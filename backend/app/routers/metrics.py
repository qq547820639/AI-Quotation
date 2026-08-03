"""Web Vitals 上报端点（G2）

接收前端 sendBeacon 上报的 Web Vitals 指标（CLS/LCP/FCP/TTFB/INP）。
- 无鉴权：上报不应被 auth 拦截
- 仅记录日志，不持久化（数据量小，日志足够）
- 兼容 sendBeacon 的 text/plain Content-Type
"""
import json
import logging

from fastapi import APIRouter, Request

router = APIRouter()
logger = logging.getLogger("procurement.metrics")


@router.post("/metrics")
async def receive_metrics(request: Request):
    """接收前端 Web Vitals 上报（sendBeacon，无鉴权）"""
    try:
        body = await request.body()
        data = json.loads(body) if body else {}
        logger.info(
            "WebVital name=%s value=%.2f rating=%s id=%s",
            data.get("name"),
            float(data.get("value", 0)),
            data.get("rating"),
            data.get("id"),
        )
    except Exception:
        logger.warning("Failed to parse metrics body")
    return {"status": "ok"}
