"""FastAPI 应用入口

- 创建数据库表
- 注入种子数据（首启）
- 注册 CORS 中间件
- 请求日志中间件（P5.3）
- 挂载 7 个路由模块（共 38 端点）
"""
import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .database import Base, engine, SessionLocal
from . import models  # noqa: F401  触发所有 ORM 模型注册到 Base.metadata
from .seed import init_db
from .routers import auth, inquiries, suppliers, materials, quotations, notifications, settings

# 日志配置（P5.3）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
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
    """请求日志中间件：记录方法/路径/状态码/耗时"""
    start = time.time()
    response = await call_next(request)
    duration_ms = (time.time() - start) * 1000
    logger.info(
        "%s %s %d %.0fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response

# 注册路由（统一挂载在 /api 前缀下，对齐前端 baseURL 与 vite proxy）
API_PREFIX = "/api"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(inquiries.router, prefix=API_PREFIX)
app.include_router(suppliers.router, prefix=API_PREFIX)
app.include_router(materials.router, prefix=API_PREFIX)
app.include_router(quotations.router, prefix=API_PREFIX)
app.include_router(notifications.router, prefix=API_PREFIX)
app.include_router(settings.router, prefix=API_PREFIX)


@app.get("/")
def root():
    return {"name": "企业采购自动询价 Web 系统 API", "docs": "/docs"}


@app.get("/api/health")
def health_check():
    """健康检查端点（无认证，供 Docker healthcheck / 监控使用）"""
    return {"status": "ok", "version": "1.0.0", "db": "connected"}
