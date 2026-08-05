"""P1 Task 6：并发与幂等 —— 报价重复创建 409、提交幂等键去重、列表稳定排序

覆盖：
- 同一 (inquiry_id, supplier_id) 重复创建报价 → 数据库唯一约束兜底返回 409 readable 错误
- 内部提交报价 submit 携带 idempotencyKey 时重复提交返回缓存结果（仅执行一次）
- 报价/询价列表使用稳定排序（id 次键），多次请求序一致、无重复
"""
from __future__ import annotations


def _create_inquiry(client, headers):
    payload = {
        "subject": "并发幂等测试询价",
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到付款",
        "items": [
            {
                "materialId": "mat-1",
                "name": "工业交换机",
                "code": "MAT001",
                "category": "电子设备",
                "brand": "华为",
                "spec": "8口千兆",
                "techParams": "8口",
                "unit": "台",
                "quantity": 10,
            }
        ],
        "invitedSupplierIds": ["sup-1", "sup-2"],
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _quotation_payload(inquiry, supplier_id="sup-1"):
    item = inquiry["items"][0]
    return {
        "inquiryId": inquiry["id"],
        "supplierId": supplier_id,
        "supplierName": "测试供应商",
        "status": "DRAFT",
        "totalAmount": 100,
        "items": [
            {
                "inquiryItemId": item["id"],
                "unitPrice": 10,
                "taxRate": 0.13,
                "taxIncludedTotal": 100,
                "deliveryDays": 7,
                "warrantyMonths": 12,
            }
        ],
    }


# ============ 重复创建返回 409 ============

def test_duplicate_quotation_conflict_409(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    q = _quotation_payload(inq, "sup-1")
    assert client.post("/api/quotations", json=q, headers=buyer_headers).status_code == 200

    # 同一 (inquiryId, supplierId) 再次创建 → 唯一约束冲突 → 409 + 可读错误结构
    resp = client.post("/api/quotations", json=q, headers=buyer_headers)
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["error_type"] == "duplicate_quotation"
    assert detail["inquiryId"] == inq["id"]
    assert detail["supplierId"] == "sup-1"

    # 不同供应商仍可创建（不受影响）
    q2 = _quotation_payload(inq, "sup-2")
    assert client.post("/api/quotations", json=q2, headers=buyer_headers).status_code == 200


# ============ 提交报价幂等键 ============

def test_submit_quotation_idempotent_key(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    q = _quotation_payload(inq, "sup-1")
    qid = client.post("/api/quotations", json=q, headers=buyer_headers).json()["id"]

    body = {"idempotencyKey": "submit-idem-1"}
    r1 = client.post(f"/api/quotations/{qid}/submit", json=body, headers=buyer_headers)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "SUBMITTED"

    # 相同幂等键重复提交 → 直接返回缓存结果，不重复执行（同 id、同状态）
    r2 = client.post(f"/api/quotations/{qid}/submit", json=body, headers=buyer_headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["id"] == qid
    assert r2.json()["status"] == "SUBMITTED"


# ============ 列表稳定排序 ============

def test_list_quotations_stable_order(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    client.post("/api/quotations", json=_quotation_payload(inq, "sup-1"), headers=buyer_headers)
    client.post("/api/quotations", json=_quotation_payload(inq, "sup-2"), headers=buyer_headers)

    r1 = client.get("/api/quotations", headers=buyer_headers)
    r2 = client.get("/api/quotations", headers=buyer_headers)
    assert r1.status_code == 200 and r2.status_code == 200
    ids1 = [x["id"] for x in r1.json()]
    ids2 = [x["id"] for x in r2.json()]

    # 稳定：两次请求排序一致，且无重复行
    assert ids1 == ids2
    assert len(ids1) == len(set(ids1))


def test_list_inquiries_pagination_stable(client, buyer_headers):
    # 创建多条询价，分页时用 id 次键保证稳定、不重复漏项
    for _ in range(3):
        _create_inquiry(client, buyer_headers)
    r1 = client.get("/api/inquiries", params={"page": 1, "pageSize": 2}, headers=buyer_headers)
    r2 = client.get("/api/inquiries", params={"page": 1, "pageSize": 2}, headers=buyer_headers)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["items"] == r2.json()["items"]