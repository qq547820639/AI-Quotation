"""认证依赖 + RBAC 权限校验"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from .models import User, Token

# ============ 角色权限矩阵（对齐前端 src/types/index.ts ROLE_PERMISSIONS） ============

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "采购人员": [
        "INQUIRY_CREATE", "INQUIRY_EDIT", "INQUIRY_SEND",
        "MATERIAL_MANAGE",
    ],
    "采购主管": [
        "INQUIRY_CREATE", "INQUIRY_EDIT", "INQUIRY_SEND", "INQUIRY_APPROVE",
        "INQUIRY_CONFIRM", "INQUIRY_CANCEL",
        "MATERIAL_MANAGE", "VIEW_LOG",
    ],
    "管理员": [
        "INQUIRY_CREATE", "INQUIRY_EDIT", "INQUIRY_SEND", "INQUIRY_APPROVE",
        "INQUIRY_CONFIRM", "INQUIRY_CANCEL",
        "SUPPLIER_MANAGE", "SUPPLIER_DISABLE",
        "MATERIAL_MANAGE", "SETTINGS_MANAGE",
        "VIEW_ALL_ORG", "VIEW_LOG",
    ],
}


def resolve_permissions(user: User) -> list[str]:
    """解析用户权限：自定义 permissions 优先，否则走角色默认"""
    if user.permissions is not None:
        return user.permissions
    return ROLE_PERMISSIONS.get(user.role, [])


# ============ Bearer token 认证 ============

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """解析 token，返回当前用户；无 token 或无效 token → 401"""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未认证")
    token_record = db.query(Token).filter(Token.token == credentials.credentials).first()
    if token_record is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 无效或已过期")
    user = db.query(User).filter(User.id == token_record.user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


def require_permission(perm: str):
    """权限校验依赖工厂：require_permission('SETTINGS_MANAGE')"""
    def checker(user: User = Depends(get_current_user)) -> User:
        if perm not in resolve_permissions(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"无权限：{perm}",
            )
        return user
    return checker


def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """可选认证：有 token 则解析，无 token 返回 None（用于登录等端点）"""
    if credentials is None:
        return None
    token_record = db.query(Token).filter(Token.token == credentials.credentials).first()
    if token_record is None:
        return None
    return db.query(User).filter(User.id == token_record.user_id).first()
