/**
 * 认证 API（W7.2）
 * W7.5：login 参数统一为 { userId }，与 useAuthStore 一致
 */
import { client } from './client';
import type { User } from '@/types';

export interface LoginParams {
  userId: string;
  password?: string;
}

export interface LoginResult {
  user: User;
  token: string;
}

export interface RefreshResult {
  user: User;
  token: string;
}

export const authApi = {
  login: (params: LoginParams) =>
    client.post<LoginResult>('/auth/login', params).then((r) => r.data),
  // 刷新 Access Token：依赖 HttpOnly Cookie 中的 refresh_token，需携带凭据（SameSite=Lax 同源）
  refresh: () =>
    client
      .post<RefreshResult>('/auth/refresh', null, { withCredentials: true })
      .then((r) => r.data),
  logout: () => client.post('/auth/logout').then((r) => r.data),
  me: () => client.get<User>('/auth/me').then((r) => r.data),
};
