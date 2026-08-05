"""持久化队列客户端（事务 outbox + Celery 投递，P1 可靠性）

- enqueue(event_type, aggregate_id, payload)：先插 outbox（独立事务持久化）再投递；
  同 idempotency_key 已存在则跳过（幂等）。
- dispatch_outbox()：扫描 pending outbox 事件投递到 Celery 并标记 dispatched。
  「DB 已提交但任务未入队」（进程重启/Redis 短暂断开）由本函数补齐，不丢失。
- retry_failed_task(task_id)：将 permanent_failure 任务重置为 pending 并重投。
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime

from sqlalchemy.exc import IntegrityError

from .database import SessionLocal
from .models import OutboxEvent, TaskRecord
from .serializers import gen_id

logger = logging.getLogger("procurement.queue")

# 事件类型 → Celery 任务名
_EVENT_TASK = {
    "email.send": "tasks.send_email_task",
    "inquiry.reminder": "tasks.send_inquiry_reminder_task",
    "batch.notify": "tasks.batch_notify_task",
    "export.run": "tasks.export_task",
    "ai.slow": "tasks.ai_slow_task",
}

# 任务名 → 事件类型（用于 retry 时按任务反查事件）
_TASK_TO_EVENT = {v: k for k, v in _EVENT_TASK.items()}


def _default_idempotency_key(event_type: str, aggregate_id, payload) -> str:
    """由事件参与方生成稳定幂等键：同一业务事件（同类型+同聚合+同载荷）重复入队被跳过。"""
    raw = json.dumps(
        {"event_type": event_type, "aggregate_id": aggregate_id, "payload": payload},
        sort_keys=True, ensure_ascii=False, default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_task(task_name: str):
    """按任务名解析 Celery 任务对象（惰性导入 tasks 模块以注册任务）。"""
    from .tasks import celery_app
    return celery_app.tasks.get(task_name)


def _dispatch_event(session, event: OutboxEvent) -> bool:
    """将单条 outbox 事件投递到 Celery 并标记 dispatched。

    投递失败（broker 不可用）时保持 pending 并回滚，由 dispatch_outbox 稍后补齐。
    """
    task_name = _EVENT_TASK.get(event.event_type)
    if task_name is None:
        event.status = "failed"
        event.error = f"未注册事件类型: {event.event_type}"
        session.commit()
        return False
    try:
        task = _get_task(task_name)
        if task is None:
            raise LookupError(f"任务未注册: {task_name}")
        kwargs = dict(event.payload or {})
        kwargs.setdefault("idempotency_key", event.idempotency_key)
        kwargs.setdefault("business_event_id", event.id)
        task.apply_async(kwargs=kwargs)
        event.status = "dispatched"
        event.dispatched_at = datetime.utcnow()
        event.error = None
        session.commit()
        return True
    except Exception as exc:  # noqa: BLE001 - broker 瞬时故障，保持 pending 供补齐
        session.rollback()
        logger.warning(
            "dispatch_event_failed",
            extra={"extra_fields": {"event_id": event.id, "event_type": event.event_type, "error": str(exc)}},
        )
        return False


def enqueue(event_type: str, aggregate_id, payload=None, idempotency_key=None) -> bool:
    """入队：先持久化 outbox（幂等，同 key 已存在则跳过）再投递。返回是否新建并投递。"""
    db = SessionLocal()
    try:
        key = idempotency_key or _default_idempotency_key(event_type, aggregate_id, payload)
        existing = db.query(OutboxEvent).filter(OutboxEvent.idempotency_key == key).first()
        if existing is not None:
            return False
        event = OutboxEvent(
            id=gen_id("ob"),
            event_type=event_type,
            aggregate_id=aggregate_id,
            payload=payload or {},
            status="pending",
            idempotency_key=key,
        )
        db.add(event)
        # 先提交 outbox：保证「入队失败不丢」——无论投递成败事件都已持久化。
        db.commit()
        _dispatch_event(db, event)
        return True
    except IntegrityError:
        # 并发重复入队：唯一键冲突视为已存在
        db.rollback()
        return False
    finally:
        db.close()


def dispatch_outbox(limit: int = 100) -> int:
    """扫描 pending outbox 事件并投递。返回成功投递数。

    用于 worker 重启 / broker 短暂断开后的补齐：未 dispatched 的事件在此被重新投递。
    """
    db = SessionLocal()
    dispatched = 0
    try:
        events = db.query(OutboxEvent).filter(
            OutboxEvent.status == "pending",
        ).order_by(OutboxEvent.created_at).limit(limit).all()
        for event in events:
            if _dispatch_event(db, event):
                dispatched += 1
        return dispatched
    finally:
        db.close()


def retry_failed_task(task_id: str) -> bool:
    """将 permanent_failure 任务重置为 pending 并重新投递。返回是否成功触发重试。"""
    db = SessionLocal()
    try:
        rec = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        if rec is None or rec.status not in ("permanent_failure", "failed"):
            return False
        task = _get_task(rec.task_name)
        if task is None:
            return False
        kwargs = dict(rec.payload or {})
        kwargs.setdefault("idempotency_key", rec.idempotency_key)
        kwargs.setdefault("business_event_id", rec.business_event_id)
        # 先重置为 pending 再投递：真实异步模式下任务入队后为 pending；
        # eager 模式下 apply_async 会同步执行，任务终态（succeeded/permanent_failure）由 on_* 回写。
        rec.status = "pending"
        rec.attempts = 0
        rec.last_error = None
        rec.finished_at = None
        db.commit()
        try:
            task.apply_async(kwargs=kwargs)
        except Exception:  # noqa: BLE001 - 投递失败（broker 不可用）恢复失败态供再次重试
            rec.status = "permanent_failure"
            db.commit()
            logger.exception("retry_dispatch_failed", extra={"extra_fields": {"task_id": task_id}})
            return False
        return True
    except Exception:  # noqa: BLE001 - 重试失败保持原状态
        db.rollback()
        logger.exception("retry_failed_task_failed", extra={"extra_fields": {"task_id": task_id}})
        return False
    finally:
        db.close()