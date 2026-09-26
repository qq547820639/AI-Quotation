"""迁移 0016（R35）：治已经躺在库里的、读侧无法表示的物料行

写侧已在 `_build_inquiry_items` 改走读侧 schema 校验，但**已发生的坏行不会被写侧修复**
（实测：修复后 POST 坏值 422，GET /api/inquiries 仍 500）。本文件钉的是迁移那一半。

三条控制缺一不可：
- 必须开火：坏行被删 + 留痕，且列表恢复可读；
- 必须不开火：健康行一个都不动（否则"修复"就是随手改数据）；
- 幂等：再跑一遍不产生任何新变更。
"""
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"


def _cfg(db_url: str) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


@pytest.fixture
def migrated_db(tmp_path, monkeypatch):
    """建一个升到 0015（即本迁移之前）的临时库，返回 (engine, db_url)"""
    import app.config as app_config

    db_file = tmp_path / "r35.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setattr(app_config, "DB_URL", db_url)
    command.upgrade(_cfg(db_url), "0015")
    engine = sa.create_engine(db_url)
    yield engine, db_url
    engine.dispose()


def _insert_row(engine, table: str, overrides: dict):
    """按**实际 schema** 填 NOT NULL 列，避免逐列猜（第一版猜漏两次：organization、
    selected_supplier_map —— 报的是 IntegrityError，容易被误读成"迁移没生效"）。
    JSON 列给 '{}'，其余给 ''；数字列不会被走到这里（本用例只塞 inquiries/inquiry_items
    的必填文本列，quantity/target_price 一律由 overrides 显式给）。
    """
    import json as _json

    insp = sa.inspect(engine)
    cols = {c["name"]: c for c in insp.get_columns(table)}
    values = {}
    for name, col in cols.items():
        if name in overrides:
            values[name] = overrides[name]
        elif not col["nullable"]:
            values[name] = _json.dumps({}) if "JSON" in str(col["type"]).upper() else ""
    conn_args = {k: v for k, v in values.items() if k in cols}
    sql = sa.text(
        f"INSERT INTO {table} ({', '.join(conn_args)}) "
        f"VALUES ({', '.join(':' + k for k in conn_args)})"
    )
    with engine.begin() as conn:
        conn.execute(sql, conn_args)


def _seed(engine, item_id: str, quantity, target_price=None):
    """绕过 ORM 直插，制造"写侧已封但库里已有"的坏行"""
    _insert_row(
        engine,
        "inquiries",
        {
            "id": f"inq-{item_id}",
            "code": f"C-{item_id}",
            "subject": f"单 {item_id}",
            "organization": "总部采购中心",
            "owner_name": "李明辉",
            "owner_id": "u-1",
            "currency": "CNY",
            "deadline": "2026-12-31 00:00:00",
            "status": "DRAFT",
            "created_by_id": "u-1",
            "created_by_name": "李明辉",
            "created_at": "2026-01-01 00:00:00",
            "updated_at": "2026-01-01 00:00:00",
        },
    )
    _insert_row(
        engine,
        "inquiry_items",
        {
            "id": item_id,
            "inquiry_id": f"inq-{item_id}",
            "name": "交换机",
            "unit": "台",
            "quantity": quantity,
            "target_price": target_price,
        },
    )


def _rows(engine, sql):
    with engine.connect() as c:
        return c.execute(sa.text(sql)).all()


def test_坏行被删除并留下可读回的留痕(migrated_db):
    engine, db_url = migrated_db
    _seed(engine, "it-bad", "NOT-A-NUMBER")
    # 前置：坏行确实以"非整数"的形态躺在库里（SQLite 列无类型强约束，这正是毒源）
    bad_before = len(_rows(engine, "SELECT id FROM inquiry_items WHERE quantity GLOB '*[a-zA-Z]*'"))
    assert bad_before == 1, bad_before

    command.upgrade(_cfg(db_url), "head")

    assert _rows(engine, "SELECT id FROM inquiry_items WHERE quantity GLOB '*[a-zA-Z]*'") == []
    logs = _rows(
        engine,
        "SELECT content FROM inquiry_logs WHERE type='DATA_REPAIR' AND inquiry_id='inq-it-bad'",
    )
    assert len(logs) == 1, logs
    assert "NOT-A-NUMBER" in logs[0][0], logs[0][0]


def test_可无损转换的值被改写而不是删除(migrated_db):
    engine, db_url = migrated_db
    _seed(engine, "it-str", "12")
    command.upgrade(_cfg(db_url), "head")
    rows = _rows(engine, "SELECT quantity FROM inquiry_items WHERE id='it-str'")
    assert rows == [(12,)], rows
    # 没留痕：可转换的不该被当成坏行删掉
    assert _rows(engine, "SELECT id FROM inquiry_logs WHERE type='DATA_REPAIR'") == []


def test_健康行一个都不动(migrated_db):
    """必须不开火的对照：否则"修复"退化成随手改数据"""
    engine, db_url = migrated_db
    _seed(engine, "it-ok", 7, target_price="9.90")
    command.upgrade(_cfg(db_url), "head")
    rows = _rows(
        engine, "SELECT quantity, target_price FROM inquiry_items WHERE id='it-ok'"
    )
    # SQLite 的 Numeric 列回读是 float 9.9 而不是写入时的字符串 '9.90'，
    # 这里要钉的是"没被改、也没被置 NULL"，不是字符串字面量。
    assert len(rows) == 1, rows
    assert rows[0][0] == 7, rows
    assert rows[0][1] is not None and abs(float(rows[0][1]) - 9.9) < 1e-9, rows
    assert _rows(engine, "SELECT id FROM inquiry_logs WHERE type='DATA_REPAIR'") == []


def test_迁移幂等(migrated_db):
    engine, db_url = migrated_db
    _seed(engine, "it-bad2", "STILL-BAD")
    _seed(engine, "it-ok2", 3)
    command.upgrade(_cfg(db_url), "head")
    after_first = _rows(engine, "SELECT id, quantity FROM inquiry_items ORDER BY id")
    logs_first = _rows(
        engine, "SELECT count(*) FROM inquiry_logs WHERE type='DATA_REPAIR'"
    )
    assert logs_first == [(1,)], logs_first

    # 重跑同一迁移：坏行已在首轮被删，第二轮应当**什么都不再产生**
    command.downgrade(_cfg(db_url), "0015")
    command.upgrade(_cfg(db_url), "head")

    assert _rows(engine, "SELECT id, quantity FROM inquiry_items ORDER BY id") == after_first
    assert _rows(
        engine, "SELECT count(*) FROM inquiry_logs WHERE type='DATA_REPAIR'"
    ) == [(0,)], "downgrade 会收回留痕；第二轮无坏行可修，不应凭空造出留痕"
