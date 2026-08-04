"""P1-8 Task 12：通知投递状态 + 用户级通知偏好

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-04

- supplier_invitations 增加 delivery_status（pending/sent/delivered/failed/bounced/opened/submitted）
  与 delivery_error（最近一次投递失败原因）
- 新建 user_notification_preferences 表（用户级通知偏好）
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ============ supplier_invitations 投递状态 ============
    with op.batch_alter_table("supplier_invitations") as batch_op:
        batch_op.add_column(sa.Column("delivery_status", sa.String(), nullable=False, server_default="pending"))
        batch_op.add_column(sa.Column("delivery_error", sa.Text(), nullable=True))

    # ============ user_notification_preferences 表 ============
    op.create_table(
        "user_notification_preferences",
        sa.Column("user_id", sa.String(), primary_key=True),
        sa.Column("deadline_reminder", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deadline_reminder_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("quotation_submitted", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("approval_result", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("inquiry_sent", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )


def downgrade() -> None:
    op.drop_table("user_notification_preferences")

    with op.batch_alter_table("supplier_invitations") as batch_op:
        batch_op.drop_column("delivery_error")
        batch_op.drop_column("delivery_status")