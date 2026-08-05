"""P0-4：供应商邀请 canonical URL 与 PUBLIC_APP_URL 校验测试

覆盖：
- build_invitation_url 统一生成 `/supplier-portal/{urlencodedToken}`，不再生成 `/portal?token=...`
- token 始终 URL 安全编码
- PUBLIC_APP_URL 拼接完整地址 / 反向代理子路径保留 / 末尾斜杠去除
- 未配置 PUBLIC_APP_URL 时回退 PORTAL_BASE_URL origin 或相对路径
- 生产 PUBLIC_APP_URL 校验（HTTPS / 禁 localhost / 缺协议 / 空值放行）
"""
from urllib.parse import quote
import types

from app import config
from app import config_validation


# ============ 统一 URL Builder ============

def test_build_invitation_url_uses_public_app_url(monkeypatch):
    """配置 PUBLIC_APP_URL 时生成完整 canonical 地址，且不含废弃的 /portal?token= 格式"""
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "https://procurement.example.com")
    url = config.build_invitation_url("tok-abc-123")
    assert url == "https://procurement.example.com/supplier-portal/tok-abc-123"
    assert "/portal?token=" not in url


def test_build_invitation_url_strips_trailing_slash(monkeypatch):
    """PUBLIC_APP_URL 以 / 结尾（含多个）→ 去除，避免 /supplier-portal//token 重复路径分隔符"""
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "https://procurement.example.com///")
    url = config.build_invitation_url("tok-abc")
    assert url == "https://procurement.example.com/supplier-portal/tok-abc"


def test_build_invitation_url_preserves_reverse_proxy_subpath(monkeypatch):
    """反向代理子路径保留：/procurement 作为 base path 拼接"""
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "https://corp.example.com/procurement")
    url = config.build_invitation_url("tok-abc")
    assert url == "https://corp.example.com/procurement/supplier-portal/tok-abc"


def test_build_invitation_url_urlencodes_token(monkeypatch):
    """token 必须 URL 安全编码：含保留字符时被 percent-encode，绝不原样进路径"""
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "https://procurement.example.com")
    raw = "tok+abc/def?x=1"
    url = config.build_invitation_url(raw)
    assert url == f"https://procurement.example.com/supplier-portal/{quote(raw, safe='')}"
    # 保留字符不可原样出现在 HTTP 路径段中
    assert "+" not in url.split("/supplier-portal/")[1]
    assert "/def" not in url.split("/supplier-portal/")[1]


def test_build_invitation_url_falls_back_to_portal_origin(monkeypatch):
    """未配置 PUBLIC_APP_URL 时回退 PORTAL_BASE_URL 的 origin（去掉废弃的 /portal 路径）"""
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "")
    monkeypatch.setattr(config, "PORTAL_BASE_URL", "http://localhost:5173/portal")
    url = config.build_invitation_url("tok-abc")
    assert url == "http://localhost:5173/supplier-portal/tok-abc"
    assert "/portal" not in url.split("//")[1].split("/supplier-portal")[0]


def test_build_invitation_url_relative_when_no_base(monkeypatch):
    """PUBLIC_APP_URL 与 PORTAL_BASE_URL 皆空 → 回退相对路径，便于开发/测试"""
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "")
    monkeypatch.setattr(config, "PORTAL_BASE_URL", "")
    url = config.build_invitation_url("tok-abc")
    assert url == "/supplier-portal/tok-abc"


def test_normalize_public_app_url_strips_multiple_trailing_slashes():
    assert config.normalize_public_app_url("https://a.com/") == "https://a.com"
    assert config.normalize_public_app_url("https://a.com///") == "https://a.com"
    assert config.normalize_public_app_url("  https://a.com/procurement// ") == "https://a.com/procurement"


# ============ 生产 PUBLIC_APP_URL 校验 ============

def _set_public(monkeypatch, value):
    monkeypatch.setattr(config, "PUBLIC_APP_URL", value)


def test_public_url_ok_https(monkeypatch):
    _set_public(monkeypatch, "https://procurement.example.com")
    ok, err = config_validation._public_url_ok()
    assert ok is True
    assert err is None


def test_public_url_ok_https_subpath(monkeypatch):
    _set_public(monkeypatch, "https://corp.example.com/procurement")
    ok, _ = config_validation._public_url_ok()
    assert ok is True


def test_public_url_rejects_http(monkeypatch):
    _set_public(monkeypatch, "http://procurement.example.com")
    ok, err = config_validation._public_url_ok()
    assert ok is False
    assert "HTTPS" in err


def test_public_url_rejects_localhost(monkeypatch):
    for host in ("localhost", "127.0.0.1", "0.0.0.0"):
        _set_public(monkeypatch, f"https://{host}")
        ok, err = config_validation._public_url_ok()
        assert ok is False
        assert "localhost" in err or "回环" in err


def test_public_url_rejects_missing_protocol(monkeypatch):
    _set_public(monkeypatch, "procurement.example.com")
    ok, err = config_validation._public_url_ok()
    assert ok is False
    assert "协议" in err


def test_public_url_empty_allowed(monkeypatch):
    """未配置（空）时放行，兼容未显式配置的部署（builder 回退）"""
    _set_public(monkeypatch, "")
    ok, err = config_validation._public_url_ok()
    assert ok is True
    assert err is None


def test_prod_validation_integration_public_url(monkeypatch):
    """通过 validate_production_config 集成校验：合法 https + 其余生产配置齐全 → 无 PUBLIC_APP_URL 错误"""
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "SECRET_KEY", "a-strong-random-prod-secret-key-0123456789")
    monkeypatch.setattr(config, "SCANNER_PROVIDER", "clamav")
    monkeypatch.setattr(config, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(config, "REDIS_REQUIRED", True)
    monkeypatch.setattr(config, "S3_ENDPOINT", "")
    monkeypatch.setattr(config, "S3_BUCKET", "")
    monkeypatch.setattr(config, "S3_ACCESS_KEY", "")
    monkeypatch.setattr(config, "S3_SECRET_KEY", "")
    monkeypatch.setattr(config, "APP_DEMO_MODE", False)
    monkeypatch.setattr(config, "DEMO_USER_PASSWORD", "a-strong-prod-password-123456")
    monkeypatch.setattr(config, "CORS_ORIGINS", ["https://procurement.example.com"])
    monkeypatch.setattr(config, "CELERY_BROKER_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(config, "CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
    monkeypatch.setattr(config, "CELERY_TASK_ALWAYS_EAGER", False)
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "https://procurement.example.com")
    monkeypatch.setattr(config_validation, "get_store", lambda: types.SimpleNamespace(ping=lambda: True))
    errors = config_validation.validate_production_config()
    assert not any("PUBLIC_APP_URL" in e for e in errors)


def test_prod_validation_integration_public_url_http_rejected(monkeypatch):
    """集成校验：生产 PUBLIC_APP_URL 为 http → 报 PUBLIC_APP_URL 错误"""
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "SECRET_KEY", "a-strong-random-prod-secret-key-0123456789")
    monkeypatch.setattr(config, "SCANNER_PROVIDER", "clamav")
    monkeypatch.setattr(config, "REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(config, "REDIS_REQUIRED", True)
    monkeypatch.setattr(config, "S3_ENDPOINT", "")
    monkeypatch.setattr(config, "S3_BUCKET", "")
    monkeypatch.setattr(config, "S3_ACCESS_KEY", "")
    monkeypatch.setattr(config, "S3_SECRET_KEY", "")
    monkeypatch.setattr(config, "APP_DEMO_MODE", False)
    monkeypatch.setattr(config, "DEMO_USER_PASSWORD", "a-strong-prod-password-123456")
    monkeypatch.setattr(config, "CORS_ORIGINS", ["https://procurement.example.com"])
    monkeypatch.setattr(config, "CELERY_BROKER_URL", "redis://localhost:6379/0")
    monkeypatch.setattr(config, "CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
    monkeypatch.setattr(config, "CELERY_TASK_ALWAYS_EAGER", False)
    monkeypatch.setattr(config, "PUBLIC_APP_URL", "http://procurement.example.com")
    monkeypatch.setattr(config_validation, "get_store", lambda: types.SimpleNamespace(ping=lambda: True))
    errors = config_validation.validate_production_config()
    assert any("PUBLIC_APP_URL" in e and "HTTPS" in e for e in errors)