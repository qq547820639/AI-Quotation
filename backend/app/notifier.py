"""通知投递渠道抽象（P1-8 Task 12 + P0-6）

- Notifier 接口：send(to, subject, body, variables) → DeliveryResult
- Provider 接口：统一 send()/status hooks；标准实现 LogProvider / SMTPProvider / MailpitProvider
- NotifierError：可重试投递异常（邮件任务失败抛出，Celery 正确进入 retry/dead-letter）
- 工厂 get_notifier()：根据 config 选择渠道；
  - NOTIFY_CHANNEL=none → None（不投递，投递记录保持 pending）
  - NOTIFY_CHANNEL=email → SMTPProvider；SMTP 不完整时 prod 抛 NotifierError / dev 显式回退 log
  - NOTIFY_CHANNEL=mailpit|mailhog → MailpitProvider（开发/E2E）
  - 其余 → LogProvider（开发/测试）
- 生产（APP_ENV=prod）禁止自动回退 LogProvider：NOTIFY_CHANNEL=log 或 email 但 SMTP 不完整
  均由 config_validation 在启动时拒绝（见 config_validation.py）。
"""
from __future__ import annotations

import logging
import smtplib
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from email.message import EmailMessage
from dataclasses import dataclass
from typing import Any

import httpx

from . import config
from .database import SessionLocal
from .models import EmailDeliveryRecord
from .serializers import gen_id

logger = logging.getLogger("procurement")


class NotifierError(Exception):
    """可重试的通知投递异常。

    邮件任务（批量通知 / 邮件投递）失败时应抛出该异常，
    使 Celery 正确进入 retry 并在耗尽最大重试次数后写入 dead-letter / permanent_failure。
    """


@dataclass
class DeliveryResult:
    """单次投递结果"""
    success: bool
    message: str = ""
    error: str = ""
    provider_message_id: str = ""


class Notifier(ABC):
    """投递渠道接口。variables 为模板变量（模板渲染由调用方完成，这里只负责发送）。"""

    @abstractmethod
    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        """发送一条消息到 to（邮箱/标识）。返回投递结果。"""


class Provider(ABC):
    """标准投递 Provider 接口：send() + status hooks。

    新接入外部邮件服务时，实现本接口的 send()（同步投递）与 handle_status_hook()
    （异步 Webhook：delivered/opened/bounced 状态回填），并注册到 get_notifier()。
    """
    name: str = "abstract"

    @abstractmethod
    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        """同步投递一封邮件。瞬态失败（连接/网络/服务端 5xx）应抛 NotifierError 供重试。"""

    def handle_status_hook(self, event: str, ref: str, payload: dict | None = None) -> bool:
        """处理异步状态事件（delivered/opened/bounced），按 provider_message_id 回填投递记录。

        返回是否被消费。默认基于 email_delivery_records 更新；子类可覆盖以对接外部服务 Webhook。
        """
        db = SessionLocal()
        try:
            rec = db.query(EmailDeliveryRecord).filter(
                EmailDeliveryRecord.provider == self.name,
                EmailDeliveryRecord.provider_message_id == ref,
            ).first()
            if rec is None:
                return False
            now = datetime.now(timezone.utc)
            if event == "delivered":
                rec.delivered_at = now
            elif event == "opened":
                rec.opened_at = now
            elif event == "bounced":
                rec.bounced_at = now
                rec.last_error = (payload or {}).get("reason") or "bounced"
            else:
                return False
            db.commit()
            return True
        except Exception:  # noqa: BLE001 - 状态回填失败不影响投递主流程
            db.rollback()
            logger.exception("status_hook_failed", extra={"extra_fields": {"event": event, "ref": ref}})
            return False
        finally:
            db.close()


def _smtp_complete() -> bool:
    return bool(config.SMTP_HOST and config.SMTP_FROM)


class LogProvider(Provider):
    """把发送记录写入日志，模拟一次成功投递（开发/测试）。"""
    name = "log"

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
        return DeliveryResult(success=True, message="已写入日志（LogProvider）")


class SMTPProvider(Provider):
    """基于 smtplib 的 SMTP 邮件发送。瞬态 SMTP 失败抛 NotifierError 供任务重试。"""
    name = "smtp"

    def __init__(self) -> None:
        self.host = config.SMTP_HOST
        self.port = config.SMTP_PORT
        self.username = config.SMTP_USERNAME
        self.password = config.SMTP_PASSWORD
        self.from_addr = config.SMTP_FROM or config.SMTP_USERNAME
        self.use_tls = config.SMTP_USE_TLS

    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        if not _smtp_complete():
            raise NotifierError("SMTP 未完整配置")
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
        except Exception as exc:  # noqa: BLE001 - SMTP 连接/认证/传输瞬态失败，抛可重试异常
            from . import metrics as metrics_mod
            metrics_mod.email_fail_total()
            logger.warning("notify_email_failed", extra={"extra_fields": {"to": to, "error": str(exc)}})
            raise NotifierError(str(exc)) from exc


class MailpitProvider(Provider):
    """Mailpit/MailHog 开发/E2E 投递：通过 Mailpit HTTP API 发送。

    需 docker-compose.mailpit.yml 提供 mailpit 服务（SMTP :1025，HTTP API :8025）。
    MAILPIT_URL 为 HTTP API 基地址。网络/API 瞬态失败抛 NotifierError 供重试。
    """
    name = "mailpit"

    def __init__(self) -> None:
        self.base_url = config.MAILPIT_URL.rstrip("/")
        self.from_addr = config.SMTP_FROM or config.SMTP_USERNAME or "no-reply@example.com"

    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        url = f"{self.base_url}/api/v1/send"
        payload = {
            "to": [{"Address": to, "Name": ""}],
            "from": {"Address": self.from_addr, "Name": ""},
            "subject": subject,
            "text": body,
            "html": f"<pre>{body}</pre>",
        }
        try:
            resp = httpx.post(url, json=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            mid = str(data.get("id", ""))
            return DeliveryResult(success=True, message="邮件已投递到 Mailpit", provider_message_id=mid)
        except Exception as exc:  # noqa: BLE001 - 网络/API 瞬态失败，抛可重试异常
            raise NotifierError(str(exc)) from exc


class ProviderNotifier(Notifier):
    """包装 Provider，投递时持久化 email_delivery_records 投递记录。"""

    def __init__(self, provider: Provider) -> None:
        self.provider = provider

    def send(self, to: str, subject: str, body: str, variables: dict[str, Any] | None = None) -> DeliveryResult:
        result = self.provider.send(to, subject, body, variables)
        self._record(to, subject, result)
        return result

    def _record(self, to: str, subject: str, result: DeliveryResult) -> None:
        """持久化投递记录；记录写入失败不影响投递结果本身。"""
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            db.add(EmailDeliveryRecord(
                id=gen_id("edr"),
                recipient=to,
                subject=subject,
                provider=self.provider.name,
                provider_message_id=result.provider_message_id or None,
                queued_at=now,
                sent_at=now if result.success else None,
                last_error=result.error or None,
                attempt_count=1,
            ))
            db.commit()
        except Exception:  # noqa: BLE001 - 记录失败不得影响投递
            db.rollback()
            logger.exception("delivery_record_save_failed", extra={"extra_fields": {"to": to}})
        finally:
            db.close()


def get_notifier() -> Notifier | None:
    """投递渠道工厂。返回 None 表示未配置任何投递渠道（投递记录保持 pending）。

    生产环境（APP_ENV=prod）:
    - NOTIFY_CHANNEL=log 或 mailpit/mailhog/none → 本函数不在此静默降级，由 config_validation 启动拒绝；
      此处若仍被调用（防御）则抛 NotifierError。
    - NOTIFY_CHANNEL=email 但 SMTP 不完整 → 抛 NotifierError，禁止回退 LogProvider。
    """
    channel = config.NOTIFY_CHANNEL
    if channel == "none":
        return None
    if channel == "email":
        if not _smtp_complete():
            if config.APP_ENV == "prod":
                raise NotifierError("NOTIFY_CHANNEL=email 但 SMTP 未完整配置，生产禁止回退 LogProvider")
            logger.warning("NOTIFY_CHANNEL=email 但 SMTP 未完整配置，回退到 LogProvider（仅 dev/test）")
            return ProviderNotifier(LogProvider())
        return ProviderNotifier(SMTPProvider())
    if channel in ("mailpit", "mailhog"):
        if config.APP_ENV == "prod":
            raise NotifierError("生产环境禁止 NOTIFY_CHANNEL=mailpit/mailhog（开发/E2E 渠道）")
        return ProviderNotifier(MailpitProvider())
    # log 或默认
    if config.APP_ENV == "prod":
        raise NotifierError("生产环境禁止 NOTIFY_CHANNEL=log（开发/测试渠道），必须配置 email")
    return ProviderNotifier(LogProvider())