/**
 * useEventStream hook 测试（P2 Task 20）
 * - fetch + eventsource-parser：带 Bearer 认证订阅 /api/events/stream
 * - 断线重连成功后触发补拉（onReconnect 回调 / 默认补拉通知）
 * - 收到事件后回调分发
 * - 指数退避重连
 * - 卸载时中断连接
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventStream, type SSEEvent } from '../useEventStream';
import { useNotificationStore } from '@/store/useNotificationStore';

const encoder = new TextEncoder();

interface FakeConnection {
  url: string;
  init: RequestInit;
  /** 让 fetch 以给定状态码 resolve；status >= 400 时 hook 视为连接失败并重连 */
  respond: (status?: number) => Promise<void>;
  /** 让 fetch 以网络异常 reject */
  reject: () => Promise<void>;
  /** 推入一段 SSE 原始文本（可分片，模拟真实流式到达） */
  push: (chunk: string) => Promise<void>;
  /** 服务端正常结束本次流（触发重连） */
  end: () => Promise<void>;
  /** 连接中途被切断（读流抛错，触发重连） */
  drop: () => Promise<void>;
  signal: AbortSignal;
}

let connections: FakeConnection[] = [];

/** 让 hook 内部的 await 链走完：每次 connect/read 会串起多个微任务 */
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** 推进退避计时器并把期间产生的微任务跑完 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  });
}

beforeEach(() => {
  connections = [];
  localStorage.removeItem('procurement_token');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, rejectOuter) => {
          let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              streamController = c;
            },
          });
          const respond = async (status = 200) => {
            resolve({
              ok: status >= 200 && status < 300,
              status,
              body,
            } as Response);
            await flush();
          };
          connections.push({
            url,
            init,
            respond,
            reject: async () => {
              rejectOuter(new Error('network down'));
              await flush();
            },
            push: async (chunk) => {
              streamController?.enqueue(encoder.encode(chunk));
              await flush();
            },
            end: async () => {
              streamController?.close();
              await flush();
            },
            drop: async () => {
              streamController?.error(new Error('connection reset'));
              await flush();
            },
            signal: init.signal as AbortSignal,
          });
        }),
    ),
  );
  vi.spyOn(useNotificationStore.getState(), 'loadFromApi').mockResolvedValue();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function authOf(conn: FakeConnection): string | undefined {
  const headers = conn.init.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

describe('useEventStream', () => {
  it('以 Bearer 认证头订阅事件流', async () => {
    localStorage.setItem('procurement_token', 'sse-token');
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    expect(connections).toHaveLength(1);
    expect(connections[0].url).toContain('/events/stream');
    expect(authOf(connections[0])).toBe('Bearer sse-token');
    expect(connections[0].init.headers).toMatchObject({ Accept: 'text/event-stream' });
  });

  it('未登录时不发送 Authorization 头', async () => {
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    expect(authOf(connections[0])).toBeUndefined();
  });

  it('连接后收到 message 事件回调分发，无 type 的帧（connected）不分发', async () => {
    const onEvent = vi.fn();
    renderHook(() => useEventStream(onEvent, true));
    await flush();
    const payload: SSEEvent = { type: 'notification', data: { id: 'n1' } };
    await connections[0].respond();
    await connections[0].push('event: connected\ndata: {"status":"ok"}\n\n');
    expect(onEvent).not.toHaveBeenCalled();
    await connections[0].push(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it('跨分片的 data 会被解析为同一个事件', async () => {
    const onEvent = vi.fn();
    renderHook(() => useEventStream(onEvent, true));
    await flush();
    await connections[0].respond();
    const payload: SSEEvent = { type: 'quotation_submitted', data: { inquiryId: 'i1' } };
    const raw = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    await connections[0].push(raw.slice(0, 20));
    expect(onEvent).not.toHaveBeenCalled();
    await connections[0].push(raw.slice(20));
    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it('断线重连成功后执行 onReconnect 补拉回调', async () => {
    const onReconnect = vi.fn();
    renderHook(() => useEventStream(() => {}, true, onReconnect));
    await flush();
    // 首次连接成功属于初始连接，不触发补拉
    await connections[0].respond();
    expect(connections[0].signal.aborted).toBe(false);
    expect(onReconnect).not.toHaveBeenCalled();
    // 服务端断开 → 退避后重连产生第二条连接
    await connections[0].end();
    await tick(2000);
    expect(connections).toHaveLength(2);
    await connections[1].respond();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('未提供 onReconnect 时默认补拉通知列表', async () => {
    const loadSpy = vi.spyOn(useNotificationStore.getState(), 'loadFromApi').mockResolvedValue();
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].respond();
    await connections[0].end();
    await tick(2000);
    await connections[1].respond();
    expect(loadSpy).toHaveBeenCalled();
  });

  it('连续失败时按指数退避重连（2s → 4s）', async () => {
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].reject();
    expect(connections).toHaveLength(1);
    await tick(1999);
    expect(connections).toHaveLength(1);
    await tick(1);
    expect(connections).toHaveLength(2);
    // 未成功连接则继续翻倍：第二次等待 4s
    await connections[1].reject();
    await tick(3999);
    expect(connections).toHaveLength(2);
    await tick(1);
    expect(connections).toHaveLength(3);
  });

  it('fetch 本身失败时同样退避重连', async () => {
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].reject();
    expect(connections).toHaveLength(1);
    await tick(2000);
    expect(connections).toHaveLength(2);
  });

  it('已建立的流中途报错时重连', async () => {
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].respond();
    await connections[0].drop();
    await tick(2000);
    expect(connections).toHaveLength(2);
  });

  it('重连成功一次后退避计时回到初始值', async () => {
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].respond();
    await connections[0].end();
    await tick(2000);
    await connections[1].respond();
    await connections[1].end();
    await tick(2000);
    expect(connections).toHaveLength(3);
  });

  it('401 后重连会带上新换出的 token', async () => {
    localStorage.setItem('procurement_token', 'stale');
    renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].respond(401);
    expect(connections).toHaveLength(1);
    localStorage.setItem('procurement_token', 'fresh');
    await tick(2000);
    expect(connections).toHaveLength(2);
    expect(authOf(connections[1])).toBe('Bearer fresh');
  });

  it('enabled=false 时不建立连接', () => {
    renderHook(() => useEventStream(() => {}, false));
    expect(connections).toHaveLength(0);
  });

  it('卸载时中断连接并停止重连', async () => {
    const { unmount } = renderHook(() => useEventStream(() => {}, true));
    await flush();
    await connections[0].respond();
    expect(connections[0].signal.aborted).toBe(false);
    unmount();
    expect(connections[0].signal.aborted).toBe(true);
    await tick(60000);
    expect(connections).toHaveLength(1);
  });
});
