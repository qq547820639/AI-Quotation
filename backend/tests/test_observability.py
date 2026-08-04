"""可观测性测试（Task 16）：request_id 头、日志脱敏、就绪/健康检查、结构化错误"""
from app.logging import redact


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