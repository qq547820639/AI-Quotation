"""持久化任务队列测试（P1 可靠性）

全部在 eager 模式下执行（conftest 默认 APP_ENV=dev → CELERY_TASK_ALWAYS_EAGER=true），
不依赖真实 worker / Redis。覆盖：
- worker 重启后未完成任务不丢失（outbox pending → dispatch_outbox 补齐）
- 重复消费（同 idempotency_key 只执行一次）
- 任务失败 → permanent_failure，可 retry
- Redis 短暂断开（mock broker 抛错）outbox 不丢
- 任务状态查询与管理员重试 API 权限
"""
from __future__ import annotations

import pytest

from app.database import SessionLocal
from app.models import OutboxEvent, TaskRecord
from app import queue_client


def _count_outbox() -> int:
    db = SessionLocal()
    try:
        return db.query(OutboxEvent).count()
    finally:
        db.close()


def _count_tasks() -> int:
    db = SessionLocal()
    try:
        return db.query(TaskRecord).count()
    finally:
        db.close()


def _get_outbox_by_key(key: str) -> OutboxEvent | None:
    db = SessionLocal()
    try:
        return db.query(OutboxEvent).filter(OutboxEvent.idempotency_key == key).first()
    finally:
        db.close()


def _get_task_by_key(key: str) -> TaskRecord | None:
    db = SessionLocal()
    try:
        return db.query(TaskRecord).filter(TaskRecord.idempotency_key == key).first()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _clean_task_tables():
    """每个测试前清理任务表，避免跨用例相互影响（保留其他业务表）。"""
    db = SessionLocal()
    try:
        db.query(OutboxEvent).delete()
        db.query(TaskRecord).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(OutboxEvent).delete()
        db.query(TaskRecord).delete()
        db.commit()
    finally:
        db.close()


# ============ 1. worker 重启后未完成任务不丢失 ============

def test_dispatch_outbox_completes_pending_events():
    """模拟 worker 重启：outbox 事件已持久化但未 dispatched，重启后 dispatch_outbox 补齐投递。"""
    # 直接插入一条 pending 事件（模拟「DB 已提交但任务未入队」）
    db = SessionLocal()
    try:
        db.add(OutboxEvent(
            id="ob-pending-1",
            event_type="email.send",
            aggregate_id="inq-notexist",
            payload={"inquiry_id": "inq-notexist"},
            status="pending",
            idempotency_key="key-pending-1",
        ))
        db.commit()
    finally:
        db.close()

    # 重启前：pending，未投递
    ev = _get_outbox_by_key("key-pending-1")
    assert ev is not None and ev.status == "pending"

    # 重启后：dispatch_outbox 补齐
    dispatched = queue_client.dispatch_outbox()
    assert dispatched == 1

    ev2 = _get_outbox_by_key("key-pending-1")
    assert ev2.status == "dispatched"
    assert ev2.dispatched_at is not None
    # 任务已执行并留下成功记录
    rec = _get_task_by_key("key-pending-1")
    assert rec is not None and rec.status == "succeeded"


def test_dispatch_outbox_skips_already_dispatched():
    """已 dispatched 的事件不会被重复投递。"""
    db = SessionLocal()
    try:
        db.add(OutboxEvent(
            id="ob-done-1",
            event_type="email.send",
            aggregate_id="inq-notexist",
            payload={"inquiry_id": "inq-notexist"},
            status="dispatched",
            idempotency_key="key-done-1",
        ))
        db.commit()
    finally:
        db.close()

    assert queue_client.dispatch_outbox() == 0


# ============ 2. 重复消费（同 idempotency_key 只执行一次） ============

def test_enqueue_idempotent_same_key_only_once():
    """同 idempotency_key 重复入队：第二次被跳过，只产生一条 outbox 记录。"""
    assert queue_client.enqueue("email.send", "inq-dup", {"inquiry_id": "inq-dup"}) is True
    assert queue_client.enqueue("email.send", "inq-dup", {"inquiry_id": "inq-dup"}) is False
    assert _count_outbox() == 1


def test_enqueue_explicit_key_dedup():
    """显式 idempotency_key 重复入队同样去重。"""
    assert queue_client.enqueue("email.send", "a", {"inquiry_id": "a"}, idempotency_key="custom-key-1") is True
    assert queue_client.enqueue("batch.notify", "b", {"items": []}, idempotency_key="custom-key-1") is False
    assert _count_outbox() == 1


# ============ 3. 任务失败 → permanent_failure，可 retry ============

def test_failed_task_enters_permanent_failure_and_retry():
    """导出不存在的询价 → 任务最终失败 → permanent_failure；retry 后重新投递。"""
    from app.queue_client import enqueue
    from app.queue_client import _default_idempotency_key
    # export_task 对不存在询价抛出 ValueError → autoretry 耗尽 → permanent_failure
    enqueue("export.run", "inq-missing", {"inquiry_id": "inq-missing", "format": "xlsx"})

    key = _default_idempotency_key("export.run", "inq-missing", {"inquiry_id": "inq-missing", "format": "xlsx"})
    rec = _get_task_by_key(key)
    assert rec is not None
    assert rec.status == "permanent_failure"
    assert rec.last_error  # 有失败原因

    # 重试：重置为 pending 并重投
    ok = queue_client.retry_failed_task(rec.id)
    assert ok is True
    rec2 = _get_task_by_key(rec.idempotency_key)
    # 重投后再次失败回到 permanent_failure
    assert rec2.status == "permanent_failure"


# ============ 4. Redis 短暂断开（mock broker 抛错）outbox 不丢 ============

def test_broker_down_outbox_not_lost(monkeypatch):
    """mock broker 抛错：入队时 outbox 已持久化保持 pending，恢复后可补齐投递。"""
    from app.queue_client import _default_idempotency_key

    def boom(task_name):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(queue_client, "_get_task", boom)

    # broker 不可用：事件仍被持久化（pending），不会丢失
    assert queue_client.enqueue("email.send", "inq-broker", {"inquiry_id": "inq-broker"}) is True
    key = _default_idempotency_key("email.send", "inq-broker", {"inquiry_id": "inq-broker"})
    ev = _get_outbox_by_key(key)
    assert ev is not None and ev.status == "pending"

    # 恢复 broker：dispatch_outbox 补齐投递
    monkeypatch.undo()
    assert queue_client.dispatch_outbox() == 1
    assert _get_outbox_by_key(key).status == "dispatched"


# ============ 5. 任务状态查询与管理重试 API 权限 ============

def test_tasks_list_api(client, buyer_headers):
    """任务状态查询：登录用户可访问，未认证 401。"""
    resp = client.get("/api/tasks", headers=buyer_headers)
    assert resp.status_code == 200, resp.text
    assert "items" in resp.json() and "total" in resp.json()

    resp_noauth = client.get("/api/tasks")
    assert resp_noauth.status_code == 401


def test_retry_api_requires_admin(client, buyer_headers, admin_headers):
    """重试 API：非管理员 403，管理员可重试。"""
    # 造一条 permanent_failure 任务
    db = SessionLocal()
    try:
        db.add(TaskRecord(
            id="task-retry-1",
            task_name="tasks.export_task",
            idempotency_key="key-retry-api-1",
            status="permanent_failure",
            attempts=4,
            last_error="boom",
            payload={"inquiry_id": "inq-missing"},
        ))
        db.commit()
    finally:
        db.close()

    # 非管理员 → 403
    resp = client.post("/api/tasks/task-retry-1/retry", headers=buyer_headers)
    assert resp.status_code == 403, resp.text

    # 管理员 → 200（重投后再次失败回到 permanent_failure，但请求成功）
    resp = client.post("/api/tasks/task-retry-1/retry", headers=admin_headers)
    assert resp.status_code == 200, resp.text


def test_tasks_list_filter_by_status(client, admin_headers):
    """任务列表可按 status 过滤。"""
    db = SessionLocal()
    try:
        db.add(TaskRecord(
            id="task-f-1", task_name="tasks.export_task", idempotency_key="key-f-1",
            status="permanent_failure", attempts=3, last_error="x", payload={},
        ))
        db.add(TaskRecord(
            id="task-s-1", task_name="tasks.export_task", idempotency_key="key-s-1",
            status="succeeded", attempts=1, payload={},
        ))
        db.commit()
    finally:
        db.close()

    resp = client.get("/api/tasks?status=permanent_failure", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == "task-f-1"