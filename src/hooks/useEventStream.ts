/**
 * SSE 实时事件 hook（P2-12 Task 17）
 * - 订阅 /api/events/stream，将服务端推送事件（quotation_submitted / inquiry_confirmed / notification 等）
 *   通过 onEvent 回调分发给调用方（用于刷新未读数、失效查询等）。
 * - 自动重连（指数退避，上限 30s），组件卸载自动断开。
 * - 仅生产/真实后端模式启用；MSW 演示模式不建立连接以免误报。
 */
import { useEffect, useRef } from 'react';
import { IS_DEMO_MODE } from '@/config';

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const MAX_RETRY_MS = 30000;

/**
 * @param onEvent 收到事件时回调
 * @param enabled 是否启用（默认内联判断演示模式）
 */
export function useEventStream(onEvent: (event: SSEEvent) => void, enabled = true): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // 演示模式（MSW）不建立 SSE 连接
    if (!enabled || IS_DEMO_MODE) return;

    let es: EventSource | null = null;
    let closed = false;
    let retryMs = 2000;

    const connect = () => {
      if (closed) return;
      if (es) {
        es.close();
        es = null;
      }
      try {
        es = new EventSource(`${BASE_URL}/events/stream`);
      } catch {
        // 构造失败（如非浏览器环境）则放弃
        return;
      }

      es.onopen = () => {
        retryMs = 2000;
      };
      es.addEventListener('message', (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as SSEEvent;
          if (payload && payload.type) {
            onEventRef.current(payload);
          }
        } catch {
          /* 忽略无法解析的事件 */
        }
      });
      es.onerror = () => {
        // 连接异常：关闭后按退避重连
        es?.close();
        es = null;
        if (closed) return;
        const delay = retryMs;
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      es?.close();
      es = null;
    };
  }, [enabled]);
}
