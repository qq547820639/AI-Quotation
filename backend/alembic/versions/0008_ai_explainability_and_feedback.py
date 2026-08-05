"""P1 深化 AI：提示词版本化 + 降级标记 + 反馈表

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-05

- ai_usage 新增 prompt_version（提示词版本号）、degraded（是否降级）列
- 新增 ai_feedback 表：记录「有帮助/无帮助/纠正」反馈（可解释性）
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---------- ai_usage：新增 prompt_version / degraded ----------
    op.add_column("ai_usage", sa.Column("prompt_version", sa.String(), nullable=True))
    op.add_column(
        "ai_usage",
        sa.Column("degraded", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # ---------- ai_feedback 表 ----------
    op.create_table(
        "ai_feedback",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("usage_id", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=True),
        sa.Column("feedback", sa.String(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("organization", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["usage_id"], ["ai_usage.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
    )
    op.create_index("ix_ai_feedback_usage_id", "ai_feedback", ["usage_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_feedback_usage_id", table_name="ai_feedback")
    op.drop_table("ai_feedback")
    op.drop_column("ai_usage", "degraded")
    op.drop_column("ai_usage", "prompt_version")