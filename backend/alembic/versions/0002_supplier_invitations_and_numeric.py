"""P0：供应商邀请 + 金额 Numeric 化 + 外键/约束

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-04

- 新建 supplier_invitations 表（仅存 token 哈希）
- notifications 增加 user_id 外键
- quotations 增加 supplier_id 外键、receipt_code 列、唯一约束 (inquiry_id, supplier_id)
- quotation_items 增加 inquiry_item_id 外键
- 金额字段 Float → Numeric
- 增加 CheckConstraint / UniqueConstraint
- 使用 batch_alter_table 保证 SQLite 兼容
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ============ 新建 supplier_invitations 表 ============
    op.create_table(
        "supplier_invitations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("supplier_id", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.UniqueConstraint("inquiry_id", "supplier_id", name="uq_supplier_invitations_inquiry_supplier"),
        sa.UniqueConstraint("token_hash", name="uq_supplier_invitations_token_hash"),
    )
    op.create_index("ix_supplier_invitations_inquiry_id", "supplier_invitations", ["inquiry_id"])
    op.create_index("ix_supplier_invitations_supplier_id", "supplier_invitations", ["supplier_id"])
    op.create_index("ix_supplier_invitations_token_hash", "supplier_invitations", ["token_hash"])

    # ============ notifications.user_id ============
    with op.batch_alter_table("notifications") as batch_op:
        batch_op.add_column(sa.Column("user_id", sa.String(), nullable=False, server_default=""))
        batch_op.create_foreign_key("fk_notifications_user_id", "users", ["user_id"], ["id"])

    # ============ quotations ============
    with op.batch_alter_table("quotations") as batch_op:
        batch_op.add_column(sa.Column("receipt_code", sa.String(), nullable=True))
        batch_op.create_foreign_key("fk_quotations_supplier_id", "suppliers", ["supplier_id"], ["id"])
        batch_op.create_unique_constraint("uq_quotations_inquiry_id_supplier_id", ["inquiry_id", "supplier_id"])
        batch_op.create_index("ix_quotations_receipt_code", ["receipt_code"])
        batch_op.alter_column("total_amount", type_=sa.Numeric(18, 2), existing_type=sa.Float(), nullable=False)

    # ============ quotation_items ============
    with op.batch_alter_table("quotation_items") as batch_op:
        batch_op.create_foreign_key("fk_quotation_items_inquiry_item_id", "inquiry_items", ["inquiry_item_id"], ["id"])
        batch_op.create_check_constraint("ck_quotation_items_unit_price_nonneg", "unit_price >= 0")
        batch_op.create_check_constraint("ck_quotation_items_delivery_days_nonneg", "delivery_days >= 0")
        batch_op.create_check_constraint("ck_quotation_items_tax_rate_range", "tax_rate >= 0 AND tax_rate <= 1")
        batch_op.alter_column("unit_price", type_=sa.Numeric(18, 2), existing_type=sa.Float(), nullable=False)
        batch_op.alter_column("tax_rate", type_=sa.Numeric(10, 4), existing_type=sa.Float(), nullable=False)
        batch_op.alter_column("tax_included_total", type_=sa.Numeric(18, 2), existing_type=sa.Float(), nullable=False)

    # ============ inquiry_items ============
    with op.batch_alter_table("inquiry_items") as batch_op:
        batch_op.create_check_constraint("ck_inquiry_items_quantity_positive", "quantity > 0")
        batch_op.alter_column("target_price", type_=sa.Numeric(18, 2), existing_type=sa.Float(), nullable=True)

    # ============ approval_nodes 唯一约束 ============
    with op.batch_alter_table("approval_nodes") as batch_op:
        batch_op.create_unique_constraint("uq_approval_nodes_inquiry_id_node_order", ["inquiry_id", "node_order"])

    # ============ suppliers / app_settings 金额 Numeric ============
    with op.batch_alter_table("suppliers") as batch_op:
        batch_op.alter_column("history_response_rate", type_=sa.Numeric(6, 4), existing_type=sa.Float(), nullable=False)
        batch_op.alter_column("history_fulfillment_rate", type_=sa.Numeric(6, 4), existing_type=sa.Float(), nullable=False)

    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.alter_column("approval_amount_threshold", type_=sa.Numeric(18, 2), existing_type=sa.Float(), nullable=False)


def downgrade() -> None:
    # 金额回退 Float
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.alter_column("approval_amount_threshold", type_=sa.Float(), existing_type=sa.Numeric(18, 2), nullable=False)
    with op.batch_alter_table("suppliers") as batch_op:
        batch_op.alter_column("history_response_rate", type_=sa.Float(), existing_type=sa.Numeric(6, 4), nullable=False)
        batch_op.alter_column("history_fulfillment_rate", type_=sa.Float(), existing_type=sa.Numeric(6, 4), nullable=False)

    with op.batch_alter_table("approval_nodes") as batch_op:
        batch_op.drop_constraint("uq_approval_nodes_inquiry_id_node_order", type_="unique")

    with op.batch_alter_table("inquiry_items") as batch_op:
        batch_op.drop_constraint("ck_inquiry_items_quantity_positive", type_="check")
        batch_op.alter_column("target_price", type_=sa.Float(), existing_type=sa.Numeric(18, 2), nullable=True)

    with op.batch_alter_table("quotation_items") as batch_op:
        batch_op.alter_column("tax_included_total", type_=sa.Float(), existing_type=sa.Numeric(18, 2), nullable=False)
        batch_op.alter_column("tax_rate", type_=sa.Float(), existing_type=sa.Numeric(10, 4), nullable=False)
        batch_op.alter_column("unit_price", type_=sa.Float(), existing_type=sa.Numeric(18, 2), nullable=False)
        batch_op.drop_constraint("ck_quotation_items_tax_rate_range", type_="check")
        batch_op.drop_constraint("ck_quotation_items_delivery_days_nonneg", type_="check")
        batch_op.drop_constraint("ck_quotation_items_unit_price_nonneg", type_="check")
        batch_op.drop_constraint("fk_quotation_items_inquiry_item_id", type_="foreignkey")

    with op.batch_alter_table("quotations") as batch_op:
        batch_op.alter_column("total_amount", type_=sa.Float(), existing_type=sa.Numeric(18, 2), nullable=False)
        batch_op.drop_index("ix_quotations_receipt_code")
        batch_op.drop_constraint("uq_quotations_inquiry_id_supplier_id", type_="unique")
        batch_op.drop_constraint("fk_quotations_supplier_id", type_="foreignkey")
        batch_op.drop_column("receipt_code")

    with op.batch_alter_table("notifications") as batch_op:
        batch_op.drop_constraint("fk_notifications_user_id", type_="foreignkey")
        batch_op.drop_column("user_id")

    op.drop_index("ix_supplier_invitations_token_hash", table_name="supplier_invitations")
    op.drop_index("ix_supplier_invitations_supplier_id", table_name="supplier_invitations")
    op.drop_index("ix_supplier_invitations_inquiry_id", table_name="supplier_invitations")
    op.drop_table("supplier_invitations")