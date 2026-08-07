"""供应商门户 API：基于邀请 token 认证（非内部 Bearer token）

所有端点位于 /api/portal 前缀下，使用独立的邀请 token 认证依赖。
Token 通过请求头 X-Invitation-Token 传递（GET 亦可使用 query 参数 token）。

字段最小化：响应绝不暴露其他受邀供应商、其他供应商报价、采购内部评论、
目标价、审批信息或内部日志。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import ALLOWED_UPLOAD_EXTENSIONS, ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE
from ..database import get_db
from ..idempotency import get_result, store_result
from ..invitations import get_invitation_by_token, is_invitation_valid, invitation_error
from ..money import compute_item_totals, compute_quotation_total, to_decimal
from ..models import (
    SupplierInvitation, Inquiry, InquiryItem, Quotation, QuotationItem,
    Attachment, Supplier,
)
from ..scanner import ScanStatus, get_scanner, run_scan
from ..serializers import attachments_for, now_str, gen_id
from ..state_machine import can_revise_submitted_quotation
from ..storage import get_storage_singleton, sanitize_filename

router = APIRouter(prefix="/portal", tags=["portal"])

# 审计日志
audit_logger = logging.getLogger("procurement.audit")

# 邀请状态
INV_SUBMITTED = "submitted"
INV_REVOKED = "revoked"
INV_OPENED = "opened"

# 报价状态
Q_DRAFT = "DRAFT"
Q_SUBMITTED_STATUS = "SUBMITTED"

# 终端询价状态（供应商不可再访问）
_TERMINAL_INQUIRY = ("COMPLETED", "CANCELLED", "TIMEOUT")


# ============ 邀请 token 认证依赖 ============

def _read_token(request: Request) -> str | None:
    token = request.headers.get("X-Invitation-Token")
    if not token and request.method == "GET":
        token = request.query_params.get("token")
    return token


def _resolve_invitation(
    request: Request,
    db: Session,
    allow_submitted: bool = False,
    allow_terminal: bool = False,
) -> SupplierInvitation:
    """解析邀请 token 并返回邀请；按需拒绝已提交/已过期/已撤销状态。"""
    token = _read_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少邀请 token")
    invitation = get_invitation_by_token(db, token)
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邀请 token 无效")

    # 已提交：若允许（submit 幂等 / receipt），则返回；否则 410
    if invitation.status == INV_SUBMITTED:
        if not allow_submitted:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail={"error_type": "invitation_submitted", "message": "该邀请已完成报价提交"},
            )
        return invitation

    # 已撤销 / 过期 / 询价终态：拒绝
    if not is_invitation_valid(invitation):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error_type": invitation_error(invitation), "message": "邀请已失效"},
        )
    return invitation


def get_invitation_from_token(
    request: Request,
    db: Session = Depends(get_db),
) -> SupplierInvitation:
    """严格依赖：401 未找到 / 403 已撤销或过期 / 410 已提交"""
    return _resolve_invitation(request, db, allow_submitted=False, allow_terminal=False)


def get_invitation_allow_submitted(
    request: Request,
    db: Session = Depends(get_db),
) -> SupplierInvitation:
    """允许已提交状态的依赖（submit 幂等 / receipt 使用）"""
    return _resolve_invitation(request, db, allow_submitted=True, allow_terminal=False)


def get_invitation_permissive(
    request: Request,
    db: Session = Depends(get_db),
) -> SupplierInvitation:
    """宽松依赖：仅校验 token 存在（validate 使用，返回任意状态）"""
    token = _read_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少邀请 token")
    invitation = get_invitation_by_token(db, token)
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邀请 token 无效")
    return invitation


# ============ 序列化辅助 ============

def _supplier_visible_item(item: InquiryItem, db: Session) -> dict:
    return {
        "id": item.id,
        "inquiryItemId": item.id,
        "name": item.name,
        "code": item.code,
        "category": item.category,
        "brand": item.brand,
        "spec": item.spec,
        "techParams": item.tech_params,
        "unit": item.unit,
        "quantity": item.quantity,
        "expectedDeliveryDate": item.expected_delivery_date,
        "remark": item.remark,
        # 注意：绝不暴露 targetPrice
        "attachments": [a.dict() for a in attachments_for(db, "inquiry_item", item.id)],
    }


def _supplier_visible_inquiry(inquiry: Inquiry, db: Session) -> dict:
    return {
        "id": inquiry.id,
        "code": inquiry.code,
        "subject": inquiry.subject,
        "organization": inquiry.organization,
        "currency": inquiry.currency,
        "deadline": inquiry.deadline,
        "expectedDeliveryDate": inquiry.expected_delivery_date,
        "deliveryAddress": inquiry.delivery_address,
        "contact": inquiry.contact,
        "paymentTerms": inquiry.payment_terms,
        "invoiceRequirement": inquiry.invoice_requirement,
        "description": inquiry.description,
        "status": inquiry.status,
        "items": [_supplier_visible_item(i, db) for i in inquiry.items],
        "attachments": [a.dict() for a in attachments_for(db, "inquiry", inquiry.id)],
        # 绝不暴露：targetPrice / purchaserComments / selectedSupplierMap / logs / approvalNodes / invitedSupplierIds / quotations
    }


def _quotation_item_dict(item: QuotationItem, db: Session) -> dict:
    return {
        "id": item.id,
        "quotationId": item.quotation_id,
        "inquiryItemId": item.inquiry_item_id,
        "unitPrice": float(item.unit_price),
        "taxRate": float(item.tax_rate),
        "taxIncludedTotal": float(item.tax_included_total),
        "moq": item.moq,
        "deliveryDays": item.delivery_days,
        "deliveryDate": item.delivery_date,
        "brand": item.brand,
        "warrantyMonths": item.warranty_months,
        "paymentTerms": item.payment_terms,
        "validUntil": item.valid_until,
        "techDeviation": item.tech_deviation,
        "commercialDeviation": item.commercial_deviation,
        "remark": item.remark,
        "attachments": [a.dict() for a in attachments_for(db, "quotation_item", item.id)],
    }


def _quotation_dict(quotation: Quotation, db: Session) -> dict:
    return {
        "id": quotation.id,
        "inquiryId": quotation.inquiry_id,
        "supplierId": quotation.supplier_id,
        "supplierName": quotation.supplier_name,
        "status": quotation.status,
        "submittedAt": quotation.submitted_at,
        "totalAmount": float(quotation.total_amount),
        "remark": quotation.remark,
        "items": [_quotation_item_dict(i, db) for i in quotation.items],
        "attachments": [a.dict() for a in attachments_for(db, "quotation", quotation.id)],
        "createdAt": quotation.created_at,
        "updatedAt": quotation.updated_at,
    }


def _receipt(quotation: Quotation, db: Session) -> dict:
    return {
        "quotationId": quotation.id,
        "inquiryId": quotation.inquiry_id,
        "supplierId": quotation.supplier_id,
        "supplierName": quotation.supplier_name,
        "submittedAt": quotation.submitted_at,
        "totalAmount": float(quotation.total_amount),
        "receiptCode": quotation.receipt_code,
        "status": quotation.status,
    }


# ============ 报价读写辅助 ============

def _find_quotation(db: Session, invitation: SupplierInvitation) -> Quotation | None:
    return db.query(Quotation).filter(
        Quotation.inquiry_id == invitation.inquiry_id,
        Quotation.supplier_id == invitation.supplier_id,
    ).first()


def _build_quotation_items(db: Session, invitation: SupplierInvitation, items_data: list) -> list[QuotationItem]:
    """由客户端明细数据构造 QuotationItem，服务端重算 tax_included_total。

    不信任客户端传入的 taxIncludedTotal / totalAmount。
    """
    result = []
    for it in items_data or []:
        inquiry_item_id = it.get("inquiryItemId")
        if not inquiry_item_id:
            raise HTTPException(status_code=422, detail="报价明细缺少 inquiryItemId")
        inquiry_item = db.query(InquiryItem).filter(InquiryItem.id == inquiry_item_id).first()
        if inquiry_item is None or inquiry_item.inquiry_id != invitation.inquiry_id:
            raise HTTPException(status_code=422, detail=f"报价明细不属于该询价单: {inquiry_item_id}")
        quantity = inquiry_item.quantity
        unit_price = to_decimal(it.get("unitPrice"))
        tax_rate = to_decimal(it.get("taxRate"))
        if tax_rate < 0 or tax_rate > 1:
            raise HTTPException(status_code=422, detail="税率必须在 0~1 之间")
        tax_included_total = compute_item_totals(unit_price, quantity, tax_rate)
        result.append(QuotationItem(
            id=it.get("id") or gen_id("qitem"),
            quotation_id=None,  # 由调用方在关联后设置
            inquiry_item_id=inquiry_item_id,
            unit_price=unit_price,
            tax_rate=tax_rate,
            tax_included_total=tax_included_total,
            moq=it.get("moq"),
            delivery_days=it.get("deliveryDays", 0),
            delivery_date=it.get("deliveryDate"),
            brand=it.get("brand"),
            warranty_months=it.get("warrantyMonths"),
            payment_terms=it.get("paymentTerms"),
            valid_until=it.get("validUntil"),
            tech_deviation=it.get("techDeviation"),
            commercial_deviation=it.get("commercialDeviation"),
            remark=it.get("remark"),
        ))
    return result


def _replace_quotation_items(db: Session, quotation: Quotation, items: list[QuotationItem]) -> None:
    for old in quotation.items:
        db.delete(old)
    quotation.items = []
    for item in items:
        item.quotation_id = quotation.id
        quotation.items.append(item)
    quotation.total_amount = compute_quotation_total(quotation.items)


def _supplier_name(db: Session, invitation: SupplierInvitation) -> str:
    supplier = db.query(Supplier).filter(Supplier.id == invitation.supplier_id).first()
    return supplier.name if supplier else ""


# ============ 端点 ============

@router.get("/invitations/validate")
def validate_invitation(
    invitation: SupplierInvitation = Depends(get_invitation_permissive),
    db: Session = Depends(get_db),
):
    """校验邀请 token，返回状态与询价概要；同时更新首次/最近打开时间。"""
    now = datetime.now(timezone.utc)
    if invitation.status == INV_SUBMITTED:
        status_val = "submitted"
    elif invitation.status == INV_REVOKED:
        status_val = "revoked"
    elif not is_invitation_valid(invitation):
        status_val = "expired"
    else:
        status_val = "valid"
        if invitation.first_opened_at is None:
            invitation.first_opened_at = now
            invitation.status = INV_OPENED
        invitation.last_opened_at = now
        invitation.delivery_status = "opened"  # P1-8 Task 12: 打开即视为已送达
        db.commit()

    inquiry = db.query(Inquiry).filter(Inquiry.id == invitation.inquiry_id).first()
    supplier = db.query(Supplier).filter(Supplier.id == invitation.supplier_id).first()
    return {
        "status": status_val,
        "invitationId": invitation.id,
        "inquiryId": invitation.inquiry_id,
        "inquiryCode": inquiry.code if inquiry else None,
        "supplierId": invitation.supplier_id,
        "supplierName": supplier.name if supplier else None,
        "deadline": inquiry.deadline if inquiry else None,
        "expiresAt": invitation.expires_at.isoformat() if invitation.expires_at else None,
    }


@router.get("/inquiries")
def portal_inquiry(
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """返回供应商可见的询价单（不含 target_price / 其他供应商 / 内部信息）"""
    inquiry = db.query(Inquiry).filter(Inquiry.id == invitation.inquiry_id).first()
    if inquiry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    return _supplier_visible_inquiry(inquiry, db)


@router.get("/quotations/current")
def portal_current_quotation(
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """返回供应商当前草稿报价（若存在），否则 null"""
    quotation = _find_quotation(db, invitation)
    if quotation is None:
        return None
    return _quotation_dict(quotation, db)


@router.put("/quotations/draft")
def portal_save_draft(
    body: dict,
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """保存/更新草稿报价。服务端重算各项金额与总价。"""
    quotation = _find_quotation(db, invitation)
    items_data = body.get("items", [])
    new_items = _build_quotation_items(db, invitation, items_data)

    if quotation is None:
        quotation = Quotation(
            id=gen_id("q"),
            inquiry_id=invitation.inquiry_id,
            supplier_id=invitation.supplier_id,
            supplier_name=_supplier_name(db, invitation),
            status=Q_DRAFT,
            total_amount=Decimal("0"),
            remark=body.get("remark"),
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(quotation)
        db.flush()
    else:
        quotation.remark = body.get("remark")
        quotation.updated_at = now_str()

    _replace_quotation_items(db, quotation, new_items)
    db.commit()
    db.refresh(quotation)
    return _quotation_dict(quotation, db)


@router.post("/quotations/submit")
def portal_submit_quotation(
    body: dict,
    invitation: SupplierInvitation = Depends(get_invitation_allow_submitted),
    db: Session = Depends(get_db),
):
    """正式提交报价。幂等：若已提交则返回既有回执（200）。"""
    # 幂等：若有 Idempotency-Key 且已处理，直接返回缓存结果
    idem_key = None
    if isinstance(body, dict):
        idem_key = body.get("idempotencyKey")
    if idem_key:
        cached = get_result(idem_key, "portal.submit_quotation")
        if cached is not None:
            return cached

    if invitation.status == INV_SUBMITTED:
        quotation = _find_quotation(db, invitation)
        if quotation is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")
        result = _receipt(quotation, db)
        if idem_key:
            store_result(idem_key, "portal.submit_quotation", result)
        return result

    inquiry = db.query(Inquiry).filter(Inquiry.id == invitation.inquiry_id).first()
    if inquiry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="询价单不存在")
    if inquiry.status in ("COMPLETED", "CANCELLED", "TIMEOUT"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="询价已结束，无法提交报价")

    quotation = _find_quotation(db, invitation)
    if quotation is None:
        quotation = Quotation(
            id=gen_id("q"),
            inquiry_id=invitation.inquiry_id,
            supplier_id=invitation.supplier_id,
            supplier_name=_supplier_name(db, invitation),
            status=Q_DRAFT,
            total_amount=Decimal("0"),
            remark=body.get("remark") if isinstance(body, dict) else None,
            created_at=now_str(),
            updated_at=now_str(),
        )
        db.add(quotation)
        db.flush()

    items_data = (body.get("items", []) if isinstance(body, dict) else [])
    new_items = _build_quotation_items(db, invitation, items_data)
    for item in new_items:
        if item.unit_price <= 0:
            raise HTTPException(status_code=422, detail="所有明细的单价必须大于 0")
        if item.delivery_days is None or item.delivery_days < 0:
            raise HTTPException(status_code=422, detail="所有明细必须填写交货天数")
    _replace_quotation_items(db, quotation, new_items)

    ts = now_str()
    quotation.status = Q_SUBMITTED_STATUS
    quotation.submitted_at = ts
    quotation.updated_at = ts
    quotation.receipt_code = gen_id(f"RCP-{quotation.id}")

    # 更新邀请状态
    invitation.status = INV_SUBMITTED
    invitation.submitted_at = datetime.now(timezone.utc)
    invitation.delivery_status = "submitted"  # P1-8 Task 12: 提交即标记交付完成

    db.commit()
    db.refresh(quotation)
    result = _receipt(quotation, db)
    if idem_key:
        store_result(idem_key, "portal.submit_quotation", result)
    return result


@router.post("/quotations/revise")
def portal_revise_quotation(
    invitation: SupplierInvitation = Depends(get_invitation_allow_submitted),
    db: Session = Depends(get_db),
):
    """若询价允许修改，将已提交报价回退为草稿以允许重新提交。"""
    if invitation.status != INV_SUBMITTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前邀请未提交，无法撤回")

    quotation = _find_quotation(db, invitation)
    if quotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")

    inquiry = db.query(Inquiry).filter(Inquiry.id == invitation.inquiry_id).first()
    if inquiry is None or not can_revise_submitted_quotation(inquiry.status):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="当前询价状态不允许撤回报价")

    quotation.status = Q_DRAFT
    quotation.submitted_at = None
    quotation.updated_at = now_str()
    quotation.receipt_code = None
    invitation.status = "opened"
    invitation.delivery_status = "opened"
    db.commit()
    db.refresh(quotation)
    return _quotation_dict(quotation, db)


@router.get("/quotations/receipt")
def portal_receipt(
    invitation: SupplierInvitation = Depends(get_invitation_allow_submitted),
    db: Session = Depends(get_db),
):
    """返回已提交报价的回执。"""
    if invitation.status != INV_SUBMITTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="报价尚未提交")
    quotation = _find_quotation(db, invitation)
    if quotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")
    return _receipt(quotation, db)


# ============ 附件 ============

def _verify_attachment_ownership(invitation: SupplierInvitation, owner_type: str, owner_id: str, db: Session) -> None:
    """校验附件归属：必须属于该邀请对应供应商的报价。"""
    if owner_type not in ("quotation", "quotation_item"):
        raise HTTPException(status_code=403, detail="仅允许 quotation/quotation_item 类型附件")
    if owner_type == "quotation":
        q = db.query(Quotation).filter(Quotation.id == owner_id).first()
        if q is None or q.inquiry_id != invitation.inquiry_id or q.supplier_id != invitation.supplier_id:
            raise HTTPException(status_code=403, detail="无权上传该报价附件")
    else:
        item = db.query(QuotationItem).filter(QuotationItem.id == owner_id).first()
        if item is None:
            raise HTTPException(status_code=403, detail="无权上传该报价明细附件")
        q = db.query(Quotation).filter(Quotation.id == item.quotation_id).first()
        if q is None or q.inquiry_id != invitation.inquiry_id or q.supplier_id != invitation.supplier_id:
            raise HTTPException(status_code=403, detail="无权上传该报价明细附件")


@router.post("/attachments")
async def portal_upload_attachment(
    owner_type: str,
    owner_id: str,
    file: UploadFile = File(...),
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """上传附件（限 pdf/图片/xlsx/docx，≤10MB）。"""
    _verify_attachment_ownership(invitation, owner_type, owner_id, db)

    # 清洗原始文件名（去除路径分隔符/危险字符），不信任原始文件名
    raw_filename = file.filename or ""
    filename = sanitize_filename(raw_filename)
    ext = Path(filename).suffix.lower()
    content_type = file.content_type or ""
    if content_type not in ALLOWED_UPLOAD_MIME_TYPES:
        raise HTTPException(status_code=415, detail=f"不支持的 MIME 类型: {content_type}")
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"不支持的扩展名: {ext}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="文件大小超过限制（10MB）")

    # 使用随机 id 命名物理文件，不信任原始文件名
    attachment_id = gen_id("att")
    ok, err = get_storage_singleton().save(attachment_id, data, filename)
    if not ok:
        audit_logger.warning(
            "attachment_storage_save_failed",
            extra={"extra_fields": {"action": "attachment_upload", "attachment_id": attachment_id,
                                    "owner": f"{owner_type}:{owner_id}", "error": err}},
        )
        raise HTTPException(status_code=500, detail="附件保存失败")

    upload_time = now_str()
    record = Attachment(
        id=attachment_id,
        name=filename,
        url=get_storage_singleton().url_for(attachment_id, filename),
        size=len(data),
        upload_time=upload_time,
        owner_type=owner_type,
        owner_id=owner_id,
        scan_status="pending",
        scan_result=None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    audit_logger.info(
        "attachment_uploaded",
        extra={"extra_fields": {"action": "attachment_upload", "attachment_id": record.id,
                                "owner": f"{owner_type}:{owner_id}", "size": record.size}},
    )
    # P0：上传后立即执行病毒扫描（生产 fail closed）。未通过（infected/error）保持不可下载。
    scan_result = get_scanner().scan(data, filename, content_type)
    record.scan_status = scan_result.status
    record.scan_result = scan_result.result
    db.commit()
    db.refresh(record)
    audit_logger.info(
        "attachment_scanned",
        extra={"extra_fields": {"action": "attachment_scan", "attachment_id": record.id,
                                "owner": f"{owner_type}:{owner_id}", "scan_status": record.scan_status,
                                "scan_result": record.scan_result}},
    )
    return {
        "id": record.id,
        "name": record.name,
        "url": record.url,
        "size": record.size,
        "uploadTime": record.upload_time,
        "scanStatus": record.scan_status,
        "scanResult": record.scan_result,
    }


@router.delete("/attachments/{attachment_id}")
def portal_delete_attachment(
    attachment_id: str,
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """删除附件：仅归属该邀请报价的附件。"""
    record = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="附件不存在")
    _verify_attachment_ownership(invitation, record.owner_type, record.owner_id, db)

    # 删除物理文件（通过存储抽象）
    get_storage_singleton().delete(attachment_id)

    owner = f"{record.owner_type}:{record.owner_id}"
    db.delete(record)
    db.commit()
    audit_logger.info(
        "attachment_deleted",
        extra={"extra_fields": {"action": "attachment_delete", "attachment_id": attachment_id, "owner": owner}},
    )
    return {"success": True, "id": attachment_id}


@router.get("/attachments/{attachment_id}/download")
def portal_download_attachment(
    attachment_id: str,
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """下载附件：需邀请认证 + 归属校验。"""
    record = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="附件不存在")
    _verify_attachment_ownership(invitation, record.owner_type, record.owner_id, db)

    # P0：仅允许下载通过病毒扫描（clean）的附件；infected/error/pending 一律禁止
    if record.scan_status != ScanStatus.CLEAN:
        audit_logger.warning(
            "attachment_download_blocked",
            extra={"extra_fields": {"action": "attachment_download", "attachment_id": attachment_id,
                                    "owner": f"{record.owner_type}:{record.owner_id}",
                                    "scan_status": record.scan_status}},
        )
        raise HTTPException(
            status_code=403,
            detail=f"附件未通过安全检查，禁止下载（状态: {record.scan_status}）",
        )

    data = get_storage_singleton().read(attachment_id)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="附件文件缺失")

    audit_logger.info(
        "attachment_downloaded",
        extra={"extra_fields": {"action": "attachment_download", "attachment_id": attachment_id,
                                "owner": f"{record.owner_type}:{record.owner_id}"}},
    )
    # 使用 Content-Disposition 指定下载文件名，避免依赖物理文件名
    from urllib.parse import quote
    disposition = f"attachment; filename*=UTF-8''{quote(record.name)}"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": disposition},
    )


@router.post("/attachments/{attachment_id}/scan")
def portal_scan_attachment(
    attachment_id: str,
    invitation: SupplierInvitation = Depends(get_invitation_from_token),
    db: Session = Depends(get_db),
):
    """对附件执行占位病毒扫描（预留接口）。

    当前为占位扫描器，真实环境可替换为 ClamAV / VirusTotal 等。
    """
    record = db.query(Attachment).filter(Attachment.id == attachment_id).first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="附件不存在")
    _verify_attachment_ownership(invitation, record.owner_type, record.owner_id, db)

    status_val = run_scan(record)
    db.commit()
    db.refresh(record)
    audit_logger.info(
        "attachment_scanned",
        extra={"extra_fields": {"action": "attachment_scan", "attachment_id": attachment_id,
                                "owner": f"{record.owner_type}:{record.owner_id}", "scan_status": status_val}},
    )
    return {"id": record.id, "scanStatus": record.scan_status, "scanResult": record.scan_result}