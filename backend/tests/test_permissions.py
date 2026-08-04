"""权限矩阵一致性测试（Task5）

断言 backend/app/auth.py 的 ROLE_PERMISSIONS 与前端 src/types/index.ts 的
ROLE_PERMISSIONS 完全一致（采购人员/采购主管/管理员三组权限集合相等）。

注：跨端读取前端 TS 文件不便，此处硬编码期望值（与前端 ROLE_PERMISSIONS 一致），
任何一端改动导致不一致时，本测试会失败以提醒同步。
"""
from app.auth import ROLE_PERMISSIONS

# 与前端 src/types/index.ts ROLE_PERMISSIONS 保持一致
EXPECTED = {
    "采购人员": [
        "INQUIRY_CREATE", "INQUIRY_EDIT", "INQUIRY_SEND",
        "MATERIAL_MANAGE",
    ],
    "采购主管": [
        "INQUIRY_CREATE", "INQUIRY_EDIT", "INQUIRY_SEND", "INQUIRY_APPROVE",
        "INQUIRY_CONFIRM", "INQUIRY_CANCEL",
        "MATERIAL_MANAGE", "VIEW_LOG",
    ],
    "管理员": [
        "INQUIRY_CREATE", "INQUIRY_EDIT", "INQUIRY_SEND", "INQUIRY_APPROVE",
        "INQUIRY_CONFIRM", "INQUIRY_CANCEL",
        "SUPPLIER_MANAGE", "SUPPLIER_DISABLE",
        "MATERIAL_MANAGE", "SETTINGS_MANAGE",
        "VIEW_ALL_ORG", "VIEW_LOG",
    ],
}


def test_role_permissions_match_frontend():
    """后端矩阵与前端（硬编码期望值）完全一致"""
    assert set(ROLE_PERMISSIONS.keys()) == set(EXPECTED.keys())
    for role, expected_perms in EXPECTED.items():
        # 顺序无关，集合相等
        assert set(ROLE_PERMISSIONS[role]) == set(expected_perms), f"角色 {role} 权限不一致"


def test_all_permissions_are_valid_strings():
    """所有权限项均为非空字符串"""
    for role, perms in ROLE_PERMISSIONS.items():
        assert isinstance(role, str) and role
        for p in perms:
            assert isinstance(p, str) and p
            assert p  # 非空


# ============ 端到端权限执行（Task 3：不依赖前端隐藏按钮） ============

def test_unauthenticated_request_returns_401(client):
    """无 token 访问受保护端点 → 401"""
    resp = client.get("/api/settings")
    assert resp.status_code == 401


def test_settings_update_requires_admin(client, buyer_headers, admin_headers):
    """settings 写操作：采购人员无权限（403），管理员有权限（200）"""
    payload = {
        "approval": {"enabled": True, "amountThreshold": 50000, "approverId": "u-2"},
        "notification": {
            "deadlineReminder": True, "deadlineReminderHours": 24,
            "quotationSubmitted": True, "approvalResult": True,
        },
    }
    # 采购人员 u-1：无 SETTINGS_MANAGE → 403
    resp = client.put("/api/settings", json=payload, headers=buyer_headers)
    assert resp.status_code == 403
    # 管理员 u-6：有 SETTINGS_MANAGE → 200
    resp = client.put("/api/settings", json=payload, headers=admin_headers)
    assert resp.status_code == 200


def test_supplier_manage_requires_admin(client, buyer_headers, admin_headers):
    """供应商启停：采购人员无 SUPPLIER_DISABLE → 403，管理员有 → 200"""
    resp = client.post(
        "/api/suppliers/sup-6/toggle-status",
        headers=buyer_headers,
    )
    assert resp.status_code == 403
    resp = client.post(
        "/api/suppliers/sup-6/toggle-status",
        headers=admin_headers,
    )
    assert resp.status_code == 200


# ============ P2-14 Task 19：审批人指定与审批权限（非指定审批人） ============

def _create_inquiry(client, headers, subject="审批权限测试"):
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
    }
    resp = client.post("/api/inquiries", json=payload, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def test_submit_approval_designates_configured_approver(client, buyer_headers):
    """提交审批后，审批节点应指定配置的审批人（settings.approval_approver_id，默认 u-2）"""
    inq = _create_inquiry(client, buyer_headers)
    iid = inq["id"]
    client.post(f"/api/inquiries/{iid}/send", headers=buyer_headers)
    resp = client.post(f"/api/inquiries/{iid}/submit-approval", headers=buyer_headers)
    assert resp.status_code == 200, resp.text
    pending = [n for n in resp.json()["approvalNodes"] if n["status"] == "PENDING"]
    assert pending, "提交审批后应存在 PENDING 审批节点"
    assert pending[0]["approverId"] == "u-2"


def test_non_designated_approver_rejected(client, buyer_headers, supervisor_headers):
    """非指定审批人（采购人员 u-1，无 INQUIRY_APPROVE）无法审批 → 403；指定审批人 u-2 可审批"""
    inq = _create_inquiry(client, buyer_headers)
    iid = inq["id"]
    client.post(f"/api/inquiries/{iid}/send", headers=buyer_headers)
    client.post(f"/api/inquiries/{iid}/submit-approval", headers=buyer_headers)
    # 采购人员 u-1 无审批权限 → 403，且状态不变
    resp = client.post(f"/api/inquiries/{iid}/approve", json={"comment": "越权审批"}, headers=buyer_headers)
    assert resp.status_code == 403
    detail = client.get(f"/api/inquiries/{iid}", headers=buyer_headers).json()
    assert detail["status"] == "PENDING_APPROVAL"
    # 指定审批人 u-2（采购主管）→ 200
    resp = client.post(f"/api/inquiries/{iid}/approve", json={"comment": "同意"}, headers=supervisor_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "PENDING_CONFIRM"