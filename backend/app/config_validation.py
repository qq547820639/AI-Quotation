"""生产环境配置强制校验（P0）。

在 lifespan 启动时（仅 APP_ENV=prod）调用 validate_production_config()，
发现不满足则抛出 RuntimeError 拒绝启动，禁止生产静默降级到进程内（内存）实现
（限流/幂等/缓存/token）或本地附件存储。

- 不安全 SECRET_KEY → 拒绝
- 生产非 clamav 扫描器 → 拒绝
- 生产 REDIS_REQUIRED 但无 REDIS_URL，或配置了 REDIS_URL 但连接不可用 → 拒绝
- 生产强制 S3/MinIO（S3_REQUIRED）：配置缺失 → 拒绝；配置齐全但真实探活失败 → 拒绝（禁止回退本地存储）
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


def _public_url_ok() -> tuple[bool, str | None]:
    """生产 PUBLIC_APP_URL（若配置）必须为 HTTPS 且禁止 localhost/回环地址。

    说明：PUBLIC_APP_URL 为空时不做强制（兼容未显式配置的部署，URL Builder 会回退到
    PORTAL_BASE_URL origin 或相对路径）；一旦配置，则必须满足 HTTPS 与非 localhost 硬性
    要求，防止生产发出 http://localhost 邀请链接。末尾路径重复（以 / 结尾）已在
    config.normalize_public_app_url 加载时去除。
    """
    url = config.normalize_public_app_url(config.PUBLIC_APP_URL)
    if not url:
        return True, None
    if "://" not in url:
        return False, "生产环境 PUBLIC_APP_URL 必须包含协议（如 https://）"
    scheme = url.split("://", 1)[0].lower()
    if scheme != "https":
        return False, f"生产环境 PUBLIC_APP_URL 必须为 HTTPS（当前为 {scheme}）"
    host = url.split("://", 1)[1].split("/", 1)[0]
    hostname = host.split(":")[0].lower()
    if hostname in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return False, "生产环境 PUBLIC_APP_URL 禁止使用 localhost/本机回环地址"
    return True, None


def _notify_ok() -> tuple[bool, str | None]:
    """生产通知渠道校验（P0-6）：禁止 log/mailpit/none 渠道，禁止 SMTP 不完整时回退 LogProvider。"""
    channel = config.NOTIFY_CHANNEL
    if channel in ("log", "mailpit", "mailhog", "none"):
        return False, f"生产环境 NOTIFY_CHANNEL={channel} 为开发/测试渠道，必须配置 email"
    if channel == "email":
        if not (config.SMTP_HOST and config.SMTP_FROM):
            return False, "生产环境 NOTIFY_CHANNEL=email 但 SMTP 配置不完整（SMTP_HOST/SMTP_FROM 必填），禁止回退 LogNotifier"
        return True, None
    return False, f"生产环境 NOTIFY_CHANNEL 非法: {channel}"


def _storage_ok() -> tuple[bool, str | None]:
    """生产强制 S3/MinIO，禁止静默回退本地磁盘。

    - S3_* 配置缺失：若 S3_REQUIRED（生产默认 true）→ 拒绝；否则（dev/test）允许本地存储。
    - S3_* 配置齐全：必须使用 S3Storage，且真实探活（head bucket/create/write/read/delete）通过，
      否则拒绝启动（禁止回退本地存储）。
    """
    if not all([config.S3_ENDPOINT, config.S3_BUCKET, config.S3_ACCESS_KEY, config.S3_SECRET_KEY]):
        if config.S3_REQUIRED:
            return False, "生产环境强制 S3/MinIO（S3_REQUIRED=true），但 S3_* 配置缺失，禁止回退本地磁盘"
        return True, None
    storage = get_storage()
    if not isinstance(storage, S3Storage):
        return False, "S3 配置已齐全但未使用 S3Storage"
    if not storage.probe():
        return False, "S3/MinIO 探活失败（head bucket/写入/读取/删除），禁止回退本地存储"
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

    public_ok, public_err = _public_url_ok()
    if not public_ok:
        errors.append(public_err or "PUBLIC_APP_URL 校验失败")

    notify_ok, notify_err = _notify_ok()
    if not notify_ok:
        errors.append(notify_err or "通知渠道校验失败")

    return errors


def assert_production_config() -> None:
    """校验生产配置，不满足则抛 RuntimeError 拒绝启动。非生产环境无副作用。"""
    errors = validate_production_config()
    if errors:
        for err in errors:
            logger.error("production config validation failed: %s", err)
        raise RuntimeError("生产配置校验未通过，拒绝启动: " + "; ".join(errors))