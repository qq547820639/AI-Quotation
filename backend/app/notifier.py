"""通知投递渠道抽象（P1-8 Task 12）

- Notifier 接口：send(to, subject, body, variables) → DeliveryResult
- EmailNotifier：基于 smtplib 的 SMTP 真实发送（默认不启用，需配置 SMTP_* + NOTIFY_CHANNEL=email）
- LogNotifier：把发送记录写入日志（开发 / 测试 / 无 SMTP 环境），模拟成功投递
- 工厂 get_notifier()：根据 config 选择渠道；
  - NOTIFY_CHANNEL=none → 返回 None（不投递，投递记录保持 pending）
  - NOTIFY_CHANNEL=email 但 SMTP 未完整配置 → 回退 LogNotifier，避免测试/CI 发真实邮件
  - 其余（log 或默认）→ LogNotifier
"""
from __future__ import annotations

import logging
import smtplib
from abc import ABC, abstractmethod
from email.message import EmailMessage
from dataclasses import dataclass
from typing import Any

from . import config

logger = logging.getLogger("procurement")


@dataclass
class DeliveryResult:
    """单次投递结果"""
    success: bool
    message: str = ""
    error: str = ""


class Notifier(ABC):
    """投递渠道接口。variables 为模板变量（模板渲染由调用方完成，这里只负责发送）。"""

    @abstractmethod
    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        """发送一条消息到 to（邮箱/标识）。返回投递结果。"""


class LogNotifier(Notifier):
    """把发送记录写入日志，模拟一次成功投递（开发/测试/无 SMTP 环境）。"""

    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        logger.info(
            "notify_send",
            extra={"extra_fields": {
                "to": to,
                "subject": subject,
                "body": body[:500],
                "channel": "log",
            }},
        )
        return DeliveryResult(success=True, message="已写入日志（LogNotifier）")


class EmailNotifier(Notifier):
    """基于 smtplib 的 SMTP 邮件发送。"""

    def __init__(self) -> None:
        self.host = config.SMTP_HOST
        self.port = config.SMTP_PORT
        self.username = config.SMTP_USERNAME
        self.password = config.SMTP_PASSWORD
        self.from_addr = config.SMTP_FROM or config.SMTP_USERNAME
        self.use_tls = config.SMTP_USE_TLS

    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        if not self.host or not self.from_addr:
            return DeliveryResult(success=False, error="SMTP 未完整配置")
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.from_addr
        msg["To"] = to
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=15) as server:
                if self.use_tls:
                    server.starttls()
                if self.username:
                    server.login(self.username, self.password)
                server.send_message(msg)
            return DeliveryResult(success=True, message="邮件已发送")
        except Exception as exc:  # noqa: BLE001 - 投递失败需持久化记录，不向上抛出
            from . import metrics as metrics_mod
            metrics_mod.email_fail_total()
            logger.warning("notify_email_failed", extra={"extra_fields": {"to": to, "error": str(exc)}})
            return DeliveryResult(success=False, error=str(exc))


def get_notifier() -> Notifier | None:
    """生产渠道工厂。返回 None 表示未配置任何投递渠道（投递记录保持 pending）。"""
    channel = config.NOTIFY_CHANNEL
    if channel == "none":
        return None
    if channel == "email":
        # 未完整配置 SMTP 时回退 LogNotifier，避免测试/CI 发真实邮件
        if config.SMTP_HOST and config.SMTP_FROM:
            return EmailNotifier()
        logger.warning("NOTIFY_CHANNEL=email 但 SMTP 未完整配置，回退到 LogNotifier")
        return LogNotifier()
    return LogNotifier()