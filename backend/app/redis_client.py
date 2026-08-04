"""Redis 客户端抽象：支持多实例分布式存储，无 Redis 时回退到进程内（内存）实现。

有 REDIS_URL 环境变量时使用 redis 客户端（可多实例）；否则回退到内存实现，
用于开发 / 测试 / 单实例部署。所有限流与幂等存储都应走本抽象，以实现可多实例。

对外暴露统一接口：
- set(key, value, ttl) / get(key) / delete(key)
- incr / expire / exists 等限流所需操作
- 幂等 get_result / store_result / clear
"""
from __future__ import annotations

import json
import threading
import time
from typing import Any

from .config import REDIS_URL

# 尝试导入 redis；若未安装则禁用 Redis 模式
try:
    import redis  # type: ignore
    _REDIS_AVAILABLE = True
except ImportError:  # pragma: no cover
    _REDIS_AVAILABLE = False


class _MemoryStore:
    """进程内内存实现（开发/测试/单实例回退）。线程安全。"""

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        expires = (time.time() + ttl) if ttl is not None else None
        with self._lock:
            self._data[key] = (expires, value)

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            expires, value = entry
            if expires is not None and time.time() > expires:
                self._data.pop(key, None)
                return None
            return value

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)

    def incr(self, key: str, ttl: int | None = None) -> int:
        with self._lock:
            entry = self._data.get(key)
            now = time.time()
            if entry is None:
                expires = (now + ttl) if ttl is not None else None
                self._data[key] = (expires, 1)
                return 1
            expires, value = entry
            if expires is not None and now > expires:
                expires = (now + ttl) if ttl is not None else None
                self._data[key] = (expires, 1)
                return 1
            self._data[key] = (expires, value + 1)
            return value + 1

    def expire(self, key: str, ttl: int) -> None:
        with self._lock:
            entry = self._data.get(key)
            if entry is not None:
                self._data[key] = (time.time() + ttl, entry[1])

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class _RedisStore:
    """Redis 客户端实现（可多实例）。"""

    def __init__(self, url: str) -> None:
        self._client = redis.Redis.from_url(url, decode_responses=True)

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        v = json.dumps(value) if not isinstance(value, (str, bytes)) else value
        self._client.set(key, v, ex=ttl)

    def get(self, key: str) -> Any | None:
        raw = self._client.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return raw

    def delete(self, key: str) -> None:
        self._client.delete(key)

    def incr(self, key: str, ttl: int | None = None) -> int:
        val = self._client.incr(key)
        if ttl is not None:
            self._client.expire(key, ttl)
        return int(val)

    def expire(self, key: str, ttl: int) -> None:
        self._client.expire(key, ttl)

    def clear(self) -> None:
        # 仅清空本项目前缀的键（限流/幂等都使用本项目前缀）
        keys = self._client.keys("procurement:*")
        if keys:
            self._client.delete(*keys)


def _build_store():
    if REDIS_URL and _REDIS_AVAILABLE:
        return _RedisStore(REDIS_URL)
    return _MemoryStore()


# 全局单例 store
_store = _build_store()


def get_store():
    """返回全局存储实例（Redis 或内存回退）"""
    return _store


# ============ 限流抽象 ============

def is_login_blocked(user_id: str, client_ip: str) -> bool:
    """判断该用户+IP 是否已超过连续失败阈值，返回是否被限流"""
    from .config import LOGIN_MAX_ATTEMPTS
    key = f"procurement:login:fail:{user_id}::{client_ip}"
    current = _store.get(key) or 0
    return int(current) >= LOGIN_MAX_ATTEMPTS


def record_login_failure(user_id: str, client_ip: str) -> None:
    """记录一次失败登录（自增计数，窗口内自动过期）"""
    from .config import LOGIN_RATE_LIMIT_WINDOW_SECONDS
    key = f"procurement:login:fail:{user_id}::{client_ip}"
    _store.incr(key, ttl=LOGIN_RATE_LIMIT_WINDOW_SECONDS)


def reset_login_attempts(user_id: str, client_ip: str) -> None:
    """登录成功后重置失败计数"""
    key = f"procurement:login:fail:{user_id}::{client_ip}"
    _store.delete(key)


# ============ 幂等存储抽象 ============

_IDEMPOTENCY_TTL_SECONDS = 600


def _idem_key(idempotency_key: str, endpoint: str) -> str:
    return f"procurement:idem:{endpoint}::{idempotency_key}"


def get_result(idempotency_key: str, endpoint: str) -> Any | None:
    """若该 key 已处理且未过期，返回缓存结果；否则返回 None"""
    if not idempotency_key:
        return None
    return _store.get(_idem_key(idempotency_key, endpoint))


def store_result(idempotency_key: str, endpoint: str, result: Any) -> None:
    """缓存该 key 的处理结果"""
    if not idempotency_key:
        return
    _store.set(_idem_key(idempotency_key, endpoint), result, ttl=_IDEMPOTENCY_TTL_SECONDS)


def clear() -> None:
    """清空幂等缓存（测试用）"""
    _store.clear()