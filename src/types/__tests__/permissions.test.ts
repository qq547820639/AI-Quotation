/**
 * 前端权限矩阵一致性测试（Task5）
 * 固化 src/types/index.ts 中 ROLE_PERMISSIONS 的权限矩阵，防止误改。
 * 与后端 backend/app/auth.py 的 ROLE_PERMISSIONS 保持一致（见 backend/tests/test_permissions.py）。
 */
import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS, type Permission } from '../index';

const ALL_PERMISSIONS: Permission[] = [
  'INQUIRY_CREATE',
  'INQUIRY_EDIT',
  'INQUIRY_SEND',
  'INQUIRY_APPROVE',
  'INQUIRY_CONFIRM',
  'INQUIRY_CANCEL',
  'SUPPLIER_MANAGE',
  'SUPPLIER_DISABLE',
  'MATERIAL_MANAGE',
  'SETTINGS_MANAGE',
  'VIEW_ALL_ORG',
  'VIEW_LOG',
];

describe('ROLE_PERMISSIONS 权限矩阵', () => {
  it('采购人员：拥有创建/编辑/发送/物料管理，不含审批与供应商/设置/日志', () => {
    const perms = ROLE_PERMISSIONS['采购人员'];
    expect(perms).toEqual(
      expect.arrayContaining(['INQUIRY_CREATE', 'INQUIRY_EDIT', 'INQUIRY_SEND', 'MATERIAL_MANAGE']),
    );
    expect(perms).not.toContain('INQUIRY_APPROVE');
    expect(perms).not.toContain('INQUIRY_CONFIRM');
    expect(perms).not.toContain('INQUIRY_CANCEL');
    expect(perms).not.toContain('SUPPLIER_MANAGE');
    expect(perms).not.toContain('SUPPLIER_DISABLE');
    expect(perms).not.toContain('SETTINGS_MANAGE');
    expect(perms).not.toContain('VIEW_ALL_ORG');
    expect(perms).not.toContain('VIEW_LOG');
  });

  it('采购主管：含审批/确认/取消/物料/日志，不含供应商/设置', () => {
    const perms = ROLE_PERMISSIONS['采购主管'];
    expect(perms).toEqual(
      expect.arrayContaining([
        'INQUIRY_CREATE',
        'INQUIRY_EDIT',
        'INQUIRY_SEND',
        'INQUIRY_APPROVE',
        'INQUIRY_CONFIRM',
        'INQUIRY_CANCEL',
        'MATERIAL_MANAGE',
        'VIEW_LOG',
      ]),
    );
    expect(perms).not.toContain('SUPPLIER_MANAGE');
    expect(perms).not.toContain('SUPPLIER_DISABLE');
    expect(perms).not.toContain('SETTINGS_MANAGE');
    expect(perms).not.toContain('VIEW_ALL_ORG');
  });

  it('管理员：拥有全部权限', () => {
    expect(ROLE_PERMISSIONS['管理员']).toEqual(expect.arrayContaining(ALL_PERMISSIONS));
    expect(ROLE_PERMISSIONS['管理员']).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('权限枚举覆盖全部合法权限点', () => {
    const defined = new Set(ALL_PERMISSIONS);
    Object.values(ROLE_PERMISSIONS).forEach((perms) => {
      perms.forEach((p) => expect(defined.has(p)).toBe(true));
    });
  });
});