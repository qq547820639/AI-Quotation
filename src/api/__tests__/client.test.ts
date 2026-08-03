/**
 * axios client 拦截器测试（阶段 H）
 * - 请求拦截器：注入 Authorization
 * - 响应拦截器：401/403/5xx/网络异常 的错误提示与 token 清理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

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

/** 构造一个自定义 adapter：抛出网络错误（无 response，有 request） */
function networkErrorAdapter(): AxiosAdapter {
  return async () => {
    throw Object.assign(new Error('Network Error'), { request: {} });
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

describe('client 响应拦截器', () => {
  it('401 响应：提示登录过期并清除 token', async () => {
    localStorage.setItem('procurement_token', 'to-be-cleared');
    client.defaults.adapter = errorAdapter(401, { message: '未授权' });
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith('登录已过期，请重新登录');
    expect(localStorage.getItem('procurement_token')).toBeNull();
  });

  it('403 响应：提示无权限', async () => {
    client.defaults.adapter = errorAdapter(403, { message: '禁止访问' });
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith('无权限访问');
  });

  it('500 响应：提示 [status] msg', async () => {
    client.defaults.adapter = errorAdapter(500, { message: '服务器内部错误' });
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith('[500] 服务器内部错误');
  });

  it('500 响应无 data.message 时回退到「请求失败」', async () => {
    client.defaults.adapter = errorAdapter(500);
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith('[500] 请求失败');
  });

  it('网络错误（无 response）：提示网络异常', async () => {
    client.defaults.adapter = networkErrorAdapter();
    await expect(client.get('/secure')).rejects.toThrow();
    expect(message.error).toHaveBeenCalledWith('网络异常，请检查网络连接');
  });
});
