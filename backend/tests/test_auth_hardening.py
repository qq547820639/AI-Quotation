"""P1 Task 10 认证与权限加固：补充已有的授权/轮换/限流实现之外的缺口测试

已有覆盖（test_auth_security / test_auth_sessions / test_security_hardening /
test_permissions / test_invitation_security）：
- 登录限流、bcrypt、token 过期/撤销、Refresh 轮换与重用检测、跨组织隔离、
  settings/suppliers 权限、改密使会话失效、CSRF（Origin 校验）、AI 用量 RBAC。

本文件补充真实断言的缺口：
- Token 用途区分：邀请 token 不能作为访问 token 使用（Bearer → 401），
  访问 token 不能作为邀请 token 使用（X-Invitation-Token → 401）。
  邀请 token 与访问 token 各自独立存储（SupplierInvitation.token_hash vs tokens.token_hash）
  且校验路径不同，从目的声明上天然隔离（无交集）。
- Refresh Cookie 属性：HttpOnly / SameSite / Secure（Secure 跟随配置）/ Path=/。
- 管理接口 RBAC：ai/feedback-summary 与 tasks 重试仅管理员可访问（普通用户 403，
  越权在业务逻辑前被拒）。
"""
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import COOKIE_SECURE, COOKIE_SAMESITE
from app.database import SessionLocal
from app.models import User

DEMO_PWD = "123456"

# 绑定 inq-3/sup-2 的种子邀请（只读，见 test_invitation_security）
INVITATION_TOKEN = "inv-token-inq3-sup2-000000000000000000000000000000000000000000000000"


def _login(client, user_id, password=DEMO_PWD):
    resp = client.post("/api/auth/login", json={"userId": user_id, "password": password})
    assert resp.status_code == 200, resp.text
    return resp


def _login_headers(client, user_id, password=DEMO_PWD):
    return {"Authorization": f"Bearer {_login(client, user_id, password).json()['token']}"}


# ============ 1. Token 用途区分 ============

def test_invitation_token_not_valid_as_access_token(client):
    """邀请 token 不能作为访问 token：以 Bearer 方式访问受保护端点 → 401"""
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {INVITATION_TOKEN}"},
    )
    assert resp.status_code == 401


def test_access_token_not_valid_as_invitation_token(client):
    """访问 token 不能作为邀请 token：放入 X-Invitation-Token 访问门户 → 401"""
    resp = _login(client, "u-1")
    access_token = resp.json()["token"]
    portal = client.get(
        "/api/portal/inquiries",
        headers={"X-Invitation-Token": access_token},
    )
    assert portal.status_code == 401


def test_valid_invitation_token_still_works(client):
    """对照：合法邀请 token 仍可访问门户（证明上一断言失败源于用途隔离而非端口故障）"""
    resp = client.get("/api/portal/inquiries", headers={"X-Invitation-Token": INVITATION_TOKEN})
    assert resp.status_code == 200
    assert resp.json()["id"] == "inq-3"


# ============ 2. Refresh Cookie 属性 ============

def test_refresh_cookie_attributes(client):
    """登录下发的 refresh cookie：HttpOnly + SameSite + Path=/ + Secure（跟随配置）"""
    set_cookie = client.post(
        "/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD}
    ).headers.get("set-cookie", "")
    assert "refresh_token=" in set_cookie
    assert "HttpOnly" in set_cookie, "refresh cookie 必须 HttpOnly"
    assert "Path=/" in set_cookie
    # SameSite 跟随配置（默认 lax）
    assert f"SameSite={COOKIE_SAMESITE}" in set_cookie
    # Secure 跟随配置：True 时强制带 Secure，False 时不带
    if COOKIE_SECURE:
        assert "Secure" in set_cookie
    else:
        assert "Secure" not in set_cookie, "未开启 COOKIE_SECURE 时不应下发 Secure 标记"


def test_refresh_cookie_secure_tracks_config(client):
    """开启 COOKIE_SECURE 后，refresh cookie 必须带 Secure 标记"""
    monkeypatch = None
    import app.routers.auth as auth_router

    # 临时开启 COOKIE_SECURE，验证 Secure 标记下发
    original = auth_router.COOKIE_SECURE
    auth_router.COOKIE_SECURE = True
    try:
        set_cookie = client.post(
            "/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD}
        ).headers.get("set-cookie", "")
        assert "Secure" in set_cookie
    finally:
        auth_router.COOKIE_SECURE = original


# ============ 3. 管理接口 RBAC（未覆盖端点） ============

def test_ai_feedback_summary_admin_only(client, monkeypatch):
    """ai/feedback-summary：普通用户 403，管理员 200"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_buyer = _login_headers(client, "u-1")
    h_admin = _login_headers(client, "u-6")
    assert client.get("/api/ai/feedback-summary", headers=h_buyer).status_code == 403
    assert client.get("/api/ai/feedback-summary", headers=h_admin).status_code == 200


def test_task_retry_admin_only(client, monkeypatch):
    """tasks 重试：普通用户在权限校验阶段即被拒（403），管理员通过后按业务返回 404"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_buyer = _login_headers(client, "u-1")
    h_admin = _login_headers(client, "u-6")
    # 非管理员：不存在的任务也返回 403（权限先于业务校验）
    assert client.post("/api/tasks/nonexistent/retry", headers=h_buyer).status_code == 403
    # 管理员：权限通过 → 业务层返回 404
    assert client.post("/api/tasks/nonexistent/retry", headers=h_admin).status_code == 404


# ============ 4. 改密后其它会话一并失效（Real 断言） ============

def test_change_password_revokes_all_sessions(client, monkeypatch):
    """改密撤销该用户全部会话：改密前创建的两个会话改密后均失效"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 两个独立会话
    token_a = _login(client, "u-1", DEMO_PWD).json()["token"]
    c2 = TestClient(client.app)
    token_b = c2.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD}).json()["token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    assert client.get("/api/auth/me", headers=headers_a).status_code == 200
    assert c2.get("/api/auth/me", headers=headers_b).status_code == 200

    # 用会话 A 改密
    r = client.post("/api/auth/change-password", json={
        "currentPassword": DEMO_PWD, "newPassword": "newpass123", "confirmPassword": "newpass123",
    }, headers=headers_a)
    assert r.status_code == 200

    # 改密后两个会话均失效
    assert client.get("/api/auth/me", headers=headers_a).status_code == 401
    assert c2.get("/api/auth/me", headers=headers_b).status_code == 401

    # 恢复密码哈希，避免影响其他测试
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == "u-1").first()
        u.password_hash = hash_password(DEMO_PWD)
        db.commit()
    finally:
        db.close()
    from app.auth import reset_login_attempts
    reset_login_attempts("u-1", "testclient")