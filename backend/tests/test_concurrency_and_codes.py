"""并发控制（版本号 + 409）、供应商定标数据完整性、服务端编号生成测试（Task 5/6/7）"""


def _create_inquiry(client, headers, subject="并发测试询价"):
    payload = {
        "subject": subject,
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
            },
            {
                "materialId": "mat-2",
                "name": "不锈钢法兰",
                "code": "MAT002",
                "category": "五金件",
                "brand": "恒远",
                "spec": "DN50",
                "techParams": "不锈钢",
                "unit": "个",
                "quantity": 20,
            },
        ],
        "invitedSupplierIds": ["sup-1"],
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


# ============ Task 6：并发控制（版本号 + 409） ============

def test_update_increments_version(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    assert inq["version"] == 1
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"subject": "更新主题", "version": 1},
        headers=buyer_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["version"] == 2
    assert resp.json()["subject"] == "更新主题"


def test_update_stale_version_returns_409(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    # 第一次成功更新 → version 2
    assert client.put(
        f"/api/inquiries/{inq['id']}",
        json={"subject": "第一次", "version": 1},
        headers=buyer_headers,
    ).status_code == 200
    # 用旧版本 version=1 再更新 → 409，且本地状态不变
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"subject": "应被拒绝", "version": 1},
        headers=buyer_headers,
    )
    assert resp.status_code == 409
    detail = client.get(f"/api/inquiries/{inq['id']}", headers=buyer_headers).json()
    assert detail["subject"] == "第一次"
    assert detail["version"] == 2


def test_action_stale_version_returns_409(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    assert inq["version"] == 1
    # send 成功 → version 2
    resp = client.post(f"/api/inquiries/{inq['id']}/send", json={"version": 1}, headers=buyer_headers)
    assert resp.status_code == 200
    assert resp.json()["version"] == 2
    # 用旧版本再 send → 409
    resp = client.post(f"/api/inquiries/{inq['id']}/send", json={"version": 1}, headers=buyer_headers)
    assert resp.status_code == 409


# ============ Task 5：供应商定标数据完整性（增量合并） ============

def test_selected_supplier_map_incremental_merge(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    item_ids = [item["id"] for item in inq["items"]]
    assert len(item_ids) == 2
    item_a, item_b = item_ids

    # 只提交 item_a 的选择（增量 PATCH），不应覆盖
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"selectedSupplierMap": {item_a: "sup-1"}, "version": 1},
        headers=buyer_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["selectedSupplierMap"] == {item_a: "sup-1"}
    assert data["version"] == 2

    # 再提交 item_b 的选择（增量 PATCH），item_a 的选择必须保留
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"selectedSupplierMap": {item_b: "sup-2"}, "version": 2},
        headers=buyer_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["selectedSupplierMap"] == {item_a: "sup-1", item_b: "sup-2"}


def test_purchaser_comments_incremental_merge(client, buyer_headers):
    inq = _create_inquiry(client, buyer_headers)
    assert client.put(
        f"/api/inquiries/{inq['id']}",
        json={"purchaserComments": {"sup-1": "价格偏高"}, "version": 1},
        headers=buyer_headers,
    ).status_code == 200
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"purchaserComments": {"sup-2": "交期较长"}, "version": 2},
        headers=buyer_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["purchaserComments"] == {"sup-1": "价格偏高", "sup-2": "交期较长"}


# ============ Task 7：服务端编号生成 ============

def test_generated_codes_unique_and_prefixed(client, buyer_headers):
    codes = set()
    for _ in range(10):
        inq = _create_inquiry(client, buyer_headers)
        assert inq["code"].startswith("INQ")
        assert inq["code"] not in codes
        codes.add(inq["code"])
    assert len(codes) == 10