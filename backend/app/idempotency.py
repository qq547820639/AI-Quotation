"""幂等性：按 (Idempotency-Key, endpoint) 去重。

存储层已迁移到 Redis 抽象（backend/app/redis_client.py），支持多实例；
无 Redis 时回退到进程内（内存）实现。本模块保持原有接口不变，
供现有调用方（portal.py 等）继续使用。

用于 send-invitation / submit-quotation / submit-approval / confirm-result 等
可能被客户端重复触发的写操作：若同一请求已处理过，则直接返回缓存结果，避免重复创建。
"""
from __future__ import annotations

from typing import Any

from .redis_client import get_result, store_result, clear  # noqa: F401  (re-export)

__all__ = ["get_result", "store_result", "clear"]