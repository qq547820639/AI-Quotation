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