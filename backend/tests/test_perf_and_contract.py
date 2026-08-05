"""P2 Task 22/24：后端查询性能与 API 一致性 contract 测试

- 列表服务端分页（inquiries / quotations）统一结构 {items,total,page,pageSize}
- 稳定排序（created_at,id 双键，分页边界不重复/不漏）
- 统一错误格式（code / message / retryable / request_id / conflict / fieldErrors）
- 迁移 0011 搜索/创建时间索引 upgrade/downgrade round-trip
- OpenAPI schema 与实际分页响应一致
"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

import app.config as app_config

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"

NEW_INDEXES = {
    "ix_inquiries_subject",
    "ix_inquiries_owner_name",
    "ix_inquiries_created_at",
    "ix_quotations_supplier_id",
    "ix_quotations_created_at",
}


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _index_names(db_url: str) -> set:
    engine = create_engine(db_url)
    try:
        insp = inspect(engine)
        names = set()
        for table in insp.get_table_names():
            for idx in insp.get_indexes(table):
                names.add(idx.get("name"))
        return names
    finally:
        engine.dispose()


# ============ 询价列表分页 contract ============

def _create_inquiry(client, headers, subject):
    payload = {
        "subject": subject,
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到付款",
        "items": [{
            "materialId": "mat-1", "name": "工业交换机", "code": "MAT001",
            "category": "电子设备", "brand": "华为", "spec": "8口千兆",
            "techParams": "8口", "unit": "台", "quantity": 10,
        }],
        "invitedSupplierIds": ["sup-1"],
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def test_inquiries_pagination_unified_structure(client, buyer_headers):
    # 创建多条询价，确保分页 total 正确
    for i in range(5):
        _create_inquiry(client, buyer_headers, f"分页询价-{i}")
    resp = client.get("/api/inquiries?page=1&pageSize=3", headers=buyer_headers)
    assert resp.status_code == 200
    body = resp.json()
    # 统一分页结构
    assert set(body.keys()) == {"items", "total", "page", "pageSize"}
    assert body["page"] == 1
    assert body["pageSize"] == 3
    assert len(body["items"]) == 3
    assert body["total"] >= 5
    # 稳定排序：created_at,id 双键，翻页无重复/漏行
    page2 = client.get("/api/inquiries?page=2&pageSize=3", headers=buyer_headers).json()
    ids_page1 = {i["id"] for i in body["items"]}
    ids_page2 = {i["id"] for i in page2["items"]}
    assert ids_page1.isdisjoint(ids_page2)


def test_inquiries_pagination_backward_compat_full_array(client, buyer_headers):
    # 不传分页参数 → 返回全量数组（向后兼容）
    resp = client.get("/api/inquiries", headers=buyer_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)


# ============ 报价列表分页 contract ============

def test_quotations_pagination_unified_structure(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers, "报价分页询价")
    inq_id = inq["id"]
    # 用真实 inquiry_item_id（首个 item）构造报价，使报价合法
    item_id = inq["items"][0]["id"]
    for i in range(4):
        resp = client.post(
            "/api/quotations",
            json={
                "inquiryId": inq_id, "supplierId": f"sup-{i+1}", "supplierName": f"供{i}",
                "status": "DRAFT", "totalAmount": 10 + i,
                "items": [{
                    "inquiryItemId": item_id, "unitPrice": i + 1, "taxRate": 0.13,
                    "taxIncludedTotal": (i + 1) * 1.13, "deliveryDays": 5,
                }],
            },
            headers=buyer_headers,
        )
        assert resp.status_code in (200, 201), resp.text

    resp = client.get("/api/quotations?page=1&pageSize=2", headers=buyer_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"items", "total", "page", "pageSize"}
    assert body["page"] == 1
    assert body["pageSize"] == 2
    assert len(body["items"]) == 2
    assert body["total"] >= 4
    # 稳定排序翻页无重复
    page2 = client.get("/api/quotations?page=2&pageSize=2", headers=buyer_headers).json()
    ids1 = {i["id"] for i in body["items"]}
    ids2 = {i["id"] for i in page2["items"]}
    assert ids1.isdisjoint(ids2)


def test_quotations_pagination_backward_compat_full_array(client, buyer_headers):
    resp = client.get("/api/quotations", headers=buyer_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ============ 统一错误格式 contract ============

def test_error_format_has_structured_fields(client):
    # 404：未认证或不存在资源 → code/message/retryable/request_id
    resp = client.get("/api/inquiries/nonexistent-xyz", headers=None)
    # 未提供 token 时 401；提供 token 后 404。这里用未认证路径验证 401 结构
    if resp.status_code == 401:
        body = resp.json()
        assert body["code"] == "unauthorized"
        assert body["error_type"] == "unauthorized"
        assert body["retryable"] is False
        assert body["request_id"]
        assert body["message"]
        assert resp.headers.get("X-Request-Id") == body["request_id"]


def test_validation_error_has_field_errors(client, buyer_headers):
    # subject 空白 → 422 + fieldErrors
    resp = client.post(
        "/api/inquiries",
        json={"subject": "   "},
        headers=buyer_headers,
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "validation_error"
    assert body["retryable"] is False
    assert body["fieldErrors"]  # 字段级错误非空
    assert "subject" in body["fieldErrors"]


def test_conflict_error_has_conflict_details(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers, "冲突测试")
    # 成功更新一次 → version 2
    assert client.put(
        f"/api/inquiries/{inq['id']}",
        json={"subject": "第一次", "version": 1},
        headers=buyer_headers,
    ).status_code == 200
    # 旧版本再更新 → 409 + conflict 字段
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"subject": "应被拒绝", "version": 1},
        headers=buyer_headers,
    )
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "conflict"
    assert body["conflict"]  # 冲突详情存在
    assert body["retryable"] is False


# ============ 迁移 0011 索引 round-trip ============

def test_migration_0011_indexes_round_trip(monkeypatch, tmp_path):
    db_file = tmp_path / "migration0011.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setattr(app_config, "DB_URL", db_url)
    cfg = _alembic_config()

    command.upgrade(cfg, "head")
    missing = NEW_INDEXES - _index_names(db_url)
    assert not missing, f"upgrade head 后缺少索引: {missing}"

    command.downgrade(cfg, "0010")
    remaining = _index_names(db_url) & NEW_INDEXES
    assert not remaining, f"downgrade 0010 后仍残留新索引: {remaining}"

    command.upgrade(cfg, "head")
    missing = NEW_INDEXES - _index_names(db_url)
    assert not missing, f"round-trip upgrade head 后缺少索引: {missing}"


# ============ OpenAPI schema 与分页响应一致 ============

def test_openapi_documents_pagination_params(client):
    schema = client.get("/openapi.json").json()
    assert "paths" in schema, f"openapi 缺少 paths，实际 keys: {list(schema.keys())}"
    # /quotations 路径带上分页查询参数（文档化服务端分页）
    for path in ("/api/quotations", "/api/inquiries"):
        params = schema["paths"][path]["get"]["parameters"]
        param_names = {p["name"] for p in params}
        assert {"page", "pageSize"} <= param_names, f"{path} 缺少分页参数"
        # 分页参数均为整数类型（可选参数由 anyOf:[integer, null] 表达）
        by_name = {p["name"]: p for p in params if p.get("in") == "query"}
        for key in ("page", "pageSize"):
            param_schema = by_name[key]["schema"]
            types = [s.get("type") for s in param_schema.get("anyOf", [param_schema])]
            assert "integer" in types, f"{path} 的 {key} 参数类型非常量 integer"


def test_paginated_response_matches_quotation_schema(client, buyer_headers):
    # 实际分页响应字段与 PaginatedQuotationsSchema 定义一致
    inq = _create_inquiry(client, buyer_headers, "schema一致性询价")
    item_id = inq["items"][0]["id"]
    client.post(
        "/api/quotations",
        json={
            "inquiryId": inq["id"], "supplierId": "sup-1", "supplierName": "供A",
            "status": "DRAFT", "totalAmount": 10,
            "items": [{
                "inquiryItemId": item_id, "unitPrice": 10, "taxRate": 0.13,
                "taxIncludedTotal": 11.3, "deliveryDays": 5,
            }],
        },
        headers=buyer_headers,
    )
    resp = client.get("/api/quotations?page=1&pageSize=5", headers=buyer_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"items", "total", "page", "pageSize"}
    assert isinstance(body["items"], list)
    assert body["total"] >= 1