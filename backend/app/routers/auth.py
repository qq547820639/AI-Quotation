"""认证路由：login / logout / me / refresh / sessions / logout-all

- 生产模式：密码 bcrypt 校验，未知用户与密码错误返回一致 401（不泄露用户是否存在）
- 演示模式（APP_DEMO_MODE=true）：允许快捷登录（选中用户即可，无需密码）
- 短期 Access Token（默认 15 分钟）：通过响应体返回，前端放 Authorization header（Bearer）
- Refresh Token（默认 14 天）：通过 HttpOnly/Secure/SameSite Cookie 下发，可轮换、带重用检测
- 库中只存 token 哈希（access & refresh），绝不存明文
- 会话管理：登录创建会话，登出/刷新/全部退出撤销会话，支持会话列表与单会话撤销
- 连续失败登录速率限制（已迁移到 Redis 抽象）
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from ..config import (
    APP_DEMO_MODE,
    COOKIE_DOMAIN,
    COOKIE_SECURE,
    COOKIE_SAMESITE,
    REFRESH_TOKEN_TTL_SECONDS,
    TRUSTED_PROXY,
)
from ..database import get_db
from ..models import User, Token, Session
from ..schemas import LoginParams, LoginResult, UserSchema, SuccessResult, RefreshResult, SessionInfo
from ..auth import (
    get_current_user,
    verify_password,
    is_login_blocked,
    record_login_failure,
    reset_login_attempts,
    bearer_scheme,
    hash_token,
    generate_access_token,
    generate_refresh_token,
    create_session,
    create_access_token_record,
    revoke_session,
    revoke_session_family,
    get_session_by_refresh_hash,
)
from ..serializers import user_to_schema

router = APIRouter(prefix="/auth", tags=["auth"])

# 统一的失败文案：不区分"用户不存在"与"密码错误"
_LOGIN_FAILED = "用户名或密码错误"

# Refresh Token Cookie 名称
REFRESH_COOKIE = "refresh_token"


def get_client_ip(request: Request) -> str:
    """提取客户端 IP。

    仅当存在可信代理配置（TRUSTED_PROXY 非空）且请求来源（request.client.host）
    在可信列表内时，才读取 X-Forwarded-For；否则使用直连地址 request.client.host。
    防止伪造代理头：
    - 未配置 TRUSTED_PROXY → 忽略 X-Forwarded-For（直连地址）
    - 配置了但请求来源不在可信列表 → 忽略 X-Forwarded-For
    """
    client_host = request.client.host if request.client else "unknown"
    if TRUSTED_PROXY and client_host in TRUSTED_PROXY:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return client_host


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """下发 Refresh Token：HttpOnly + Secure + SameSite（按配置）+ domain"""
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh_token,
        max_age=REFRESH_TOKEN_TTL_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN or None,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    """清除 Refresh Token Cookie"""
    response.delete_cookie(
        key=REFRESH_COOKIE,
        domain=COOKIE_DOMAIN or None,
        path="/",
    )


def _device(request: Request) -> str | None:
    ua = request.headers.get("user-agent")
    return ua[:200] if ua else None


def _issue_tokens(db: Session, user: User, request: Request, response: Response) -> str:
    """创建会话 + 签发 access & refresh token；返回 access token"""
    refresh_token = generate_refresh_token()
    session = create_session(db, user.id, refresh_token, _device(request))
    access_token = generate_access_token()
    create_access_token_record(db, user.id, access_token, session.id)
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    return access_token


def _session_info(s: Session, current_id: str | None) -> SessionInfo:
    def _fmt(dt):
        return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None
    return SessionInfo(
        id=s.id,
        device=s.device,
        createdAt=s.created_at.strftime("%Y-%m-%d %H:%M:%S") if s.created_at else "",
        expiresAt=s.expires_at.strftime("%Y-%m-%d %H:%M:%S") if s.expires_at else "",
        revokedAt=_fmt(s.revoked_at),
        lastRefreshAt=_fmt(s.last_refresh_at),
        current=(s.id == current_id),
    )


@router.post("/login", response_model=LoginResult)
def login(body: LoginParams, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = get_client_ip(request)

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

    token = _issue_tokens(db, user, request, response)
    return LoginResult(user=user_to_schema(user), token=token)


@router.post("/refresh", response_model=RefreshResult)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    """刷新 Access Token：可轮换 Refresh Token（旧 refresh 视为已用）。

    若检测到已用 refresh token 再次使用（重用检测）→ 判定会话被窃取，撤销整个会话。
    """
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 refresh token")
    r_hash = hash_token(refresh_token)
    session = get_session_by_refresh_hash(db, r_hash)

    if session is None:
        # refresh token 未知：可能已被轮换（重用）或不存在
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="refresh token 无效")

    # 重用检测：会话已因轮换（rotated）或重用（reuse）被撤销 → 该 refresh 已被使用过，
    # 再次使用判定为被窃取，撤销整个会话族（family_id 相同），杜绝伪造链继续使用。
    if session.revoked_at is not None and session.revoked_reason in ("rotated", "reuse"):
        revoke_session_family(db, session.family_id, "reuse")
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效")

    # 会话已因其他原因撤销（logout / logout_all）→ 拒绝
    if session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效")

    # 会话过期 → 拒绝
    if session.expires_at is not None and session.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已过期")

    user = db.query(User).filter(User.id == session.user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    # 轮换：撤销旧 refresh（标记为已轮换），签发新 refresh（继承同一 family_id 用于重用检测）
    session.revoked_at = datetime.utcnow()
    session.revoked_reason = "rotated"
    session.last_refresh_at = datetime.utcnow()

    new_refresh = generate_refresh_token()
    new_session = create_session(db, user.id, new_refresh, session.device, session.family_id)
    # 新会话保留最近刷新时间，便于追踪
    new_session.last_refresh_at = datetime.utcnow()

    access_token = generate_access_token()
    create_access_token_record(db, user.id, access_token, new_session.id)
    db.commit()
    _set_refresh_cookie(response, new_refresh)
    return RefreshResult(user=user_to_schema(user), token=access_token)


@router.post("/logout", response_model=SuccessResult)
def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    response: Response = None,
    db: Session = Depends(get_db),
):
    """登出：先撤销服务端会话（当前 access token 对应的会话），再让前端清除本地状态。

    前端调用顺序：先携带有效凭证调用本接口（服务端撤销会话），成功后再清本地。
    """
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未认证")
    token_record = db.query(Token).filter(Token.token_hash == hash_token(credentials.credentials)).first()
    if token_record is not None:
        if token_record.session_id:
            # 撤销该 access token 所属的整个会话
            revoke_session(db, token_record.session_id, "logout")
        else:
            # 兼容无会话绑定的旧 token：仅删除该 token 记录
            db.delete(token_record)
        db.commit()
    _clear_refresh_cookie(response)
    return SuccessResult(success=True)


@router.get("/sessions", response_model=list[SessionInfo])
def list_sessions(
    user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    """会话列表：返回当前用户的所有会话（含已撤销），标记当前会话。"""
    current_token = db.query(Token).filter(Token.token_hash == hash_token(credentials.credentials)).first()
    current_session_id = current_token.session_id if current_token else None
    sessions = db.query(Session).filter(Session.user_id == user.id).order_by(Session.created_at.desc()).all()
    return [_session_info(s, current_session_id) for s in sessions]


@router.delete("/sessions/{session_id}", response_model=SuccessResult)
def revoke_one_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """单会话撤销：仅允许撤销当前用户自己的会话。"""
    session = db.query(Session).filter(Session.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    if session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权撤销该会话")
    revoke_session(db, session.id, "logout")
    db.commit()
    return SuccessResult(success=True)


@router.post("/logout-all", response_model=SuccessResult)
def logout_all(
    user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    response: Response = None,
    db: Session = Depends(get_db),
):
    """全部退出：撤销当前用户的所有会话。"""
    # 撤销当前会话后，再撤销其余会话
    sessions = db.query(Session).filter(Session.user_id == user.id).all()
    for s in sessions:
        revoke_session(db, s.id, "logout_all")
    db.commit()
    _clear_refresh_cookie(response)
    return SuccessResult(success=True)


@router.get("/me", response_model=UserSchema)
def me(user: User = Depends(get_current_user)):
    return user_to_schema(user)