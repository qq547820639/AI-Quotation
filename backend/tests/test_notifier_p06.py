"""P0-6 通知投递相关测试：Provider 接口 / 投递记录 / 批量逐项结果 / 可重试异常 / Webhook

覆盖：
- get_notifier 渠道选择（dev log / email-SMTP / none；prod 禁止回退）
- ProviderNotifier 持久化 email_delivery_records
- SMTPProvider / MailpitProvider 失败抛 NotifierError（可重试）
- batch_notify_task 返回逐项结果，部分失败不返回无条件 ok:true
- 邮件任务失败抛 NotifierError → Celery 进入 permanent_failure（可重试/死信）
- webhook 端点回填 delivered/opened/bounced
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from app import config
from app import notifier as notifier_mod
from app.database import SessionLocal
from app.models import EmailDeliveryRecord, SupplierInvitation, TaskRecord, OutboxEvent
from app.notifier import (
    NotifierError, DeliveryResult, LogProvider, MailpitProvider,
    Provider, ProviderNotifier, SMTPProvider, get_notifier,
)


@pytest.fixture(autouse=True)
def _clean_p06_tables():
    """清理 P0-6 测试产生的记录，避免污染共享测试库。"""
    db = SessionLocal()
    try:
        db.query(EmailDeliveryRecord).delete()
        db.query(SupplierInvitation).filter(
            SupplierInvitation.id == "inv-p06-1",
        ).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(EmailDeliveryRecord).delete()
        db.query(SupplierInvitation).filter(
            SupplierInvitation.id == "inv-p06-1",
        ).delete()
        db.query(TaskRecord).filter(
            TaskRecord.idempotency_key.in_(["k-p06-batch", "k-p06-email", "k-p06-email-incomplete", "k-p06-perm"]),
        ).delete()
        db.query(OutboxEvent).filter(
            OutboxEvent.idempotency_key.in_(["k-p06-perm", "k-p06-email", "k-p06-email-incomplete"]),
        ).delete()
        db.commit()
    finally:
        db.close()


# ============ get_notifier 渠道选择 ============

def test_get_notifier_dev_default_log(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "dev")
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "log")
    n = get_notifier()
    assert isinstance(n, ProviderNotifier)
    assert n.provider.name == "log"


def test_get_notifier_none_returns_none(monkeypatch):
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "none")
    assert get_notifier() is None


def test_get_notifier_dev_email_incomplete_falls_back_log(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "dev")
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "email")
    monkeypatch.setattr(config, "SMTP_HOST", "")
    monkeypatch.setattr(config, "SMTP_FROM", "")
    n = get_notifier()
    assert isinstance(n, ProviderNotifier)
    assert n.provider.name == "log"


def test_get_notifier_prod_log_raises(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "log")
    with pytest.raises(NotifierError):
        get_notifier()


def test_get_notifier_prod_email_incomplete_raises(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "email")
    monkeypatch.setattr(config, "SMTP_HOST", "")
    monkeypatch.setattr(config, "SMTP_FROM", "")
    with pytest.raises(NotifierError):
        get_notifier()


def test_get_notifier_prod_mailpit_raises(monkeypatch):
    monkeypatch.setattr(config, "APP_ENV", "prod")
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "mailpit")
    with pytest.raises(NotifierError):
        get_notifier()


# ============ ProviderNotifier 持久化投递记录 ============

def test_provider_notifier_persists_delivery_record(monkeypatch):
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "log")
    n = get_notifier()
    assert isinstance(n, ProviderNotifier)
    res = n.send("persist@example.com", "主题", "正文")
    assert res.success
    db = SessionLocal()
    try:
        rec = db.query(EmailDeliveryRecord).filter_by(recipient="persist@example.com").first()
        assert rec is not None
        assert rec.provider == "log"
        assert rec.queued_at is not None
        assert rec.sent_at is not None
        assert rec.attempt_count == 1
    finally:
        db.close()


# ============ SMTPProvider / MailpitProvider 失败抛可重试异常 ============

def test_smtp_provider_raises_notifier_error_when_incomplete(monkeypatch):
    monkeypatch.setattr(config, "SMTP_HOST", "")
    monkeypatch.setattr(config, "SMTP_FROM", "")
    with pytest.raises(NotifierError):
        SMTPProvider().send("a@example.com", "s", "b")


def test_mailpit_provider_send_success(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"id": "mailpit-123"}

    monkeypatch.setattr(httpx, "post", lambda *a, **k: FakeResp())
    res = MailpitProvider().send("a@example.com", "s", "b")
    assert res.success is True
    assert res.provider_message_id == "mailpit-123"


def test_mailpit_provider_raises_on_network_failure(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(NotifierError):
        MailpitProvider().send("a@example.com", "s", "b")


# ============ 批量通知逐项结果 + 可重试异常 ============

def test_batch_notify_returns_per_item_results(monkeypatch):
    class FakeNotifier:
        def send(self, to, subject, body, variables=None):
            ok = to != "bad@example.com"
            return DeliveryResult(success=ok, error="" if ok else "addr rejected")

    monkeypatch.setattr(notifier_mod, "get_notifier", lambda: FakeNotifier())
    from app.tasks import batch_notify_task
    result = batch_notify_task.run(idempotency_key="k-p06-batch", items=[
        {"to": "a@example.com", "subject": "s", "body": "b"},
        {"to": "bad@example.com", "subject": "s", "body": "b"},
    ])
    # 部分失败 → 不得返回无条件 ok:true
    assert result["ok"] is False
    assert result["sent"] == 1
    assert result["failed"] == 1
    assert len(result["results"]) == 2
    assert result["results"][0]["ok"] is True
    assert result["results"][1]["ok"] is False
    assert result["results"][1]["error"]


def test_batch_notify_raises_notifier_error_on_retryable_failure(monkeypatch):
    class BoomNotifier:
        def send(self, to, subject, body, variables=None):
            raise NotifierError("smtp down")

    monkeypatch.setattr(notifier_mod, "get_notifier", lambda: BoomNotifier())
    from app.tasks import batch_notify_task
    with pytest.raises(NotifierError):
        batch_notify_task.run(idempotency_key="k-p06-batch", items=[
            {"to": "a@example.com", "subject": "s", "body": "b"},
        ])


def test_batch_notify_enters_permanent_failure_via_queue(monkeypatch):
    """可重试异常经真实队列路径 → autoretry 耗尽 → permanent_failure（可 retry/dead-letter）。"""
    class BoomNotifier:
        def send(self, to, subject, body, variables=None):
            raise NotifierError("smtp down")

    monkeypatch.setattr(notifier_mod, "get_notifier", lambda: BoomNotifier())
    from app.queue_client import enqueue
    payload = {"items": [{"to": "a@example.com", "subject": "s", "body": "b"}]}
    enqueue("batch.notify", "agg-p06", payload, idempotency_key="k-p06-perm")
    db = SessionLocal()
    try:
        rec = db.query(TaskRecord).filter(TaskRecord.idempotency_key == "k-p06-perm").first()
        assert rec is not None
        assert rec.status == "permanent_failure"
        assert rec.last_error and "批量通知失败" in rec.last_error
    finally:
        db.close()


def test_send_email_task_raises_notifier_error_on_remaining(monkeypatch):
    """邮件投递任务：仍有 pending 邀请 → 抛可重试 NotifierError，而非谎报成功。"""
    from app import delivery as delivery_mod
    monkeypatch.setattr(delivery_mod, "deliver_pending_inquiry", lambda inquiry_id: None)
    db = SessionLocal()
    try:
        db.add(SupplierInvitation(
            id="inv-p06-1", inquiry_id="inq-p06", supplier_id="sup-1",
            token_hash="tok-hash", created_by="u-1",
            created_at=datetime.now(timezone.utc),
            status="pending", delivery_status="pending",
        ))
        db.commit()
    finally:
        db.close()
    from app.tasks import send_email_task
    with pytest.raises(NotifierError):
        send_email_task.run(idempotency_key="k-p06-email", inquiry_id="inq-p06")


# ============ Webhook 回填投递状态 ============

def test_status_webhook_updates_delivery_record(client, monkeypatch):
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "mailpit")
    db = SessionLocal()
    try:
        db.add(EmailDeliveryRecord(
            id="edr-webhook-1", recipient="a@example.com", provider="mailpit",
            provider_message_id="mid-w1", queued_at=datetime.now(timezone.utc),
            sent_at=datetime.now(timezone.utc), attempt_count=1,
        ))
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/notifications/webhooks/mailpit",
                       json={"event": "delivered", "ref": "mid-w1", "payload": {}})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True

    resp_bounce = client.post("/api/notifications/webhooks/mailpit",
                              json={"event": "bounced", "ref": "mid-w1", "payload": {"reason": "mailbox full"}})
    assert resp_bounce.status_code == 200, resp_bounce.text

    db = SessionLocal()
    try:
        rec = db.query(EmailDeliveryRecord).filter_by(id="edr-webhook-1").first()
        assert rec.delivered_at is not None
        assert rec.bounced_at is not None
        assert rec.last_error == "mailbox full"
    finally:
        db.close()


def test_status_webhook_unknown_provider_404(client, monkeypatch):
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "log")
    resp = client.post("/api/notifications/webhooks/ses",
                       json={"event": "delivered", "ref": "x", "payload": {}})
    assert resp.status_code == 404


def test_status_webhook_unknown_record_404(client, monkeypatch):
    monkeypatch.setattr(config, "NOTIFY_CHANNEL", "mailpit")
    resp = client.post("/api/notifications/webhooks/mailpit",
                       json={"event": "delivered", "ref": "does-not-exist", "payload": {}})
    assert resp.status_code == 404