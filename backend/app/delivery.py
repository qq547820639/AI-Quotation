"""询价投递服务（P1-8 Task 12）

职责：
- 为询价受邀供应商创建/更新 SupplierInvitation 投递记录（delivery_status）
- 生成并投递询价模板（异步任务，可重试且幂等）
- 汇总逐供应商交付状态（采购端展示）
- 截止提醒（未提交供应商 → 通知采购人员）
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import config
from .database import SessionLocal
from .invitations import create_invitation, get_invitation_raw_token
from .models import (
    User, Inquiry, Supplier, SupplierInvitation, Notification,
    AppSettings, UserNotificationPreference,
)
from .notifier import get_notifier, Notifier
from .serializers import gen_notification_id, now_iso
from .templates import render_subject, render_template

logger = logging.getLogger("procurement")

# 交付状态枚举
D_PENDING = "pending"      # 待发送
D_SENT = "sent"            # 已发送
D_DELIVERED = "delivered"  # 已送达
D_FAILED = "failed"        # 失败
D_BOUNCED = "bounced"      # 退信
D_OPENED = "opened"        # 已打开
D_SUBMITTED = "submitted"  # 已提交

# 邀请状态 → 交付状态联动
INV_SENT = "sent"
INV_OPENED = "opened"
INV_SUBMITTED = "submitted"


def ensure_invitations(db: Session, inquiry: Inquiry, user: User) -> None:
    """为询价所有受邀供应商创建投递记录（SupplierInvitation），已存在则跳过。

    幂等：每 (inquiry_id, supplier_id) 唯一。已撤销/已提交的邀请不重复创建。
    """
    for supplier in inquiry.invited_suppliers:
        existing = db.query(SupplierInvitation).filter(
            SupplierInvitation.inquiry_id == inquiry.id,
            SupplierInvitation.supplier_id == supplier.id,
        ).first()
        if existing is not None:
            continue
        create_invitation(db, inquiry.id, supplier.id, user.id)


def _invitation_context(invitation: SupplierInvitation, db: Session) -> dict:
    """构造模板变量上下文（原始 token 仅取自短期存储，不持久化）。"""
    inquiry = db.query(Inquiry).filter(Inquiry.id == invitation.inquiry_id).first()
    supplier = db.query(Supplier).filter(Supplier.id == invitation.supplier_id).first()
    # 原始 token 从短期存储读取；已被重新生成则取不到，此时不注入 portalUrl（避免发出失效链接）
    raw_token = get_invitation_raw_token(invitation.id)
    if not raw_token:
        # 防御性处理：绝不对明文 token 已丢失的邀请发出空/失效链接
        raise ValueError("invitation raw token is missing; cannot build a valid portal link")
    portal_url = f"{config.PORTAL_BASE_URL}?token={raw_token}"
    return {
        "inquiryCode": inquiry.code if inquiry else "",
        "subject": inquiry.subject if inquiry else "",
        "deadline": inquiry.deadline if inquiry else "",
        "supplierName": supplier.name if supplier else "",
        "count": str(len(inquiry.invited_suppliers)) if inquiry else "0",
        "organization": inquiry.organization if inquiry else "",
        "portalUrl": portal_url,
    }


def deliver_single_invitation(db: Session, invitation: SupplierInvitation, notifier: Notifier | None) -> None:
    """投递单个邀请（幂等：仅投递 pending / failed）。

    成功 → sent + sent_at；失败 → failed + delivery_error。无渠道 → 保持 pending。
    """
    if invitation.delivery_status not in (D_PENDING, D_FAILED):
        return
    if invitation.status in (INV_SUBMITTED, "revoked"):
        return
    if notifier is None:
        # 未配置投递渠道：保持 pending，不假装已发送
        return
    supplier = db.query(Supplier).filter(Supplier.id == invitation.supplier_id).first()
    to = supplier.email if supplier else ""
    try:
        variables = _invitation_context(invitation, db)
    except ValueError as exc:
        # 防御性处理：明文 token 缺失时绝不发出空链接，标记为失败而非静默
        logger.warning(
            "invitation_raw_token_missing",
            extra={"extra_fields": {"invitation_id": invitation.id, "error": str(exc)}},
        )
        invitation.delivery_status = D_FAILED
        invitation.delivery_error = "邀请 token 缺失，无法生成有效链接"
        return
    subject = render_subject("inquiry", None, variables)
    body = render_template("inquiry", None, variables)
    result = notifier.send(to, subject, body, variables)
    if result.success:
        invitation.delivery_status = D_SENT
        invitation.sent_at = datetime.now(timezone.utc)
        invitation.delivery_error = None
    else:
        invitation.delivery_status = D_FAILED
        invitation.delivery_error = result.error or "投递失败"


def deliver_pending_inquiry(inquiry_id: str) -> None:
    """后台任务：投递某询价下所有待发送/失败的邀请。

    使用独立 session，避免与请求 session 冲突；可重试且幂等（delivery_status 判断）。
    """
    notifier = get_notifier()
    if notifier is None:
        return
    db = SessionLocal()
    try:
        invitations = db.query(SupplierInvitation).filter(
            SupplierInvitation.inquiry_id == inquiry_id,
            SupplierInvitation.delivery_status.in_((D_PENDING, D_FAILED)),
        ).all()
        for inv in invitations:
            deliver_single_invitation(db, inv, notifier)
        db.commit()
    except Exception:  # noqa: BLE001 - 后台任务失败不得影响主流程
        db.rollback()
        logger.exception("deliver_pending_inquiry_failed", extra={"extra_fields": {"inquiry_id": inquiry_id}})
    finally:
        db.close()


def delivery_summary(invitations: list[SupplierInvitation]) -> dict:
    """汇总交付状态计数。"""
    statuses = [i.delivery_status for i in invitations]
    summary = {
        "total": len(statuses),
        "pending": statuses.count(D_PENDING),
        "sent": statuses.count(D_SENT) + statuses.count(D_DELIVERED),
        "delivered": statuses.count(D_DELIVERED),
        "failed": statuses.count(D_FAILED) + statuses.count(D_BOUNCED),
        "submitted": statuses.count(D_SUBMITTED),
    }
    # 已送达语义：opened/submitted 视为已送达
    summary["allDelivered"] = (
        summary["total"] > 0
        and summary["pending"] == 0
        and summary["failed"] == 0
    )
    return summary


def _user_preference(db: Session, user_id: str) -> UserNotificationPreference | None:
    return db.query(UserNotificationPreference).filter(
        UserNotificationPreference.user_id == user_id
    ).first()


def generate_deadline_reminders(db: Session) -> int:
    """为临近截止且存在未提交供应商的询价生成提醒通知（返回创建条数）。

    归属：通知发给询价创建人（owner）。规则：截止时间在 notification_deadline_reminder_hours
    内（从全局 AppSettings 或用户偏好读取）。幂等：同一 (inquiry_id, user_id, type) 已存在则不重复。
    """
    settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if settings is not None and not settings.notification_deadline_reminder:
        return 0
    hours = settings.notification_deadline_reminder_hours if settings else 24
    now = datetime.now()
    window_end = now + timedelta(hours=hours)

    created = 0
    inquiries = db.query(Inquiry).filter(Inquiry.status == "INQUIRING").all()
    for inq in inquiries:
        pref = _user_preference(db, inq.owner_id)
        if pref is not None and not pref.deadline_reminder:
            continue
        try:
            deadline = datetime.strptime(inq.deadline, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        if not (now < deadline <= window_end):
            continue
        # 存在未提交供应商
        has_pending = db.query(SupplierInvitation).filter(
            SupplierInvitation.inquiry_id == inq.id,
            SupplierInvitation.status != INV_SUBMITTED,
        ).first()
        if not has_pending:
            continue
        # 幂等：已存在该询价 + 该用户的截止提醒则跳过
        dup = db.query(Notification).filter(
            Notification.inquiry_id == inq.id,
            Notification.user_id == inq.owner_id,
            Notification.type == "deadline_approaching",
        ).first()
        if dup is not None:
            continue
        db.add(Notification(
            id=gen_notification_id(),
            user_id=inq.owner_id,
            inquiry_id=inq.id,
            type="deadline_approaching",
            title=f"询价单 {inq.code} 即将截止",
            content=f"报价截止时间：{inq.deadline}，请关注未提交供应商",
            time=now_iso(),
            read=False,
        ))
        created += 1
    db.commit()
    return created