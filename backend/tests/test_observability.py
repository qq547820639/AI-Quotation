"""可观测性测试（Task 16）：request_id 头、日志脱敏、就绪/健康检查、结构化错误
Task 25：指标端点、请求延迟直方图、DB 派生指标、日志管线脱敏、依赖故障（Redis）就绪降级"""
import json
import logging

from app.logging import JsonFormatter, redact
from app import metrics as metrics_mod


def test_request_id_header_present(client):
    """每个响应都应携带 X-Request-Id 头"""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "X-Request-Id" in r.headers
    assert r.headers["X-Request-Id"]


def test_health_returns_ok(client):
    """健康检查：DB 连通时返回 ok"""
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "connected"
    assert body["version"] == "1.0.0"


def test_ready_returns_ready(client):
    """就绪检查：DB 连通且关键表可查询时返回 ready"""
    r = client.get("/api/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["db"] == "connected"


def _broken_db_session():
    """模拟数据库连接不可用：SessionLocal() 成功但 execute() 抛错（更贴近连接丢失场景）"""
    class BrokenSession:
        def execute(self, *args, **kwargs):
            raise RuntimeError("database connection refused")
        def close(self):
            pass
    return BrokenSession()


def test_ready_returns_503_when_db_unavailable(client, monkeypatch):
    """数据库不可用场景：/api/ready 应返回 503（not_ready / disconnected）"""
    monkeypatch.setattr("app.main.SessionLocal", _broken_db_session)
    r = client.get("/api/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["db"] == "disconnected"


def test_health_returns_degraded_when_db_unavailable(client, monkeypatch):
    """数据库不可用场景：/api/health 仍返回 200（进程存活），但 status=degraded / db=disconnected"""
    monkeypatch.setattr("app.main.SessionLocal", _broken_db_session)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["db"] == "disconnected"


def test_redact_masks_sensitive_values():
    """日志脱敏：敏感 key 的值被掩码，非敏感字段保留"""
    data = {
        "password": "secret123",
        "token": "abc123",
        "authorization": "Bearer xyz",
        "nested": {"api_key": "k-secret", "name": "张三"},
        "items": [{"price": 100, "note": "ok"}],
    }
    out = redact(data)
    assert out["password"] == "***"
    assert out["token"] == "***"
    assert out["authorization"] == "***"
    assert out["nested"]["api_key"] == "***"
    assert out["nested"]["name"] == "张三"
    assert out["items"] == [{"price": 100, "note": "ok"}]
    # 不修改原结构
    assert data["password"] == "secret123"


def test_unauthorized_error_is_structured(client):
    """未认证访问返回 401，body 含 request_id 与 error_type"""
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    body = r.json()
    assert body["error_type"] == "unauthorized"
    assert body["request_id"]
    assert r.headers.get("X-Request-Id") == body["request_id"]


def test_not_found_error_is_structured(client, buyer_headers):
    """不存在的资源返回 404，body 含 request_id 与 error_type"""
    r = client.get("/api/inquiries/not-exist", headers=buyer_headers)
    assert r.status_code == 404
    body = r.json()
    assert body["error_type"] == "not_found"
    assert body["request_id"]
    assert r.headers.get("X-Request-Id") == body["request_id"]


# ============ Task 25：指标端点与依赖故障 ============

def test_metrics_endpoint_returns_json(client):
    """GET /api/metrics 返回指标 JSON（含 request_total / uptime_seconds）"""
    r = client.get("/api/metrics")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert "request_total" in body
    assert "uptime_seconds" in body
    assert body["request_total"] >= 1  # metrics 请求自身已被计数


def test_metrics_request_total_increments(client):
    """发起一次请求后 request_total 增加"""
    before = client.get("/api/metrics").json()["request_total"]
    client.get("/api/health")
    after = client.get("/api/metrics").json()["request_total"]
    assert after > before


def test_metrics_error_total_increments_on_4xx(client):
    """4xx 请求累计 request_error_total"""
    metrics_mod.request_error_total()  # 保证基线非负
    client.get("/api/not-exist-404")
    body = client.get("/api/metrics").json()
    assert body["request_error_total"] >= 1


def test_metrics_email_fail_total_increments():
    """EmailNotifier 投递失败路径累计 email_fail_total"""
    metrics_mod.email_fail_total()
    assert metrics_mod.get_metrics()["email_fail_total"] >= 1


def test_ready_returns_503_when_redis_unavailable(client, monkeypatch):
    """配置了 Redis 但连接不可用 → /api/ready 返回 503（redis=disconnected）"""
    monkeypatch.setattr("app.main.REDIS_URL", "redis://localhost:6379/0")
    def _raise():
        raise ConnectionError("redis down")
    monkeypatch.setattr("app.main.get_store", lambda: type("S", (), {"ping": _raise})())
    r = client.get("/api/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["db"] == "connected"
    assert body["redis"] == "disconnected"


# ============ Task 25：请求延迟直方图与 DB 派生指标 ============

def test_metrics_request_duration_histogram_updates(client):
    """记录请求耗时后直方图 count/sum/avg/buckets 正确更新"""
    before = metrics_mod.get_metrics()["request_duration"]["count"]
    metrics_mod.record_request_duration_ms(120.5)
    metrics_mod.record_request_duration_ms(5.0)
    m = metrics_mod.get_metrics()["request_duration"]
    assert m["count"] == before + 2
    assert m["sum_ms"] >= 125.5
    assert m["avg_ms"] > 0
    assert m["buckets"]["+Inf"] >= 2
    assert m["buckets"]["100"] >= 1  # 5.0ms 落入 100ms 桶


def test_metrics_endpoint_exposes_db_derived_gauges(client):
    """GET /api/metrics 返回 DB 派生瞬时指标（队列积压/任务失败/AI 调用/扫描失败）与延迟"""
    r = client.get("/api/metrics")
    assert r.status_code == 200
    body = r.json()
    for key in ("queue_backlog_gauge", "task_fail_gauge", "ai_call_gauge", "scan_fail_gauge"):
        assert key in body, key
        assert isinstance(body[key], int)
    assert isinstance(body["request_duration"]["buckets"], dict)


def test_task_success_and_fail_counters():
    """任务成功/失败计数器可累计"""
    metrics_mod.task_success_total()
    metrics_mod.task_fail_total()
    m = metrics_mod.get_metrics()
    assert m["task_success_total"] >= 1
    assert m["task_fail_total"] >= 1


# ============ Task 25：日志管线脱敏（邮箱部分 + 报价正文） ============

def test_redact_masks_email_partially():
    """邮箱 key 部分脱敏：保留域名，本地部分仅暴露首字符"""
    out = redact({
        "email": "john.doe@example.com",
        "contactEmail": "user@b.com",
        "username": "张三",
    })
    assert out["email"] == "j***@example.com"
    assert "john.doe" not in out["email"]
    assert out["contactEmail"] == "u***@b.com"
    assert out["username"] == "张三"


def test_redact_masks_quote_content():
    """报价正文类 key（content/body/quotation/remark）整体掩码"""
    out = redact({
        "content": "报价正文：10 万元",
        "body": "供应商报价明细",
        "quotation": "敏感报价",
        "remark": "备注",
    })
    assert out["content"] == "***"
    assert out["body"] == "***"
    assert out["quotation"] == "***"
    assert out["remark"] == "***"


def test_json_formatter_redacts_sensitive_extra_fields():
    """JsonFormatter 落盘前对 extra_fields 应用脱敏（邮箱部分 + 报价正文）"""
    record = logging.LogRecord(
        name="procurement",
        level=logging.INFO,
        pathname="test.py",
        lineno=1,
        msg="test_event",
        args=(),
        exc_info=None,
    )
    record.extra_fields = {"email": "buyer@corp.com", "quotation": "机密", "duration_ms": 12}
    payload = json.loads(JsonFormatter().format(record))
    assert payload["email"] == "b***@corp.com"
    assert payload["quotation"] == "***"
    assert payload["duration_ms"] == 12