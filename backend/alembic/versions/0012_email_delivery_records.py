"""邮件投递记录：email_delivery_records 表

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-05

P0-6：逐封邮件投递状态追踪，记录 provider、provider_message_id、各阶段时间戳
（queued/sent/delivered/opened/bounced）、最近错误与重试次数。异步 Webhook 回填阶段时间戳。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_delivery_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("recipient", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_message_id", sa.String(), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bounced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("notification_id", sa.String(), nullable=True),
        sa.Column("inquiry_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_email_delivery_provider_msgid", "email_delivery_records", ["provider", "provider_message_id"], unique=False)
    op.create_index("ix_email_delivery_records_recipient", "email_delivery_records", ["recipient"], unique=False)
    op.create_index("ix_email_delivery_records_notification_id", "email_delivery_records", ["notification_id"], unique=False)
    op.create_index("ix_email_delivery_records_inquiry_id", "email_delivery_records", ["inquiry_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_email_delivery_records_inquiry_id", table_name="email_delivery_records")
    op.drop_index("ix_email_delivery_records_notification_id", table_name="email_delivery_records")
    op.drop_index("ix_email_delivery_records_recipient", table_name="email_delivery_records")
    op.drop_index("ix_email_delivery_provider_msgid", table_name="email_delivery_records")
    op.drop_table("email_delivery_records")