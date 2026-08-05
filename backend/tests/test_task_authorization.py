"""P0-7 安全授权边界测试

覆盖：
- 横向越权（IDOR）：用户 A 无法看到用户 B 的任务（跨用户/跨组织）
- 跨组织访问被拒：普通用户仅可见本组织/本人任务，管理员可见全部
- 错误信息泄露防护：/api/tasks /api/health /api/metrics 不泄露
  idempotency_key / 内部 task_name / 原始堆栈 / DB / broker / 路径
"""
from __future__ import annotations

import pytest

from app.database import SessionLocal
from app.models import TaskRecord


@pytest.fixture(autouse=True)
def _clean_task_tables():
    """每个测试前清理任务表，避免跨用例相互影响。"""
    db = SessionLocal()
    try:
        db.query(TaskRecord).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(TaskRecord).delete()
        db.commit()
    finally:
        db.close()


def _login_headers(client, user_id: str) -> dict:
    resp = client.post("/api/auth/login", json={"userId": user_id})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _add_task(task_id, user_id, organization, last_error=None, task_name="tasks.send_email_task"):
    db = SessionLocal()
    try:
        db.add(TaskRecord(
            id=task_id,
            task_name=task_name,
            idempotency_key=f"key-{task_id}",
            status="failed",
            attempts=2,
            last_error=last_error,
            payload={"inquiry_id": f"inq-{task_id}", "user_id": user_id, "organization": organization},
            user_id=user_id,
            organization=organization,
        ))
        db.commit()
    finally:
        db.close()


# ============ 1. 横向越权（IDOR）与跨组织隔离 ============

def test_user_cannot_see_other_users_cross_org_task(client, buyer_headers, admin_headers):
    """用户 A（u-1 总部）触发任务；跨组织用户 B（u-3 华东）不可见；本人可见；管理员可见全部。"""
    _add_task("task-a", "u-1", "总部采购中心", last_error="boom")

    # 跨组织用户 u-3（华东分部）不可见
    headers_b = _login_headers(client, "u-3")
    resp_b = client.get("/api/tasks", headers=headers_b)
    assert resp_b.status_code == 200
    assert resp_b.json()["total"] == 0, resp_b.text

    # 本人 u-1 可见
    resp_self = client.get("/api/tasks", headers=buyer_headers)
    assert resp_self.status_code == 200
    assert resp_self.json()["total"] == 1
    assert resp_self.json()["items"][0]["id"] == "task-a"

    # 管理员可见全部（跨组织）
    resp_admin = client.get("/api/tasks", headers=admin_headers)
    assert resp_admin.status_code == 200
    assert resp_admin.json()["total"] == 1


def test_user_sees_own_task_within_shared_org(client):
    """同组织内，用户仅当归属自己或本组织时可见。"""
    _add_task("task-org", "u-1", "总部采购中心")
    # u-5 同属总部采购中心，经组织归属可见
    headers_u5 = _login_headers(client, "u-5")
    resp = client.get("/api/tasks", headers=headers_u5)
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


def test_cross_org_admin_audit_and_access(client, admin_headers):
    """管理员跨组织访问全部任务（审计日志），普通用户不能越权到他人组织。"""
    _add_task("task-x", "u-4", "华南分部")
    headers_u1 = _login_headers(client, "u-1")
    resp = client.get("/api/tasks", headers=headers_u1)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0  # 总部用户不可见华南任务

    resp_admin = client.get("/api/tasks", headers=admin_headers)
    assert resp_admin.status_code == 200
    assert resp_admin.json()["total"] == 1


# ============ 2. 错误信息泄露防护 ============

def test_tasks_response_redacts_internal_fields_and_stack(client, admin_headers):
    """任务响应不暴露 idempotencyKey / taskName / businessEventId，且 lastError 脱敏。"""
    raw_error = (
        "Traceback (most recent call last):\n"
        '  File "/app/backend/app/tasks.py", line 120, in on_failure\n'
        "sqlalchemy.exc.OperationalError: (psycopg2.OperationalError) "
        "connection to server at 10.0.0.5, port 5432 failed: connection refused"
    )
    _add_task("task-leak", "u-1", "总部采购中心", last_error=raw_error)

    resp = client.get("/api/tasks", headers=admin_headers)
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    # 不泄露内部字段
    assert "idempotencyKey" not in item
    assert "taskName" not in item
    assert "businessEventId" not in item
    # lastError 已脱敏为通用文案，不包含堆栈/文件路径/连接串/端口
    assert item["lastError"] == "任务执行失败，请查看服务端日志"
    assert "Traceback" not in str(item["lastError"])
    assert "File" not in str(item["lastError"])
    assert "psycopg2" not in str(item["lastError"])
    assert "5432" not in str(item["lastError"])
    assert "10.0.0.5" not in str(item["lastError"])


def test_tasks_last_error_truncation(client, admin_headers):
    """非敏感但超长的 lastError 被截断，不整体回传。"""
    _add_task("task-long", "u-1", "总部采购中心", last_error="x" * 1000)
    resp = client.get("/api/tasks", headers=admin_headers)
    item = resp.json()["items"][0]
    assert len(item["lastError"]) <= 200 + 3  # 200 + "..."
    assert item["lastError"].endswith("...")


def test_health_does_not_leak_raw_db_error(client):
    """数据库不可用时 /api/health 返回脱敏 db_error，不泄露原始异常（连接串/方言）。"""
    class BrokenSession:
        def execute(self, *args, **kwargs):
            raise RuntimeError("psycopg2 connection to db.example.com:5432 user=prod password=secret failed")
        def close(self):
            pass

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr("app.main.SessionLocal", lambda: BrokenSession())
    try:
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "degraded"
        assert body["db"] == "disconnected"
        assert body["db_error"] == "database unavailable"
        raw = "psycopg2 connection to db.example.com:5432 user=prod password=secret failed"
        assert raw not in str(body)
        assert "5432" not in str(body)
        assert "password=" not in str(body)
    finally:
        monkeypatch.undo()


def test_metrics_requires_admin_and_does_not_leak(client, buyer_headers, admin_headers):
    """/api/metrics 非公开：匿名 401，普通用户 403，管理员 200。"""
    assert client.get("/api/metrics").status_code == 401
    assert client.get("/api/metrics", headers=buyer_headers).status_code == 403
    r = client.get("/api/metrics", headers=admin_headers)
    assert r.status_code == 200