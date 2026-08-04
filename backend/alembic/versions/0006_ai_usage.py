"""P1-9 Task 14 AI 服务：ai_usage 调用统计表

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-04

- 新增 ai_usage 表：id/action/provider/model/prompt_tokens/completion_tokens/cost/latency_ms/created_at/created_by
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost", sa.Numeric(18, 6), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_usage_action"), "ai_usage", ["action"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ai_usage_action"), table_name="ai_usage")
    op.drop_table("ai_usage")