"""AppSettings 新增 AI 服务配置列（provider/base_url/model/api_key/structured_output）

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-07

背景：AI 配置原先仅由环境变量（AI_PROVIDER/AI_API_KEY/...）控制。为支持在设置页
可视化配置（含 API Key），将 AI 配置持久化到 AppSettings 单行表。

本迁移为 app_settings 表新增 5 列，均带默认值，历史数据行自动补齐，无需回填。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns() -> set[str]:
    """返回 app_settings 表当前存在的列名集合（幂等迁移用）。"""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = inspector.get_columns("app_settings")
    return {c["name"] for c in cols}


def upgrade() -> None:
    cols = _columns()
    if "ai_provider" not in cols:
        op.add_column("app_settings", sa.Column("ai_provider", sa.String(), nullable=False, server_default="local"))
    if "ai_base_url" not in cols:
        op.add_column("app_settings", sa.Column("ai_base_url", sa.String(), nullable=False, server_default=""))
    if "ai_model" not in cols:
        op.add_column("app_settings", sa.Column("ai_model", sa.String(), nullable=False, server_default=""))
    if "ai_api_key" not in cols:
        op.add_column("app_settings", sa.Column("ai_api_key", sa.String(), nullable=False, server_default=""))
    if "ai_structured_output" not in cols:
        op.add_column(
            "app_settings",
            sa.Column("ai_structured_output", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )


def downgrade() -> None:
    cols = _columns()
    for col in ("ai_provider", "ai_base_url", "ai_model", "ai_api_key", "ai_structured_output"):
        if col in cols:
            op.drop_column("app_settings", col)