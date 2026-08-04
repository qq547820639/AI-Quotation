"""FastAPI 应用入口

- 创建数据库表
- 注入种子数据（首启）
- 注册 CORS 中间件
- 结构化请求日志中间件（request_id + 脱敏，P5.3）
- 统一异常处理（结构化错误，含 request_id / error_type）
- 健康检查 /api/health 与就绪检查 /api/ready
- 挂载 7 个路由模块（共 38 端点）
"""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException
from sqlalchemy import text

from .config import CORS_ORIGINS
from .database import Base, engine, SessionLocal
from . import models  # noqa: F401  触发所有 ORM 模型注册到 Base.metadata
from .logging import get_request_id, new_request_id, set_request_id, setup_logging
from .seed import init_db
from .routers import auth, inquiries, suppliers, materials, quotations, notifications, settings, metrics

# 结构化日志配置（P5.3）
setup_logging()
logger = logging.getLogger("procurement")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：建表 + 注入种子
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()
    logger.info("FastAPI 启动完成，38 端点就绪")
    yield


app = FastAPI(
    title="企业采购自动询价 Web 系统 API",
    version="1.0.0",
    description="对齐 docs/api-contract.md 的 38 端点",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """请求日志中间件：生成 request_id，注入响应头，记录结构化访问日志（脱敏）"""
    start = time.time()
    request_id = new_request_id()
    set_request_id(request_id)
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception:
        # 异常交由全局异常处理器记录与返回，这里只负责记录耗时异常
        raise
    duration_ms = (time.time() - start) * 1000
    response.headers["X-Request-Id"] = request_id
    logger.info(
        "http_request",
        extra={
            "extra_fields": {
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(duration_ms, 1),
            }
        },
    )
    return response


def _request_id(request: Request) -> str:
    """从请求状态取 request_id，兜底用 contextvar"""
    rid = getattr(request.state, "request_id", None)
    return rid or get_request_id()


def _error_type_for_status(status_code: int) -> str:
    """将 HTTP 状态码映射为错误分类"""
    if status_code == 400:
        return "bad_request"
    if status_code in (401, 403):
        return "unauthorized" if status_code == 401 else "forbidden"
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "conflict"
    if status_code == 422:
        return "validation_error"
    if status_code == 429:
        return "too_many_requests"
    if status_code == 503:
        return "service_unavailable"
    return "internal_error"


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """HTTPException 统一处理：保留原状态码与 detail，附加 request_id / error_type"""
    rid = _request_id(request)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "request_id": rid,
            "error_type": _error_type_for_status(exc.status_code),
        },
        headers={"X-Request-Id": rid},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """请求体校验失败（422）：结构化返回，detail 保持默认错误列表"""
    rid = _request_id(request)
    errors = exc.errors()
    # Pydantic v2 的 ctx.error 可能是非可序列化对象（如 ValueError），转为字符串
    for err in errors:
        ctx = err.get("ctx")
        if ctx:
            err["ctx"] = {k: str(v) for k, v in ctx.items()}
    return JSONResponse(
        status_code=422,
        content={
            "detail": errors,
            "request_id": rid,
            "error_type": "validation_error",
        },
        headers={"X-Request-Id": rid},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """未知系统错误：记录异常堆栈，返回结构化 500（不吞异常、不伪造成功）"""
    rid = _request_id(request)
    logger.exception(
        "unhandled_exception",
        extra={"extra_fields": {
            "request_id": rid,
            "method": request.method,
            "path": request.url.path,
        }},
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器内部错误",
            "request_id": rid,
            "error_type": "internal_error",
        },
        headers={"X-Request-Id": rid},
    )


# 注册路由（统一挂载在 /api 前缀下，对齐前端 baseURL 与 vite proxy）
API_PREFIX = "/api"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(inquiries.router, prefix=API_PREFIX)
app.include_router(suppliers.router, prefix=API_PREFIX)
app.include_router(materials.router, prefix=API_PREFIX)
app.include_router(quotations.router, prefix=API_PREFIX)
app.include_router(notifications.router, prefix=API_PREFIX)
app.include_router(settings.router, prefix=API_PREFIX)
app.include_router(metrics.router, prefix=API_PREFIX)  # Web Vitals 上报（G2）


@app.get("/")
def root():
    return {"name": "企业采购自动询价 Web 系统 API", "docs": "/docs"}


@app.get("/api/health")
def health_check():
    """健康检查端点：真实探测数据库连通性（G3，无认证，供 Docker healthcheck / 监控使用）"""
    db_ok = False
    db_error = None
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        finally:
            db.close()
    except Exception as e:
        db_error = str(e)
    return {
        "status": "ok" if db_ok else "degraded",
        "version": "1.0.0",
        "db": "connected" if db_ok else "disconnected",
        "db_error": db_error,
    }


@app.get("/api/ready")
def ready_check():
    """就绪检查：DB 连通 + 关键表（users/inquiries）可查询，返回 ready 状态"""
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        db.execute(text("SELECT COUNT(*) FROM users"))
        db.execute(text("SELECT COUNT(*) FROM inquiries"))
    except Exception:
        db.close()
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "db": "disconnected"},
        )
    db.close()
    return {"status": "ready", "db": "connected"}
