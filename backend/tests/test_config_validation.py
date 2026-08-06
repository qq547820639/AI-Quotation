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
        "NOTIFY_CHANNEL": "email",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_FROM": "no-reply@example.com",
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
    # 注入探活通过的 fake client（真实驱动 probe 往返，避免依赖真实 MinIO）
    s3 = S3Storage(
        endpoint="http://minio:9000", bucket="b", access_key="a", secret_key="s",
        client=_FakeS3Client(),
    )
    monkeypatch.setattr(config_validation, "get_storage", lambda: s3)
    assert config_validation.validate_production_config() == []


def test_prod_s3_required_but_not_configured(monkeypatch):
    """生产强制 S3（S3_REQUIRED=true）但 S3_* 缺失 → 拒绝，禁止回退本地磁盘。"""
    _set_prod(monkeypatch)  # 默认 S3_* 为空
    monkeypatch.setattr(config, "S3_REQUIRED", True)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("S3" in e and "S3_REQUIRED" in e for e in errors)


def test_prod_s3_probe_fails(monkeypatch):
    """生产 S3 配置齐全但真实探活失败 → 拒绝（禁止回退本地存储）。"""
    _set_prod(
        monkeypatch,
        S3_ENDPOINT="http://minio:9000",
        S3_BUCKET="b",
        S3_ACCESS_KEY="a",
        S3_SECRET_KEY="s",
    )
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    from app.storage import S3Storage

    class _FailClient:
        def head_bucket(self, **kw):
            pass
        def put_object(self, **kw):
            raise RuntimeError("put failed")

    s3 = S3Storage(endpoint="http://x", bucket="b", access_key="a", secret_key="s", client=_FailClient())
    monkeypatch.setattr(config_validation, "get_storage", lambda: s3)
    errors = config_validation.validate_production_config()
    assert any("S3" in e or "MinIO" in e for e in errors)


def _FakeS3Client():
    """探活可通过的内存版最小 S3 客户端（head/write/read/delete 全通过）。"""
    class _Body:
        def __init__(self, data):
            self._data = data
        def read(self):
            return self._data
    class _Client:
        def __init__(self):
            self.objects = {}
        def head_bucket(self, **kw):
            pass
        def create_bucket(self, **kw):
            pass
        def put_object(self, Bucket=None, Key=None, Body=None):
            self.objects[Key] = Body
        def get_object(self, Bucket=None, Key=None):
            return {"Body": _Body(self.objects[Key])}
        def delete_object(self, Bucket=None, Key=None):
            self.objects.pop(Key, None)
    return _Client()


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


def test_prod_seed_demo_data_allowed(monkeypatch):
    """prod + SEED_DEMO_DATA=true（且 APP_DEMO_MODE=false）→ 不报错。

    验证 SEED_DEMO_DATA 与快捷登录解耦：它只允许注入真实密码哈希的种子数据，
    不触发 config_validation 对演示快捷登录的禁止，生产/CI 形态 E2E 可安全使用。
    """
    _set_prod(monkeypatch, APP_DEMO_MODE=False)
    monkeypatch.setattr(config, "SEED_DEMO_DATA", True)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert errors == []


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


# ============ P0-6：生产通知渠道校验 ============

def test_prod_notify_log_forbidden(monkeypatch):
    """prod + NOTIFY_CHANNEL=log → 拒绝（禁止生产用日志假成功）"""
    _set_prod(monkeypatch, NOTIFY_CHANNEL="log")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("NOTIFY_CHANNEL" in e and "log" in e for e in errors)


def test_prod_notify_mailpit_forbidden(monkeypatch):
    """prod + NOTIFY_CHANNEL=mailpit → 拒绝（开发/E2E 渠道）"""
    _set_prod(monkeypatch, NOTIFY_CHANNEL="mailpit")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("NOTIFY_CHANNEL" in e and "mailpit" in e for e in errors)


def test_prod_notify_none_forbidden(monkeypatch):
    """prod + NOTIFY_CHANNEL=none → 拒绝（不投递通知）"""
    _set_prod(monkeypatch, NOTIFY_CHANNEL="none")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("NOTIFY_CHANNEL" in e and "none" in e for e in errors)


def test_prod_notify_email_incomplete_smtp_forbidden(monkeypatch):
    """prod + NOTIFY_CHANNEL=email 但 SMTP_HOST/SMTP_FROM 缺失 → 拒绝（禁止回退 LogNotifier）"""
    _set_prod(monkeypatch, SMTP_HOST="", SMTP_FROM="")
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert any("SMTP" in e and "回退" in e for e in errors)


def test_prod_notify_email_complete_ok(monkeypatch):
    """prod + NOTIFY_CHANNEL=email 且 SMTP 完整 → 通过"""
    _set_prod(monkeypatch)
    monkeypatch.setattr(config_validation, "get_store", lambda: _fake_store(True))
    errors = config_validation.validate_production_config()
    assert not any("NOTIFY_CHANNEL" in e or "SMTP" in e for e in errors)


# ============ CORS_ORIGINS 解析（P0-2） ============


def test_parse_cors_origins_default_when_empty():
    """未设置 CORS_ORIGINS → 回退本地开发默认项"""
    assert config.parse_cors_origins(None) == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    assert config.parse_cors_origins("") == config.parse_cors_origins(None)


def test_parse_cors_origins_comma_separated():
    """逗号分隔：去除空白、丢弃空项"""
    assert config.parse_cors_origins(
        " https://a.com , https://b.com ,  ,https://c.com "
    ) == ["https://a.com", "https://b.com", "https://c.com"]


def test_parse_cors_origins_json_array():
    """JSON 数组字符串：逐项 strip 并丢弃空项"""
    assert config.parse_cors_origins(
        '["https://a.com", "https://b.com", "", "https://c.com"]'
    ) == ["https://a.com", "https://b.com", "https://c.com"]


def test_parse_cors_origins_json_invalid_falls_back_to_comma():
    """非法 JSON（以 [ 开头但解析失败）→ 回退逗号切分"""
    assert config.parse_cors_origins('[https://a.com, https://b.com]') == [
        "[https://a.com",
        "https://b.com]",
    ]


def test_parse_cors_origins_json_non_list_falls_back_to_comma():
    """JSON 解析成功但非 list（如字符串/对象）→ 回退逗号切分"""
    assert config.parse_cors_origins('"https://a.com"') == ['"https://a.com"']