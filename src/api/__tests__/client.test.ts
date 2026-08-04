/**
 * axios client 拦截器 + 重试策略测试（可靠性深化）
 * - 幂等/非幂等重试分离
 * - 统一错误对象解析（401/403/409/422/网络/超时/业务码）
 * - 401 记录回跳地址
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import i18n from '@/i18n';
import { parseApiError, ApiError, ERROR_CODES } from '../errors';

// mock antd message，避免真实 DOM 渲染并便于断言
vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

import { client } from '../client';
import { message } from 'antd';

/** 保存原始 adapter，避免污染其它测试 */
const originalAdapter = client.defaults.adapter;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  client.defaults.adapter = originalAdapter;
});

/** 构造一个自定义 adapter：返回成功响应 */
function successAdapter(capture?: (config: InternalAxiosRequestConfig) => void): AxiosAdapter {
  return async (config) => {
    if (capture) capture(config);
    const response: AxiosResponse = {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
    return response;
  };
}

/** 构造一个自定义 adapter：抛出带 response 的错误 */
function errorAdapter(status: number, data: Record<string, unknown> = {}): AxiosAdapter {
  return async (config) => {
    throw Object.assign(new Error(`HTTP ${status}`), {
      response: { status, data, statusText: '', headers: {}, config },
    });
  };
}

/** 构造一个自定义 adapter：抛出网络错误（有 request，无 response） */
function networkErrorAdapter(): AxiosAdapter {
  return async () => {
    throw Object.assign(new Error('Network Error'), { request: {} });
  };
}

/** 构造一个自定义 adapter：抛出超时错误 */
function timeoutAdapter(): AxiosAdapter {
  return async () => {
    throw Object.assign(new Error('timeout of 1000ms exceeded'), {
      code: 'ECONNABORTED',
    });
  };
}

describe('client 请求拦截器', () => {
  it('存在 procurement_token 时注入 Authorization 头', async () => {
    localStorage.setItem('procurement_token', 'test-token-123');
    let captured: InternalAxiosRequestConfig | undefined;
    client.defaults.adapter = successAdapter((c) => {
      captured = c;
    });
    await client.get('/ping');
    expect(captured!.headers.Authorization).toBe('Bearer test-token-123');
  });

  it('不存在 token 时不注入 Authorization 头', async () => {
    let captured: InternalAxiosRequestConfig | undefined;
    client.defaults.adapter = successAdapter((c) => {
      captured = c;
    });
    await client.get('/ping');
    expect(captured!.headers.Authorization).toBeUndefined();
  });
});

describe('重试策略：非幂等请求不自动重试', () => {
  it('POST 5xx 不重复发送（仅一次）', async () => {
    let count = 0;
    client.defaults.adapter = errorAdapter(500, { message: '服务器内部错误' });
    // 拦截器不会重试，但需验证 adapter 调用次数
    const orig = client.defaults.adapter;
    client.defaults.adapter = async (config) => {
      count += 1;
      throw Object.assign(new Error('HTTP 500'), {
        response: { status: 500, data: { message: '服务器内部错误' }, statusText: '', headers: {}, config },
      });
    };
    await expect(client.post('/submit', {})).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBe(1);
    client.defaults.adapter = orig;
  });
});

describe('parseApiError 统一错误解析', () => {
  it('401 → UNAUTHORIZED，文案国际化', () => {
    const err = parseApiError(Object.assign(new Error('401'), {
      response: { status: 401, data: {}, statusText: '', headers: {}, config: {} },
    }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(err.message).toBe(i18n.t('errors.unauthorized'));
    expect(err.retryable).toBe(false);
  });

  it('403 → FORBIDDEN', () => {
    const err = parseApiError(Object.assign(new Error('403'), {
      response: { status: 403, data: {}, statusText: '', headers: {}, config: {} },
    }));
    expect(err.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(err.message).toBe(i18n.t('errors.forbidden'));
  });

  it('409 → CONFLICT，提示数据冲突', () => {
    const err = parseApiError(Object.assign(new Error('409'), {
      response: { status: 409, data: {}, statusText: '', headers: {}, config: {} },
    }));
    expect(err.code).toBe(ERROR_CODES.CONFLICT);
    expect(err.message).toBe(i18n.t('errors.conflict'));
  });

  it('422 → VALIDATION，携带 fieldErrors', () => {
    const err = parseApiError(Object.assign(new Error('422'), {
      response: { status: 422, data: { fieldErrors: { name: '必填' } }, statusText: '', headers: {}, config: {} },
    }));
    expect(err.code).toBe(ERROR_CODES.VALIDATION);
    expect(err.fieldErrors).toEqual({ name: '必填' });
  });

  it('业务错误码 → 映射为 i18n 文案', () => {
    const err = parseApiError(Object.assign(new Error('409'), {
      response: { status: 409, data: { code: 'duplicate_code' }, statusText: '', headers: {}, config: {} },
    }));
    expect(err.message).toBe(i18n.t('errors.duplicateCode'));
  });

  it('5xx → retryable=true', () => {
    const err = parseApiError(Object.assign(new Error('500'), {
      response: { status: 500, data: { message: '服务器内部错误' }, statusText: '', headers: {}, config: {} },
    }));
    expect(err.retryable).toBe(true);
  });

  it('网络错误 → NETWORK_ERROR，retryable=true', () => {
    const err = parseApiError(Object.assign(new Error('Network Error'), { request: {} }));
    expect(err.code).toBe(ERROR_CODES.NETWORK);
    expect(err.message).toBe(i18n.t('errors.networkError'));
    expect(err.retryable).toBe(true);
  });

  it('超时 → TIMEOUT', () => {
    const err = parseApiError(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    expect(err.code).toBe(ERROR_CODES.TIMEOUT);
    expect(err.message).toBe(i18n.t('errors.timeout'));
  });
});

describe('client 响应拦截器', () => {
  /** 设置 window.location 的 pathname/search（jsdom 下可写） */
  function setLocation(pathname: string, search = '') {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname, search, href: pathname + search },
    });
  }

  it('401 响应：清除 token 并记录回跳地址', async () => {
    localStorage.setItem('procurement_token', 'to-be-cleared');
    setLocation('/inquiry/list');
    client.defaults.adapter = errorAdapter(401, { message: '未授权' });
    await expect(client.get('/secure')).rejects.toThrow();
    expect(localStorage.getItem('procurement_token')).toBeNull();
    expect(localStorage.getItem('redirect_after_login')).toBe('/inquiry/list');
  });

  it('401 在登录页时不记录回跳地址', async () => {
    setLocation('/login');
    client.defaults.adapter = errorAdapter(401, { message: '未授权' });
    await expect(client.get('/secure')).rejects.toThrow();
    expect(localStorage.getItem('redirect_after_login')).toBeNull();
  });

  it('403 响应：提示权限不足（国际化文案）', async () => {
    client.defaults.adapter = errorAdapter(403, { message: '禁止访问' });
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith(i18n.t('errors.forbidden'));
  });

  it('网络错误：提示网络异常（国际化文案）', async () => {
    client.defaults.adapter = networkErrorAdapter();
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith(i18n.t('errors.networkError'));
  });

  it('超时：提示请求超时（国际化文案）', async () => {
    client.defaults.adapter = timeoutAdapter();
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith(i18n.t('errors.timeout'));
  });
});