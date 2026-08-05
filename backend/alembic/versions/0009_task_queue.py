"""持久化任务队列：task_records 与 outbox_events 表

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-05

- task_records：Celery 任务持久化状态（含 permanent_failure），idempotency_key 唯一
- outbox_events：事务 outbox，pending/dispatched/failed，idempotency_key 唯一
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---------- task_records ----------
    op.create_table(
        "task_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("task_name", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("business_event_id", sa.String(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
    )
    op.create_index("ix_task_records_idempotency_key", "task_records", ["idempotency_key"], unique=True)
    op.create_index("ix_task_records_business_event_id", "task_records", ["business_event_id"], unique=False)
    op.create_index("ix_task_records_status", "task_records", ["status"], unique=False)

    # ---------- outbox_events ----------
    op.create_table(
        "outbox_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("aggregate_id", sa.String(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_outbox_events_idempotency_key", "outbox_events", ["idempotency_key"], unique=True)
    op.create_index("ix_outbox_events_aggregate_id", "outbox_events", ["aggregate_id"], unique=False)
    op.create_index("ix_outbox_events_status", "outbox_events", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_outbox_events_status", table_name="outbox_events")
    op.drop_index("ix_outbox_events_aggregate_id", table_name="outbox_events")
    op.drop_index("ix_outbox_events_idempotency_key", table_name="outbox_events")
    op.drop_table("outbox_events")

    op.drop_index("ix_task_records_status", table_name="task_records")
    op.drop_index("ix_task_records_business_event_id", table_name="task_records")
    op.drop_index("ix_task_records_idempotency_key", table_name="task_records")
    op.drop_table("task_records")