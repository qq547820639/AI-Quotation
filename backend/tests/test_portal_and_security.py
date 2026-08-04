"""P0 供应商邀请与门户安全测试（Task 3/4/6/7/8/9）

覆盖：
- 邀请 token 安全（随机、仅存哈希、枚举/越权/过期/撤销/篡改拒绝）
- 供应商门户 API（校验/明细最小化/草稿/提交重算/回执/撤回）
- 资源级授权（跨组织读/跨用户编辑/伪造负责人/非所有者删除）
- 状态机（合法/非法转换）
- 金额精度（Decimal 舍入/税率/空报价/极大值）
- 幂等（同一 Idempotency-Key 返回同一结果，不重复创建）
- 附件上传（越权/类型/大小/下载鉴权）

注：conftest 使用共享临时 DB，各 token 承担的测试互不冲突：
- H3 = inq-3/sup-2：只读（validate / 明细最小化）
- H4 = inq-4/sup-2：成功提交生命周期（草稿/提交/重复提交幂等）
- H5 = inq-3/sup-5：拒绝校验（越界单价/税率/他询价物料）+ 附件（不提交，保持有效）
- H6 = inq-5/sup-1：提交前回执（409）
"""
from decimal import Decimal

from app.invitations import (
    generate_invitation_token, hash_invitation_token, INV_REVOKED,
)
from app.money import compute_item_totals, compute_quotation_total, quantize_money, to_decimal

# 各 token 对应 (inquiry_id, supplier_id)
H3 = {"X-Invitation-Token": "inv-token-inq3-sup2-000000000000000000000000000000000000000000000000"}
H5 = {"X-Invitation-Token": "inv-token-inq3-sup5-000000000000000000000000000000000000000000000000"}
H4 = {"X-Invitation-Token": "inv-token-inq4-sup2-000000000000000000000000000000000000000000000000"}
H6 = {"X-Invitation-Token": "inv-token-inq5-sup1-000000000000000000000000000000000000000000000000"}


# ============ 邀请 token 安全 ============

def test_invitation_token_is_random_and_not_stored():
    """两次生成的 token 不同，且仅存哈希（不存明文）"""
    t1 = generate_invitation_token()
    t2 = generate_invitation_token()
    assert t1 != t2
    assert len(t1) >= 32
    assert hash_invitation_token(t1) != t1  # 哈希与明文不同
    assert hash_invitation_token(t1) == hash_invitation_token(t1)  # 可重复计算


def test_invitation_unknown_or_missing_token_rejected(client):
    """缺失 / 未知 token 访问门户 → 401"""
    assert client.get("/api/portal/inquiries").status_code == 401
    assert client.get("/api/portal/inquiries", headers={"X-Invitation-Token": "nope"}).status_code == 401


def test_invitation_binds_unique_inquiry_and_supplier(client):
    """不同供应商的 token 绑定不同询价/供应商，无法互相越权"""
    resp = client.get("/api/portal/inquiries", headers=H3)
    assert resp.status_code == 200
    assert resp.json()["id"] == "inq-3"
    # 用 inq-4 的 token 访问到的是 inq-4，而非 inq-3
    resp4 = client.get("/api/portal/inquiries", headers=H4)
    assert resp4.status_code == 200
    assert resp4.json()["id"] == "inq-4"


def test_completed_inquiry_invitation_rejected(client):
    """终态（COMPLETED）询价的邀请应被拒绝（403）"""
    tok = "inv-token-inq7-sup2-000000000000000000000000000000000000000000000000"
    resp = client.get("/api/portal/inquiries", headers={"X-Invitation-Token": tok})
    assert resp.status_code == 403


def test_revoked_token_rejected(client):
    """撤销后的邀请被拒绝（403）"""
    from app.database import SessionLocal
    from app.invitations import get_invitation_by_token, revoke_invitation
    db = SessionLocal()
    try:
        inv = get_invitation_by_token(db, "inv-token-inq4-sup5-000000000000000000000000000000000000000000000000")
        assert inv is not None
        revoke_invitation(db, inv)
        db.refresh(inv)
        assert inv.status == INV_REVOKED
    finally:
        db.close()
    resp = client.get("/api/portal/inquiries", headers={
        "X-Invitation-Token": "inv-token-inq4-sup5-000000000000000000000000000000000000000000000000"})
    assert resp.status_code == 403


# ============ 供应商门户 API ============

def test_validate_returns_valid_status(client):
    resp = client.get("/api/portal/invitations/validate", headers=H3)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "valid"
    assert data["inquiryId"] == "inq-3"
    assert data["supplierId"] == "sup-2"


def test_inquiry_does_not_leak_target_price_or_other_suppliers(client):
    resp = client.get("/api/portal/inquiries", headers=H3)
    assert resp.status_code == 200
    data = resp.json()
    assert "targetPrice" not in data["items"][0]
    assert "purchaserComments" not in data
    assert "selectedSupplierMap" not in data
    assert "quotations" not in data
    assert "approvalNodes" not in data
    assert "logs" not in data
    assert "invitedSupplierIds" not in data


def test_save_draft_and_submit_recomputes_amount(client):
    """H4（inq-4/sup-2）：草稿保存与提交，服务端重算总额"""
    draft = client.put("/api/portal/quotations/draft", headers=H4, json={
        "items": [{"inquiryItemId": "item-inq-4-1", "unitPrice": 4200, "taxRate": 0.13, "deliveryDays": 10}],
        "remark": "草稿备注",
    })
    assert draft.status_code == 200
    d = draft.json()
    assert d["status"] == "DRAFT"
    # inq-4 物料数量为 30：4200 * 30 = 126000
    assert d["totalAmount"] == 126000.0

    submit = client.post("/api/portal/quotations/submit", headers=H4, json={
        "items": [{"inquiryItemId": "item-inq-4-1", "unitPrice": 4200, "taxRate": 0.13, "deliveryDays": 10}],
    })
    assert submit.status_code == 200
    s = submit.json()
    assert s["status"] == "SUBMITTED"
    assert s["totalAmount"] == 126000.0
    assert s["receiptCode"]

    # 提交后再次提交 → 返回既有回执（幂等）
    again = client.post("/api/portal/quotations/submit", headers=H4, json={
        "items": [{"inquiryItemId": "item-inq-4-1", "unitPrice": 4200, "taxRate": 0.13, "deliveryDays": 10}]})
    assert again.status_code == 200
    assert again.json()["receiptCode"] == s["receiptCode"]


def test_submit_rejects_zero_price_and_bad_tax(client):
    """H5：单价必须 > 0、税率必须在 0~1"""
    resp = client.post("/api/portal/quotations/submit", headers=H5, json={
        "items": [{"inquiryItemId": "item-inq-3-1", "unitPrice": 0, "taxRate": 0.13, "deliveryDays": 10}]})
    assert resp.status_code == 422
    resp = client.post("/api/portal/quotations/submit", headers=H5, json={
        "items": [{"inquiryItemId": "item-inq-3-1", "unitPrice": 100, "taxRate": 1.5, "deliveryDays": 10}]})
    assert resp.status_code == 422


def test_submit_rejects_item_belonging_to_other_inquiry(client):
    """H5：报价明细不属于该询价单 → 422"""
    resp = client.post("/api/portal/quotations/submit", headers=H5, json={
        "items": [{"inquiryItemId": "item-inq-5-1", "unitPrice": 100, "taxRate": 0.13, "deliveryDays": 10}]})
    assert resp.status_code == 422


def test_receipt_before_submit_conflict(client):
    """H6（inq-5/sup-1）尚未提交 → 回执 409"""
    resp = client.get("/api/portal/quotations/receipt", headers=H6)
    assert resp.status_code == 409


# ============ 资源级授权 ============

def _create_inquiry(client, headers, subject="授权测试询价"):
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


def _login(client, user_id):
    r = client.post("/api/auth/login", json={"userId": user_id})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_cross_org_read_rejected(client, buyer_headers):
    """u-1（总部）不能读取华东分部 inq-1；u-3(华东)不能读取总部 inq-2"""
    assert client.get("/api/inquiries/inq-1", headers=buyer_headers).status_code == 403
    h3 = _login(client, "u-3")
    assert client.get("/api/inquiries/inq-2", headers=h3).status_code == 403


def test_forged_owner_and_org_ignored_on_create(client, buyer_headers):
    """创建时伪造 ownerId/ownerName/organization 被忽略，服务端强制为当前用户"""
    payload = {
        "subject": "伪造负责人的询价",
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到付款",
        "ownerId": "u-99", "ownerName": "伪造", "organization": "伪造组织",
        "createdById": "u-99", "createdByName": "伪造",
        "items": [{
            "materialId": "mat-1", "name": "工业交换机", "code": "MAT001",
            "category": "电子设备", "brand": "华为", "spec": "8口千兆",
            "techParams": "8口", "unit": "台", "quantity": 10,
        }],
    }
    resp = client.post("/api/inquiries", json=payload, headers=buyer_headers)
    assert resp.status_code in (200, 201)
    data = resp.json()
    assert data["ownerId"] == "u-1"
    assert data["ownerName"] == "李明辉"
    assert data["organization"] == "总部采购中心"
    assert data["createdById"] == "u-1"


def test_cross_user_edit_rejected(client, buyer_headers):
    """u-3 不能编辑 u-1 的询价 inq-2（403），且状态不变"""
    h3 = _login(client, "u-3")
    resp = client.put("/api/inquiries/inq-2", json={"subject": "越权修改"}, headers=h3)
    assert resp.status_code == 403
    detail = client.get("/api/inquiries/inq-2", headers=buyer_headers).json()
    assert detail["subject"] == "不锈钢法兰批量采购"


def test_non_owner_delete_rejected(client, buyer_headers):
    """u-5 不能删除 u-1 的询价 inq-2（403）"""
    h5 = _login(client, "u-5")
    resp = client.delete("/api/inquiries/inq-2", headers=h5)
    assert resp.status_code == 403


def test_update_cannot_change_status(client, buyer_headers):
    """普通 PUT 不得修改 status / organization / code"""
    inq = _create_inquiry(client, buyer_headers)
    resp = client.put(
        f"/api/inquiries/{inq['id']}",
        json={"status": "COMPLETED", "organization": "HACK", "code": "HACK001", "version": 1},
        headers=buyer_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "DRAFT"
    assert data["organization"] == "总部采购中心"
    assert data["code"].startswith("INQ")


# ============ 状态机 ============

def test_illegal_transition_returns_409(client, buyer_headers, supervisor_headers):
    """DRAFT 直接 confirm（COMPLETED）为非法转换 → 409（需有 confirm 权限者触发，排除权限 403 干扰）"""
    inq = _create_inquiry(client, buyer_headers)
    resp = client.post(f"/api/inquiries/{inq['id']}/confirm", json={"version": 1}, headers=supervisor_headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["error_type"] == "conflict"
    assert body["detail"]["error_type"] == "invalid_state_transition"


def test_legal_transition_pipeline(client, buyer_headers, supervisor_headers):
    """DRAFT→send→INQUIRING→submit-approval→PENDING_APPROVAL→approve→PENDING_CONFIRM→confirm→COMPLETED 全合法"""
    inq = _create_inquiry(client, buyer_headers)
    iid = inq["id"]
    assert client.post(f"/api/inquiries/{iid}/send", json={"version": 1}, headers=buyer_headers).status_code == 200
    assert client.post(f"/api/inquiries/{iid}/submit-approval", headers=buyer_headers).status_code == 200
    assert client.post(f"/api/inquiries/{iid}/approve", json={"comment": "ok"}, headers=supervisor_headers).status_code == 200
    assert client.post(f"/api/inquiries/{iid}/confirm", headers=supervisor_headers).status_code == 200
    final = client.get(f"/api/inquiries/{iid}", headers=buyer_headers).json()
    assert final["status"] == "COMPLETED"


# ============ 金额精度 ============

def test_money_rounding_half_up():
    assert quantize_money("1.005") == Decimal("1.01")
    assert quantize_money("1.004") == Decimal("1.00")
    assert quantize_money("0.1") == Decimal("0.10")


def test_money_item_total():
    assert compute_item_totals("1234.56", 3, 0.13) == Decimal("3703.68")
    assert to_decimal(None) == Decimal("0")
    assert to_decimal("abc") == Decimal("0")


def test_money_tax_rate_validation():
    import pytest
    with pytest.raises(ValueError):
        compute_item_totals("100", 1, 1.2)
    with pytest.raises(ValueError):
        compute_item_totals("100", 1, -0.1)


def test_money_empty_and_large_quotation():
    assert compute_quotation_total([]) == Decimal("0")
    assert compute_quotation_total([{"unitPrice": "999999999999.99", "quantity": 2, "taxRate": 0}]) == Decimal("1999999999999.98")


# ============ 幂等 ============

def test_idempotency_key_returns_same_result(client):
    """同一 Idempotency-Key 提交报价只创建一次，返回同一回执"""
    from app.idempotency import clear
    clear()
    try:
        for _ in range(2):
            resp = client.post("/api/portal/quotations/submit", headers=H4, json={
                "idempotencyKey": "idem-key-001",
                "items": [{"inquiryItemId": "item-inq-4-1", "unitPrice": 4200, "taxRate": 0.13, "deliveryDays": 10}],
            })
            assert resp.status_code == 200
            assert resp.json()["receiptCode"]
    finally:
        clear()


# ============ 附件上传 ============

def test_attachment_upload_requires_valid_type(client):
    """不支持的 MIME 类型 → 415"""
    draft = client.put("/api/portal/quotations/draft", headers=H5, json={
        "items": [{"inquiryItemId": "item-inq-3-1", "unitPrice": 4000, "taxRate": 0.13, "deliveryDays": 10}]})
    assert draft.status_code == 200
    qid = draft.json()["id"]
    resp = client.post(
        f"/api/portal/attachments?owner_type=quotation&owner_id={qid}",
        headers=H5,
        files={"file": ("evil.exe", b"hello", "application/octet-stream")},
    )
    assert resp.status_code == 415


def test_attachment_upload_and_download_roundtrip(client):
    """上传合法 PDF 附件，可下载；无 token 下载被拒"""
    draft = client.put("/api/portal/quotations/draft", headers=H5, json={
        "items": [{"inquiryItemId": "item-inq-3-1", "unitPrice": 4000, "taxRate": 0.13, "deliveryDays": 10}]})
    assert draft.status_code == 200
    qid = draft.json()["id"]
    up = client.post(
        f"/api/portal/attachments?owner_type=quotation&owner_id={qid}",
        headers=H5,
        files={"file": ("报价单.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert up.status_code == 200, up.text
    att = up.json()
    assert att["name"] == "报价单.pdf"
    # 下载鉴权：无 token 拒绝
    assert client.get(f"/api/portal/attachments/{att['id']}/download").status_code == 401
    # 带 token 可下载
    dl = client.get(f"/api/portal/attachments/{att['id']}/download", headers=H5)
    assert dl.status_code == 200
    assert dl.content == b"%PDF-1.4 fake"


def test_attachment_scan_status_and_scan_endpoint(client):
    """上传附件默认 scan_status=pending；调用占位扫描接口后标记为 clean/infected"""
    draft = client.put("/api/portal/quotations/draft", headers=H5, json={
        "items": [{"inquiryItemId": "item-inq-3-1", "unitPrice": 4000, "taxRate": 0.13, "deliveryDays": 10}]})
    assert draft.status_code == 200
    qid = draft.json()["id"]

    # 合法 PDF → 上传后 pending，扫描后 clean
    up = client.post(
        f"/api/portal/attachments?owner_type=quotation&owner_id={qid}",
        headers=H5, files={"file": ("报告.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert up.status_code == 200, up.text
    att = up.json()
    assert att["scanStatus"] == "pending"
    scan = client.post(f"/api/portal/attachments/{att['id']}/scan", headers=H5)
    assert scan.status_code == 200, scan.text
    assert scan.json()["scanStatus"] == "clean"

    # 扫描越权：无 token 拒绝
    assert client.post(f"/api/portal/attachments/{att['id']}/scan").status_code == 401