/**
 * 认证服务入口（Task5）
 * 模块级 authAdapter 实例 + 可替换 setter（不引入 DI 框架）。
 * 默认使用 demoAdapter；正式接入时可调用 setAuthAdapter 替换。
 */
import { demoAuthAdapter } from './demoAdapter';
import type { AuthAdapter } from './types';

let authAdapter: AuthAdapter = demoAuthAdapter;

export function getAuthAdapter(): AuthAdapter {
  return authAdapter;
}

export function setAuthAdapter(adapter: AuthAdapter): void {
  authAdapter = adapter;
}

export { demoAuthAdapter } from './demoAdapter';
export type { AuthAdapter } from './types';