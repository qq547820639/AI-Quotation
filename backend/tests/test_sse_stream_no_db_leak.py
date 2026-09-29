"""SSE 长连接不得长期占用连接池连接

回归依据（本机 dev 栈实测）：并发打开 18 条 `/api/events/stream` 后，
普通的 `GET /api/inquiries` 从 0.0s/200 变成 **30.0s/500** ——
连接池为 QueuePool(5 + overflow 10)，而 `StreamingResponse` 的响应体永不结束，
请求级依赖栈因此不会回收 `get_db` 的 session，每个订阅者长期占走一条连接。
"""
from sqlalchemy import text

from app.database import SessionLocal, engine
from app.routers.events import stream_events


def _checked_out() -> int:
    return engine.pool.checkedout()


def test_stream_events_releases_session_before_handing_back_body():
    before = _checked_out()
    db = SessionLocal()
    try:
        db.execute(text("select 1"))
        assert _checked_out() == before + 1, "前提：连接确已被这条 session 占住"

        # 端点必须在读流之前释放连接（鉴权已在依赖阶段完成，流本身不碰库）
        response = stream_events(db=db, _current_user=None)
        assert _checked_out() == before, "SSE 端点把连接池连接留给了长连接"
        assert response.media_type == "text/event-stream"
    finally:
        db.close()
    assert _checked_out() == before
