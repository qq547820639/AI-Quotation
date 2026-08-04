/**
 * useAuthStore 测试（阶段 H + 生产安全深化）
 * 覆盖登录/登出/权限判断/角色判断/401 会话重置
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../useAuthStore';
import { currentUser, adminUser, supervisorUser } from '@/mock/users';

// mock 认证适配器，避免真实网络请求
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockMe = vi.fn();

vi.mock('@/services/auth', () => ({
  getAuthAdapter: () => ({
    login: mockLogin,
    logout: mockLogout,
    me: mockMe,
  }),
}));

// 测试环境默认演示模式开启（便于快捷登录用例）；可动态切换以覆盖生产失败路径
const configMock = vi.hoisted(() => ({ IS_DEMO_MODE: true }));
vi.mock('@/config', () => configMock);

beforeEach(() => {
  localStorage.clear();
  mockLogin.mockReset();
  mockLogout.mockReset();
  mockMe.mockReset();
  // 默认：后端登录成功，返回真实用户
  mockLogin.mockResolvedValue({ token: 'fake-token', user: adminUser });
  mockLogout.mockResolvedValue(undefined);
  mockMe.mockResolvedValue(adminUser);
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
    it('登录成功：调用后端并设置 currentUser、isAuthenticated=true、持久化 token', async () => {
      const ok = await useAuthStore.getState().login('u-6', '123456');
      expect(ok).toBe(true);
      expect(mockLogin).toHaveBeenCalledWith({ userId: 'u-6', password: '123456' });
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().currentUser.id).toBe('u-6');
      expect(localStorage.getItem('procurement_token')).toBe('fake-token');
    });

    it('后端登录失败且非演示模式：返回 false 且不改变认证态', async () => {
      vi.mocked(mockLogin).mockRejectedValue(new Error('unauthorized'));
      configMock.IS_DEMO_MODE = false;
      const ok = await useAuthStore.getState().login('u-6', 'wrong');
      expect(ok).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      configMock.IS_DEMO_MODE = true;
    });

    it('演示模式后端不可用时降级到本地快捷登录', async () => {
      mockLogin.mockRejectedValue(new Error('network'));
      const ok = await useAuthStore.getState().login('u-2');
      expect(ok).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().currentUser.id).toBe('u-2');
    });

    it('演示模式降级：未知 userId 返回 false 且不改变认证态', async () => {
      mockLogin.mockRejectedValue(new Error('network'));
      const ok = await useAuthStore.getState().login('not-exist');
      expect(ok).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('登出：清空 isAuthenticated，currentUser 回到默认，并调用后端', async () => {
      await useAuthStore.getState().login('u-6');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().currentUser.id).toBe(currentUser.id);
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  describe('resetSession（401）', () => {
    it('401 时清除会话与 token，不触发后端请求', async () => {
      await useAuthStore.getState().login('u-6');
      localStorage.setItem('procurement_token', 'fake-token');
      useAuthStore.getState().resetSession();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().currentUser.id).toBe(currentUser.id);
      expect(localStorage.getItem('procurement_token')).toBeNull();
      expect(mockLogout).not.toHaveBeenCalled();
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

    it('采购主管有 INQUIRY_APPROVE 权限', () => {
      useAuthStore.setState({ currentUser: supervisorUser });
      expect(useAuthStore.getState().hasPermission('INQUIRY_APPROVE')).toBe(true);
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
  });

  describe('switchUser（演示模式）', () => {
    it('切换用户后 currentUser 与 isAuthenticated 更新', () => {
      // 测试环境 IS_DEMO_MODE=true
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