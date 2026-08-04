"""后端配置"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("DB_PATH", str(BASE_DIR / "procurement.db"))
DB_URL = f"sqlite:///{DB_PATH}"

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

# token 有效期（秒），默认 24 小时
TOKEN_TTL_SECONDS = int(os.environ.get("TOKEN_TTL", "86400"))

# 登录取证：连续失败登录速率限制
LOGIN_MAX_ATTEMPTS = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("LOGIN_RATE_LIMIT_WINDOW", "900"))

# 演示账号默认密码（仅 APP_DEMO_MODE=true 时的种子用户使用）
DEMO_USER_PASSWORD = os.environ.get("DEMO_USER_PASSWORD", "123456")
