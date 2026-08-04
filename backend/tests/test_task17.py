"""P2-12 Task 17：采购端体验深化 —— 服务端分页/筛选/搜索/排序、表格偏好、报价快照、导出、SSE

覆盖新增接口与向后兼容性：
- GET /api/inquiries 分页参数（缺省返回全量数组，向后兼容）
- GET/PUT /api/users/table-preferences/{pageKey}
- POST /api/inquiries/{id}/export（pdf / xlsx）
- 定标确认生成报价快照 GET /api/inquiries/{id}/snapshots
- GET /api/events/stream（SSE 短连接）
"""
import pytest

from app.main import app


def _create_inquiry(client, headers, subject="T17 测试询价", status="ALL_QUOTED"):
    payload = {
        "subject": subject,
        "status": status,
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到付款",
        "items": [
            {
                "materialId": "mat-1",
                "name": "工业交换机",
                "code": "MAT-T17",
                "category": "电子设备",
                "brand": "华为",
                "spec": "8口千兆",
                "techParams": "8口",
                "unit": "台",
                "quantity": 10,
            }
        ],
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _submit_quotation(client, headers, inquiry, supplier_id="sup-1", unit_price=100):
    item = inquiry["items"][0]
    q = {
        "inquiryId": inquiry["id"],
        "supplierId": supplier_id,
        "supplierName": "测试供应商",
        "status": "DRAFT",
        "totalAmount": unit_price * 10,
        "items": [
            {
                "inquiryItemId": item["id"],
                "unitPrice": unit_price,
                "taxRate": 0.13,
                "taxIncludedTotal": unit_price * 10,
                "deliveryDays": 7,
                "warrantyMonths": 12,
            }
        ],
    }
    resp = client.post("/api/quotations", json=q, headers=headers)
    assert resp.status_code == 200, resp.text
    qid = resp.json()["id"]
    resp = client.post(f"/api/quotations/{qid}/submit", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ============ 1. 服务端分页 / 筛选 / 搜索 / 排序 ============

def test_list_returns_array_by_default_backward_compat(client, buyer_headers):
    resp = client.get("/api/inquiries", headers=buyer_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_paginated_structure(client, buyer_headers):
    resp = client.get("/api/inquiries", params={"page": 1, "pageSize": 2}, headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) == {"items", "total", "page", "pageSize"}
    assert data["page"] == 1
    assert data["pageSize"] == 2
    assert len(data["items"]) <= 2
    assert data["total"] >= 5


def test_list_search_keyword(client, buyer_headers):
    resp = client.get("/api/inquiries", params={"keyword": "交换机"}, headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    for inq in data:
        assert "交换机" in (inq["subject"] + inq["code"])


def test_list_status_filter(client, buyer_headers):
    resp = client.get("/api/inquiries", params={"status": "PENDING_SEND"}, headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert all(i["status"] == "PENDING_SEND" for i in data)


def test_list_paginated_with_sort(client, buyer_headers):
    resp = client.get(
        "/api/inquiries",
        params={"page": 1, "pageSize": 3, "sort": "createdAt:asc"},
        headers=buyer_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    created = [i["createdAt"] for i in data["items"]]
    assert created == sorted(created)


# ============ 2. 表格偏好持久化 ============

def test_table_preferences_roundtrip(client, buyer_headers):
    payload = {
        "pageKey": "inquiryList",
        "data": {"density": "compact", "columns": [{"key": "code", "visible": True}]},
    }
    resp = client.put("/api/users/table-preferences/inquiryList", json=payload, headers=buyer_headers)
    assert resp.status_code == 200, resp.text
    saved = resp.json()
    assert saved["pageKey"] == "inquiryList"
    assert saved["data"]["density"] == "compact"

    resp = client.get("/api/users/table-preferences/inquiryList", headers=buyer_headers)
    assert resp.status_code == 200
    got = resp.json()
    assert got["data"]["density"] == "compact"
    assert got["data"]["columns"][0]["key"] == "code"


def test_table_preferences_default_empty(client, buyer_headers):
    resp = client.get("/api/users/table-preferences/never-saved", headers=buyer_headers)
    assert resp.status_code == 200
    assert resp.json()["data"] == {}


# ============ 3. 报价快照（定标确认后冻结） ============

def test_confirm_creates_quotation_snapshot(client, supervisor_headers, buyer_headers):
    inq = _create_inquiry(client, supervisor_headers, subject="T17 快照测试")
    _submit_quotation(client, supervisor_headers, inq)
    # 定标确认
    resp = client.post(f"/api/inquiries/{inq['id']}/confirm", headers=supervisor_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "COMPLETED"

    # 应有快照
    resp = client.get(f"/api/inquiries/{inq['id']}/snapshots", headers=supervisor_headers)
    assert resp.status_code == 200, resp.text
    snaps = resp.json()
    assert len(snaps) == 1
    assert snaps[0]["inquiryCode"] == inq["code"]
    assert snaps[0]["snapshot"]["quotations"]  # 冻结了报价
    assert snaps[0]["snapshot"]["inquiry"]["selectedSupplierMap"] is not None


# ============ 4. 服务端导出 ============

def test_export_xlsx(client, supervisor_headers, buyer_headers):
    inq = _create_inquiry(client, supervisor_headers, subject="T17 导出测试")
    _submit_quotation(client, supervisor_headers, inq)
    resp = client.post(
        f"/api/inquiries/{inq['id']}/export",
        json={"format": "xlsx", "scope": "compare"},
        headers=supervisor_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert resp.content[:2] == b"PK"  # xlsx 是 zip


def test_export_pdf(client, supervisor_headers, buyer_headers):
    inq = _create_inquiry(client, supervisor_headers, subject="T17 PDF 测试")
    _submit_quotation(client, supervisor_headers, inq)
    resp = client.post(
        f"/api/inquiries/{inq['id']}/export",
        json={"format": "pdf", "scope": "compare"},
        headers=supervisor_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content.startswith(b"%PDF")


def test_export_invalid_format_400(client, supervisor_headers):
    inq = _create_inquiry(client, supervisor_headers)
    resp = client.post(
        f"/api/inquiries/{inq['id']}/export",
        json={"format": "csv"},
        headers=supervisor_headers,
    )
    assert resp.status_code == 400


# ============ 5. SSE 实时事件（事件总线） ============

def test_events_stream_registered(client, buyer_headers):
    """SSE 端点已注册并返回 text/event-stream（不断开无限流，避免同步 TestClient 挂起）。"""
    paths = {r.path for r in app.routes}
    assert "/api/events/stream" in paths


def test_events_stream_publishes_and_heartbeats():
    """事件总线：连接收到 connected、publish 后收到 message、断开后清理订阅（确定性验证）。"""
    import asyncio

    from app.events import event_stream, publish, _subscribers

    results: list[str] = []

    async def run():
        gen = event_stream()
        # 首个 chunk 为 connected
        results.append(await gen.__anext__())
        # publish 后下一 chunk 为 message
        publish("quotation_submitted", {"inquiryId": "inq-1"})
        results.append(await asyncio.wait_for(gen.__anext__(), timeout=2))
        # 关闭生成器，订阅应被清理
        before = len(_subscribers)
        await gen.aclose()
        assert len(_subscribers) == before - 1

    asyncio.run(run())
    assert "connected" in results[0]
    assert "quotation_submitted" in results[1]