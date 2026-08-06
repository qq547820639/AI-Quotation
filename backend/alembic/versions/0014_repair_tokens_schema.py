"""修复 tokens 表与 Token 模型漂移（token_hash / session_id）

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-06

背景：0001 创建 tokens 表时列名为 token（明文主键）；后续安全加固将 Token 模型改为
仅存 SHA-256 哈希（token_hash）并新增 session_id 外键，但未新增迁移同步 schema，
导致真实 PostgreSQL（走 Alembic 迁移）下查询 token_hash 报 UndefinedColumn。

本迁移将：
- 若存在 token 列且无 token_hash，则重命名为 token_hash（保留主键语义）。
- 新增可空 session_id 列 + 外键 + 索引（供会话级 token 撤销）。
- 幂等：若目标列已存在则跳过，避免在 create_all 初始化过的库上重复报错。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns() -> set[str]:
    """返回 tokens 表当前存在的列名集合。"""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = inspector.get_columns("tokens")
    return {c["name"] for c in cols}


def upgrade() -> None:
    cols = _columns()
    # 1) token -> token_hash（保留主键）
    if "token" in cols and "token_hash" not in cols:
        op.alter_column("tokens", "token", new_column_name="token_hash")
    # 2) 新增 session_id（可空，历史 access token 无会话归属）
    if "session_id" not in cols:
        op.add_column("tokens", sa.Column("session_id", sa.String(), nullable=True))
        op.create_index("ix_tokens_session_id", "tokens", ["session_id"], unique=False)
        # 仅非 SQLite 方言创建外键（SQLite 不支持 ALTER 加约束，需 batch 模式；生产/CI 为 PG）
        if op.get_bind().dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_tokens_session_id",
                "tokens",
                "sessions",
                ["session_id"],
                ["id"],
            )


def downgrade() -> None:
    cols = _columns()
    if "session_id" in cols:
        op.drop_index("ix_tokens_session_id", table_name="tokens")
        if op.get_bind().dialect.name != "sqlite":
            op.drop_constraint("fk_tokens_session_id", "tokens", type_="foreignkey")
        op.drop_column("tokens", "session_id")
    if "token_hash" in cols and "token" not in cols:
        op.alter_column("tokens", "token_hash", new_column_name="token")