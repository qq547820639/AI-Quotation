/**
 * useEventStream hook 测试（P2 Task 20）
 * - 断线重连成功后触发补拉（onReconnect 回调 / 默认补拉通知）
 * - 收到事件后回调分发
 * - 指数退避重连
 * - 卸载时断开
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventStream, type SSEEvent } from '../useEventStream';
import { useNotificationStore } from '@/store/useNotificationStore';

/** 捕获的 EventSource 实例 */
let instances: MockEventSource[] = [];

class MockEventSource {
  url: string;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(cb);
  }
  dispatch(type: string, data: string) {
    const ev = { data } as MessageEvent;
    (this.listeners[type] ?? []).forEach((cb) => cb(ev));
    if (type === 'message' && this.onmessage) this.onmessage(ev);
  }
  emitOpen() {
    this.onopen?.(new Event('open'));
  }
  emitError() {
    this.onerror?.(new Event('error'));
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.spyOn(useNotificationStore.getState(), 'loadFromApi').mockResolvedValue();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useEventStream', () => {
  it('连接后收到 message 事件回调分发', () => {
    const onEvent = vi.fn();
    renderHook(() => useEventStream(onEvent, true));
    expect(instances).toHaveLength(1);
    const payload: SSEEvent = { type: 'notification', data: { id: 'n1' } };
    act(() => {
      instances[0].dispatch('message', JSON.stringify(payload));
    });
    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  it('断线重连成功后执行 onReconnect 补拉回调', () => {
    const onReconnect = vi.fn();
    renderHook(() => useEventStream(() => {}, true, onReconnect));
    // 首次 onopen 属于初始连接，不触发补拉
    act(() => instances[0].emitOpen());
    expect(onReconnect).not.toHaveBeenCalled();
    // 触发断线
    act(() => instances[0].emitError());
    // 退避后重连产生新实例
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(instances).toHaveLength(2);
    // 重连成功 onopen → 触发补拉
    act(() => instances[1].emitOpen());
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('未提供 onReconnect 时默认补拉通知列表', () => {
    const loadSpy = vi.spyOn(useNotificationStore.getState(), 'loadFromApi').mockResolvedValue();
    renderHook(() => useEventStream(() => {}, true));
    act(() => instances[0].emitOpen());
    act(() => instances[0].emitError());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => instances[1].emitOpen());
    expect(loadSpy).toHaveBeenCalled();
  });

  it('断线后按指数退避重连（2s → 4s → 8s）', () => {
    renderHook(() => useEventStream(() => {}, true));
    act(() => instances[0].emitError());
    expect(instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(instances).toHaveLength(2);
    // 第二次断线退避 4s
    act(() => instances[1].emitError());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(instances).toHaveLength(3);
  });

  it('enabled=false 时不建立连接', () => {
    renderHook(() => useEventStream(() => {}, false));
    expect(instances).toHaveLength(0);
  });

  it('卸载时断开连接', () => {
    const { unmount } = renderHook(() => useEventStream(() => {}, true));
    expect(instances).toHaveLength(1);
    unmount();
    expect(instances[0].closed).toBe(true);
  });
});
