/**
 * useAuthStore 测试（阶段 H）
 * 覆盖登录/登出/权限判断/角色判断
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../useAuthStore';
import { currentUser, adminUser, supervisorUser } from '@/mock/users';

// mock API 层，避免真实网络请求
vi.mock('@/api', () => ({
  authApi: {
    login: vi.fn().mockResolvedValue({ token: 'fake-token', user: {} }),
    logout: vi.fn().mockResolvedValue({}),
    me: vi.fn().mockResolvedValue({}),
  },
}));

beforeEach(() => {
  localStorage.clear();
  // 重置为未登录态（默认用户为 mock currentUser）
  useAuthStore.setState({
    currentUser,
    isAuthenticated: false,
  });
});

describe('useAuthStore', () => {
  describe('初始状态', () => {
    it('未登录：isAuthenticated 为 false', () => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('有默认当前用户', () => {
      expect(useAuthStore.getState().currentUser).toBeDefined();
      expect(useAuthStore.getState().currentUser.id).toBe(currentUser.id);
    });

    it('users 列表非空', () => {
      expect(useAuthStore.getState().users.length).toBeGreaterThan(0);
    });

    it('organizations 列表非空', () => {
      expect(useAuthStore.getState().organizations.length).toBeGreaterThan(0);
    });
  });

  describe('login', () => {
    it('登录成功：设置 currentUser、isAuthenticated=true', () => {
      const ok = useAuthStore.getState().login('u-6');
      expect(ok).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().currentUser.id).toBe('u-6');
      expect(useAuthStore.getState().currentUser.name).toBe('周大海');
      expect(useAuthStore.getState().currentUser.role).toBe('管理员');
    });

    it('登录采购主管', () => {
      const ok = useAuthStore.getState().login('u-2');
      expect(ok).toBe(true);
      expect(useAuthStore.getState().currentUser.id).toBe('u-2');
      expect(useAuthStore.getState().currentUser.role).toBe('采购主管');
    });

    it('登录失败：未知 userId 返回 false 且不改变认证态', () => {
      const ok = useAuthStore.getState().login('not-exist');
      expect(ok).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('登出：清空 isAuthenticated，currentUser 回到默认', () => {
      useAuthStore.getState().login('u-6');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().currentUser.id).toBe(currentUser.id);
    });
  });

  describe('hasPermission', () => {
    it('管理员拥有 SETTINGS_MANAGE 权限', () => {
      useAuthStore.setState({ currentUser: adminUser });
      expect(useAuthStore.getState().hasPermission('SETTINGS_MANAGE')).toBe(true);
    });

    it('采购人员没有 SETTINGS_MANAGE 权限', () => {
      useAuthStore.setState({ currentUser });
      expect(useAuthStore.getState().hasPermission('SETTINGS_MANAGE')).toBe(false);
    });

    it('采购人员有 INQUIRY_CREATE 权限', () => {
      useAuthStore.setState({ currentUser });
      expect(useAuthStore.getState().hasPermission('INQUIRY_CREATE')).toBe(true);
    });

    it('采购主管有 INQUIRY_APPROVE 权限', () => {
      useAuthStore.setState({ currentUser: supervisorUser });
      expect(useAuthStore.getState().hasPermission('INQUIRY_APPROVE')).toBe(true);
    });

    it('采购人员没有 INQUIRY_APPROVE 权限', () => {
      useAuthStore.setState({ currentUser });
      expect(useAuthStore.getState().hasPermission('INQUIRY_APPROVE')).toBe(false);
    });

    it('管理员有 VIEW_ALL_ORG 权限，采购主管没有', () => {
      useAuthStore.setState({ currentUser: adminUser });
      expect(useAuthStore.getState().hasPermission('VIEW_ALL_ORG')).toBe(true);
      useAuthStore.setState({ currentUser: supervisorUser });
      expect(useAuthStore.getState().hasPermission('VIEW_ALL_ORG')).toBe(false);
    });
  });

  describe('isRole', () => {
    it('管理员匹配单角色', () => {
      useAuthStore.setState({ currentUser: adminUser });
      expect(useAuthStore.getState().isRole('管理员')).toBe(true);
    });

    it('管理员匹配多角色数组', () => {
      useAuthStore.setState({ currentUser: adminUser });
      expect(useAuthStore.getState().isRole(['采购人员', '管理员'])).toBe(true);
    });

    it('采购人员不匹配管理员', () => {
      useAuthStore.setState({ currentUser });
      expect(useAuthStore.getState().isRole('管理员')).toBe(false);
    });

    it('采购人员匹配多角色数组中的采购人员', () => {
      useAuthStore.setState({ currentUser });
      expect(useAuthStore.getState().isRole(['采购主管', '采购人员'])).toBe(true);
    });
  });

  describe('switchUser', () => {
    it('切换用户后 currentUser 与 isAuthenticated 更新', () => {
      useAuthStore.getState().switchUser('u-2');
      expect(useAuthStore.getState().currentUser.id).toBe('u-2');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('切换到未知用户不改变状态', () => {
      const before = useAuthStore.getState().currentUser.id;
      useAuthStore.getState().switchUser('not-exist');
      expect(useAuthStore.getState().currentUser.id).toBe(before);
    });
  });
});
