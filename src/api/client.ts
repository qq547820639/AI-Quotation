/**
 * axios 实例（W7.2 + 可靠性深化）
 * - 幂等/非幂等重试分离：仅 GET/HEAD 及带幂等键的请求自动重试
 * - 统一错误处理：parseApiError → 统一 ApiError，提示走 i18n
 * - 401：清理会话、记录回跳地址、跳转登录
 */
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { message } from 'antd';
import { parseApiError, ERROR_CODES } from './errors';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

export const client = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** 判断请求是否幂等（可安全自动重试） */
function isIdempotentMethod(method: string | undefined): boolean {
  const m = (method || 'get').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/** 判断请求是否携带幂等键（写请求的幂等保护） */
function hasIdempotencyKey(config: unknown): boolean {
  const headers = (config as { headers?: unknown })?.headers;
  if (!headers) return false;
  const h = headers as Record<string, unknown> & { get?: (k: string) => unknown };
  const key = h['Idempotency-Key'] ?? h['idempotency-key'] ?? (typeof h.get === 'function' ? h.get('Idempotency-Key') ?? h.get('idempotency-key') : undefined);
  return typeof key === 'string' && key.length > 0;
}

// 自动重试：仅幂等请求（GET/HEAD）或带幂等键的写请求，对网络错误与 5xx 重试最多 2 次
axiosRetry(client, {
  retries: 2,
  retryCondition: (error) => {
    const safeToRetry = isIdempotentMethod(error.config?.method) || hasIdempotencyKey(error.config);
    if (!safeToRetry) return false;
    if (axiosRetry.isNetworkError(error)) return true;
    const status = error.response?.status;
    return status !== undefined && status >= 500;
  },
  retryDelay: axiosRetry.exponentialDelay,
  shouldResetTimeout: true,
});

// 请求拦截器：注入认证 token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('procurement_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// 401 处理：避免并发 401 重复弹错/重复跳转
let handling401 = false;

async function handleUnauthorized() {
  if (handling401) return;
  handling401 = true;
  try {
    // 清除 token + 用户/权限状态（resetSession 会清 token 与 localStorage）
    const { useAuthStore } = await import('@/store/useAuthStore');
    useAuthStore.getState().resetSession();
    // 保存安全返回地址（不在登录页时）
    const currentPath = window.location.pathname + window.location.search;
    if (!currentPath.startsWith('/login')) {
      localStorage.setItem('redirect_after_login', currentPath);
    }
    // 跳转登录页
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  } finally {
    handling401 = false;
  }
}

// 响应拦截器：统一错误处理
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const apiError = parseApiError(error);

    // 401：完整退出并跳转登录页
    if (apiError.code === ERROR_CODES.UNAUTHORIZED) {
      void handleUnauthorized();
      return Promise.reject(apiError);
    }

    // 其余错误：统一提示（403 明确权限不足，409 数据冲突，网络/超时/服务不可用差异化）
    message.error(apiError.message);
    return Promise.reject(apiError);
  },
);