import type { User } from '@/types';

/**
 * 认证服务接口（Task5）
 * 用于解耦"演示认证"（demoAdapter）与"正式认证"（后续接入时替换）
 * 只定义接口 + 一个 demo 实现，不引入 DI 框架。
 */
export interface AuthAdapter {
  login(credentials: { userId: string; password?: string }): Promise<{ token: string; user: User }>;
  logout(): Promise<void>;
  me(): Promise<User>;
  /** 预留：token 刷新（正式接入用） */
  refreshToken?(): Promise<{ token: string }>;
  /** 预留：会话撤销（正式接入用） */
  revokeSession?(): Promise<void>;
  /** 预留：SSO 登录（正式接入用） */
  loginWithSSO?(provider: string): Promise<{ token: string; user: User }>;
}