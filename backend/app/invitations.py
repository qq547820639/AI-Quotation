"""供应商邀请 token 服务

- 生成密码学安全的随机邀请 token（secrets.token_urlsafe）
- 数据库仅存储 token 的 SHA-256 哈希，绝不存储原始 token
- 提供创建 / 撤销 / 重新生成 / 按哈希查询 / 有效性校验
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .config import INVITATION_TOKEN_TTL_HOURS
from .models import Inquiry, SupplierInvitation
from .redis_client import get_store
from .serializers import gen_id

# 原始 token 存放于短期存储（Redis/内存回退），key 前缀，TTL 与邀请有效期一致。
# 数据库只存哈希；原始 token 仅用于投递邮件链接与内部"获取邀请链接"端点，不落库。
RAW_TOKEN_KEY_PREFIX = "procurement:inv:raw:"

# 邀请状态枚举
INV_PENDING = "pending"
INV_SENT = "sent"
INV_OPENED = "opened"
INV_REVOKED = "revoked"
INV_SUBMITTED = "submitted"
INV_EXPIRED = "expired"

# 可用的（处于有效状态）邀请状态
VALID_INVITATION_STATUSES = (INV_PENDING, INV_SENT, INV_OPENED)


def generate_invitation_token() -> str:
    """生成密码学安全的随机邀请 token（48 字节 URL-safe）"""
    return secrets.token_urlsafe(48)


def hash_invitation_token(token: str) -> str:
    """对邀请 token 计算 SHA-256 十六进制摘要"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_invitation(db: Session, inquiry_id: str, supplier_id: str, created_by: str) -> tuple[str, SupplierInvitation]:
    """创建一条供应商邀请，返回 (原始 token, SupplierInvitation)。

    注意：原始 token 仅返回给调用方用于发送，不做持久化；为支持投递邮件链接与
    内部"获取邀请链接"端点，会将其写入短期存储（Redis/内存），TTL 与邀请有效期一致。
    """
    token = generate_invitation_token()
    token_hash = hash_invitation_token(token)
    now = datetime.now(timezone.utc)
    invitation = SupplierInvitation(
        id=gen_id("inv"),
        inquiry_id=inquiry_id,
        supplier_id=supplier_id,
        token_hash=token_hash,
        expires_at=now + timedelta(hours=INVITATION_TOKEN_TTL_HOURS),
        status=INV_PENDING,
        created_at=now,
        created_by=created_by,
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    # 原始 token 写入短期存储（不落库），便于投递与"重新生成/获取链接"端点使用
    store_raw_token(invitation.id, token)
    return token, invitation


def store_raw_token(invitation_id: str, raw_token: str) -> None:
    """将原始邀请 token 写入短期存储（Redis/内存回退），TTL 与邀请有效期一致。"""
    get_store().set(
        f"{RAW_TOKEN_KEY_PREFIX}{invitation_id}",
        raw_token,
        ttl=INVITATION_TOKEN_TTL_HOURS * 3600,
    )


def get_invitation_raw_token(invitation_id: str) -> str | None:
    """从短期存储读取原始邀请 token；已被重新生成/过期则返回 None。"""
    return get_store().get(f"{RAW_TOKEN_KEY_PREFIX}{invitation_id}")


def revoke_invitation(db: Session, invitation: SupplierInvitation) -> SupplierInvitation:
    """撤销邀请：status=revoked, revoked_at=now"""
    invitation.status = INV_REVOKED
    invitation.revoked_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invitation)
    return invitation


def regenerate_invitation(db: Session, invitation: SupplierInvitation, created_by: str) -> tuple[str, SupplierInvitation]:
    """在当前供应商邀请上原地重新生成 token（保持 (inquiry_id, supplier_id) 唯一）。

    撤销旧 token 并签发新 token，使旧链接立即失效；不新增行，符合唯一的
    (inquiry_id, supplier_id) 约束。原始新 token 仅写入短期存储，不落库。
    """
    token = generate_invitation_token()
    token_hash = hash_invitation_token(token)
    now = datetime.now(timezone.utc)
    invitation.token_hash = token_hash
    invitation.expires_at = now + timedelta(hours=INVITATION_TOKEN_TTL_HOURS)
    invitation.status = INV_PENDING
    invitation.revoked_at = None  # 新 token 生效，清除撤销标记
    invitation.sent_at = None
    invitation.first_opened_at = None
    invitation.last_opened_at = None
    invitation.submitted_at = None
    invitation.created_by = created_by
    db.commit()
    db.refresh(invitation)
    # 覆盖短期存储中的原始 token（同 invitation.id 的 key），新 token 立即生效
    store_raw_token(invitation.id, token)
    return token, invitation


def get_invitation_by_token(db: Session, raw_token: str) -> SupplierInvitation | None:
    """按原始 token 哈希查询邀请，返回模型或 None"""
    if not raw_token:
        return None
    token_hash = hash_invitation_token(raw_token)
    return db.query(SupplierInvitation).filter(SupplierInvitation.token_hash == token_hash).first()


def is_invitation_valid(invitation: SupplierInvitation, now: datetime | None = None) -> bool:
    """校验邀请是否有效：状态在 (pending/sent/opened) 且未过期且询价未被取消/完成

    注意：Token 表等使用 datetime.utcnow（naive），SupplierInvitation 使用 timezone-aware。
    这里统一以 aware datetime 比较。
    """
    now = now or datetime.now(timezone.utc)
    if invitation.status not in VALID_INVITATION_STATUSES:
        return False
    if invitation.expires_at is not None:
        # 兼容 naive 与 aware 两种存储
        exp = invitation.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now:
            return False
    inquiry = invitation.inquiry
    if inquiry is not None and inquiry.status in ("CANCELLED", "COMPLETED", "TIMEOUT"):
        return False
    return True


def invitation_error(invitation: SupplierInvitation) -> str:
    """返回邀请被拒绝时的结构化错误信息（供 403/410 使用）"""
    if invitation.status == INV_REVOKED:
        return "invitation_revoked"
    if invitation.status == INV_SUBMITTED:
        return "invitation_submitted"
    return "invitation_expired"