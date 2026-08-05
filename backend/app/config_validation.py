"""生产环境配置强制校验（P0）。

在 lifespan 启动时（仅 APP_ENV=prod）调用 validate_production_config()，
发现不满足则抛出 RuntimeError 拒绝启动，禁止生产静默降级到进程内（内存）实现
（限流/幂等/缓存/token）或本地附件存储。

- 不安全 SECRET_KEY → 拒绝
- 生产非 clamav 扫描器 → 拒绝
- 生产 REDIS_REQUIRED 但无 REDIS_URL，或配置了 REDIS_URL 但连接不可用 → 拒绝
- 生产 S3 配置齐全但客户端不可用 → 拒绝（禁止回退本地存储）
"""
from __future__ import annotations

import logging

from . import config
from .redis_client import get_store
from .storage import S3Storage, get_storage

logger = logging.getLogger("procurement")

# 生产环境必须替换的默认/演示密钥，视为不安全
_INSECURE_SECRET_KEYS = {
    "dev-secret-key-change-me",
    "change-me-in-production",
    "",
}

# 生产环境 SECRET_KEY 最小长度（32 字符），过短视为不安全
_MIN_SECRET_KEY_LENGTH = 32

# 生产环境禁止使用演示模式（APP_DEMO_MODE=true 时快捷登录，不校验密码）
# 种子逻辑（seed.py）以 DEMO_USER_PASSWORD 哈希创建/回填用户密码，生产必须替换默认演示密码。
_DEFAULT_DEMO_PASSWORD = "123456"

# 仅包含本地开发默认项（localhost/127.0.0.1）的 CORS 白名单在产线视为未配置
_LOCAL_HOST_MARKERS = ("localhost", "127.0.0.1")


def _secret_key_is_safe() -> bool:
    if config.SECRET_KEY in _INSECURE_SECRET_KEYS:
        return False
    return len(config.SECRET_KEY) >= _MIN_SECRET_KEY_LENGTH


def _demo_mode_ok() -> tuple[bool, str | None]:
    """生产禁止 demo 模式与默认演示密码。"""
    if config.APP_DEMO_MODE:
        return False, "生产环境禁止 APP_DEMO_MODE=true（演示快捷登录）"
    if config.DEMO_USER_PASSWORD == _DEFAULT_DEMO_PASSWORD:
        return False, "生产环境 DEMO_USER_PASSWORD 仍为默认演示密码（123456），必须设置强生产密码"
    return True, None


def _cors_ok() -> tuple[bool, str | None]:
    """生产必须配置明确的 CORS 白名单（非空且含非本地默认项）。"""
    origins = config.CORS_ORIGINS or []
    if not origins:
        return False, "生产环境 CORS_ORIGINS 为空，必须配置明确的生产白名单"
    non_local = [o for o in origins if not any(m in o for m in _LOCAL_HOST_MARKERS)]
    if not non_local:
        return False, "生产环境 CORS_ORIGINS 仅包含 localhost/127.0.0.1 本地默认项，必须配置明确的生产白名单"
    return True, None


def _scanner_is_clamav() -> bool:
    return config.SCANNER_PROVIDER == "clamav"


def _redis_ok() -> tuple[bool, str | None]:
    """返回 (是否通过, 错误信息)。"""
    if not config.REDIS_URL:
        if config.REDIS_REQUIRED:
            return False, "生产要求 REDIS_URL（REDIS_REQUIRED=true），未配置"
        return True, None
    try:
        get_store().ping()
    except Exception as e:  # noqa: BLE001 - 连接失败即拒绝启动
        return False, f"Redis 连接不可用: {e}"
    return True, None


def _no_in_memory_backend_ok() -> tuple[bool, str | None]:
    """生产禁止内存型 token/限流/缓存后端与内存任务队列（禁止静默降级到单进程内存）。"""
    if not config.REDIS_URL:
        return False, "生产环境禁止使用内存型 token/限流/缓存后端（必须配置远程缓存存储）"
    broker = (config.CELERY_BROKER_URL or "").lower()
    backend = (config.CELERY_RESULT_BACKEND or "").lower()
    if not broker or broker.startswith("memory://") or broker.startswith("cache+memory://"):
        return False, "生产环境任务队列 broker 必须为持久化后端，禁止 memory:// 内存 broker"
    if not backend or backend.startswith("memory://") or backend.startswith("cache+memory://"):
        return False, "生产环境任务队列 result backend 必须为持久化后端，禁止 memory:// 内存 backend"
    if config.CELERY_TASK_ALWAYS_EAGER:
        return False, "生产环境禁止 CELERY_TASK_ALWAYS_EAGER=true（任务必须落真实队列）"
    return True, None


def _storage_ok() -> tuple[bool, str | None]:
    """若 S3 配置齐全但客户端不可用 → 拒绝（禁止静默回退本地存储）。"""
    if not all([config.S3_ENDPOINT, config.S3_BUCKET, config.S3_ACCESS_KEY, config.S3_SECRET_KEY]):
        return True, None
    storage = get_storage()
    if not isinstance(storage, S3Storage):
        return False, "S3 配置已齐全但未使用 S3Storage"
    if not storage.is_available():
        return False, "S3/MinIO 客户端不可用（检查端点/密钥/boto3），禁止回退本地存储"
    return True, None


def validate_production_config() -> list[str]:
    """返回生产配置校验错误列表；全部通过时返回空列表。非生产环境直接返回空。"""
    errors: list[str] = []
    if config.APP_ENV != "prod":
        return errors

    if not _secret_key_is_safe():
        errors.append("SECRET_KEY 未设置为安全的随机值（仍为默认/演示密钥或长度 < 32）")

    if not _scanner_is_clamav():
        errors.append(f"生产环境 SCANNER_PROVIDER 必须为 clamav（当前为 {config.SCANNER_PROVIDER}），禁止 noop 扫描")

    demo_ok, demo_err = _demo_mode_ok()
    if not demo_ok:
        errors.append(demo_err or "演示模式校验失败")

    cors_ok, cors_err = _cors_ok()
    if not cors_ok:
        errors.append(cors_err or "CORS 白名单校验失败")

    redis_ok, redis_err = _redis_ok()
    if not redis_ok:
        errors.append(redis_err or "Redis 校验失败")

    backend_ok, backend_err = _no_in_memory_backend_ok()
    if not backend_ok:
        errors.append(backend_err or "内存型后端校验失败")

    storage_ok, storage_err = _storage_ok()
    if not storage_ok:
        errors.append(storage_err or "对象存储校验失败")

    return errors


def assert_production_config() -> None:
    """校验生产配置，不满足则抛 RuntimeError 拒绝启动。非生产环境无副作用。"""
    errors = validate_production_config()
    if errors:
        for err in errors:
            logger.error("production config validation failed: %s", err)
        raise RuntimeError("生产配置校验未通过，拒绝启动: " + "; ".join(errors))