"""AI 调用统计：写入 ai_usage 表 + SQL 聚合统计（P1-9 Task 14 + P1 深化 Task 13）

- record_usage(db, user, result)：每次调用写一条（provider/model/tokens/cost/latency/prompt_version/degraded）。
- get_ai_stats(db, ...)：通过 SQL COUNT/SUM/GROUP BY 聚合，不读取全部记录到 Python 内存。
- record_feedback(db, user, ...)：记录「有帮助/无帮助/纠正」反馈（可解释性）。
"""
from __future__ import annotations

import logging
import secrets
import time
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .base import ProviderResult
from ..models import AIFeedback, AIUsage, User

logger = logging.getLogger("procurement.ai")


def gen_usage_id() -> str:
    return f"aiu-{int(time.time() * 1000)}-{secrets.token_hex(2)}"


def gen_feedback_id() -> str:
    return f"aif-{int(time.time() * 1000)}-{secrets.token_hex(2)}"


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
            prompt_version=result.prompt_version,
            degraded=result.degraded,
            created_by=created_by,
        ))
        db.commit()
    except Exception:  # pragma: no cover - 统计失败不应影响主流程
        db.rollback()
        logger.warning("AI usage 记录失败", exc_info=True)


def record_feedback(
    db: Session,
    created_by: Optional[str],
    feedback: str,
    *,
    usage_id: Optional[str] = None,
    action: Optional[str] = None,
    comment: Optional[str] = None,
    organization: Optional[str] = None,
) -> AIFeedback:
    """记录一条 AI 输出反馈。返回持久化的 AIFeedback 对象。"""
    f = AIFeedback(
        id=gen_feedback_id(),
        usage_id=usage_id,
        action=action,
        feedback=feedback,
        comment=comment,
        created_by=created_by,
        organization=organization,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


# 支持的反馈取值，供路由校验
FEEDBACK_VALUES = ("helpful", "not_helpful", "correct")


def get_ai_stats(
    db: Session,
    *,
    organization: Optional[str] = None,
    action: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """SQL 聚合统计（COUNT/SUM + GROUP BY），不读取全部记录。

    通过 join users 支持按组织机构过滤（AIUsage.created_by -> users.organization）。
    返回总体聚合 + 按 action 拆分 + 分页明细。
    """
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))

    # 基础过滤条件
    def _base_filters():
        conds = []
        if action:
            conds.append(AIUsage.action == action)
        if start_time:
            conds.append(AIUsage.created_at >= start_time)
        if end_time:
            conds.append(AIUsage.created_at <= end_time)
        if organization:
            conds.append(User.id == AIUsage.created_by)
            conds.append(User.organization == organization)
        return conds

    filters = _base_filters()

    # 总体聚合（COUNT/SUM）
    total_row = db.execute(
        select(
            func.count(AIUsage.id),
            func.coalesce(func.sum(AIUsage.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsage.completion_tokens), 0),
            func.coalesce(func.sum(AIUsage.cost), 0),
        ).select_from(AIUsage).filter(*filters)
    ).one()
    total_calls = int(total_row[0])
    total_prompt = int(total_row[1])
    total_completion = int(total_row[2])
    total_cost = float(total_row[3])

    # 按 action 聚合（COUNT/SUM + GROUP BY）
    agg_query = (
        select(
            AIUsage.action,
            func.count(AIUsage.id),
            func.coalesce(func.sum(AIUsage.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsage.completion_tokens), 0),
            func.coalesce(func.sum(AIUsage.cost), 0),
        )
        .select_from(AIUsage)
        .filter(*filters)
        .group_by(AIUsage.action)
    )
    by_action: dict[str, dict] = {}
    for row in db.execute(agg_query):
        by_action[str(row[0])] = {
            "calls": int(row[1]),
            "prompt_tokens": int(row[2]),
            "completion_tokens": int(row[3]),
            "cost": round(float(row[4]), 6),
        }

    # 分页明细（倒序）
    detail_query = (
        select(AIUsage)
        .select_from(AIUsage)
        .filter(*filters)
        .order_by(AIUsage.created_at.desc(), AIUsage.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        {
            "id": r.id,
            "action": r.action,
            "provider": r.provider,
            "model": r.model,
            "prompt_tokens": r.prompt_tokens,
            "completion_tokens": r.completion_tokens,
            "cost": round(float(r.cost or 0), 6),
            "latency_ms": r.latency_ms,
            "prompt_version": r.prompt_version,
            "degraded": r.degraded,
            "created_at": r.created_at,
            "created_by": r.created_by,
        }
        for r in db.execute(detail_query).scalars()
    ]

    return {
        "total_calls": total_calls,
        "total_prompt_tokens": total_prompt,
        "total_completion_tokens": total_completion,
        "total_tokens": total_prompt + total_completion,
        "total_cost": round(total_cost, 6),
        "by_action": by_action,
        "items": items,
        "page": page,
        "page_size": page_size,
    }


def get_ai_feedback_summary(db: Session, *, organization: Optional[str] = None) -> dict:
    """反馈聚合：按 feedback 取值计数（COUNT + GROUP BY）。"""
    filters = []
    if organization:
        filters.append(AIFeedback.organization == organization)
    rows = db.execute(
        select(AIFeedback.feedback, func.count(AIFeedback.id))
        .filter(*filters)
        .group_by(AIFeedback.feedback)
    ).all()
    return {
        "helpful": 0,
        "not_helpful": 0,
        "correct": 0,
        **{str(f): int(c) for f, c in rows},
    }