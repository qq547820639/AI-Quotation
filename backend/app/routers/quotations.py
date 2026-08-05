"""报价单路由：list / get / create / saveDraft / submit

注：GET /inquiries/{inquiryId}/quotations 在 inquiries 路由中实现（前缀归属）
"""
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..idempotency import get_result, store_result
from ..models import User, Quotation, QuotationItem, Inquiry, InquiryLog
from ..schemas import (
    QuotationSchema, QuotationCreate, QuotationDraft, SuccessResult,
    PaginatedQuotationsSchema,
)
from ..auth import get_current_user
from ..policy import require_inquiry_access
from ..serializers import quotation_to_schema, gen_id, now_str
from ..events import publish

router = APIRouter(prefix="/quotations", tags=["quotations"])

QUOTATION_SUBMITTED = "SUBMITTED"
LOG_TYPE_SUBMIT_QUOTATION = "SUBMIT_QUOTATION"


def _get_quotation_with_access(db: Session, user: User, quotation_id: str) -> Quotation:
    """按 ID 加载报价单并做组织级访问校验（P1：报价单属询价单，复用 require_inquiry_access）。

    报价单本身无 organization 字段，其归属由父询价单决定；因此加载报价后校验父询价单，
    用户无权访问该询价单时返回 403，防止跨组织 IDOR。
    """
    q = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")
    inq = db.query(Inquiry).filter(Inquiry.id == q.inquiry_id).first()
    if inq is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问该报价单",
        )
    require_inquiry_access(user, inq)
    return q


def _build_quotation_from_data(data: dict) -> Quotation:
    """从请求 dict 构造 Quotation ORM（含 items）"""
    q = Quotation(
        id=data.get("id") or gen_id("q"),
        inquiry_id=data["inquiryId"],
        supplier_id=data["supplierId"],
        supplier_name=data.get("supplierName", ""),
        status=data.get("status", "DRAFT"),
        submitted_at=data.get("submittedAt"),
        total_amount=data.get("totalAmount", 0),
        remark=data.get("remark"),
        created_at=data.get("createdAt") or now_str(),
        updated_at=data.get("updatedAt") or now_str(),
    )
    for item_data in data.get("items", []) or []:
        q.items.append(QuotationItem(
            id=item_data.get("id") or gen_id("qitem"),
            quotation_id=q.id,
            inquiry_item_id=item_data["inquiryItemId"],
            unit_price=item_data.get("unitPrice", 0),
            tax_rate=item_data.get("taxRate", 0),
            tax_included_total=item_data.get("taxIncludedTotal", 0),
            moq=item_data.get("moq"),
            delivery_days=item_data.get("deliveryDays", 0),
            delivery_date=item_data.get("deliveryDate"),
            brand=item_data.get("brand"),
            warranty_months=item_data.get("warrantyMonths"),
            payment_terms=item_data.get("paymentTerms"),
            valid_until=item_data.get("validUntil"),
            tech_deviation=item_data.get("techDeviation"),
            commercial_deviation=item_data.get("commercialDeviation"),
            remark=item_data.get("remark"),
        ))
    return q


@router.get("")
def list_quotations(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    page: Optional[int] = Query(default=None, ge=1),
    pageSize: Optional[int] = Query(default=None, ge=1, le=200),
):
    """报价列表（P2 Task 22：服务端分页 + 稳定排序 + joinedload 消除 items N+1）

    - 向后兼容：不传分页参数时返回全量数组（保持既有调用不变）。
    - 传入 page/pageSize 时返回分页结构 {items, total, page, pageSize}。
    """
    # Task 7 / Task 22：稳定排序（created_at,id 双键）+ joinedload 消除 items N+1
    query = (
        db.query(Quotation)
        .options(joinedload(Quotation.items))
        .order_by(Quotation.created_at, Quotation.id)
    )
    if page is None and pageSize is None:
        rows = query.all()
        return [quotation_to_schema(q, db) for q in rows]

    _page = page if page is not None else 1
    _size = pageSize if pageSize is not None else 20
    total = db.query(Quotation).count()
    rows = query.offset((_page - 1) * _size).limit(_size).all()
    return PaginatedQuotationsSchema(
        items=[quotation_to_schema(q, db) for q in rows],
        total=total,
        page=_page,
        pageSize=_size,
    )


@router.get("/{quotation_id}", response_model=QuotationSchema)
def get_quotation(
    quotation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _get_quotation_with_access(db, user, quotation_id)
    return quotation_to_schema(q, db)


@router.post("", response_model=QuotationSchema)
def create_quotation(
    body: QuotationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = body.model_dump()
    # 组织级校验：报价必须归属当前用户可访问的询价单
    inq = db.query(Inquiry).filter(Inquiry.id == data["inquiryId"]).first()
    if inq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    require_inquiry_access(user, inq)
    q = _build_quotation_from_data(data)
    db.add(q)
    try:
        db.commit()
    except IntegrityError:
        # Task 6：uq_quotations_inquiry_id_supplier_id 唯一约束兜底，重复提交返回 409
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_type": "duplicate_quotation",
                "message": "该供应商已存在此询价单的报价，请勿重复创建",
                "inquiryId": data["inquiryId"],
                "supplierId": data.get("supplierId"),
            },
        )
    db.refresh(q)
    return quotation_to_schema(q, db)


@router.put("/{quotation_id}/draft", response_model=QuotationSchema)
def save_draft(
    quotation_id: str,
    body: QuotationDraft,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _get_quotation_with_access(db, user, quotation_id)
    data = body.model_dump(exclude_unset=True)
    # 更新标量字段
    scalar_map = {
        "supplierId": "supplier_id", "supplierName": "supplier_name",
        "status": "status", "submittedAt": "submitted_at",
        "totalAmount": "total_amount", "remark": "remark",
    }
    for camel, snake in scalar_map.items():
        if camel in data:
            setattr(q, snake, data[camel])
    # 更新 items（整体替换）
    if "items" in data:
        for old_item in q.items:
            db.delete(old_item)
        q.items = []
        for item_data in data["items"] or []:
            q.items.append(QuotationItem(
                id=item_data.get("id") or gen_id("qitem"),
                quotation_id=q.id,
                inquiry_item_id=item_data["inquiryItemId"],
                unit_price=item_data.get("unitPrice", 0),
                tax_rate=item_data.get("taxRate", 0),
                tax_included_total=item_data.get("taxIncludedTotal", 0),
                moq=item_data.get("moq"),
                delivery_days=item_data.get("deliveryDays", 0),
                delivery_date=item_data.get("deliveryDate"),
                brand=item_data.get("brand"),
                warranty_months=item_data.get("warrantyMonths"),
                payment_terms=item_data.get("paymentTerms"),
                valid_until=item_data.get("validUntil"),
                tech_deviation=item_data.get("techDeviation"),
                commercial_deviation=item_data.get("commercialDeviation"),
                remark=item_data.get("remark"),
            ))
    q.updated_at = now_str()
    db.commit()
    db.refresh(q)
    return quotation_to_schema(q, db)


@router.post("/{quotation_id}/submit", response_model=QuotationSchema)
def submit_quotation(
    quotation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    body: dict = Body(default=None),
):
    """提交报价：status→SUBMITTED, submittedAt=now, 追加 SUBMIT_QUOTATION 日志到对应 inquiry

    Task 6 幂等：请求体可携带 idempotencyKey，已处理过则直接返回缓存结果，避免重复日志/重复事件。
    """
    idem_key = body.get("idempotencyKey") if body else None
    if idem_key:
        cached = get_result(idem_key, "quotations.submit")
        if cached is not None:
            return cached

    q = _get_quotation_with_access(db, user, quotation_id)
    ts = now_str()
    q.status = QUOTATION_SUBMITTED
    q.submitted_at = ts
    q.updated_at = ts
    # 追加日志到父询价单
    inquiry = db.query(Inquiry).filter(Inquiry.id == q.inquiry_id).first()
    if inquiry is not None:
        log = InquiryLog(
            id=gen_id(f"log-{inquiry.id}"),
            inquiry_id=inquiry.id,
            time=ts,
            operator=q.supplier_name,
            operator_role="供应商",
            type=LOG_TYPE_SUBMIT_QUOTATION,
            content="提交报价",
        )
        db.add(log)
        inquiry.updated_at = ts
    db.commit()
    db.refresh(q)
    # P2-12 Task 17：广播报价提交事件，SSE 订阅端据此刷新未读/详情/比价/通知中心
    publish("quotation_submitted", {"quotationId": q.id, "inquiryId": q.inquiry_id, "supplierId": q.supplier_id})
    result = quotation_to_schema(q, db)
    if idem_key:
        store_result(idem_key, "quotations.submit", result)
    return result
