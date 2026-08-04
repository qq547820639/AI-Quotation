"""SSE 实时事件总线（P2-12 Task 17）

进程内 asyncio 发布/订阅：服务端各写入操作（报价提交 / 通知创建等）调用 publish()，
向所有已订阅的 /api/events/stream 连接广播事件；前端 EventSource 订阅并 invalidateQueries。

说明：
- 单进程内有效（开发/单副本部署）。多副本部署需替换为 Redis pub/sub 等外部总线。
- 无订阅者时 publish 为 no-op，不阻塞写路径。
- 连接空闲时发送心跳注释（: ping）以保持连接，避免代理/防火墙超时断开。
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import Request

# 每个连接一个 asyncio.Queue；dict 无锁（事件循环内单线程访问）
_subscribers: dict[int, asyncio.Queue] = {}
_next_id = 0

# 空闲心跳间隔：兼顾及时响应断开与避免高频空转
_HEARTBEAT_SECONDS = 1.0


def publish(event_type: str, data: dict[str, Any] | None = None) -> None:
    """向所有订阅连接广播一个事件。data 须可 JSON 序列化。"""
    payload = json.dumps({"type": event_type, "data": data or {}}, ensure_ascii=False)
    for q in list(_subscribers.values()):
        try:
            q.put_nowait(payload)
        except Exception:  # noqa: BLE001 - 队列满/关闭时跳过该连接
            pass


def subscribe() -> int:
    """为调用方注册一个新订阅队列，返回订阅 id。"""
    global _next_id
    _next_id += 1
    sid = _next_id
    _subscribers[sid] = asyncio.Queue(maxsize=100)
    return sid


def unsubscribe(sid: int) -> None:
    _subscribers.pop(sid, None)


async def event_stream() -> str:
    """SSE 生成器：持续产出事件，空闲时发送心跳注释。

    生成器由 StreamingResponse 的 listen_for_disconnect 在客户端断开时取消，
    此处无需额外感知断开；心跳间隔较短以便及时响应取消。
    """
    sid = subscribe()
    q = _subscribers[sid]
    try:
        yield "event: connected\ndata: {\"status\":\"ok\"}\n\n"
        while True:
            try:
                # 等待事件；超时则发送心跳保活
                payload = await asyncio.wait_for(q.get(), timeout=_HEARTBEAT_SECONDS)
                yield f"event: message\ndata: {payload}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    finally:
        unsubscribe(sid)