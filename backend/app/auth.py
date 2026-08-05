"""认证依赖 + RBAC 权限校验 + 密码哈希 + 登录速率限制"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .config import ACCESS_TOKEN_TTL_SECONDS
from .database import get_db
from .models import User, Token, Session
from .redis_client import (
    is_login_blocked,
    record_login_failure,
    reset_login_attempts,
)

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


# ============ 登录速率限制（已迁移到 Redis 抽象，见 redis_client.py） ============
# 保留 is_login_blocked / record_login_failure / reset_login_attempts 的导入，供路由使用。
# 限流存储已接入 Redis（可多实例），无 Redis 时回退到进程内实现。


# ============ Token 哈希与会话工具 ============

def hash_token(token: str) -> str:
    """计算 access/refresh token 的 SHA-256 哈希（库中只存哈希，不存明文）"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_access_token() -> str:
    """生成随机 access token（明文返回给客户端，库中只存哈希）"""
    return f"at-{secrets.token_hex(32)}"


def generate_refresh_token() -> str:
    """生成随机 refresh token（明文通过 Cookie 下发，库中只存哈希）"""
    return f"rt-{secrets.token_hex(32)}"


def create_session(db: Session, user_id: str, refresh_token: str, device: str | None, family_id: str | None = None) -> Session:
    """创建会话记录：仅存 refresh token 哈希；family_id 用于会话族（轮换衍生，重用检测批量撤销）"""
    from .config import REFRESH_TOKEN_TTL_SECONDS
    if family_id is None:
        family_id = f"fam-{secrets.token_hex(16)}"
    session = Session(
        id=f"ses-{secrets.token_hex(16)}",
        user_id=user_id,
        refresh_token_hash=hash_token(refresh_token),
        device=device,
        family_id=family_id,
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
    )
    db.add(session)
    db.flush()
    return session


def create_access_token_record(db: Session, user_id: str, access_token: str, session_id: str | None) -> None:
    """写入 access token 哈希记录（仅存哈希，绑定会话）"""
    db.add(Token(
        token_hash=hash_token(access_token),
        user_id=user_id,
        session_id=session_id,
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(seconds=ACCESS_TOKEN_TTL_SECONDS),
    ))
    db.flush()


def revoke_session(db: Session, session_id: str, reason: str) -> None:
    """撤销会话：标记 revoked_at，并删除该会话下所有 access token 记录"""
    session = db.query(Session).filter(Session.id == session_id).first()
    if session is not None:
        session.revoked_at = datetime.utcnow()
        session.revoked_reason = reason
    db.query(Token).filter(Token.session_id == session_id).delete()
    db.flush()


def revoke_session_family(db: Session, family_id: str, reason: str) -> None:
    """撤销整个会话族（family_id 相同）：用于 Refresh 重用检测时批量撤销衍生会话。
    撤销每个会话并删除其下的 access token 记录。"""
    sessions = db.query(Session).filter(Session.family_id == family_id).all()
    for s in sessions:
        if s.revoked_at is None:
            s.revoked_at = datetime.utcnow()
            s.revoked_reason = reason
        db.query(Token).filter(Token.session_id == s.id).delete()
    db.flush()


# ============ Bearer token 认证 ============

bearer_scheme = HTTPBearer(auto_error=False)


def get_session_by_refresh_hash(db: Session, refresh_token_hash: str) -> Session | None:
    """按 refresh token 哈希查找会话"""
    return db.query(Session).filter(Session.refresh_token_hash == refresh_token_hash).first()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,  # type: ignore[assignment]  # FastAPI 注入 Request
) -> User:
    """解析 token（按哈希查找），返回当前用户；无 token / 无效 / 过期 token → 401"""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未认证")
    token_record = db.query(Token).filter(Token.token_hash == hash_token(credentials.credentials)).first()
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
    # 注入认证上下文到 request.state，供结构化日志（user_id / organization）使用
    if request is not None:
        request.state.user_id = user.id
        request.state.organization = user.organization
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


# 管理员专属接口（AI 用量统计等）统一走角色校验，不依赖前端隐藏按钮。
# 不新增 ROLE_PERMISSIONS 权限项（保持与前端矩阵一致），仅按角色判定。
def require_admin(user: User = Depends(get_current_user)) -> User:
    """管理员角色校验依赖：非管理员 → 403"""
    if user.role != "管理员":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    request: Request = None,  # type: ignore[assignment]  # FastAPI 注入 Request
) -> User | None:
    """可选认证：有 token 则解析，无 token 返回 None（用于登录等端点）"""
    if credentials is None:
        return None
    token_record = db.query(Token).filter(Token.token_hash == hash_token(credentials.credentials)).first()
    if token_record is None:
        return None
    if token_record.expires_at is not None and token_record.expires_at < datetime.utcnow():
        return None
    user = db.query(User).filter(User.id == token_record.user_id).first()
    if user is not None and request is not None:
        request.state.user_id = user.id
        request.state.organization = user.organization
    return user
