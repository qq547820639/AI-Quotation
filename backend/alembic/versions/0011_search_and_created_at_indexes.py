"""搜索/创建时间/供应商高频列索引（P2 Task 22）

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-05

为列表页搜索与时间范围/供应商筛选补充索引：
- inquiries.subject / owner_name：关键词 LIKE 搜索（code 已有唯一索引）
- inquiries.created_at：创建时间范围过滤 + 稳定排序
- quotations.supplier_id：按供应商筛选
- quotations.created_at：稳定排序

仅新增索引，无列/表结构变更；upgrade / downgrade 均可在 SQLite / Postgres 上执行。
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_inquiries_subject", "inquiries", ["subject"], unique=False)
    op.create_index("ix_inquiries_owner_name", "inquiries", ["owner_name"], unique=False)
    op.create_index("ix_inquiries_created_at", "inquiries", ["created_at"], unique=False)
    op.create_index("ix_quotations_supplier_id", "quotations", ["supplier_id"], unique=False)
    op.create_index("ix_quotations_created_at", "quotations", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_quotations_created_at", table_name="quotations")
    op.drop_index("ix_quotations_supplier_id", table_name="quotations")
    op.drop_index("ix_inquiries_created_at", table_name="inquiries")
    op.drop_index("ix_inquiries_owner_name", table_name="inquiries")
    op.drop_index("ix_inquiries_subject", table_name="inquiries")