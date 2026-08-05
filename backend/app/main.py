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
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException
from sqlalchemy import text

from .config import (
    APP_ENV,
    CORS_ORIGINS,
    DB_AUTO_CREATE,
    CSP_DEFAULT,
    HSTS_ENABLED,
    HSTS_MAX_AGE,
    REFERRER_POLICY,
    PERMISSIONS_POLICY,
    REDIS_URL,
    S3_ENDPOINT,
    S3_BUCKET,
    S3_ACCESS_KEY,
    S3_SECRET_KEY,
    S3_REQUIRED,
    SCANNER_PROVIDER,
    CELERY_TASK_ALWAYS_EAGER,
)
from .database import Base, engine, SessionLocal
from . import models  # noqa: F401  触发所有 ORM 模型注册到 Base.metadata
from .models import AIUsage, Attachment, OutboxEvent, TaskRecord, User
from .config_validation import assert_production_config
from .logging import get_request_id, new_request_id, set_request_id, setup_logging
from .auth import require_admin
from . import metrics as metrics_mod
from .redis_client import get_store
from .seed import ensure_app_settings, init_db
from .scanner import check_scanner_available
from .storage import get_storage, S3Storage
from .routers import auth, inquiries, suppliers, materials, quotations, notifications, settings, metrics, portal, ai, users, events, tasks

# 慢请求阈值（毫秒）：超时记录结构化 slow_request 日志（Task 22 慢查询观测）
SLOW_REQUEST_THRESHOLD_MS = float(os.environ.get("SLOW_REQUEST_THRESHOLD_MS", "1000"))

# 结构化日志配置（P5.3）
setup_logging()
logger = logging.getLogger("procurement")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 生产环境启动前强制校验配置：不满足（不安全密钥/无 clamav/Redis 不可用/S3 客户端不可用）
    # 则抛 RuntimeError 拒绝启动，禁止生产静默降级到内存实现或本地附件存储。
    assert_production_config()
    # 启动：仅 dev/test 自动建表（prod 依赖 Alembic 迁移）
    if DB_AUTO_CREATE:
        Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if APP_ENV != "prod":
            # dev/test：注入演示种子数据（幂等；生产由 Alembic 建表 + bootstrap-admin 引导）
            init_db(db)
        else:
            # 生产：仅确保 AppSettings 配置单行，绝不注入/绝不回填演示数据
            ensure_app_settings(db)
    finally:
        db.close()
    # 启动钩子：补齐未 dispatched 的 outbox 事件（broker 短暂断开/上一次进程重启后未入队的任务）
    try:
        from .queue_client import dispatch_outbox
        dispatched = dispatch_outbox()
        if dispatched:
            logger.info("outbox 启动补齐投递", extra={"extra_fields": {"dispatched": dispatched}})
    except Exception:  # noqa: BLE001 - outbox 补齐失败不阻塞启动
        logger.exception("outbox_dispatch_on_startup_failed")
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
    """请求日志中间件：生成 request_id，注入响应头，记录结构化访问日志（脱敏）并累计指标"""
    start = time.time()
    request_id = new_request_id()
    set_request_id(request_id)
    request.state.request_id = request_id
    metrics_mod.request_total()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception:
        # 未捕获异常：累计错误指标，交由全局异常处理器记录与返回
        metrics_mod.request_error_total()
        raise
    if status_code >= 400:
        metrics_mod.request_error_total()
    duration_ms = (time.time() - start) * 1000
    metrics_mod.record_request_duration_ms(duration_ms)
    response.headers["X-Request-Id"] = request_id
    # 从 request.state 读取认证上下文（若已由 get_current_user 注入）；拿不到则留空
    user_id = getattr(request.state, "user_id", "") or ""
    organization = getattr(request.state, "organization", "") or ""
    logger.info(
        "http_request",
        extra={
            "extra_fields": {
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "duration_ms": round(duration_ms, 1),
                "organization_id": organization,
                "user_id": user_id,
            }
        },
    )
    # Task 22：慢请求结构化日志（超阈值），用于定位后端慢查询/慢接口
    if duration_ms >= SLOW_REQUEST_THRESHOLD_MS:
        logger.warning(
            "slow_request",
            extra={
                "extra_fields": {
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": status_code,
                    "duration_ms": round(duration_ms, 1),
                    "threshold_ms": SLOW_REQUEST_THRESHOLD_MS,
                    "organization_id": organization,
                    "user_id": user_id,
                }
            },
        )
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """安全响应头中间件（P1-6）：为所有响应添加 CSP / HSTS / nosniff / Referrer-Policy / Permissions-Policy。

    - CSP 宽松默认，可从环境变量 CSP_DEFAULT 配置
    - HSTS 仅生产（HSTS_ENABLED=true）时下发
    """
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", CSP_DEFAULT)
    if HSTS_ENABLED:
        response.headers.setdefault(
            "Strict-Transport-Security",
            f"max-age={HSTS_MAX_AGE}; includeSubDomains",
        )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", REFERRER_POLICY)
    response.headers.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
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


def _extract_code_and_message(detail, status_code: int) -> tuple[str, str]:
    """从 HTTPException.detail 中提取机器错误码与用户可读消息。

    - detail 为 dict（结构化，如 {"error_type": ..., "message": ...}）：优先取出。
    - detail 为 str：作为可读消息，错误码由状态码映射。
    """
    if isinstance(detail, dict):
        code = detail.get("error_type") or detail.get("code") or _error_type_for_status(status_code)
        message = detail.get("message") or detail.get("msg") or "请求失败"
        return str(code), str(message)
    if isinstance(detail, str):
        return _error_type_for_status(status_code), detail
    return _error_type_for_status(status_code), "请求失败"


def _field_errors_from_errors(errors: list) -> dict:
    """将 Pydantic 校验错误列表聚合为 {字段路径: 用户可读消息}。"""
    field_errors: dict = {}
    for err in errors:
        loc = err.get("loc", [])
        # 去掉开头的 "body" 定位段，取字段名
        field = ".".join(str(x) for x in loc if x != "body")
        if not field:
            field = "_"
        msg = err.get("msg") or "参数校验失败"
        field_errors[field] = msg
    return field_errors


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """HTTPException 统一处理：统一错误格式（code/message/retryable/request_id/冲突详情）。

    保留既有 detail / error_type 字段以向后兼容；新增结构化 code / message / retryable。
    """
    rid = _request_id(request)
    code, message = _extract_code_and_message(exc.detail, exc.status_code)
    content: dict = {
        "detail": exc.detail,
        "request_id": rid,
        "error_type": _error_type_for_status(exc.status_code),
        "code": code,
        "message": message,
        "retryable": exc.status_code >= 500,
    }
    # Task 24：冲突详情（409）独立暴露，便于前端展示可恢复冲突信息
    if exc.status_code == 409:
        content["conflict"] = exc.detail if isinstance(exc.detail, dict) else {"message": message}
    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers={"X-Request-Id": rid},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """请求体校验失败（422）：结构化返回，detail 保持默认错误列表 + 字段级 fieldErrors"""
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
            "code": "validation_error",
            "message": "参数校验失败",
            "retryable": False,
            "fieldErrors": _field_errors_from_errors(errors),
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
app.include_router(portal.router, prefix=API_PREFIX)
app.include_router(ai.router, prefix=API_PREFIX)  # AI 服务（P1-9 Task 14）
app.include_router(users.router, prefix=API_PREFIX)  # 用户级表格偏好（P2-12 Task 17）
app.include_router(events.router, prefix=API_PREFIX)  # SSE 实时事件（P2-12 Task 17）
app.include_router(tasks.router, prefix=API_PREFIX)  # 持久化任务队列管理（P1 可靠性）


@app.get("/")
def root():
    return {"name": "企业采购自动询价 Web 系统 API", "docs": "/docs"}


@app.get("/api/metrics")
def metrics_endpoint(_user: User = Depends(require_admin)):
    """轻量级进程内指标（JSON）：request_total / request_error_total / 请求延迟直方图 /
    队列积压 / 任务失败 / AI 调用 / 扫描失败等。

    不依赖 prometheus_client，避免新增依赖；供运维/监控抓取。
    需管理员权限（P0-7）：指标含内部队列/任务/进程信息，禁止匿名公开。
    """
    _refresh_db_derived_metrics()
    return metrics_mod.get_metrics()


def _refresh_db_derived_metrics() -> None:
    """从 DB 计算瞬时指标并写入进程内 metrics（事务任务/队列可靠性派生统计）。

    - queue_backlog_gauge：pending 任务 + pending outbox 事件数（队列积压）
    - task_fail_gauge：status 为 failed / permanent_failure 的任务数（任务失败）
    - ai_call_gauge：ai_usage 记录数（AI 调用）
    - scan_fail_gauge：attachments scan_status 为 error / infected 的数量（扫描失败）

    DB 瞬时不可用时保留上次已写入的瞬时值并记录 warning（不使 /api/metrics 因 DB 故障返回 500）。
    """
    try:
        db = SessionLocal()
        try:
            pending_tasks = db.query(TaskRecord).filter(TaskRecord.status == "pending").count()
            pending_outbox = db.query(OutboxEvent).filter(OutboxEvent.status == "pending").count()
            metrics_mod.set_metric("queue_backlog_gauge", pending_tasks + pending_outbox)
            failed_tasks = db.query(TaskRecord).filter(
                TaskRecord.status.in_(["failed", "permanent_failure"])
            ).count()
            metrics_mod.set_metric("task_fail_gauge", failed_tasks)
            metrics_mod.set_metric("ai_call_gauge", db.query(AIUsage).count())
            scan_fail = db.query(Attachment).filter(
                Attachment.scan_status.in_(["error", "infected"])
            ).count()
            metrics_mod.set_metric("scan_fail_gauge", scan_fail)
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - metrics 端点韧性：DB 故障不阻断指标抓取
        logger.warning("metrics_db_derived_refresh_failed")


@app.get("/api/health")
def health_check():
    """Liveness 探针（供 Docker healthcheck / 监控使用）：进程存活即返回 200。

    真实探测数据库连通性（SELECT 1），但 DB 不可用时仍返回 HTTP 200（status=degraded），
    用于区分「进程是否存活」与「依赖是否就绪」——进程存活不应被依赖故障误判为重启。
    """
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
        # P0-7：不向客户端泄露原始 DB 异常（连接串/堆栈/方言），仅记录脱敏日志并返回通用文案。
        logger.warning(
            "health_db_check_failed",
            extra={"extra_fields": {"error": str(e)}},
        )
        db_error = "database unavailable"
    return {
        "status": "ok" if db_ok else "degraded",
        "version": "1.0.0",
        "db": "connected" if db_ok else "disconnected",
        "db_error": db_error,
    }


@app.get("/api/ready")
def ready_check():
    """Readiness 探针：PostgreSQL + 关键表 +（若配置）Redis + S3/MinIO + ClamAV + Celery Worker
    全部就绪才返回 200，否则返回 503。

    覆盖（P0-8）：
    - PostgreSQL：SELECT 1 + users/inquiries 关键表可查询。
    - Redis：若配置 REDIS_URL 则必须 ping 通过（未配置不阻塞，dev/test）。
    - S3/MinIO：若配置 S3_* 则真实探活（head bucket/create/write/read/delete）；生产强制 S3_REQUIRED。
    - ClamAV：若 SCANNER_PROVIDER=clamav 则 EICAR 探活（fail-closed）。
    - Celery Worker：非 eager 模式（生产）必须有存活 worker 响应。
    """
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

    result: dict = {"status": "ready", "db": "connected"}

    # Redis
    if REDIS_URL:
        try:
            get_store().ping()
            result["redis"] = "connected"
        except Exception:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "db": "connected", "redis": "disconnected"},
            )
    else:
        result["redis"] = "not_configured"

    # S3/MinIO：配置齐全则真实探活；生产强制 S3 但未配置 → 不就绪
    s3_configured = bool(S3_ENDPOINT and S3_BUCKET and S3_ACCESS_KEY and S3_SECRET_KEY)
    if s3_configured:
        try:
            storage = get_storage()
            if not isinstance(storage, S3Storage) or not storage.probe():
                return JSONResponse(
                    status_code=503,
                    content={"status": "not_ready", "db": "connected",
                             "redis": result.get("redis"), "s3": "disconnected"},
                )
            result["s3"] = "connected"
        except Exception:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "db": "connected",
                         "redis": result.get("redis"), "s3": "disconnected"},
            )
    elif S3_REQUIRED:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "db": "connected",
                     "redis": result.get("redis"), "s3": "not_configured"},
        )
    else:
        result["s3"] = "not_configured"

    # ClamAV：配置为 clamav 时 EICAR 探活（fail-closed）
    if (SCANNER_PROVIDER or "").strip().lower() == "clamav":
        if not check_scanner_available():
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "db": "connected",
                         "redis": result.get("redis"), "s3": result.get("s3"),
                         "clamav": "disconnected"},
            )
        result["clamav"] = "connected"
    else:
        result["clamav"] = "not_configured"

    # Celery Worker：非 eager 模式（生产）必须有存活 worker
    if not CELERY_TASK_ALWAYS_EAGER:
        if not _celery_worker_ok():
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "db": "connected",
                         "redis": result.get("redis"), "s3": result.get("s3"),
                         "clamav": result.get("clamav"), "celery": "disconnected"},
            )
        result["celery"] = "connected"
    else:
        result["celery"] = "not_configured"

    return result


def _celery_worker_ok() -> bool:
    """探测是否有存活 Celery worker（生产非 eager 模式）。

    通过 celery control ping 广播向 worker 发起探活；无 worker 响应或 broker 不可用 → False。
    """
    try:
        from .tasks import celery_app
        replies = celery_app.control.ping(timeout=3)
        return bool(replies)
    except Exception:  # noqa: BLE001 - 探活失败即不就绪
        logger.warning("celery_worker_probe_failed")
        return False
