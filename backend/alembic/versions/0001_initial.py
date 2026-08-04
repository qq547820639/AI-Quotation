"""初始迁移：完整创建全部业务表

Revision ID: 0001
Revises:
Create Date: 2026-08-04

包含 users / materials / suppliers / attachments / inquiries / inquiry_items /
inquiry_logs / approval_nodes / quotations / quotation_items / notifications /
app_settings / tokens / inquiry_supplier 全部表，含唯一约束、索引、外键。
与 app/models.py 的 ORM 定义保持一致。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 用户表
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("avatar", sa.Text(), nullable=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("department", sa.String(), nullable=False),
        sa.Column("organization", sa.String(), nullable=False),
        sa.Column("permissions", sa.JSON(), nullable=True),
        sa.Column("password_hash", sa.String(), nullable=True),
    )

    # 物料表（code 唯一 + 索引）
    op.create_table(
        "materials",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("brand", sa.String(), nullable=False),
        sa.Column("spec", sa.String(), nullable=False),
        sa.Column("tech_params", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("stock_qty", sa.Integer(), nullable=True),
        sa.UniqueConstraint("code", name="uq_materials_code"),
    )
    op.create_index("ix_materials_code", "materials", ["code"])

    # 供应商表（code 唯一 + 索引）
    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("region", sa.String(), nullable=False),
        sa.Column("contact", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("main_categories", sa.JSON(), nullable=False),
        sa.Column("level", sa.String(), nullable=False),
        sa.Column("cooperation_status", sa.String(), nullable=False),
        sa.Column("qualified", sa.Boolean(), nullable=False),
        sa.Column("history_response_rate", sa.Float(), nullable=False),
        sa.Column("history_fulfillment_rate", sa.Float(), nullable=False),
        sa.Column("avg_delivery_days", sa.Integer(), nullable=False),
        sa.Column("last_cooperate_time", sa.String(), nullable=True),
        sa.Column("history_coop_count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("code", name="uq_suppliers_code"),
    )
    op.create_index("ix_suppliers_code", "suppliers", ["code"])

    # 附件表（多态归属）
    op.create_table(
        "attachments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("upload_time", sa.String(), nullable=False),
        sa.Column("owner_type", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
    )

    # 询价单表（code 唯一 + 索引）
    op.create_table(
        "inquiries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("organization", sa.String(), nullable=False),
        sa.Column("owner_name", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("deadline", sa.String(), nullable=False),
        sa.Column("expected_delivery_date", sa.String(), nullable=True),
        sa.Column("delivery_address", sa.Text(), nullable=False),
        sa.Column("contact", sa.String(), nullable=False),
        sa.Column("payment_terms", sa.String(), nullable=False),
        sa.Column("invoice_requirement", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_by_id", sa.String(), nullable=False),
        sa.Column("created_by_name", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("selected_supplier_map", sa.JSON(), nullable=False),
        sa.Column("purchaser_comments", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.UniqueConstraint("code", name="uq_inquiries_code"),
    )
    op.create_index("ix_inquiries_code", "inquiries", ["code"])

    # 询价单明细（inquiry_id 外键 + 索引）
    op.create_table(
        "inquiry_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("material_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("brand", sa.String(), nullable=False),
        sa.Column("spec", sa.String(), nullable=False),
        sa.Column("tech_params", sa.Text(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("target_price", sa.Float(), nullable=True),
        sa.Column("expected_delivery_date", sa.String(), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_inquiry_items_inquiry_id", "inquiry_items", ["inquiry_id"])

    # 询价日志（inquiry_id 外键 + 索引）
    op.create_table(
        "inquiry_logs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("time", sa.String(), nullable=False),
        sa.Column("operator", sa.String(), nullable=False),
        sa.Column("operator_role", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("result", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_inquiry_logs_inquiry_id", "inquiry_logs", ["inquiry_id"])

    # 审批节点（inquiry_id 外键 + 索引）
    op.create_table(
        "approval_nodes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("node_order", sa.Integer(), nullable=False),
        sa.Column("approver_id", sa.String(), nullable=False),
        sa.Column("approver_name", sa.String(), nullable=False),
        sa.Column("approver_role", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("time", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_approval_nodes_inquiry_id", "approval_nodes", ["inquiry_id"])

    # 报价单（inquiry_id 外键 + 索引）
    op.create_table(
        "quotations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("supplier_id", sa.String(), nullable=False),
        sa.Column("supplier_name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("submitted_at", sa.String(), nullable=True),
        sa.Column("total_amount", sa.Float(), nullable=False),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_quotations_inquiry_id", "quotations", ["inquiry_id"])

    # 报价单明细（quotation_id 外键 + 索引）
    op.create_table(
        "quotation_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("quotation_id", sa.String(), nullable=False),
        sa.Column("inquiry_item_id", sa.String(), nullable=False),
        sa.Column("unit_price", sa.Float(), nullable=False),
        sa.Column("tax_rate", sa.Float(), nullable=False),
        sa.Column("tax_included_total", sa.Float(), nullable=False),
        sa.Column("moq", sa.Integer(), nullable=True),
        sa.Column("delivery_days", sa.Integer(), nullable=False),
        sa.Column("delivery_date", sa.String(), nullable=True),
        sa.Column("brand", sa.String(), nullable=True),
        sa.Column("warranty_months", sa.Integer(), nullable=True),
        sa.Column("payment_terms", sa.String(), nullable=True),
        sa.Column("valid_until", sa.String(), nullable=True),
        sa.Column("tech_deviation", sa.Text(), nullable=True),
        sa.Column("commercial_deviation", sa.Text(), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_quotation_items_quotation_id", "quotation_items", ["quotation_id"])

    # 通知表
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("inquiry_id", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("time", sa.String(), nullable=False),
        sa.Column("read", sa.Boolean(), nullable=False),
    )

    # 系统配置表（单行，id 固定为 1）
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("approval_enabled", sa.Boolean(), nullable=False),
        sa.Column("approval_amount_threshold", sa.Float(), nullable=False),
        sa.Column("approval_approver_id", sa.String(), nullable=False),
        sa.Column("notification_deadline_reminder", sa.Boolean(), nullable=False),
        sa.Column("notification_deadline_reminder_hours", sa.Integer(), nullable=False),
        sa.Column("notification_quotation_submitted", sa.Boolean(), nullable=False),
        sa.Column("notification_approval_result", sa.Boolean(), nullable=False),
    )

    # token 表（user_id 外键，expires_at DateTime）
    op.create_table(
        "tokens",
        sa.Column("token", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )

    # 询价-供应商 多对多关联表
    op.create_table(
        "inquiry_supplier",
        sa.Column("inquiry_id", sa.String(), nullable=False),
        sa.Column("supplier_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["inquiry_id"], ["inquiries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"]),
        sa.PrimaryKeyConstraint("inquiry_id", "supplier_id"),
    )


def downgrade() -> None:
    # 按外键依赖逆序删除
    op.drop_table("inquiry_supplier")
    op.drop_table("tokens")
    op.drop_table("app_settings")
    op.drop_table("notifications")
    op.drop_index("ix_quotation_items_quotation_id", table_name="quotation_items")
    op.drop_table("quotation_items")
    op.drop_index("ix_quotations_inquiry_id", table_name="quotations")
    op.drop_table("quotations")
    op.drop_index("ix_approval_nodes_inquiry_id", table_name="approval_nodes")
    op.drop_table("approval_nodes")
    op.drop_index("ix_inquiry_logs_inquiry_id", table_name="inquiry_logs")
    op.drop_table("inquiry_logs")
    op.drop_index("ix_inquiry_items_inquiry_id", table_name="inquiry_items")
    op.drop_table("inquiry_items")
    op.drop_index("ix_inquiries_code", table_name="inquiries")
    op.drop_table("inquiries")
    op.drop_table("attachments")
    op.drop_index("ix_suppliers_code", table_name="suppliers")
    op.drop_table("suppliers")
    op.drop_index("ix_materials_code", table_name="materials")
    op.drop_table("materials")
    op.drop_table("users")