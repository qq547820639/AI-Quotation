"""SSE 实时事件路由（P2-12 Task 17）

GET /api/events/stream：SSE 长连接，事件如 quotation_submitted / notification。
前端以 fetch + Bearer 头订阅（原生 EventSource 无法携带认证头）；
收到事件后 invalidateQueries 刷新未读/详情/比价/通知中心。
"""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..auth import get_current_user
from ..events import event_stream

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/stream")
def stream_events(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    """SSE 长连接：无新增时保持连接（心跳保活），测试可用短连接验证。"""
    # 鉴权已在依赖阶段完成，这里必须立刻释放 session：StreamingResponse 的响应体
    # 不会结束，请求级依赖栈也就不回收 session，于是每个订阅者长期占有一条连接池连接。
    db.close()
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )