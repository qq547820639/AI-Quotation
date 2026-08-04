"""AI 调用统计：写入 ai_usage 表 + 聚合统计（P1-9 Task 14）

- record_usage(db, user, result)：每次调用写一条（provider/model/tokens/cost/latency）。
- get_ai_stats(db)：聚合统计（总调用数 / 总 Token / 总成本 / 按 action 拆分）。
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Optional

from sqlalchemy.orm import Session

from .base import ProviderResult
from ..models import AIUsage

logger = logging.getLogger("procurement.ai")


def gen_usage_id() -> str:
    return f"aiu-{int(time.time() * 1000)}-{secrets.token_hex(2)}"


def record_usage(db: Session, created_by: Optional[str], result: ProviderResult) -> None:
    """持久化一次 AI 调用统计。失败不阻断响应（仅记录日志）。"""
    try:
        db.add(AIUsage(
            id=gen_usage_id(),
            action=result.action,
            provider=result.source,
            model=result.model,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            cost=result.cost,
            latency_ms=result.latency_ms,
            created_by=created_by,
        ))
        db.commit()
    except Exception:  # pragma: no cover - 统计失败不应影响主流程
        db.rollback()
        logger.warning("AI usage 记录失败", exc_info=True)


def get_ai_stats(db: Session) -> dict:
    """聚合统计：总调用数 / 总 Token / 总成本 / 按 action 拆分。"""
    rows = db.query(AIUsage).all()
    total_calls = len(rows)
    total_prompt = sum(r.prompt_tokens or 0 for r in rows)
    total_completion = sum(r.completion_tokens or 0 for r in rows)
    total_cost = sum(float(r.cost or 0) for r in rows)

    by_action: dict[str, dict] = {}
    for r in rows:
        a = by_action.setdefault(r.action, {
            "calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0,
        })
        a["calls"] += 1
        a["prompt_tokens"] += r.prompt_tokens or 0
        a["completion_tokens"] += r.completion_tokens or 0
        a["cost"] += float(r.cost or 0)

    return {
        "total_calls": total_calls,
        "total_prompt_tokens": total_prompt,
        "total_completion_tokens": total_completion,
        "total_tokens": total_prompt + total_completion,
        "total_cost": round(total_cost, 6),
        "by_action": by_action,
    }