"""P1-8 Task 13 安全附件上传：附件病毒扫描状态预留

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-04

- attachments 增加 scan_status（pending/scanned/clean/infected/error）与 scan_result
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("attachments") as batch_op:
        batch_op.add_column(sa.Column("scan_status", sa.String(), nullable=False, server_default="pending"))
        batch_op.add_column(sa.Column("scan_result", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("attachments") as batch_op:
        batch_op.drop_column("scan_result")
        batch_op.drop_column("scan_status")