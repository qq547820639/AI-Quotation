"""任务记录归属：task_records 增加 user_id / organization（P0-7 安全边界）

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-05

P0-7：为 task_records 增加可空的 user_id / organization 归属列，用于任务列表的
横向越权（IDOR）与跨组织可见性隔离。旧行可空（归属未知，普通用户不可见）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("task_records", sa.Column("user_id", sa.String(), nullable=True))
    op.add_column("task_records", sa.Column("organization", sa.String(), nullable=True))
    op.create_index("ix_task_records_user_id", "task_records", ["user_id"], unique=False)
    op.create_index("ix_task_records_organization", "task_records", ["organization"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_task_records_organization", table_name="task_records")
    op.drop_index("ix_task_records_user_id", table_name="task_records")
    op.drop_column("task_records", "organization")
    op.drop_column("task_records", "user_id")