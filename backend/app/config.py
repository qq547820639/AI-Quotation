"""后端配置"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("DB_PATH", str(BASE_DIR / "procurement.db"))
# 支持 DATABASE_URL 环境变量（如 postgresql://...），否则回退到本地 SQLite
DATABASE_URL = os.environ.get("DATABASE_URL")
DB_URL = DATABASE_URL or f"sqlite:///{DB_PATH}"

# 应用环境：dev / test / prod
APP_ENV = os.environ.get("APP_ENV", "dev")

# 是否由应用启动时调用 Base.metadata.create_all（仅 dev/test 开启；prod 依赖 Alembic）
# 逻辑：默认 APP_ENV=prod 时为 false；亦可显式通过 DB_AUTO_CREATE 覆盖。
DB_AUTO_CREATE = os.environ.get("DB_AUTO_CREATE", "true" if APP_ENV != "prod" else "false").lower() in ("1", "true", "yes")

# ============ 数据库连接池（仅 PostgreSQL 生效；SQLite 忽略） ============
DB_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "10"))
DB_MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", "20"))
# 连接前置 ping，避免使用已断开的池化连接（生产建议开启）
DB_POOL_PRE_PING = os.environ.get("DB_POOL_PRE_PING", "true").lower() in ("1", "true", "yes")

# CORS 白名单：开发环境允许前端 vite dev server
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

# ============ 认证与安全配置 ============

# 演示/开发模式：仅当显式开启时，才允许"快捷登录"（选中用户即可，无需校验密码）。
# 生产环境必须留空或设为 false，走真实密码校验。
APP_DEMO_MODE = os.environ.get("APP_DEMO_MODE", "false").lower() in ("1", "true", "yes")

# 兼容旧配置：历史 token 有效期（秒），默认 24 小时（新代码使用 ACCESS_TOKEN_TTL_SECONDS）
TOKEN_TTL_SECONDS = int(os.environ.get("TOKEN_TTL", "86400"))

# 登录取证：连续失败登录速率限制
LOGIN_MAX_ATTEMPTS = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("LOGIN_RATE_LIMIT_WINDOW", "900"))

# 演示账号默认密码（仅 APP_DEMO_MODE=true 时的种子用户使用）
DEMO_USER_PASSWORD = os.environ.get("DEMO_USER_PASSWORD", "123456")

# ============ 会话安全（P1-6） ============

# Access Token 有效期（秒），默认 15 分钟（短期）
ACCESS_TOKEN_TTL_SECONDS = int(os.environ.get("ACCESS_TOKEN_TTL", "900"))

# Refresh Token 有效期（秒），默认 14 天
REFRESH_TOKEN_TTL_SECONDS = int(os.environ.get("REFRESH_TOKEN_TTL", str(14 * 24 * 3600)))

# Redis 连接：设置 REDIS_URL 时使用 Redis 客户端，否则回退到进程内（内存）实现（开发/测试/单实例）
REDIS_URL = os.environ.get("REDIS_URL", "")
# 生产是否强制要求 Redis（默认 APP_ENV=prod 为 true，可由 REDIS_REQUIRED 覆盖）。
# 生产开启时，若配置了 REDIS_URL 但连接不可用则拒绝启动（禁止静默降级到进程内内存限流/幂等/缓存/token）。
REDIS_REQUIRED = os.environ.get("REDIS_REQUIRED", "true" if APP_ENV == "prod" else "false").lower() in ("1", "true", "yes")

# ============ 对象存储（S3/MinIO，可选） ============
# 未配置 S3_* 时回退本地 UPLOAD_DIR；生产若配置完整但客户端不可用则拒绝启动（禁止静默降级）。
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "")
S3_BUCKET = os.environ.get("S3_BUCKET", "")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "")

# 安全响应头（CSP/HSTS 从环境变量读取，宽松默认）
# 收紧的 CSP：限制 frame 嵌入（frame-ancestors 'none'）、禁用 object（object-src 'none'）、
# 限制 base/form 来源。script-src 移除 'unsafe-inline'（前端构建产物无内联脚本，见 dist/index.html）。
CSP_DEFAULT = os.environ.get(
    "CSP_DEFAULT",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; "
    "base-uri 'self'; form-action 'self'",
)
HSTS_ENABLED = os.environ.get("HSTS_ENABLED", "false").lower() in ("1", "true", "yes")
HSTS_MAX_AGE = os.environ.get("HSTS_MAX_AGE", "31536000")
REFERRER_POLICY = os.environ.get("REFERRER_POLICY", "strict-origin-when-cross-origin")
PERMISSIONS_POLICY = os.environ.get(
    "PERMISSIONS_POLICY",
    "camera=(), microphone=(), geolocation=(), payment=()",
)

# ============ 供应商邀请 ============

# 邀请 token 有效期（小时），默认 72 小时
INVITATION_TOKEN_TTL_HOURS = int(os.environ.get("INVITATION_TOKEN_TTL_HOURS", "72"))

# ============ 通知投递渠道（P1-8 Task 12） ============

# 投递渠道：log（默认，写入日志） / email（SMTP 真实发送） / none（不投递，仅记录待发送）
# none 时投递记录保持 pending，不假装已发送成功。
NOTIFY_CHANNEL = os.environ.get("NOTIFY_CHANNEL", "log").strip().lower()

# SMTP 配置（仅 NOTIFY_CHANNEL=email 时生效；未配置则回退到 LogNotifier，避免测试/CI 发真实邮件）
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

# 供应商门户基础地址（用于模板中的 portalUrl 变量）
PORTAL_BASE_URL = os.environ.get("PORTAL_BASE_URL", "http://localhost:5173/portal")

# ============ 供应商门户附件上传 ============

# 附件存储目录（默认 <项目>/data/uploads）
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
# 附件大小上限（字节），默认 10MB
MAX_UPLOAD_SIZE = int(os.environ.get("MAX_UPLOAD_SIZE", str(10 * 1024 * 1024)))
# 允许的 MIME 类型
ALLOWED_UPLOAD_MIME_TYPES = {
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
}
# 允许的扩展名
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".xlsx", ".docx"}

# ============ 附件病毒扫描（P0：真实扫描器 + fail closed） ============

# 扫描器提供方：clamav（真实 ClamAV，生产必须）/ noop（占位，仅开发/测试）/ sanitizing（仅静态校验）
# 生产环境（APP_ENV=prod）必须显式设为 clamav，否则 get_scanner() 拒绝创建并抛错（fail closed）。
SCANNER_PROVIDER = os.environ.get("SCANNER_PROVIDER", "noop").strip().lower()
# ClamAV clamd 地址（docker-compose 内为服务名 clamav）
CLAMAV_HOST = os.environ.get("CLAMAV_HOST", "127.0.0.1")
CLAMAV_PORT = int(os.environ.get("CLAMAV_PORT", "3310"))
# clamd INSTREAM 扫描/连接超时（秒）
CLAMAV_TIMEOUT_SECONDS = float(os.environ.get("CLAMAV_TIMEOUT_SECONDS", "30"))
CLAMAV_CONNECT_TIMEOUT_SECONDS = float(os.environ.get("CLAMAV_CONNECT_TIMEOUT_SECONDS", "5"))
# 扫描服务不可用/超时时是否放行（fail-open）。生产默认 false（fail-closed：返回 error，禁止下载）。
SCAN_FAIL_OPEN = os.environ.get("SCAN_FAIL_OPEN", "false").lower() in ("1", "true", "yes")

# ============ 生产环境（P1 预留） ============

# 用于签名等对称加密用途的密钥（生产必须通过环境变量 SECRET_KEY 注入，勿写入代码）
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")

# Cookie 安全配置（认证 Cookie 场景）
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", "")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() in ("1", "true", "yes")
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax")

# 可信反向代理（用于 X-Forwarded-For / X-Forwarded-Proto 信任）
TRUSTED_PROXY = os.environ.get("TRUSTED_PROXY", "").split(",")
TRUSTED_PROXY = [p.strip() for p in TRUSTED_PROXY if p.strip()]

# ============ AI 服务（P1-9 Task 14） ============

# Provider 模式：local（本地规则，默认，不调用外部 API）/ remote（OpenAI 兼容远程 LLM）
# 仅当 AI_PROVIDER=remote 且配置了 AI_API_KEY 时才启用远程；否则回退本地规则。
# 默认 local 且 AI_API_KEY 留空，保证测试/CI 不调用外部 API、不发送任何数据。
AI_PROVIDER = os.environ.get("AI_PROVIDER", "local").strip().lower()

# API Key 仅存服务端环境变量，绝不发送到前端。
AI_API_KEY = os.environ.get("AI_API_KEY", "")

# OpenAI 兼容端点（/v1/chat/completions）：形如 https://api.openai.com/v1
AI_BASE_URL = os.environ.get("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-4o-mini")

# 单次请求超时（秒）
AI_TIMEOUT_SECONDS = float(os.environ.get("AI_TIMEOUT_SECONDS", "30"))
# 有限重试次数（指数退避），超时/网络错误后重试
AI_MAX_RETRIES = int(os.environ.get("AI_MAX_RETRIES", "2"))
# 并发限制（信号量）
AI_MAX_CONCURRENCY = int(os.environ.get("AI_MAX_CONCURRENCY", "4"))
# 熔断：连续失败达到阈值后开启熔断，进入降级；冷却后尝试半开
AI_CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get("AI_CIRCUIT_FAILURE_THRESHOLD", "5"))
AI_CIRCUIT_COOLDOWN_SECONDS = float(os.environ.get("AI_CIRCUIT_COOLDOWN_SECONDS", "60"))
AI_CIRCUIT_ENABLED = os.environ.get("AI_CIRCUIT_ENABLED", "true").lower() in ("1", "true", "yes")

# 成本估算（每 1000 token 的价格，未配置则按 0 计）
AI_COST_PER_1K_PROMPT_TOKENS = float(os.environ.get("AI_COST_PER_1K_PROMPT_TOKENS", "0"))
AI_COST_PER_1K_COMPLETION_TOKENS = float(os.environ.get("AI_COST_PER_1K_COMPLETION_TOKENS", "0"))

# 预算上限（累计成本，货币单位）。<=0 表示不限制。
# 进程内累计成本达到该值后，后续远程调用被拒绝并降级本地（并发请求不绕过预算）。
AI_BUDGET_MAX_COST = float(os.environ.get("AI_BUDGET_MAX_COST", "0"))

# 结构化输出模式（Task 12）：默认开启，向远端点请求 response_format={"type":"json_object"}，
# 让模型优先返回合法 JSON；仍以 Pydantic 严格校验兜底。若远端不支持（400），回退本地规则。
AI_STRUCTURED_OUTPUT = os.environ.get("AI_STRUCTURED_OUTPUT", "true").lower() in ("1", "true", "yes")

# ============ 持久化任务队列（Celery，P1 可靠性） ============

# broker / backend：默认复用 REDIS_URL；未配置（dev/test）时回退 memory:// 或依赖 eager 模式。
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)

# 是否以 eager 模式同步执行任务（开发/测试默认开启，无需真实 broker/worker；生产默认关闭）
CELERY_TASK_ALWAYS_EAGER = os.environ.get(
    "CELERY_TASK_ALWAYS_EAGER",
    "true" if APP_ENV != "prod" else "false",
).lower() in ("1", "true", "yes")

# 任务默认重试配置
CELERY_TASK_MAX_RETRIES = int(os.environ.get("CELERY_TASK_MAX_RETRIES", "3"))
CELERY_TASK_RETRY_BACKOFF = os.environ.get("CELERY_TASK_RETRY_BACKOFF", "true").lower() in ("1", "true", "yes")
CELERY_TASK_RETRY_BACKOFF_MAX = int(os.environ.get("CELERY_TASK_RETRY_BACKOFF_MAX", "60"))