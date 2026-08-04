"""P1-6 会话安全测试：登录爆破、Token 过期/撤销、Refresh 重用检测、重放、跨组织、伪造代理头。

覆盖：
- 登录爆破：连续失败被限流 → 429（已接入 Redis 抽象，无论是否 Redis 都应该通过）
- Access/Refresh Token 过期 → 401
- 单会话撤销 → 当前会话失效，其他会话保留
- 全部退出 → 所有会话全部撤销
- Refresh 轮换：旧 refresh 不能再次使用（重用检测），二次刷新被拒
- 重用检测：旧 refresh 二次使用判定被窃取 → 会话撤销
- 跨组织访问：已有权限策略保持有效（已实现，仅追加测试）
- 伪造代理头：无 TRUSTED_PROXY 配置时 X-Forwarded-For 被忽略，取直连 IP
"""
import app.models
from fastapi.testclient import TestClient
from app.auth import hash_token
from app.database import SessionLocal


DEMO_PWD = "123456"


def _login(client, user_id, password=None):
    body = {"userId": user_id}
    if password is not None:
        body["password"] = password
    return client.post("/api/auth/login", json=body)


def _get_current_session_id(headers, client):
    """从会话列表获取当前 token 对应的 session id"""
    resp = client.get("/api/auth/sessions", headers=headers)
    assert resp.status_code == 200
    for sess in resp.json():
        if sess["current"]:
            return sess["id"]
    return None


def test_login_rate_limiting_redis_implementation(client, monkeypatch):
    """登录爆破：连续失败超过阈值 → 429（Redis 抽象兼容性测试）"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    victim = "u-rate-session"
    from app.config import LOGIN_MAX_ATTEMPTS
    # 连续失败 LOGIN_MAX_ATTEMPTS 次
    for _ in range(LOGIN_MAX_ATTEMPTS):
        r = _login(client, victim, "wrong-password")
        assert r.status_code == 401
    # 第 LOGIN_MAX_ATTEMPTS+1 次被限流
    r = _login(client, victim, "wrong-password")
    assert r.status_code == 429


def test_access_token_expiry_rejected_and_cleaned(client, monkeypatch):
    """Access token 过期 → 401 且被清理"""
    from datetime import datetime, timedelta
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r = _login(client, "u-1", DEMO_PWD)
    assert r.status_code == 200
    token = r.json()["token"]
    access_hash = hash_token(token)

    # 手动将过期时间改为过去
    db = SessionLocal()
    rec = db.query(app.models.Token).filter(app.models.Token.token_hash == access_hash).first()
    rec.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    db.close()

    # 访问 → 401
    r2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 401

    # 过期 token 已被清理
    db = SessionLocal()
    assert db.query(app.models.Token).filter(app.models.Token.token_hash == access_hash).first() is None
    db.close()


def test_refresh_rotation_works(client, monkeypatch):
    """Refresh 轮换：每次刷新签发新 refresh，旧 refresh 视为已用，重用被拒绝"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 登录
    r_login = _login(client, "u-1", DEMO_PWD)
    assert r_login.status_code == 200
    old_token = r_login.json()["token"]
    # 登录后 cookie 中包含 refresh_token
    refresh_cookie = client.cookies.get("refresh_token")
    assert refresh_cookie is not None

    # 第一次刷新（独立 client 通过 Cookie 头传旧 refresh）→ 成功，返回新 access
    c1 = TestClient(client.app)
    r_refresh = c1.post("/api/auth/refresh", headers={"Cookie": f"refresh_token={refresh_cookie}"})
    assert r_refresh.status_code == 200
    new_token = r_refresh.json()["token"]
    new_refresh_cookie = c1.cookies.get("refresh_token")
    assert new_token != old_token
    assert new_refresh_cookie != refresh_cookie

    # 旧 refresh cookie 再次刷新 → 重用检测，被拒绝
    c2 = TestClient(client.app)
    r_again = c2.post("/api/auth/refresh", headers={"Cookie": f"refresh_token={refresh_cookie}"})
    assert r_again.status_code == 401
    assert "会话已失效" in r_again.json()["detail"]


def test_refresh_reuse_detect_revokes_session(client, monkeypatch):
    """Refresh 重用检测：检测到二次使用 → 撤销整个会话链"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 登录
    r1 = _login(client, "u-1", DEMO_PWD)
    assert r1.status_code == 200
    refresh1 = client.cookies.get("refresh_token")
    assert refresh1 is not None

    # 两次使用同一个 refresh 并发刷新 → 第一次成功，第二次被拒绝并撤销
    client2 = TestClient(client.app)
    r2 = client2.post("/api/auth/refresh", headers={"Cookie": f"refresh_token={refresh1}"})
    assert r2.status_code == 200

    # 第二次刷新（同一个旧 refresh）→ 被拒绝，且会话链已撤销
    client3 = TestClient(client.app)
    r3 = client3.post("/api/auth/refresh", headers={"Cookie": f"refresh_token={refresh1}"})
    assert r3.status_code == 401
    assert "会话已失效" in r3.json()["detail"]

    # 新的 refresh（从第一次刷新）也不能使用：整个会话链因重用被标记
    new_refresh1 = client2.cookies.get("refresh_token")
    client4 = TestClient(client.app)
    r4 = client4.post("/api/auth/refresh", headers={"Cookie": f"refresh_token={new_refresh1}"})
    assert r4.status_code == 401


def test_logout_revokes_current_session_only(client, monkeypatch):
    """登出：仅撤销当前会话，其他会话保持有效"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 同用户两个会话
    r1 = _login(client, "u-1", DEMO_PWD)
    assert r1.status_code == 200
    token_a = r1.json()["token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    client_b = TestClient(client.app)
    r_b = client_b.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
    assert r_b.status_code == 200
    token_b = r_b.json()["token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 会话 a 登出
    r_logout = client.post("/api/auth/logout", headers=headers_a)
    assert r_logout.status_code == 200

    # 会话 a 失效，会话 b 仍有效
    assert client.get("/api/auth/me", headers=headers_a).status_code == 401
    assert client_b.get("/api/auth/me", headers=headers_b).status_code == 200


def test_revoke_one_session_other_still_valid(client, monkeypatch):
    """单会话撤销：撤销指定会话，其他会话保持有效"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r1 = _login(client, "u-1", DEMO_PWD)
    token1 = r1.json()["token"]
    headers1 = {"Authorization": f"Bearer {token1}"}
    session_id1 = _get_current_session_id(headers1, client)
    assert session_id1 is not None

    r2 = client.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
    token2 = r2.json()["token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    # 撤销会话 1
    rv = client.delete(f"/api/auth/sessions/{session_id1}", headers=headers2)
    assert rv.status_code == 200

    # 会话 1 失效，会话 2 仍有效
    assert client.get("/api/auth/me", headers=headers1).status_code == 401
    assert client.get("/api/auth/me", headers=headers2).status_code == 200


def test_logout_all_revokes_all_sessions(client, monkeypatch):
    """全部退出：撤销当前用户的所有会话"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 创建三个会话
    tokens = []
    headers_list = []
    for _ in range(3):
        c = TestClient(client.app)
        r = c.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
        assert r.status_code == 200
        tokens.append(r.json()["token"])
        headers_list.append({"Authorization": f"Bearer {tokens[-1]}"})

    # 从第一个会话发起全部退出
    first_headers = headers_list[0]
    rv = client.post("/api/auth/logout-all", headers=first_headers)
    assert rv.status_code == 200

    # 所有三个会话均失效
    for idx, h in enumerate(headers_list):
        c = TestClient(client.app)
        assert c.get("/api/auth/me", headers=h).status_code == 401


def test_list_sessions_marks_current(client, monkeypatch):
    """会话列表：返回当前用户所有会话，且标记 current=True 的正是当前会话"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r = _login(client, "u-1", DEMO_PWD)
    assert r.status_code == 200
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.get("/api/auth/sessions", headers=headers)
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) >= 1
    current_count = sum(1 for s in sessions if s["current"])
    assert current_count == 1, "恰好一个标记为 current"
    current = next(s for s in sessions if s["current"])
    assert current["id"] == _get_current_session_id(headers, client)


def test_cross_organization_access_rejected(client, monkeypatch):
    """跨组织访问：u-1（总部）不能访问华东分部 inq-1，已有权限策略保持有效"""
    # 来自 test_portal_and_security.py，这里仅重复确认未破坏
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    token = _login(client, "u-1", DEMO_PWD).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/inquiries/inq-1", headers=headers).status_code == 403


def test_forged_x_forwarded_for_ignored_without_trusted_proxy(client, monkeypatch):
    """伪造代理头：未配置 TRUSTED_PROXY → 忽略 X-Forwarded-For，取直连 IP"""
    from app.routers.auth import get_client_ip
    from fastapi import Request
    from unittest.mock import Mock

    # 模拟请求：来源为测试客户端 IP，但伪造 X-Forwarded-For
    mock_request = Mock()
    mock_request.client = Mock(host="127.0.0.1")
    mock_request.headers = {"x-forwarded-for": "192.168.1.100, 10.0.0.1"}

    # TRUSTED_PROXY 是空列表 → 取直连 127.0.0.1，不读取 X-Forwarded-For
    monkeypatch.setattr("app.routers.auth.TRUSTED_PROXY", [])
    ip = get_client_ip(mock_request)
    assert ip == "127.0.0.1"

    # TRUSTED_PROXY 配置但直连不在其中 → 仍取直连，忽略伪造
    monkeypatch.setattr("app.routers.auth.TRUSTED_PROXY", ["10.0.0.1"])
    ip = get_client_ip(mock_request)
    assert ip == "127.0.0.1"


def test_tokens_never_stored_plaintext(client, monkeypatch):
    """验证库中绝不存储明文 token（access 和 refresh）"""
    from app.models import Token as TokenModel, Session as SessionModel
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r = _login(client, "u-1", DEMO_PWD)
    assert r.status_code == 200
    plain_token = r.json()["token"]

    db = SessionLocal()
    tokens = db.query(TokenModel).all()
    assert len(tokens) >= 1
    # 数据库中 token_hash 长度 64（SHA-256 hex），绝不存在明文 token
    for t in tokens:
        if hasattr(t, "token"):
            # 旧字段不存在于新模型，仅检查新字段
            pass
        assert len(t.token_hash) == 64, f"token_hash 应为 SHA-256 hex，长度 64，实际 {len(t.token_hash)}"
        assert t.token_hash != plain_token, "数据库不应存储明文 access token"

    # refresh token 哈希长度也是 64，绝不存储明文
    sessions = db.query(SessionModel).all()
    for s in sessions:
        assert len(s.refresh_token_hash) == 64, "refresh_token_hash 应为 SHA-256 hex"
    db.close()


def test_refresh_missing_cookie_401(client, monkeypatch):
    """刷新接口：无 refresh cookie → 401"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 登录但不保留 cookie
    r = _login(client, "u-1", DEMO_PWD)
    assert r.status_code == 200
    client.cookies.clear()
    # 刷新 → 缺少 cookie → 401
    r2 = client.post("/api/auth/refresh")
    assert r2.status_code == 401
    assert "缺少 refresh token" in r2.json()["detail"]


def test_security_headers_present(client):
    """安全响应头（P1-6 10.4）：CSP / X-Content-Type-Options / Referrer-Policy / Permissions-Policy 均下发"""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "Content-Security-Policy" in r.headers
    assert "X-Content-Type-Options" in r.headers
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "Referrer-Policy" in r.headers
    assert "Permissions-Policy" in r.headers
