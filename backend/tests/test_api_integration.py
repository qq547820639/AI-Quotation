"""API 集成测试：认证 / 询价 / 供应商 / 报价核心接口

复用 conftest 的临时 SQLite + 种子数据 + TestClient 夹具。
断言关键字段（状态码、字段值），不写恒真断言。
"""


# ============ 认证 ============

def test_login_success_returns_token_and_user(client):
    resp = client.post("/api/auth/login", json={"userId": "u-1"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["token"]
    assert data["user"]["id"] == "u-1"
    assert data["user"]["name"] == "李明辉"
    assert data["user"]["role"] == "采购人员"


def test_login_unknown_user_returns_401(client):
    resp = client.post("/api/auth/login", json={"userId": "no-such-user"})
    assert resp.status_code == 401


def test_unauthorized_inquiries_returns_401(client):
    resp = client.get("/api/inquiries")
    assert resp.status_code == 401


# ============ 询价 ============

def test_inquiries_list_returns_seed_data(client, buyer_headers):
    resp = client.get("/api/inquiries", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 8
    inq1 = next(i for i in data if i["id"] == "inq-1")
    assert inq1["code"] == "INQ20260801001"
    assert inq1["status"] == "DRAFT"
    assert inq1["ownerId"] == "u-3"


def test_create_inquiry_returns_created(client, buyer_headers):
    payload = {
        "code": "INQ-TEST-001",
        "subject": "测试询价单",
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到验收后 30 天付款",
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
                "targetPrice": 800,
            }
        ],
    }
    resp = client.post("/api/inquiries", json=payload, headers=buyer_headers)
    assert resp.status_code in (200, 201)
    data = resp.json()
    # Task 7：编号由服务端生成，忽略客户端传入的 code
    assert data["code"].startswith("INQ")
    assert data["code"] != payload["code"]
    assert data["status"] == "DRAFT"
    assert data["ownerId"] == "u-1"
    assert data["version"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "工业交换机"


def test_get_inquiry_detail(client, buyer_headers):
    resp = client.get("/api/inquiries/inq-2", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "inq-2"
    assert data["subject"] == "不锈钢法兰批量采购"
    assert data["status"] == "PENDING_SEND"
    assert len(data["items"]) >= 1


def test_get_inquiry_not_found_returns_404(client, buyer_headers):
    resp = client.get("/api/inquiries/no-such-id", headers=buyer_headers)
    assert resp.status_code == 404


# ============ 供应商 ============

def test_suppliers_list_returns_seed_data(client, buyer_headers):
    resp = client.get("/api/suppliers", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 8
    sup1 = next(s for s in data if s["id"] == "sup-1")
    assert sup1["code"] == "SUP001"
    assert sup1["cooperationStatus"] == "COOPERATING"
    assert sup1["name"] == "上海恒远工业设备有限公司"


def test_supplier_toggle_status_requires_admin(client, buyer_headers, admin_headers):
    # 采购人员无 SUPPLIER_DISABLE 权限 → 403
    resp = client.post("/api/suppliers/sup-1/toggle-status", headers=buyer_headers)
    assert resp.status_code == 403
    # 管理员可切换启用/停用
    resp = client.post("/api/suppliers/sup-1/toggle-status", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["cooperationStatus"] == "DISABLED"
    # 再切回恢复
    resp = client.post("/api/suppliers/sup-1/toggle-status", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["cooperationStatus"] == "COOPERATING"


# ============ 报价 ============

def test_quotations_by_inquiry_returns_seed(client, buyer_headers):
    resp = client.get("/api/inquiries/inq-5/quotations", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert all(q["inquiryId"] == "inq-5" for q in data)
    assert all(q["status"] == "SUBMITTED" for q in data)
    assert all(q["totalAmount"] > 0 for q in data)


def test_quotations_list_returns_all(client, buyer_headers):
    resp = client.get("/api/quotations", headers=buyer_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 8
    quo = next(q for q in data if q["id"] == "quo-5-1")
    assert quo["inquiryId"] == "inq-5"
    assert quo["supplierId"] == "sup-1"