/**
 * 演示认证适配器（Task5）
 * 复用现有 authApi（login/logout/me），行为与旧 useAuthStore 一致。
 * 其余预留方法（refreshToken/revokeSession/loginWithSSO）留空实现，供正式接入时替换。
 */
import { authApi } from '@/api';
import type { AuthAdapter } from './types';

export const demoAuthAdapter: AuthAdapter = {
  login: (credentials) => authApi.login(credentials),
  logout: () => authApi.logout().then(() => undefined),
  me: () => authApi.me(),
  refreshToken: () => Promise.reject(new Error('Not implemented (reserved for real auth)')),
  revokeSession: () => Promise.reject(new Error('Not implemented (reserved for real auth)')),
  loginWithSSO: () => Promise.reject(new Error('Not implemented (reserved for real auth)')),
};