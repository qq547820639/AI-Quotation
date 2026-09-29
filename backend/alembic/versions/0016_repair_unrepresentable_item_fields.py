"""修复 inquiry_items 里读侧无法表示的行（quantity / target_price）

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-26

背景（R35）：`_build_inquiry_items` 曾把前端值原样写库，而 SQLite 的列不校验类型，
于是 `quantity="NOT-A-NUMBER"` 能落库；读侧 `InquiryItemSchema.quantity: int`
在 `GET /api/inquiries` 的序列化里抛 ValidationError —— **一条坏行让列表对所有人 500**。
写边界已在同一次改动里封住（改走读侧 schema 校验），但**已经躺在库里的坏行不会被写侧修复**：
实测修复后 `POST` 坏值返回 422，而 `GET /api/inquiries` 仍 500。本迁移负责治已发生的。

策略（不伪造、不静默丢数据）：
- quantity 可无损转换（int / 整值 float / 数字字符串）→ 就地改成该整值；
- quantity 不可表示 → 删除这一行，并在父询价单的 inquiry_logs 追加一条 DATA_REPAIR 留痕，
  写明被删的 item id 与原始值。不选"置 0"：表上有 CHECK (quantity > 0)，0 会被拒；
  也不选"猜一个数"：那是替用户伪造业务事实。
- target_price 不可表示 → 置 NULL（该列本就可空，NULL 是诚实的"不知道"）。

幂等：修复后再跑一次，所有值都已可表示，不做任何变更。
Postgres 上 quantity/target_price 是强类型列，坏值根本进不去，本迁移自然空转。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _as_int(value):
    """能无损表示为 int 才返回，否则 None。bool 不算 int（True→1 是语义漂移）。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _as_float(value):
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, inquiry_id, quantity, target_price FROM inquiry_items")
    ).mappings().all()

    repaired = 0
    removed = 0
    for r in rows:
        q_ok = _as_int(r["quantity"])
        if q_ok is None:
            # 不可表示：删行 + 留痕
            bind.execute(
                sa.text("DELETE FROM inquiry_items WHERE id = :id"), {"id": r["id"]}
            )
            bind.execute(
                sa.text(
                    "INSERT INTO inquiry_logs "
                    "(id, inquiry_id, time, operator, operator_role, type, content, result) "
                    "VALUES (:id, :inquiry_id, :time, :operator, :operator_role, "
                    ":type, :content, :result)"
                ),
                {
                    "id": f"log-r35-repair-{r['id']}",
                    "inquiry_id": r["inquiry_id"],
                    "time": "1970-01-01 00:00:00",
                    "operator": "系统",
                    "operator_role": "系统",
                    "type": "DATA_REPAIR",
                    "content": (
                        "迁移 0016：物料行 "
                        f"{r['id']} 的 quantity={r['quantity']!r} 无法表示为整数，已删除该行"
                    ),
                    "result": "已删除并留痕",
                },
            )
            removed += 1
            continue

        if q_ok != r["quantity"]:
            bind.execute(
                sa.text("UPDATE inquiry_items SET quantity = :q WHERE id = :id"),
                {"q": q_ok, "id": r["id"]},
            )
            repaired += 1

        tp = r["target_price"]
        if tp is not None and _as_float(tp) is None:
            bind.execute(
                sa.text(
                    "UPDATE inquiry_items SET target_price = NULL WHERE id = :id"
                ),
                {"id": r["id"]},
            )
            repaired += 1


def downgrade() -> None:
    """不逆向：本迁移删除/改写的都是**已经无法读出**的坏数据，
    恢复它们只会把列表端点重新打挂。留痕行按标记删除，避免降级后留下无主日志。
    """
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM inquiry_logs WHERE type = 'DATA_REPAIR' AND id LIKE 'log-r35-repair-%'")
    )
