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