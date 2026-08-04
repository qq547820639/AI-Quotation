/**
 * 认证 store（W4 RBAC + 生产安全深化）
 * - 当前登录用户、登录/登出、权限判断
 * - 持久化登录态到 localStorage（key: auth），刷新保持登录
 * - login 走后端密码认证；演示模式（IS_DEMO_MODE）下后端不可用时降级到本地快捷登录
 * - resetSession：401 时清除会话（token/用户/权限状态），避免残留登录态
 */
import { create } from 'zustand';
import { loadJSON, saveJSON, removeKey } from '@/utils/storage';
import { ROLE_PERMISSIONS, type Permission, type User, type UserRole } from '@/types';
import { currentUser, users, organizations } from '@/mock/users';
import { getAuthAdapter } from '@/services/auth';
import { IS_DEMO_MODE } from '@/config';

const STORAGE_KEY = 'auth';

interface AuthState {
  currentUser: User;
  isAuthenticated: boolean;
  /** 可登录用户列表（供登录页等使用，避免直接 import mock） */
  users: User[];
  /** 采购组织列表（供 MainLayout 等切换使用，避免直接 import mock） */
  organizations: string[];
  login: (userId: string, password?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  /** 401 时完整清除会话（token + 用户/权限状态），不触发后端请求 */
  resetSession: () => void;
  hasPermission: (perm: Permission) => boolean;
  isRole: (role: UserRole | UserRole[]) => boolean;
  /** 从 API 同步当前用户（失败时降级到本地） */
  loadFromApi: () => Promise<void>;
  /** 演示用：快速切换用户（不经过登录页，仅演示模式可用） */
  switchUser: (userId: string) => void;
}

function loadAuthUser(): User {
  const saved = loadJSON<{ userId: string } | null>(STORAGE_KEY, null);
  if (saved?.userId) {
    const u = users.find((x) => x.id === saved.userId);
    if (u) return u;
  }
  return currentUser;
}

function loadAuthenticated(): boolean {
  return loadJSON<{ userId: string } | null>(STORAGE_KEY, null) !== null;
}

function resolvePermissions(user: User): Permission[] {
  return user.permissions ?? ROLE_PERMISSIONS[user.role] ?? [];
}

function clearSessionLocally() {
  removeKey(STORAGE_KEY);
  localStorage.removeItem('procurement_token');
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: loadAuthUser(),
  isAuthenticated: loadAuthenticated(),
  users,
  organizations,

  login: async (userId, password) => {
    // 优先通过后端认证（生产模式必须成功；演示模式可降级）
    try {
      const result = await getAuthAdapter().login({ userId, password });
      clearSessionLocally();
      saveJSON(STORAGE_KEY, { userId });
      localStorage.setItem('procurement_token', result.token);
      set({ currentUser: result.user, isAuthenticated: true });
      return true;
    } catch {
      // 演示模式：后端不可用时降级到本地快捷登录
      if (!IS_DEMO_MODE) return false;
      const u = users.find((x) => x.id === userId);
      if (!u) return false;
      clearSessionLocally();
      saveJSON(STORAGE_KEY, { userId });
      set({ currentUser: u, isAuthenticated: true });
      return true;
    }
  },

  logout: async () => {
    // 先撤销服务端会话（此时本地仍持有有效 Bearer token，后端请求拦截器才能注入），
    // 成功后再清本地 token 与用户态，避免"先清本地导致服务端会话无法撤销"。
    try {
      await getAuthAdapter().logout();
    } catch {
      /* 服务端撤销失败（网络异常等）不阻塞本地登出 */
    } finally {
      clearSessionLocally();
      set({ currentUser, isAuthenticated: false });
    }
  },

  resetSession: () => {
    clearSessionLocally();
    set({ currentUser, isAuthenticated: false });
  },

  hasPermission: (perm) => resolvePermissions(get().currentUser).includes(perm),

  isRole: (role) => {
    const r = get().currentUser.role;
    return Array.isArray(role) ? role.includes(r) : r === role;
  },

  // 从 API 同步当前用户，失败时降级到本地
  loadFromApi: async () => {
    try {
      const user = await getAuthAdapter().me();
      set({ currentUser: user });
    } catch {
      /* API 不可用时使用本地用户 */
    }
  },

  switchUser: (userId) => {
    // 快捷切换仅演示模式可用
    if (!IS_DEMO_MODE) return;
    const u = users.find((x) => x.id === userId);
    if (u) {
      saveJSON(STORAGE_KEY, { userId });
      set({ currentUser: u, isAuthenticated: true });
    }
  },
}));
