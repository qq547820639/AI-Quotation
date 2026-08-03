/**
 * 认证 store（W4 RBAC）
 * - 当前登录用户、登录/登出、权限判断
 * - 持久化登录态到 localStorage（key: auth），刷新保持登录
 * - W7.5：login/logout 走 API + 降级，loadFromApi 同步当前用户
 * - users 字段供登录页等使用，避免各页面直接 import mock
 */
import { create } from 'zustand';
import { loadJSON, saveJSON, removeKey } from '@/utils/storage';
import { ROLE_PERMISSIONS, type Permission, type User, type UserRole } from '@/types';
import { currentUser, users, organizations } from '@/mock/users';
import { authApi } from '@/api';

const STORAGE_KEY = 'auth';

interface AuthState {
  currentUser: User;
  isAuthenticated: boolean;
  /** 可登录用户列表（供登录页等使用，避免直接 import mock） */
  users: User[];
  /** 采购组织列表（供 MainLayout 等切换使用，避免直接 import mock） */
  organizations: string[];
  login: (userId: string) => boolean;
  logout: () => void;
  hasPermission: (perm: Permission) => boolean;
  isRole: (role: UserRole | UserRole[]) => boolean;
  /** W7.5：从 API 同步当前用户（失败时降级到本地） */
  loadFromApi: () => Promise<void>;
  /** 演示用：快速切换用户（不经过登录页） */
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

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: loadAuthUser(),
  isAuthenticated: loadAuthenticated(),
  users,
  organizations,

  login: (userId) => {
    const u = users.find((x) => x.id === userId);
    if (!u) return false;
    saveJSON(STORAGE_KEY, { userId });
    set({ currentUser: u, isAuthenticated: true });
    // 异步同步到 API，成功后持久化 token（client.ts 拦截器读 procurement_token）
    authApi
      .login({ userId })
      .then((result) => {
        localStorage.setItem('procurement_token', result.token);
      })
      .catch(() => {
        /* API 不可用时降级到本地 */
      });
    return true;
  },

  logout: () => {
    removeKey(STORAGE_KEY);
    localStorage.removeItem('procurement_token');
    set({ currentUser, isAuthenticated: false });
    authApi.logout().catch(() => {
      /* API 不可用时降级到本地 */
    });
  },

  hasPermission: (perm) => resolvePermissions(get().currentUser).includes(perm),

  isRole: (role) => {
    const r = get().currentUser.role;
    return Array.isArray(role) ? role.includes(r) : r === role;
  },

  // W7.5：从 API 同步当前用户，失败时降级到本地
  loadFromApi: async () => {
    try {
      const user = await authApi.me();
      set({ currentUser: user });
    } catch {
      /* API 不可用时使用本地用户 */
    }
  },

  switchUser: (userId) => {
    const u = users.find((x) => x.id === userId);
    if (u) {
      saveJSON(STORAGE_KEY, { userId });
      set({ currentUser: u, isAuthenticated: true });
    }
  },
}));
