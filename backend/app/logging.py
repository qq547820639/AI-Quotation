"""结构化日志 + request_id 上下文 + 敏感字段脱敏

- JsonFormatter：JSON 格式输出（timestamp/level/logger/message/request_id/extra）
- get_request_id() / set_request_id()：基于 contextvar 的每请求唯一 ID
- redact()：对敏感 key（password/token/authorization/secret/api_key 等）的值脱敏
"""
from __future__ import annotations

import json
import logging
import uuid
from contextvars import ContextVar

# 每请求 request_id（contextvar，随请求作用域传播）
_request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# 敏感字段名（子串匹配，小写比对）。命中即对该 key 的值整体掩码为 ***。
SENSITIVE_KEYS = (
    "password",
    "passwd",
    "token",
    "authorization",
    "secret",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "credential",
    "authorization",
    # 报价业务正文（报价正文/说明/备注等自由文本，避免招采明细落盘）
    "content",
    "body",
    "quotation",
    "quotation_body",
    "quote_content",
    "quote_body",
    "remark",
)

# 邮箱类 key：采用「部分脱敏」而非整体掩码（保留域名，本地部分仅暴露首字符）
EMAIL_KEYS = ("email",)


def _is_sensitive(key: str) -> bool:
    k = str(key).lower()
    return any(s in k for s in SENSITIVE_KEYS)


def _is_email(key: str) -> bool:
    k = str(key).lower()
    return any(s in k for s in EMAIL_KEYS)


def _mask_email(value):
    """对邮箱做部分脱敏：保留域名，本地部分仅保留首字符。非邮箱格式则整体掩码。"""
    s = str(value)
    if "@" not in s:
        return "***"
    user, _, domain = s.partition("@")
    if not user:
        return f"***@{domain}"
    masked = user[0] + "***" if len(user) > 1 else "***"
    return f"{masked}@{domain}"


def redact(data):
    """递归脱敏：对敏感 key 的 value 掩码，返回新结构（不修改入参）。

    - 邮箱类 key（含 email）：部分脱敏，保留域名
    - 其余敏感 key（password/token/authorization/报价正文等）：整体掩码为 ***
    - 支持 dict / list / 标量；非敏感 key 原样保留
    """
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            if _is_email(k):
                out[k] = _mask_email(v) if v is not None else v
            elif _is_sensitive(k):
                out[k] = "***"
            else:
                out[k] = redact(v)
        return out
    if isinstance(data, (list, tuple)):
        return [redact(v) for v in data]
    return data


def get_request_id() -> str:
    """取当前请求的 request_id（无则返回空串）"""
    return _request_id_var.get()


def set_request_id(request_id: str) -> None:
    """设置当前请求的 request_id（每请求以 uuid4().hex 生成）"""
    _request_id_var.set(request_id)


def new_request_id() -> str:
    """生成唯一请求 ID"""
    return uuid.uuid4().hex


class JsonFormatter(logging.Formatter):
    """JSON 结构化日志格式化器。

    输出字段：timestamp / level / logger / message / request_id / (extra_fields)
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = get_request_id()
        if rid:
            payload["request_id"] = rid
        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            # 落盘前对 extra_fields 应用脱敏（密码/token/邮箱部分/报价正文）
            payload.update(redact(extra))
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """配置根日志：单 handler + JSON 格式化器（替换旧的 basicConfig 格式）"""
    root = logging.getLogger()
    root.setLevel(level)
    # 清除已有 handler，避免重复输出
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    return root