"""生产配置校验单元测试：validate_production_config 对不安全 SECRET_KEY、prod 无 clamav、
prod 内存回退（Redis 不可用）、S3 配置齐全但客户端不可用等返回错误。"""
import types

import pytest

from app import config
from app import config_validation


def _set_prod(monkeypatch, **kwargs):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    defaults = {
        "SECRET_KEY": "a-strong-random-prod-secret-key-0123456789",
        "SCANNER_PROVIDER": "clamav",
        "REDIS_URL": "redis://localhost:6379/0",
        "REDIS_REQUIRED": True,
        "S3_ENDPOINT": "",
        "S3_BUCKET": "",
        "S3_ACCESS_KEY": "",
        "S3_SECRET_KEY": "",
        "APP_DEMO_MODE": False,
        "DEMO_USER_PASSWORD": "a-strong-prod-password-123456",
        "CORS_ORIGINS": ["https://procurement.example.com"],
        "CELERY_BROKER_URL": "redis://localhost:6379/0",
        "CELERY_RESULT_BACKEND": "redis://localhost:6379/0",
        "CELERY_TASK_ALWAYS_EAGER": False,
    }
    defaults.update(kwargs)
    for k, v in defaults.items():
        monkeypatch.setattr(config, k, v)


def _fake_store(ping_ok=True):
    if ping_ok:
        return types.SimpleNamespace(ping=lambda: True)
    def _raise():
        raise ConnectionError("redis down")
    return types.SimpleNamespace(ping=_raise)


def test_not_prod_returns_no_errors(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "dev")
    assert config_validation.validate_production_config() == []


def test_prod_all_valid(monkeypatch):
    _set_prod(monkeypatch)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    assert config_validation.validate_production_config() == []


def test_prod_insecure_secret_key(monkeypatch):
    _set_prod(monkeypatch, SECRET_KEY="dev-secret-key-change-me")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("SECRET_KEY" in e for e in errors)


def test_prod_noop_scanner(monkeypatch):
    _set_prod(monkeypatch, SCANNER_PROVIDER="noop")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("SCANNER_PROVIDER" in e and "clamav" in e for e in errors)


def test_prod_redis_required_no_url(monkeypatch):
    _set_prod(monkeypatch, REDIS_URL="", REDIS_REQUIRED=True)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("REDIS_URL" in e for e in errors)


def test_prod_redis_unreachable(monkeypatch):
    _set_prod(monkeypatch)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(False))
    errors = config_validation.validate_production_config()
    assert any("Redis" in e for e in errors)


def test_prod_redis_optional_no_url_ok(monkeypatch):
    _set_prod(monkeypatch, REDIS_URL="", REDIS_REQUIRED=False)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert not any("REDIS" in e for e in errors)


def test_prod_s3_configured_but_unavailable(monkeypatch):
    _set_prod(
        monkeypatch,
        S3_ENDPOINT="http://minio:9000",
        S3_BUCKET="b",
        S3_ACCESS_KEY="a",
        S3_SECRET_KEY="s",
    )
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    from app.storage import S3Storage
    s3 = S3Storage()  # 默认空配置 → is_available() False
    monkeypatch.setattr(config_validation, "get_storage", lambda: s3)
    errors = config_validation.validate_production_config()
    assert any("S3" in e or "MinIO" in e for e in errors)


def test_prod_s3_configured_and_available(monkeypatch):
    _set_prod(
        monkeypatch,
        S3_ENDPOINT="http://minio:9000",
        S3_BUCKET="b",
        S3_ACCESS_KEY="a",
        S3_SECRET_KEY="s",
    )
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    from app.storage import S3Storage
    s3 = S3Storage(endpoint="http://minio:9000", bucket="b", access_key="a", secret_key="s")
    monkeypatch.setattr(config_validation, "get_storage", lambda: s3)
    assert config_validation.validate_production_config() == []


def test_assert_production_config_raises_on_errors(monkeypatch):
    _set_prod(monkeypatch, SECRET_KEY="dev-secret-key-change-me", SCANNER_PROVIDER="noop")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    with pytest.raises(RuntimeError):
        config_validation.assert_production_config()


def test_assert_production_config_noop_in_dev(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "test")
    config_validation.assert_production_config()  # 不应抛错


# ============ Task 9：生产配置校验补齐 ============

def test_prod_short_secret_key(monkeypatch):
    """SECRET_KEY 长度 < 32 视为不安全 → 报错"""
    _set_prod(monkeypatch, SECRET_KEY="short-secret")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("SECRET_KEY" in e for e in errors)


def test_prod_32_char_secret_key_ok(monkeypatch):
    """SECRET_KEY 长度 >= 32 且非默认值 → 通过"""
    _set_prod(monkeypatch, SECRET_KEY="x" * 32)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert not any("SECRET_KEY" in e for e in errors)


def test_prod_demo_mode_forbidden(monkeypatch):
    """prod + APP_DEMO_MODE=true → 报错"""
    _set_prod(monkeypatch, APP_DEMO_MODE=True)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("APP_DEMO_MODE" in e for e in errors)


def test_prod_default_demo_password_forbidden(monkeypatch):
    """prod + DEMO_USER_PASSWORD 仍为默认演示密码 → 报错"""
    _set_prod(monkeypatch, DEMO_USER_PASSWORD="123456")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("DEMO_USER_PASSWORD" in e for e in errors)


def test_prod_cors_whitelist_empty_forbidden(monkeypatch):
    """prod + CORS_ORIGINS 为空 → 报错"""
    _set_prod(monkeypatch, CORS_ORIGINS=[])
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("CORS_ORIGINS" in e for e in errors)


def test_prod_cors_only_localhost_forbidden(monkeypatch):
    """prod + CORS_ORIGINS 仅包含 localhost/127.0.0.1 → 报错"""
    _set_prod(monkeypatch, CORS_ORIGINS=["http://localhost:5173", "http://127.0.0.1:5173"])
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("CORS_ORIGINS" in e for e in errors)


def test_prod_cors_mixed_with_production_origin_ok(monkeypatch):
    """prod + CORS_ORIGINS 含生产域名 → 通过"""
    _set_prod(monkeypatch, CORS_ORIGINS=["http://localhost:5173", "https://procurement.example.com"])
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert not any("CORS_ORIGINS" in e for e in errors)


def test_prod_in_memory_token_backend_forbidden(monkeypatch):
    """prod + 未配置远程缓存（内存 token/限流/缓存后端）→ 报错"""
    _set_prod(monkeypatch, REDIS_URL="", REDIS_REQUIRED=False)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("内存型" in e for e in errors)


def test_prod_memory_celery_broker_forbidden(monkeypatch):
    """prod + CELERY_BROKER_URL 为 memory:// → 报错"""
    _set_prod(monkeypatch, CELERY_BROKER_URL="memory://", CELERY_RESULT_BACKEND="memory://")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("broker" in e and "memory" in e for e in errors)


def test_prod_celery_always_eager_forbidden(monkeypatch):
    """prod + CELERY_TASK_ALWAYS_EAGER=true → 报错"""
    _set_prod(monkeypatch, CELERY_TASK_ALWAYS_EAGER=True)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("CELERY_TASK_ALWAYS_EAGER" in e for e in errors)


def test_errors_do_not_leak_secrets(monkeypatch):
    """错误信息不得包含 SECRET_KEY / 演示密码等敏感值"""
    secret = "top-secret-value-abcdef-1234567890"
    demo_pw = "super-secret-password"
    _set_prod(monkeypatch, SECRET_KEY=secret, DEMO_USER_PASSWORD=demo_pw, SCANNER_PROVIDER="noop")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    joined = " ".join(errors)
    assert secret not in joined
    assert demo_pw not in joined
    assert errors  # 至少应因 SCANNER_PROVIDER=noop 报错