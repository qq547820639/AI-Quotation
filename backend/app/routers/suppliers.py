"""供应商路由：list / get / create / update / delete / toggle-status"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Supplier
from ..schemas import SupplierSchema, SupplierCreate, SuccessResult
from ..auth import get_current_user, require_permission
from ..serializers import supplier_to_schema, gen_id

router = APIRouter(prefix="/suppliers", tags=["suppliers"])

# 合作状态枚举值（对齐前端 CooperationStatus）
COOPERATING = "COOPERATING"
DISABLED = "DISABLED"


@router.get("", response_model=list[SupplierSchema])
def list_suppliers(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Supplier).all()
    return [supplier_to_schema(s) for s in rows]


@router.get("/{supplier_id}", response_model=SupplierSchema)
def get_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sup = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if sup is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在")
    return supplier_to_schema(sup)


@router.post("", response_model=SupplierSchema)
def create_supplier(
    body: SupplierCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("SUPPLIER_MANAGE")),
):
    data = body.model_dump(exclude_none=True)
    sup = Supplier(
        id=data.get("id") or gen_id("sup"),
        code=data["code"],
        name=data["name"],
        region=data["region"],
        contact=data["contact"],
        phone=data["phone"],
        email=data["email"],
        main_categories=data.get("mainCategories", []),
        level=data.get("level", "QUALIFIED"),
        cooperation_status=data.get("cooperationStatus", COOPERATING),
        qualified=data.get("qualified", True),
        history_response_rate=data.get("historyResponseRate", 0.0),
        history_fulfillment_rate=data.get("historyFulfillmentRate", 0.0),
        avg_delivery_days=data.get("avgDeliveryDays", 0),
        last_cooperate_time=data.get("lastCooperateTime"),
        history_coop_count=data.get("historyCoopCount", 0),
    )
    db.add(sup)
    db.commit()
    db.refresh(sup)
    return supplier_to_schema(sup)


@router.put("/{supplier_id}", response_model=SupplierSchema)
def update_supplier(
    supplier_id: str,
    body: SupplierCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("SUPPLIER_MANAGE")),
):
    sup = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if sup is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在")
    data = body.model_dump(exclude_unset=True)
    field_map = {
        "code": "code", "name": "name", "region": "region", "contact": "contact",
        "phone": "phone", "email": "email", "mainCategories": "main_categories",
        "level": "level", "cooperationStatus": "cooperation_status",
        "qualified": "qualified", "historyResponseRate": "history_response_rate",
        "historyFulfillmentRate": "history_fulfillment_rate",
        "avgDeliveryDays": "avg_delivery_days",
        "lastCooperateTime": "last_cooperate_time",
        "historyCoopCount": "history_coop_count",
    }
    for camel, snake in field_map.items():
        if camel in data:
            setattr(sup, snake, data[camel])
    db.commit()
    db.refresh(sup)
    return supplier_to_schema(sup)


@router.delete("/{supplier_id}", response_model=SuccessResult)
def delete_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("SUPPLIER_MANAGE")),
):
    sup = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if sup is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在")
    db.delete(sup)
    db.commit()
    return SuccessResult(success=True)


@router.post("/{supplier_id}/toggle-status", response_model=SupplierSchema)
def toggle_status(
    supplier_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("SUPPLIER_DISABLE")),
):
    """启用/停用切换：COOPERATING ↔ DISABLED"""
    sup = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if sup is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="供应商不存在")
    if sup.cooperation_status == COOPERATING:
        sup.cooperation_status = DISABLED
    else:
        sup.cooperation_status = COOPERATING
    db.commit()
    db.refresh(sup)
    return supplier_to_schema(sup)
