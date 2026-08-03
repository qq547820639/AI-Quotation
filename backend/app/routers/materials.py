"""物料路由：list / get / create / update / delete / batch"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Material
from ..schemas import MaterialSchema, MaterialCreate, BatchMaterials, SuccessResult
from ..auth import get_current_user, require_permission
from ..serializers import material_to_schema, gen_id

router = APIRouter(prefix="/materials", tags=["materials"])


@router.get("", response_model=list[MaterialSchema])
def list_materials(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Material).all()
    return [material_to_schema(m) for m in rows]


@router.post("/batch")
def batch_materials(
    body: BatchMaterials,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("MATERIAL_MANAGE")),
):
    """批量导入：upsert by code，返回成功条数（对齐前端 {success: number}）"""
    success = 0
    for item in body.items:
        code = item.get("code")
        if not code:
            continue
        existing = db.query(Material).filter(Material.code == code).first()
        if existing is None:
            db.add(Material(
                id=item.get("id") or gen_id("mat"),
                code=code,
                name=item.get("name", ""),
                category=item.get("category", ""),
                brand=item.get("brand", ""),
                spec=item.get("spec", ""),
                tech_params=item.get("techParams", item.get("tech_params", "")),
                unit=item.get("unit", ""),
                stock_qty=item.get("stockQty", item.get("stock_qty")),
            ))
        else:
            for camel, snake in {
                "name": "name", "category": "category", "brand": "brand",
                "spec": "spec", "unit": "unit", "stockQty": "stock_qty",
            }.items():
                if camel in item:
                    setattr(existing, snake, item[camel])
            if "techParams" in item:
                existing.tech_params = item["techParams"]
        success += 1
    db.commit()
    return {"success": success}


@router.get("/{material_id}", response_model=MaterialSchema)
def get_material(
    material_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    mat = db.query(Material).filter(Material.id == material_id).first()
    if mat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物料不存在")
    return material_to_schema(mat)


@router.post("", response_model=MaterialSchema)
def create_material(
    body: MaterialCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("MATERIAL_MANAGE")),
):
    data = body.model_dump(exclude_none=True)
    mat = Material(
        id=data.get("id") or gen_id("mat"),
        code=data.get("code", ""),
        name=data.get("name", ""),
        category=data.get("category", ""),
        brand=data.get("brand", ""),
        spec=data.get("spec", ""),
        tech_params=data.get("techParams", ""),
        unit=data.get("unit", ""),
        stock_qty=data.get("stockQty"),
    )
    db.add(mat)
    db.commit()
    db.refresh(mat)
    return material_to_schema(mat)


@router.put("/{material_id}", response_model=MaterialSchema)
def update_material(
    material_id: str,
    body: MaterialCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("MATERIAL_MANAGE")),
):
    mat = db.query(Material).filter(Material.id == material_id).first()
    if mat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物料不存在")
    data = body.model_dump(exclude_unset=True)
    field_map = {
        "code": "code", "name": "name", "category": "category", "brand": "brand",
        "spec": "spec", "techParams": "tech_params", "unit": "unit", "stockQty": "stock_qty",
    }
    for camel, snake in field_map.items():
        if camel in data:
            setattr(mat, snake, data[camel])
    db.commit()
    db.refresh(mat)
    return material_to_schema(mat)


@router.delete("/{material_id}", response_model=SuccessResult)
def delete_material(
    material_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("MATERIAL_MANAGE")),
):
    mat = db.query(Material).filter(Material.id == material_id).first()
    if mat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="物料不存在")
    db.delete(mat)
    db.commit()
    return SuccessResult(success=True)
