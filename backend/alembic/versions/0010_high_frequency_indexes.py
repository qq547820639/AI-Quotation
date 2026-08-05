"""高频查询索引（P1 Task 7）

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-05

为高频查询路径补充索引：
- inquiries.organization / status / owner_id：列表过滤与组织可见性
- quotations.status：状态筛选
- notifications.user_id：按用户查通知
- attachments(owner_type, owner_id)：多态附件归属查询

仅新增索引，无列/表结构变更；upgrade / downgrade 均可在 SQLite / Postgres 上执行。
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_inquiries_organization", "inquiries", ["organization"], unique=False)
    op.create_index("ix_inquiries_status", "inquiries", ["status"], unique=False)
    op.create_index("ix_inquiries_owner_id", "inquiries", ["owner_id"], unique=False)
    op.create_index("ix_quotations_status", "quotations", ["status"], unique=False)
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)
    op.create_index("ix_attachments_owner", "attachments", ["owner_type", "owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_attachments_owner", table_name="attachments")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_index("ix_quotations_status", table_name="quotations")
    op.drop_index("ix_inquiries_owner_id", table_name="inquiries")
    op.drop_index("ix_inquiries_status", table_name="inquiries")
    op.drop_index("ix_inquiries_organization", table_name="inquiries")