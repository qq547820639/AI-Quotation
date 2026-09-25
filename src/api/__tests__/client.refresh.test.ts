/**
 * Access Token 自动续期（401 → /auth/refresh → 重放）拦截器测试
 * 每条判据各配一组「必须开火 / 必须不开火」对照：
 * - 续期成功：原请求重放、会话保留、不跳登录
 * - 单飞：并发 401 只发一次 refresh
 * - 续期失败（refresh 自身 401）：完整登出，不递归
 * - _retry 守卫：续期后仍 401 不再触发第二次续期
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import { message } from 'antd';

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
import { useAuthStore } from '@/store/useAuthStore';

const originalAdapter = client.defaults.adapter;

interface TrackedCall {
  url: string;
  auth?: string;
}

let calls: TrackedCall[] = [];

/**
 * 单 URL 调用上限：缺失 _retry 守卫时"401→续期→重放→401"是不让出事件循环的
 * 无限微任务链（实测 94% CPU、连测试超时都不触发），夹具必须自行封顶才能读到失败而非挂死。
 */
const MAX_CALLS_PER_URL = 20;

type Script = Record<string, Array<number | { status: number; data?: unknown }>>;

/** 按 url 记录调用次数与请求头，并按 script 依次给出响应（超出末位则重复末位） */
function scriptedAdapter(
  script: Record<string, Array<number | { status: number; data?: unknown }>>,
): AxiosAdapter {
  const counts: Record<string, number> = {};
  return async (config) => {
    const url = config.url ?? '';
    counts[url] = (counts[url] ?? 0) + 1;
    calls.push({ url, auth: (config.headers as Record<string, string>)?.Authorization });
    if (counts[url] > MAX_CALLS_PER_URL) {
      throw Object.assign(new Error(`too many calls to ${url}：疑似无限续期循环`), {
        code: AxiosError.ERR_NETWORK,
        config,
      });
    }

    const steps = script[url] ?? [200];
    const step = steps[Math.min(counts[url], steps.length) - 1];
    const status = typeof step === 'number' ? step : step.status;
    const data = typeof step === 'number' ? { ok: true } : (step.data ?? { ok: true });
    const response: AxiosResponse = {
      data,
      status,
      statusText: status < 400 ? 'OK' : 'Error',
      headers: {},
      config,
    };
    if (status < 400) return response;
    // 与 axios 内部 settle() 对 HTTP 非 2xx 的产出完全一致：AxiosError 携带
    // config / request / response，缺一位则响应拦截器读不到 error.config，续期分支不可达。
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 400 && status < 500 ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
      config,
      {},
      response,
    );
  };
}

function setLocation(pathname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname, search: '', href: pathname },
  });
  return window.location as { pathname: string; href: string };
}

function refreshCallCount() {
  return calls.filter((c) => c.url === '/auth/refresh').length;
}

const REFRESH_OK: Script = { '/auth/refresh': [{ status: 200, data: { token: 'fresh-token' } }] };

beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem('procurement_token', 'stale-token');
  setLocation('/inquiry/list');
  vi.clearAllMocks();
});

afterEach(() => {
  client.defaults.adapter = originalAdapter;
});

describe('401 自动续期：成功路径', () => {
  it('token 过期后换取新 token、更新本地会话并重放原请求，用户不掉线', async () => {
    const loc = setLocation('/inquiry/list');
    const resetSpy = vi.spyOn(useAuthStore.getState(), 'resetSession');
    client.defaults.adapter = scriptedAdapter({ '/secure': [401, 200], ...REFRESH_OK });

    const res = await client.get('/secure');

    expect(res.status).toBe(200);
    // 顺序：过期请求 → 续期 → 用新 token 重放
    expect(calls.map((c) => c.url)).toEqual(['/secure', '/auth/refresh', '/secure']);
    expect(calls[0].auth).toBe('Bearer stale-token');
    expect(calls[2].auth).toBe('Bearer fresh-token');
    expect(localStorage.getItem('procurement_token')).toBe('fresh-token');
    // 不掉线、不清会话、不弹错误提示
    expect(resetSpy).not.toHaveBeenCalled();
    expect(loc.href).toBe('/inquiry/list');
    expect(message.error).not.toHaveBeenCalled();
    expect(localStorage.getItem('redirect_after_login')).toBeNull();
  });

  it('对照：续期成功时不得发出第二个 refresh，也不得回退到登出分支', async () => {
    client.defaults.adapter = scriptedAdapter({ '/secure': [401, 200], ...REFRESH_OK });
    await client.get('/secure');
    expect(refreshCallCount()).toBe(1);
    expect(calls.filter((c) => c.url === '/secure')).toHaveLength(2);
  });
});

describe('401 自动续期：并发单飞', () => {
  it('多个并发请求同时 401 只触发一次 /auth/refresh，全部重放成功', async () => {
    const resetSpy = vi.spyOn(useAuthStore.getState(), 'resetSession');
    client.defaults.adapter = scriptedAdapter({
      '/a': [401, 200],
      '/b': [401, 200],
      '/c': [401, 200],
      ...REFRESH_OK,
    });

    const [a, b, c] = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);

    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(refreshCallCount()).toBe(1);
    // 三个重放请求都带上刷新后的 token
    const replays = calls.filter((call) => call.url !== '/auth/refresh').slice(3);
    expect(replays).toHaveLength(3);
    expect(replays.every((call) => call.auth === 'Bearer fresh-token')).toBe(true);
    expect(resetSpy).not.toHaveBeenCalled();
  });
});

describe('401 自动续期：失败路径', () => {
  it('refresh 自身 401：不递归刷新，执行完整登出并跳转登录页', async () => {
    const loc = setLocation('/inquiry/list');
    const resetSpy = vi.spyOn(useAuthStore.getState(), 'resetSession');
    client.defaults.adapter = scriptedAdapter({ '/secure': [401], '/auth/refresh': [401] });

    await expect(client.get('/secure')).rejects.toThrow();

    expect(refreshCallCount()).toBe(1);
    await vi.waitFor(() => {
      expect(resetSpy).toHaveBeenCalled();
    });
    expect(localStorage.getItem('procurement_token')).toBeNull();
    expect(loc.href).toBe('/login');
    expect(message.error).not.toHaveBeenCalled();
  });

  it('_retry 守卫：续期后原请求仍 401 时不再触发第二次续期，直接登出', async () => {
    const loc = setLocation('/inquiry/list');
    const resetSpy = vi.spyOn(useAuthStore.getState(), 'resetSession');
    client.defaults.adapter = scriptedAdapter({ '/secure': [401, 401], ...REFRESH_OK });

    await expect(client.get('/secure')).rejects.toThrow();

    // 去掉 _retry 守卫会让这里变成无限刷新循环（计数持续增长 / 用例超时）
    expect(refreshCallCount()).toBe(1);
    expect(calls.map((c) => c.url)).toEqual(['/secure', '/auth/refresh', '/secure']);
    await vi.waitFor(() => {
      expect(resetSpy).toHaveBeenCalled();
    });
    expect(loc.href).toBe('/login');
  });
});
