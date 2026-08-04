"""认证路由：login / logout / me
- 生产模式：密码 bcrypt 校验，未知用户与密码错误返回一致 401（不泄露用户是否存在）
- 演示模式（APP_DEMO_MODE=true）：允许快捷登录（选中用户即可，无需密码）
- token 带过期时间；登出撤销当前 token；连续失败登录速率限制
"""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from ..config import APP_DEMO_MODE, TOKEN_TTL_SECONDS
from ..database import get_db
from ..models import User, Token
from ..schemas import LoginParams, LoginResult, UserSchema, SuccessResult
from ..auth import (
    get_current_user,
    verify_password,
    is_login_blocked,
    record_login_failure,
    reset_login_attempts,
    bearer_scheme,
)
from ..serializers import user_to_schema

router = APIRouter(prefix="/auth", tags=["auth"])

# 统一的失败文案：不区分"用户不存在"与"密码错误"
_LOGIN_FAILED = "用户名或密码错误"


def _client_ip(request: Request) -> str:
    """提取客户端 IP（优先 X-Forwarded-For，其次直连）"""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=LoginResult)
def login(body: LoginParams, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)

    # 速率限制：连续失败超过阈值 → 429
    if is_login_blocked(body.userId, ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="尝试次数过多，请稍后再试",
        )

    user = db.query(User).filter(User.id == body.userId).first()

    # 演示模式：快捷登录，选中用户即可（不校验密码）
    if APP_DEMO_MODE:
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_LOGIN_FAILED)
        reset_login_attempts(body.userId, ip)
    else:
        # 生产模式：必须校验密码；未知用户与密码错误返回一致 401
        if user is None or not verify_password(body.password or "", user.password_hash):
            record_login_failure(body.userId, ip)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_LOGIN_FAILED)
        reset_login_attempts(body.userId, ip)

    token = f"token-{user.id}-{secrets.token_hex(16)}"
    db.add(Token(
        token=token,
        user_id=user.id,
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(seconds=TOKEN_TTL_SECONDS),
    ))
    db.commit()
    return LoginResult(user=user_to_schema(user), token=token)


@router.post("/logout", response_model=SuccessResult)
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """登出：仅撤销当前 token（而不是该用户全部 token），支持 per-token 撤销"""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未认证")
    db.query(Token).filter(Token.token == credentials.credentials).delete()
    db.commit()
    return SuccessResult(success=True)


@router.get("/me", response_model=UserSchema)
def me(user: User = Depends(get_current_user)):
    return user_to_schema(user)
