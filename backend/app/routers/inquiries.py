"""询价单路由：list / get / create / update / delete + 6 动作端点 + 按 inquiry 查报价

动作端点均：更新 status + 追加 InquiryLog + 更新 updatedAt + 审批端点追加 ApprovalNode。
对齐 src/mocks/handlers.ts 业务逻辑。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    User, Inquiry, InquiryItem, InquiryLog, ApprovalNode, Quotation,
    Supplier, AppSettings,
)
from ..schemas import (
    InquirySchema, InquiryCreate, InquiryUpdate, ApprovalAction,
    QuotationSchema, SuccessResult,
)
from ..auth import get_current_user, require_permission, resolve_permissions
from ..serializers import inquiry_to_schema, quotation_to_schema, gen_id, now_str

router = APIRouter(prefix="/inquiries", tags=["inquiries"])

# 状态枚举值（对齐前端 InquiryStatus）
S_PENDING_APPROVAL = "PENDING_APPROVAL"
S_PENDING_CONFIRM = "PENDING_CONFIRM"
S_INQUIRING = "INQUIRING"
S_COMPLETED = "COMPLETED"
S_CANCELLED = "CANCELLED"

# 审批节点状态
APV_PENDING = "PENDING"
APV_APPROVED = "APPROVED"
APV_REJECTED = "REJECTED"

# 日志类型
LOG_SEND_INQUIRY = "SEND_INQUIRY"
LOG_CANCEL = "CANCEL"
LOG_CONFIRM_RESULT = "CONFIRM_RESULT"
LOG_SUBMIT_APPROVAL = "SUBMIT_APPROVAL"
LOG_APPROVE = "APPROVE"
LOG_REJECT = "REJECT"


def _append_log(db: Session, inquiry: Inquiry, user: User, log_type: str, content: str, result: str | None = None):
    log = InquiryLog(
        id=gen_id(f"log-{inquiry.id}"),
        inquiry_id=inquiry.id,
        time=now_str(),
        operator=user.name,
        operator_role=user.role,
        type=log_type,
        content=content,
        result=result,
    )
    db.add(log)
    inquiry.logs.append(log)


def _build_inquiry_items(inquiry_id: str, items_data: list) -> list[InquiryItem]:
    """从前端 items 构造 ORM InquiryItem 列表（items 含 material 内联对象 + 扁平字段）"""
    result = []
    for it in items_data or []:
        material = it.get("material") or {}
        result.append(InquiryItem(
            id=it.get("id") or gen_id(f"item-{inquiry_id}"),
            inquiry_id=inquiry_id,
            material_id=material.get("id") or it.get("materialId"),
            name=it.get("name", material.get("name", "")),
            code=it.get("code", material.get("code", "")),
            category=it.get("category", material.get("category", "")),
            brand=it.get("brand", material.get("brand", "")),
            spec=it.get("spec", material.get("spec", "")),
            tech_params=it.get("techParams", material.get("techParams", "")),
            unit=it.get("unit", material.get("unit", "")),
            quantity=it.get("quantity", 0),
            target_price=it.get("targetPrice"),
            expected_delivery_date=it.get("expectedDeliveryDate"),
            remark=it.get("remark"),
        ))
    return result


def _build_logs(inquiry_id: str, logs_data: list, default_user: User | None = None) -> list[InquiryLog]:
    """从前端 logs 构造 ORM InquiryLog 列表"""
    result = []
    for lg in logs_data or []:
        result.append(InquiryLog(
            id=lg.get("id") or gen_id(f"log-{inquiry_id}"),
            inquiry_id=inquiry_id,
            time=lg.get("time", now_str()),
            operator=lg.get("operator", default_user.name if default_user else "系统"),
            operator_role=lg.get("operatorRole", default_user.role if default_user else "系统"),
            type=lg.get("type", "CREATE"),
            content=lg.get("content", ""),
            result=lg.get("result"),
        ))
    return result


def _build_approval_nodes(inquiry_id: str, nodes_data: list) -> list[ApprovalNode]:
    result = []
    for nd in nodes_data or []:
        result.append(ApprovalNode(
            id=nd.get("id") or gen_id(f"apv-{inquiry_id}"),
            inquiry_id=inquiry_id,
            node_order=nd.get("nodeOrder", 1),
            approver_id=nd.get("approverId", ""),
            approver_name=nd.get("approverName", ""),
            approver_role=nd.get("approverRole", ""),
            status=nd.get("status", APV_PENDING),
            comment=nd.get("comment"),
            time=nd.get("time"),
        ))
    return result


# ============ 查询 ============

@router.get("", response_model=list[InquirySchema])
def list_inquiries(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Inquiry).order_by(Inquiry.updated_at.desc()).all()
    return [inquiry_to_schema(i, db) for i in rows]


@router.get("/{inquiry_id}/quotations", response_model=list[QuotationSchema])
def list_quotations_by_inquiry(
    inquiry_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Quotation).filter(Quotation.inquiry_id == inquiry_id).all()
    return [quotation_to_schema(q, db) for q in rows]


@router.get("/{inquiry_id}", response_model=InquirySchema)
def get_inquiry(
    inquiry_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    return inquiry_to_schema(inq, db)


# ============ 增删改 ============

@router.post("", response_model=InquirySchema)
def create_inquiry(
    body: InquiryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_CREATE")),
):
    data = body.model_dump()
    inq_id = data.get("id") or gen_id("inq")
    ts = data.get("createdAt") or now_str()
    inq = Inquiry(
        id=inq_id,
        code=data.get("code", ""),
        subject=data.get("subject", ""),
        organization=data.get("organization", user.organization),
        owner_name=data.get("ownerName", user.name),
        owner_id=data.get("ownerId", user.id),
        currency=data.get("currency", "CNY"),
        deadline=data.get("deadline", ""),
        expected_delivery_date=data.get("expectedDeliveryDate"),
        delivery_address=data.get("deliveryAddress", ""),
        contact=data.get("contact", ""),
        payment_terms=data.get("paymentTerms", ""),
        invoice_requirement=data.get("invoiceRequirement"),
        description=data.get("description"),
        status=data.get("status", "DRAFT"),
        created_by_id=data.get("createdById", user.id),
        created_by_name=data.get("createdByName", user.name),
        created_at=ts,
        updated_at=data.get("updatedAt") or ts,
        selected_supplier_map=data.get("selectedSupplierMap", {}),
        purchaser_comments=data.get("purchaserComments", {}),
    )
    # items
    inq.items = _build_inquiry_items(inq_id, data.get("items", []))
    # logs
    inq.logs = _build_logs(inq_id, data.get("logs", []), default_user=user)
    # approval nodes
    inq.approval_nodes = _build_approval_nodes(inq_id, data.get("approvalNodes", []))
    # invited suppliers
    for sup_id in data.get("invitedSupplierIds", []) or []:
        sup = db.query(Supplier).filter(Supplier.id == sup_id).first()
        if sup is not None:
            inq.invited_suppliers.append(sup)
    db.add(inq)
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.put("/{inquiry_id}", response_model=InquirySchema)
def update_inquiry(
    inquiry_id: str,
    body: InquiryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_EDIT")),
):
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    data = body.model_dump(exclude_unset=True)
    # 标量字段
    scalar_map = {
        "code": "code", "subject": "subject", "organization": "organization",
        "ownerName": "owner_name", "ownerId": "owner_id", "currency": "currency",
        "deadline": "deadline", "expectedDeliveryDate": "expected_delivery_date",
        "deliveryAddress": "delivery_address", "contact": "contact",
        "paymentTerms": "payment_terms", "invoiceRequirement": "invoice_requirement",
        "description": "description", "status": "status",
        "selectedSupplierMap": "selected_supplier_map",
        "purchaserComments": "purchaser_comments",
    }
    for camel, snake in scalar_map.items():
        if camel in data:
            setattr(inq, snake, data[camel])
    # items（整体替换）
    if "items" in data:
        for old in inq.items:
            db.delete(old)
        inq.items = _build_inquiry_items(inq.id, data["items"])
    # invited suppliers（整体替换）
    if "invitedSupplierIds" in data:
        inq.invited_suppliers = []
        for sup_id in data["invitedSupplierIds"] or []:
            sup = db.query(Supplier).filter(Supplier.id == sup_id).first()
            if sup is not None:
                inq.invited_suppliers.append(sup)
    inq.updated_at = now_str()
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.delete("/{inquiry_id}", response_model=SuccessResult)
def delete_inquiry(
    inquiry_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("INQUIRY_CANCEL")),
):
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    db.delete(inq)
    db.commit()
    return SuccessResult(success=True)


# ============ 动作端点 ============

@router.post("/{inquiry_id}/send", response_model=InquirySchema)
def send_inquiry(
    inquiry_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_SEND")),
):
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    count = len(inq.invited_suppliers)
    inq.status = S_INQUIRING
    _append_log(db, inq, user, LOG_SEND_INQUIRY, f"向 {count} 家供应商发送询价", "询价中")
    inq.updated_at = now_str()
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.post("/{inquiry_id}/cancel", response_model=InquirySchema)
def cancel_inquiry(
    inquiry_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_CANCEL")),
):
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    inq.status = S_CANCELLED
    _append_log(db, inq, user, LOG_CANCEL, "取消询价单", "已取消")
    inq.updated_at = now_str()
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.post("/{inquiry_id}/confirm", response_model=InquirySchema)
def confirm_inquiry(
    inquiry_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_CONFIRM")),
):
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    inq.status = S_COMPLETED
    _append_log(db, inq, user, LOG_CONFIRM_RESULT, "确认定标结果", "已完成")
    inq.updated_at = now_str()
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.post("/{inquiry_id}/submit-approval", response_model=InquirySchema)
def submit_approval(
    inquiry_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_SEND")),
):
    """提交审批：status→PENDING_APPROVAL + 新增 PENDING 审批节点 + 追加 SUBMIT_APPROVAL 日志

    审批人取自 AppSettings.approval_approver_id（默认 u-2）
    """
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    # 读取审批配置
    settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    approver_id = settings.approval_approver_id if settings else "u-2"
    approver = db.query(User).filter(User.id == approver_id).first()
    approver_name = approver.name if approver else "采购主管"
    approver_role = approver.role if approver else "采购主管"
    node = ApprovalNode(
        id=gen_id(f"apv-{inq.id}"),
        inquiry_id=inq.id,
        node_order=len(inq.approval_nodes) + 1,
        approver_id=approver_id,
        approver_name=approver_name,
        approver_role=approver_role,
        status=APV_PENDING,
    )
    db.add(node)
    inq.approval_nodes.append(node)
    inq.status = S_PENDING_APPROVAL
    _append_log(db, inq, user, LOG_SUBMIT_APPROVAL, f"提交审批，审批人：{approver_name}")
    inq.updated_at = now_str()
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.post("/{inquiry_id}/approve", response_model=InquirySchema)
def approve_inquiry(
    inquiry_id: str,
    body: ApprovalAction,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_APPROVE")),
):
    """审批通过：status→PENDING_CONFIRM + PENDING 节点转 APPROVED + 追加 APPROVE 日志"""
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    ts = now_str()
    for node in inq.approval_nodes:
        if node.status == APV_PENDING:
            node.status = APV_APPROVED
            node.comment = body.comment
            node.time = ts
    inq.status = S_PENDING_CONFIRM
    comment_suffix = f"：{body.comment}" if body.comment else ""
    _append_log(db, inq, user, LOG_APPROVE, f"审批通过{comment_suffix}", "已通过")
    inq.updated_at = ts
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)


@router.post("/{inquiry_id}/reject", response_model=InquirySchema)
def reject_inquiry(
    inquiry_id: str,
    body: ApprovalAction,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("INQUIRY_APPROVE")),
):
    """审批驳回：PENDING 节点转 REJECTED + 追加 REJECT 日志（status 沿用 handlers.ts 语义转 PENDING_CONFIRM）"""
    inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    ts = now_str()
    for node in inq.approval_nodes:
        if node.status == APV_PENDING:
            node.status = APV_REJECTED
            node.comment = body.comment
            node.time = ts
    inq.status = S_PENDING_CONFIRM
    comment_suffix = f"：{body.comment}" if body.comment else ""
    _append_log(db, inq, user, LOG_REJECT, f"审批驳回{comment_suffix}", "已驳回")
    inq.updated_at = ts
    db.commit()
    db.refresh(inq)
    return inquiry_to_schema(inq, db)
