"""用户路由：表格视图/列配置持久化（P2-12 Task 17）

GET /api/users/table-preferences/{pageKey}  读取某页面表格偏好
PUT /api/users/table-preferences/{pageKey}  保存某页面表格偏好（JSON 存 user_table_preferences 表）
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, UserTablePreference
from ..schemas import TablePreferencesSchema
from ..auth import get_current_user
from ..serializers import now_str

router = APIRouter(prefix="/users", tags=["users"])


def _row(db: Session, user_id: str, page_key: str) -> UserTablePreference | None:
    return db.query(UserTablePreference).filter(
        UserTablePreference.user_id == user_id,
        UserTablePreference.page_key == page_key,
    ).first()


@router.get("/table-preferences/{page_key}", response_model=TablePreferencesSchema)
def get_table_preference(
    page_key: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """读取用户在某页面的表格偏好；未保存时返回默认空 data。"""
    row = _row(db, user.id, page_key)
    return TablePreferencesSchema(
        pageKey=page_key,
        data=row.data if row and row.data else {},
    )


@router.put("/table-preferences/{page_key}", response_model=TablePreferencesSchema)
def put_table_preference(
    page_key: str,
    body: TablePreferencesSchema,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """保存用户在某页面的表格偏好（整体覆盖 data）。"""
    row = _row(db, user.id, page_key)
    if row is None:
        row = UserTablePreference(
            user_id=user.id,
            page_key=page_key,
            data=body.data or {},
            updated_at=now_str(),
        )
        db.add(row)
    else:
        row.data = body.data or {}
        row.updated_at = now_str()
    db.commit()
    db.refresh(row)
    return TablePreferencesSchema(pageKey=page_key, data=row.data or {})