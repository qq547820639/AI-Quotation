/**
 * SSE 实时事件 hook（P2-12 Task 17）
 * - 订阅 /api/events/stream，将服务端推送事件（quotation_submitted / inquiry_confirmed / notification 等）
 *   通过 onEvent 回调分发给调用方（用于刷新未读数、失效查询等）。
 * - 自动重连（指数退避，上限 30s），组件卸载自动断开。
 * - 仅生产/真实后端模式启用；MSW 演示模式不建立连接以免误报。
 */
import { useEffect, useRef } from 'react';
import { createParser } from 'eventsource-parser';
import { IS_DEMO_MODE } from '@/config';
import { useNotificationStore } from '@/store/useNotificationStore';

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const MAX_RETRY_MS = 30000;
const FIRST_RETRY_MS = 2000;

/** 断线重连后默认补拉逻辑：重载通知以拉取遗漏通知 */
function defaultReconnectCatchUp(): void {
  void useNotificationStore.getState().loadFromApi();
}

/**
 * @param onEvent 收到事件时回调
 * @param enabled 是否启用（默认内联判断演示模式）
 * @param onReconnect 断线重连成功后的回调（用于补拉遗漏数据）。缺省时补拉通知列表。
 */
export function useEventStream(
  onEvent: (event: SSEEvent) => void,
  enabled = true,
  onReconnect?: () => void,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    // 演示模式（MSW）不建立 SSE 连接
    if (!enabled || IS_DEMO_MODE) return;

    let closed = false;
    let retryMs = FIRST_RETRY_MS;
    // 首次成功连接属于初始连接，之后的成功连接视为断线重连成功
    let hasConnected = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const triggerReconnect = () => {
      if (onReconnectRef.current) {
        onReconnectRef.current();
      } else {
        defaultReconnectCatchUp();
      }
    };

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = retryMs;
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      timer = setTimeout(() => {
        timer = null;
        void connect();
      }, delay);
    };

    const parser = createParser({
      onEvent: (event) => {
        // 服务端以 data 承载 {type, data} JSON；无 type 的帧（如首帧 connected）不分发
        try {
          const payload = JSON.parse(event.data) as SSEEvent;
          if (payload && payload.type) {
            onEventRef.current(payload);
          }
        } catch {
          /* 忽略无法解析的事件 */
        }
      },
    });

    const connect = async () => {
      if (closed) return;
      controller = new AbortController();
      // 每次连接现取 token：access token 会随 401 续期轮换，登录前则不带认证头
      const token = localStorage.getItem('procurement_token');
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (token) headers.Authorization = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(`${BASE_URL}/events/stream`, {
          headers,
          signal: controller.signal,
          credentials: 'same-origin',
        });
      } catch {
        // 网络异常 / 主动 abort：abort 时 closed 已为 true
        scheduleReconnect();
        return;
      }
      if (!response.ok || !response.body) {
        scheduleReconnect();
        return;
      }

      retryMs = FIRST_RETRY_MS;
      if (hasConnected) {
        // 断线重连成功后补拉遗漏通知
        triggerReconnect();
      }
      hasConnected = true;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      parser.reset();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        /* 连接被中断：走下方统一重连 */
      }
      if (!closed) scheduleReconnect();
    };

    void connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      controller = null;
    };
  }, [enabled]);
}
