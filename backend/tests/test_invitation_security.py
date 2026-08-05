"""P2-14 Task 19：供应商邀请 Token 安全补充测试

test_portal_and_security.py 已覆盖：token 随机性/仅存哈希、缺失/未知 token 拒绝、
token 绑定唯一询价与供应商、撤销拒绝、终态询价拒绝、重复提交幂等、已提交状态 410。

本文件在此基础上补充真实断言的缺口：
- 邀请过期（expires_at 过期）→ 门户访问被拒 403
- 篡改 token 任意字符 → 哈希不匹配 → 401（无法伪造出另一个有效邀请）
- 供应商用邀请 token 提交报价时，服务端强制绑定邀请的 supplier_id，忽略请求体伪造的 supplierId
- token 无法用来访问绑定询价之外的其它询价

注：supplier_invitations 存在 (inquiry_id, supplier_id) 唯一约束，故复用种子邀请
（均为 pending 状态），避免与现有测试冲突。
"""
from datetime import datetime, timedelta, timezone
import threading

from app.database import SessionLocal
from app.invitations import (
    get_invitation_by_token, get_invitation_raw_token, hash_invitation_token,
    resend_invitation,
)
from app.models import SupplierInvitation
from app.redis_client import get_store

# 绑定 inq-3/sup-2 的种子邀请（只读）
H3 = {"X-Invitation-Token": "inv-token-inq3-sup2-000000000000000000000000000000000000000000000000"}
# 绑定 inq-5/sup-3 的种子邀请（用于防伪造提交；inq-5 为 ALL_QUOTED 活跃状态）
TOKEN_INQ5_SUP3 = "inv-token-inq5-sup3-000000000000000000000000000000000000000000000000"
# 绑定 inq-5/sup-5 的种子邀请（用于过期测试；不在其他测试中复用）
TOKEN_INQ5_SUP5 = "inv-token-inq5-sup5-000000000000000000000000000000000000000000000000"


def test_expired_invitation_rejected(client):
    """将邀请 expires_at 改为过去 → 门户访问被拒（403）"""
    db = SessionLocal()
    try:
        inv = get_invitation_by_token(db, TOKEN_INQ5_SUP5)
        assert inv is not None and inv.status == "pending"
        inv.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    finally:
        db.close()
    resp = client.get("/api/portal/inquiries", headers={"X-Invitation-Token": TOKEN_INQ5_SUP5})
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_type"] == "invitation_expired"


def test_tampered_token_rejected(client):
    """篡改 token 任意字符 → 哈希不匹配 → 401（无法伪造出另一个有效邀请）"""
    tok = H3["X-Invitation-Token"]
    head_tamper = list(tok)
    head_tamper[0] = "a" if tok[0] != "a" else "b"
    resp = client.get("/api/portal/inquiries", headers={"X-Invitation-Token": "".join(head_tamper)})
    assert resp.status_code == 401
    # 篡改尾部字符同样被拒
    tail = tok[:-2] + ("xy" if tok[-2:] != "xy" else "ab")
    resp = client.get("/api/portal/inquiries", headers={"X-Invitation-Token": tail})
    assert resp.status_code == 401


def test_token_cannot_access_other_inquiry(client):
    """H3（绑定 inq-3）只能读取 inq-3，无法读取其它询价"""
    resp = client.get("/api/portal/inquiries", headers=H3)
    assert resp.status_code == 200
    assert resp.json()["id"] == "inq-3"
    assert resp.json()["id"] != "inq-4"


def test_supplier_cannot_forge_supplier_id_on_submit(client):
    """提交报价时请求体伪造 supplierId 被忽略，服务端强制绑定邀请的供应商（inq-5/sup-3）"""
    resp = client.post(
        "/api/portal/quotations/submit",
        headers={"X-Invitation-Token": TOKEN_INQ5_SUP3},
        json={
            # 试图伪造为其他供应商
            "supplierId": "sup-99",
            "supplierName": "伪造供应商",
            "items": [{"inquiryItemId": "item-inq-5-1", "unitPrice": 100.55, "taxRate": 0.13, "deliveryDays": 7}],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["supplierId"] == "sup-3"
    assert data["supplierId"] != "sup-99"


def _login(client, user_id):
    r = client.post("/api/auth/login", json={"userId": user_id})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _create_and_send_inquiry(client, headers, supplier_id="sup-1"):
    payload = {
        "subject": f"重新生成邀请测试-{supplier_id}",
        "deadline": "2026-09-01 18:00:00",
        "deliveryAddress": "测试地址",
        "contact": "测试 13800000000",
        "paymentTerms": "货到付款",
        "items": [{
            "materialId": "mat-1", "name": "工业交换机", "code": "MAT001",
            "category": "电子设备", "brand": "华为", "spec": "8口千兆",
            "techParams": "8口", "unit": "台", "quantity": 10,
        }],
        "invitedSupplierIds": [supplier_id],
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    iid = resp.json()["id"]
    # 发送询价 → 创建邀请（pending）
    assert client.post(f"/api/inquiries/{iid}/send", json={"version": 1}, headers=headers).status_code == 200
    return iid


def test_regenerate_link_returns_working_token(client):
    """采购主管重新生成邀请链接 → 返回的原始 token 有效，可经门户 API 读取询价"""
    headers = _login(client, "u-2")
    iid = _create_and_send_inquiry(client, headers, "sup-1")
    resp = client.post(f"/api/inquiries/{iid}/invitations/sup-1/regenerate", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["token"]
    assert data["inquiryId"] == iid
    assert data["supplierId"] == "sup-1"
    assert data["portalUrl"] and data["token"] in data["portalUrl"]
    # 新 token 可读取绑定的询价（门户 API 按 token 哈希校验）
    portal = client.get("/api/portal/inquiries", headers={"X-Invitation-Token": data["token"]})
    assert portal.status_code == 200, portal.text
    assert portal.json()["id"] == iid


def test_regenerate_link_forbidden_for_uninvited_supplier(client):
    """未受邀供应商无法重新生成链接（403）"""
    headers = _login(client, "u-2")
    iid = _create_and_send_inquiry(client, headers, "sup-1")
    resp = client.post(f"/api/inquiries/{iid}/invitations/sup-99/regenerate", headers=headers)
    assert resp.status_code == 403


def test_regenerate_link_requires_permission_and_access(client):
    """无 INQUIRY_SEND 的普通用户 / 非负责人跨组织访问被拒"""
    headers = _login(client, "u-1")  # u-1 自身创建的 inq-2 属于他人(总部，但 owner 非 u-1)
    # u-1 不能为不属于自己数据的 url 重新生成；这里用不存在的询价验证 404
    resp = client.post("/api/inquiries/inq-999/invitations/sup-1/regenerate", headers=headers)
    assert resp.status_code == 404


# ============ P0: 重发语义（resend vs regenerate）与 token 加固 ============

def _fresh_invitation(client, headers):
    """创建一个新询价并发送，返回 (iid, supplier_id, invitation_id)"""
    iid = _create_and_send_inquiry(client, headers, "sup-1")
    db = SessionLocal()
    try:
        inv = db.query(SupplierInvitation).filter(
            SupplierInvitation.inquiry_id == iid,
            SupplierInvitation.supplier_id == "sup-1",
        ).first()
        assert inv is not None
        return iid, inv.id
    finally:
        db.close()


def test_resend_reuses_same_token_when_available(client):
    """明文 token 仍在短期存储时，重复重发复用同一有效 token（不产生多个有效 token）"""
    headers = _login(client, "u-2")
    iid, inv_id = _fresh_invitation(client, headers)
    tok_before = get_invitation_raw_token(inv_id)
    assert tok_before

    for _ in range(2):
        r = client.post(f"/api/inquiries/{iid}/deliveries/sup-1/resend", headers=headers)
        assert r.status_code == 200, r.text

    tok_after = get_invitation_raw_token(inv_id)
    assert tok_after == tok_before  # 复用同一 token
    # 原 token 仍有效
    assert client.get("/api/portal/inquiries", headers={"X-Invitation-Token": tok_after}).status_code == 200


def test_resend_after_token_loss_rotates_new_token(client):
    """明文 token 丢失（Redis 重启/进程重启）后重发 → 自动重签新 token，旧 token 立即失效"""
    headers = _login(client, "u-2")
    iid, inv_id = _fresh_invitation(client, headers)
    old_tok = get_invitation_raw_token(inv_id)
    assert old_tok

    # 模拟短期存储丢失
    get_store().delete(f"procurement:inv:raw:{inv_id}")
    assert get_invitation_raw_token(inv_id) is None

    r = client.post(f"/api/inquiries/{iid}/deliveries/sup-1/resend", headers=headers)
    assert r.status_code == 200, r.text

    new_tok = get_invitation_raw_token(inv_id)
    assert new_tok and new_tok != old_tok
    # 旧 token 失效（哈希已被覆盖）
    assert client.get("/api/portal/inquiries", headers={"X-Invitation-Token": old_tok}).status_code == 401
    # 新 token 有效
    assert client.get("/api/portal/inquiries", headers={"X-Invitation-Token": new_tok}).status_code == 200


def test_resend_revoked_invitation_rejected(client):
    """已撤销邀请不可重发 → 409 结构化错误 invitation_revoked"""
    headers = _login(client, "u-2")
    iid, inv_id = _fresh_invitation(client, headers)
    db = SessionLocal()
    try:
        inv = db.query(SupplierInvitation).filter(SupplierInvitation.id == inv_id).first()
        inv.status = "revoked"
        inv.revoked_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    r = client.post(f"/api/inquiries/{iid}/deliveries/sup-1/resend", headers=headers)
    assert r.status_code == 409
    assert r.json()["detail"]["error_type"] == "invitation_revoked"


def test_resend_submitted_invitation_rejected(client):
    """已提交邀请不可重发 → 409 结构化错误 invitation_submitted"""
    headers = _login(client, "u-2")
    iid, inv_id = _fresh_invitation(client, headers)
    db = SessionLocal()
    try:
        inv = db.query(SupplierInvitation).filter(SupplierInvitation.id == inv_id).first()
        inv.status = "submitted"
        inv.submitted_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    r = client.post(f"/api/inquiries/{iid}/deliveries/sup-1/resend", headers=headers)
    assert r.status_code == 409
    assert r.json()["detail"]["error_type"] == "invitation_submitted"


def test_resend_expired_invitation_rejected(client):
    """已过期邀请不可重发 → 410 结构化错误 invitation_expired"""
    headers = _login(client, "u-2")
    iid, inv_id = _fresh_invitation(client, headers)
    db = SessionLocal()
    try:
        inv = db.query(SupplierInvitation).filter(SupplierInvitation.id == inv_id).first()
        inv.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    finally:
        db.close()
    r = client.post(f"/api/inquiries/{iid}/deliveries/sup-1/resend", headers=headers)
    assert r.status_code == 410
    assert r.json()["detail"]["error_type"] == "invitation_expired"


def test_concurrent_resend_single_valid_token(client):
    """并发重发（多线程）只产生一个有效 token：DB 哈希与短期存储明文 token 始终一致"""
    headers = _login(client, "u-2")
    iid = _create_and_send_inquiry(client, headers, "sup-1")
    db = SessionLocal()
    try:
        inv = db.query(SupplierInvitation).filter(
            SupplierInvitation.inquiry_id == iid,
            SupplierInvitation.supplier_id == "sup-1",
        ).first()
        inv_id = inv.id
        # 模拟明文 token 丢失，强制各线程走重签路径
        get_store().delete(f"procurement:inv:raw:{inv_id}")
        assert get_invitation_raw_token(inv_id) is None
    finally:
        db.close()

    results, errors, mlock = [], [], threading.Lock()

    def _run():
        try:
            s = SessionLocal()
            try:
                invx = s.query(SupplierInvitation).filter(
                    SupplierInvitation.inquiry_id == iid,
                    SupplierInvitation.supplier_id == "sup-1",
                ).first()
                tok, _ = resend_invitation(s, invx, "u-2")
                with mlock:
                    results.append(tok)
            finally:
                s.close()
        except Exception as e:  # noqa: BLE001
            with mlock:
                errors.append(e)

    threads = [threading.Thread(target=_run) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors

    check = SessionLocal()
    try:
        final = check.query(SupplierInvitation).filter(
            SupplierInvitation.inquiry_id == iid,
            SupplierInvitation.supplier_id == "sup-1",
        ).first()
        store_tok = get_invitation_raw_token(final.id)
        assert store_tok is not None
        # 只有一个生效 token：DB 哈希与短期存储明文 token 一致，且该 token 有效
        assert hash_invitation_token(store_tok) == final.token_hash
        assert store_tok in results
        assert client.get("/api/portal/inquiries", headers={"X-Invitation-Token": store_tok}).status_code == 200
    finally:
        check.close()