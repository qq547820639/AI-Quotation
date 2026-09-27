"""AppSettings 新增"基本信息/询价规则"三列（system_name / default_currency / inquiry_deadline_lead_days）

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-27

背景（登记册 R49 → R57 → 本片）：这三项在设置页可编辑、每键入落一次 localStorage，
但从未上行——`toAppSettings` 只映射 approval/notification/ai。
它们与另 5 个"零读者"字段的区别是**有生产读者**：
`system_name` 现在驱动浏览器标签标题（src/App.tsx），
`default_currency` 与 `inquiry_deadline_lead_days` 驱动新建询价单的默认币种与默认截止日
（src/pages/inquiry/create/shared.ts 的 defaultBasicInfo）。
⇒ "设置已保存"在有读者的字段上是真的跨设备丢失，本片把它接进服务端。

形状选择（为什么是三个列而不是一个 JSON 列）：本仓确实用 JSON 列（models.py:29/55/114/115），
但那些装的是**键即数据**的变长载荷（权限列表、主类别、{itemId: supplierId} 映射）；
这里是三个各自带类型、带默认值、带取值域约束的标量，列形态才能把 NOT NULL 与 server_default 写进库，
也才能让 `scripts/check-settings-inert.mjs` 的上行轴按"本地哪个单位上了行"逐字段判定
（整对象塞进一个 blob 会让"这一项到底有没有上行"变成不可判）。

三列均带默认值，历史行自动补齐，无需回填；迁移幂等（照 0015 的 _columns() 形状）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_COLUMNS = {
    "system_name": lambda: sa.Column(
        "system_name", sa.String(), nullable=False, server_default="采购询价系统"
    ),
    "default_currency": lambda: sa.Column(
        "default_currency", sa.String(), nullable=False, server_default="CNY"
    ),
    "inquiry_deadline_lead_days": lambda: sa.Column(
        "inquiry_deadline_lead_days", sa.Integer(), nullable=False, server_default="3"
    ),
}


def _columns() -> set[str]:
    """返回 app_settings 表当前存在的列名集合（幂等迁移用）。"""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {c["name"] for c in inspector.get_columns("app_settings")}


def upgrade() -> None:
    cols = _columns()
    for name, factory in NEW_COLUMNS.items():
        if name not in cols:
            op.add_column("app_settings", factory())


def downgrade() -> None:
    cols = _columns()
    for name in NEW_COLUMNS:
        if name in cols:
            op.drop_column("app_settings", name)
