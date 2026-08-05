"""Celery 应用与持久化任务定义（P1 可靠性：迁出 FastAPI 进程内 BackgroundTasks）

- broker/backend 用 config 的 CELERY_BROKER_URL（默认 REDIS_URL）；dev/test 未配置时回退 memory://。
- 每个任务携带稳定幂等键 idempotency_key，配合 outbox 去重，避免同一业务事件重复发送。
- 支持指数退避与最大重试次数（autoretry_for / retry_backoff / max_retries）。
- 任务最终失败时写入 task_records status=permanent_failure，可经 POST /api/tasks/{id}/retry 重投。
"""
from __future__ import annotations

import logging
from datetime import datetime

from celery import Celery

from . import config
from .database import SessionLocal
from .models import TaskRecord
from .serializers import gen_id

logger = logging.getLogger("procurement.tasks")

# broker / backend：未配置时回退 memory://（dev/test 单进程；生产应配置 Redis）
_broker = config.CELERY_BROKER_URL or "memory://"
_backend = config.CELERY_RESULT_BACKEND or _broker
# memory:// 只适用于 broker，不能作为 result backend；eager 模式改用 cache+memory://
if not _backend or _backend == "memory://":
    _backend = "cache+memory://"

celery_app = Celery(
    "procurement",
    broker=_broker,
    backend=_backend,
    include=["app.tasks"],
)

celery_app.conf.update(
    task_always_eager=config.CELERY_TASK_ALWAYS_EAGER,
    # eager 模式下不让任务异常冒泡到请求，避免发起的请求因后台任务失败而 500
    task_eager_propagates=False,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_default_queue="procurement",
)


def _mark_task(
    task_name: str,
    idempotency_key: str | None,
    status: str,
    payload: dict | None = None,
    last_error: str | None = None,
    attempts: int = 0,
    business_event_id: str | None = None,
) -> None:
    """按 idempotency_key upsert 任务状态记录。

    供任务体（running）与基类 on_success/on_failure（succeeded/permanent_failure）调用。
    独立 session，后台任务失败不影响主流程。
    """
    if not idempotency_key:
        return
    db = SessionLocal()
    try:
        rec = db.query(TaskRecord).filter(TaskRecord.idempotency_key == idempotency_key).first()
        if rec is None:
            rec = TaskRecord(
                id=gen_id("task"),
                task_name=task_name,
                idempotency_key=idempotency_key,
                status=status,
                payload=payload or {},
                business_event_id=business_event_id,
            )
            db.add(rec)
        rec.task_name = task_name
        rec.status = status
        rec.attempts = attempts
        rec.last_error = last_error
        rec.payload = payload or rec.payload
        if business_event_id:
            rec.business_event_id = business_event_id
        if status == "running":
            rec.started_at = datetime.utcnow()
        elif status in ("succeeded", "failed", "permanent_failure"):
            rec.finished_at = datetime.utcnow()
        db.commit()
    except Exception:  # noqa: BLE001 - 状态记录失败不得影响任务本身
        db.rollback()
        logger.exception("mark_task_status_failed", extra={"extra_fields": {"idempotency_key": idempotency_key}})
    finally:
        db.close()


class TrackingTask(celery_app.Task):
    """带状态记录 / 重试策略的任务基类。"""

    abstract = True
    autoretry_for = (Exception,)
    retry_backoff = config.CELERY_TASK_RETRY_BACKOFF
    retry_backoff_max = config.CELERY_TASK_RETRY_BACKOFF_MAX
    retry_jitter = False
    max_retries = config.CELERY_TASK_MAX_RETRIES

    def _ctx(self, kwargs: dict) -> dict:
        return {
            "task_name": self.name,
            "idempotency_key": kwargs.get("idempotency_key"),
            "business_event_id": kwargs.get("business_event_id"),
            "payload": {k: v for k, v in kwargs.items() if k not in ("idempotency_key", "business_event_id")},
        }

    def on_success(self, retval, task_id, args, kwargs):
        ctx = self._ctx(kwargs)
        _mark_task(
            ctx["task_name"], ctx["idempotency_key"], "succeeded",
            ctx["payload"], attempts=self.request.retries + 1,
            business_event_id=ctx["business_event_id"],
        )
        super().on_success(retval, task_id, args, kwargs)

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        ctx = self._ctx(kwargs)
        _mark_task(
            ctx["task_name"], ctx["idempotency_key"], "permanent_failure",
            ctx["payload"], last_error=str(exc), attempts=self.request.retries + 1,
            business_event_id=ctx["business_event_id"],
        )
        super().on_failure(exc, task_id, args, kwargs, einfo)


# ============ 任务定义 ============


@celery_app.task(base=TrackingTask, bind=True, name="tasks.send_email_task")
def send_email_task(self, idempotency_key=None, business_event_id=None, **payload):
    """邮件发送：投递某询价下所有待发送/失败的邀请（幂等，delivery_status 判断）。"""
    _mark_task(self.name, idempotency_key, "running", payload, attempts=self.request.retries + 1,
               business_event_id=business_event_id)
    from .delivery import deliver_pending_inquiry
    inquiry_id = payload.get("inquiry_id")
    if not inquiry_id:
        raise ValueError("send_email_task 缺少 inquiry_id")
    deliver_pending_inquiry(inquiry_id)
    return {"ok": True, "inquiry_id": inquiry_id}


@celery_app.task(base=TrackingTask, bind=True, name="tasks.send_inquiry_reminder_task")
def send_inquiry_reminder_task(self, idempotency_key=None, business_event_id=None, **payload):
    """截止提醒：为临近截止且存在未提交供应商的询价生成提醒通知（幂等）。"""
    _mark_task(self.name, idempotency_key, "running", payload, attempts=self.request.retries + 1,
               business_event_id=business_event_id)
    from .delivery import generate_deadline_reminders
    db = SessionLocal()
    try:
        created = generate_deadline_reminders(db)
        return {"ok": True, "created": created}
    finally:
        db.close()


@celery_app.task(base=TrackingTask, bind=True, name="tasks.batch_notify_task")
def batch_notify_task(self, idempotency_key=None, business_event_id=None, **payload):
    """批量通知：逐条经 notifier 发送（LogNotifier 模拟 / EmailNotifier 真实发送）。"""
    _mark_task(self.name, idempotency_key, "running", payload, attempts=self.request.retries + 1,
               business_event_id=business_event_id)
    from .notifier import get_notifier
    notifier = get_notifier()
    sent = 0
    for item in payload.get("items") or []:
        if notifier is None:
            continue
        result = notifier.send(
            item.get("to", ""),
            item.get("subject", ""),
            item.get("body", ""),
            item.get("variables"),
        )
        if result.success:
            sent += 1
    return {"ok": True, "sent": sent}


@celery_app.task(base=TrackingTask, bind=True, name="tasks.export_task")
def export_task(self, idempotency_key=None, business_event_id=None, **payload):
    """大型导出：生成询价详情/比价的 PDF 或 Excel（耗时操作迁出请求线程）。"""
    _mark_task(self.name, idempotency_key, "running", payload, attempts=self.request.retries + 1,
               business_event_id=business_event_id)
    from .routers.inquiries import _export_dataset, _export_xlsx, _export_pdf
    from .models import Inquiry
    inquiry_id = payload.get("inquiry_id")
    db = SessionLocal()
    try:
        inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id).first()
        if inq is None:
            raise ValueError(f"export_task 询价不存在: {inquiry_id}")
        dataset = _export_dataset(db, inq)
        fmt = (payload.get("format") or "xlsx").lower()
        content = _export_pdf(dataset) if fmt == "pdf" else _export_xlsx(dataset)
        return {"ok": True, "bytes": len(content), "format": fmt}
    finally:
        db.close()


@celery_app.task(base=TrackingTask, bind=True, name="tasks.ai_slow_task")
def ai_slow_task(self, idempotency_key=None, business_event_id=None, **payload):
    """慢 AI 请求：本地/远程 AI 执行迁出请求线程（失败将由 autoretry 重试）。"""
    _mark_task(self.name, idempotency_key, "running", payload, attempts=self.request.retries + 1,
               business_event_id=business_event_id)
    import asyncio
    from .ai import execute
    from .ai.local import LocalRuleProvider
    action = payload.get("action", "inquiry-description")
    args = payload.get("args") or {}
    provider = LocalRuleProvider()
    result = asyncio.run(execute(action, args, payload.get("user_id", "system"), provider))
    return {"ok": True, "action": action, "source": result.source}