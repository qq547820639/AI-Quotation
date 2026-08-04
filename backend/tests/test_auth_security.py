"""生产安全与鉴权测试（第一阶段）

覆盖：
- 生产模式密码校验（bcrypt）：未知用户与密码错误返回一致 401，不泄露用户是否存在
- 演示模式快捷登录（APP_DEMO_MODE=true）
- token 过期被拒绝并清理
- 登出撤销 token（per-token）
- 连续失败登录速率限制（429）
- 密码哈希正确性
"""
from datetime import datetime, timedelta

import pytest

from app.auth import hash_password, verify_password, reset_login_attempts
from app.config import LOGIN_MAX_ATTEMPTS
from app.models import Token
from app.database import SessionLocal

# 演示账号默认密码（与 seed 一致）
DEMO_PWD = "123456"


def _login(client, user_id, password=None):
    body = {"userId": user_id}
    if password is not None:
        body["password"] = password
    return client.post("/api/auth/login", json=body)


def test_password_hash_roundtrip():
    """bcrypt 哈希：正确密码通过，错误密码失败，且不存明文"""
    h = hash_password("Secret@123")
    assert h != "Secret@123"  # 不存明文
    assert verify_password("Secret@123", h) is True
    assert verify_password("wrong", h) is False
    # 哈希缺失视为失败（不泄露用户是否存在）
    assert verify_password("Secret@123", None) is False


def test_production_login_unknown_user_and_wrong_password_same_401(client, monkeypatch):
    """生产模式：未知用户与密码错误返回一致 401 文案（不泄露用户是否存在）"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)

    # 未知用户
    r1 = _login(client, "not-exist", "whatever")
    assert r1.status_code == 401
    # 已知用户但密码错误
    r2 = _login(client, "u-1", "wrong-password")
    assert r2.status_code == 401
    # 两者 detail 一致（不泄露用户是否存在）
    assert r1.json()["detail"] == r2.json()["detail"]


def test_production_login_correct_password(client, monkeypatch):
    """生产模式：正确密码登录成功，返回用户与 token"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r = _login(client, "u-1", DEMO_PWD)
    assert r.status_code == 200
    data = r.json()
    assert data["token"]
    assert data["user"]["id"] == "u-1"


def test_production_login_missing_password_rejected(client, monkeypatch):
    """生产模式：缺失密码视为错误密码 → 401"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r = _login(client, "u-1")
    assert r.status_code == 401


def test_demo_mode_quick_login(client):
    """演示模式：快捷登录，选中用户即可（无需密码）"""
    # conftest 已设置 APP_DEMO_MODE=true
    r = _login(client, "u-2")
    assert r.status_code == 200
    assert r.json()["user"]["id"] == "u-2"


def test_token_expiry_rejected(client, monkeypatch):
    """token 过期后访问受保护端点被拒绝并清理"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    token = _login(client, "u-1", DEMO_PWD).json()["token"]

    # 手动将 token 过期时间改为过去
    db = SessionLocal()
    rec = db.query(Token).filter(Token.token == token).first()
    rec.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()
    db.close()

    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401

    # 过期 token 已被清理
    db = SessionLocal()
    assert db.query(Token).filter(Token.token == token).first() is None
    db.close()


def test_logout_revokes_only_current_token(client, monkeypatch):
    """登出仅撤销当前 token，不影响同用户其他 token"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    token_a = _login(client, "u-1", DEMO_PWD).json()["token"]
    token_b = _login(client, "u-1", DEMO_PWD).json()["token"]

    # 登出 token_a
    r = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 200

    # token_a 失效，token_b 仍有效
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_a}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_b}"}).status_code == 200


def test_login_rate_limiting(client, monkeypatch):
    """连续失败登录超过阈值 → 429"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 使用独立用户，避免影响其他基于 u-1 的测试
    victim = "u-rate-limit"
    # 连续失败 LOGIN_MAX_ATTEMPTS 次
    for _ in range(LOGIN_MAX_ATTEMPTS):
        r = _login(client, victim, "wrong-password")
        assert r.status_code == 401
    # 第 LOGIN_MAX_ATTEMPTS+1 次被限流
    r = _login(client, victim, "wrong-password")
    assert r.status_code == 429
    # 清理：避免污染全局计数影响其他测试
    reset_login_attempts(victim, "testclient")