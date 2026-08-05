"""安全响应头加固测试（Task 11）：断言所有响应携带收紧的 CSP、nosniff、Referrer-Policy 等头。

- CSP 包含 frame-ancestors 'none' / object-src 'none' / base-uri 'self'
- script-src 不含 'unsafe-inline'（前端构建产物无内联脚本，故可安全移除；未采用 nonce 策略）
- X-Content-Type-Options: nosniff
- Referrer-Policy / Permissions-Policy
"""
import pytest

from app import config


def test_csp_contains_hardening_directives(client):
    """CSP 必须包含 frame-ancestors/object-src/base-uri/form-action 收紧指令"""
    csp = client.get("/api/health").headers["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    assert "base-uri 'self'" in csp
    assert "form-action 'self'" in csp


def test_csp_script_src_no_unsafe_inline(client):
    """script-src 不应包含 'unsafe-inline'（前端无内联脚本，可安全移除）"""
    csp = client.get("/api/health").headers["Content-Security-Policy"]
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]


def test_csp_default_config_consistent(client):
    """运行时的 CSP 与 config.CSP_DEFAULT 一致（未在中间件被覆盖）"""
    csp = client.get("/api/health").headers["Content-Security-Policy"]
    assert csp == config.CSP_DEFAULT


def test_nosniff_header_present(client):
    """所有响应携带 X-Content-Type-Options: nosniff"""
    assert client.get("/api/health").headers["X-Content-Type-Options"] == "nosniff"


def test_referrer_policy_header_present(client):
    """所有响应携带 Referrer-Policy"""
    r = client.get("/api/health")
    assert "Referrer-Policy" in r.headers
    assert r.headers["Referrer-Policy"] == config.REFERRER_POLICY


def test_permissions_policy_header_present(client):
    """所有响应携带 Permissions-Policy"""
    r = client.get("/api/health")
    assert "Permissions-Policy" in r.headers
    assert r.headers["Permissions-Policy"] == config.PERMISSIONS_POLICY


def hsts_enabled_env(monkeypatch):
    """切换 HSTS 为启用（仅测试 HSTS 头下发逻辑）"""
    monkeypatch.setattr("app.main.HSTS_ENABLED", True)
    monkeypatch.setattr("app.main.HSTS_MAX_AGE", "31536000")


def test_hsts_present_when_enabled(client, monkeypatch):
    """HSTS_ENABLED=true 时下发 Strict-Transport-Security"""
    hsts_enabled_env(monkeypatch)
    r = client.get("/api/health")
    assert "Strict-Transport-Security" in r.headers
    assert "max-age=31536000" in r.headers["Strict-Transport-Security"]
    assert "includeSubDomains" in r.headers["Strict-Transport-Security"]


def test_hsts_absent_when_disabled(client):
    """HSTS_ENABLED=false（默认）时不下发 Strict-Transport-Security"""
    r = client.get("/api/health")
    assert "Strict-Transport-Security" not in r.headers