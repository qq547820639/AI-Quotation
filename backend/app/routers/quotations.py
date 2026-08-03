"""报价单路由：list / get / create / saveDraft / submit

注：GET /inquiries/{inquiryId}/quotations 在 inquiries 路由中实现（前缀归属）
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Quotation, QuotationItem, Inquiry, InquiryLog
from ..schemas import QuotationSchema, QuotationCreate, QuotationDraft, SuccessResult
from ..auth import get_current_user
from ..serializers import quotation_to_schema, gen_id, now_str

router = APIRouter(prefix="/quotations", tags=["quotations"])

QUOTATION_SUBMITTED = "SUBMITTED"
LOG_TYPE_SUBMIT_QUOTATION = "SUBMIT_QUOTATION"


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


@router.get("", response_model=list[QuotationSchema])
def list_quotations(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Quotation).all()
    return [quotation_to_schema(q, db) for q in rows]


@router.get("/{quotation_id}", response_model=QuotationSchema)
def get_quotation(
    quotation_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")
    return quotation_to_schema(q, db)


@router.post("", response_model=QuotationSchema)
def create_quotation(
    body: QuotationCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = body.model_dump()
    q = _build_quotation_from_data(data)
    db.add(q)
    db.commit()
    db.refresh(q)
    return quotation_to_schema(q, db)


@router.put("/{quotation_id}/draft", response_model=QuotationSchema)
def save_draft(
    quotation_id: str,
    body: QuotationDraft,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")
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
    _: User = Depends(get_current_user),
):
    """提交报价：status→SUBMITTED, submittedAt=now, 追加 SUBMIT_QUOTATION 日志到对应 inquiry"""
    q = db.query(Quotation).filter(Quotation.id == quotation_id).first()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报价单不存在")
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
    return quotation_to_schema(q, db)
