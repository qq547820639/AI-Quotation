"""认证依赖 + RBAC 权限校验 + 密码哈希 + 登录速率限制"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .config import LOGIN_MAX_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS, TOKEN_TTL_SECONDS
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


# ============ 密码哈希（bcrypt） ============

def hash_password(password: str) -> str:
    """生成 bcrypt 哈希（自动加盐）"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    """校验明文密码与 bcrypt 哈希是否匹配；哈希缺失视为不匹配（避免泄露用户是否存在）"""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ============ 登录速率限制（内存计数，按用户 id + 客户端 IP 维度） ============

_attempts: dict[str, list[float]] = {}
_lock = threading.Lock()


def _rate_key(user_id: str, client_ip: str) -> str:
    return f"{user_id}::{client_ip}"


def is_login_blocked(user_id: str, client_ip: str) -> bool:
    """判断该用户+IP 是否已超过连续失败阈值"""
    now = time.time()
    with _lock:
        records = _attempts.get(_rate_key(user_id, client_ip), [])
        records = [t for t in records if now - t < LOGIN_RATE_LIMIT_WINDOW_SECONDS]
        _attempts[_rate_key(user_id, client_ip)] = records
        return len(records) >= LOGIN_MAX_ATTEMPTS


def record_login_failure(user_id: str, client_ip: str) -> None:
    """记录一次失败登录时间戳"""
    now = time.time()
    with _lock:
        records = _attempts.setdefault(_rate_key(user_id, client_ip), [])
        records.append(now)


def reset_login_attempts(user_id: str, client_ip: str) -> None:
    """登录成功后重置失败计数"""
    with _lock:
        _attempts.pop(_rate_key(user_id, client_ip), None)


# ============ Bearer token 认证 ============

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """解析 token，返回当前用户；无 token / 无效 / 过期 token → 401"""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未认证")
    token_record = db.query(Token).filter(Token.token == credentials.credentials).first()
    if token_record is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 无效或已过期")
    # 过期 token：拒绝并清理
    if token_record.expires_at is not None and token_record.expires_at < datetime.utcnow():
        db.delete(token_record)
        db.commit()
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
    if token_record.expires_at is not None and token_record.expires_at < datetime.utcnow():
        return None
    return db.query(User).filter(User.id == token_record.user_id).first()
