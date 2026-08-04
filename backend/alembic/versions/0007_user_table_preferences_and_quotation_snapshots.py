"""P2-12 Task 17：用户级表格偏好 + 报价不可变快照

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-04

- user_table_preferences 表：用户级表格视图/列配置持久化（复合主键 user_id + page_key）
- quotation_snapshots 表：定标确认时冻结报价数据，避免供应商后续修改影响审批记录
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ============ user_table_preferences 表 ============
    op.create_table(
        "user_table_preferences",
        sa.Column("user_id", sa.String(), primary_key=True),
        sa.Column("page_key", sa.String(), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )

    # ============ quotation_snapshots 表 ============
    op.create_table(
        "quotation_snapshots",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("inquiry_code", sa.String(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_by_name", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_quotation_snapshots_inquiry_id",
        "quotation_snapshots",
        ["inquiry_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_quotation_snapshots_inquiry_id", table_name="quotation_snapshots")
    op.drop_table("quotation_snapshots")
    op.drop_table("user_table_preferences")