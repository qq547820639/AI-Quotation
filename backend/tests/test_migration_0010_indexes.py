"""P1 Task 7：迁移 0010 高频查询索引的 upgrade / downgrade 验证

在独立临时 SQLite 库上执行 alembic：
- upgrade head 后新增索引存在
- downgrade base 后这些索引被移除（表随之消失）
- round-trip（downgrade 后重新 upgrade head）索引恢复
"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

import app.config as app_config

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"

# 0010 新增的索引
NEW_INDEXES = {
    "ix_inquiries_organization",
    "ix_inquiries_status",
    "ix_inquiries_owner_id",
    "ix_quotations_status",
    "ix_notifications_user_id",
    "ix_attachments_owner",
}


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _index_names(db_url: str) -> set:
    engine = create_engine(db_url)
    try:
        insp = inspect(engine)
        names = set()
        for table in insp.get_table_names():
            for idx in insp.get_indexes(table):
                names.add(idx.get("name"))
        return names
    finally:
        engine.dispose()


def test_migration_0010_indexes_round_trip(monkeypatch, tmp_path):
    db_file = tmp_path / "migration0010.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setattr(app_config, "DB_URL", db_url)
    cfg = _alembic_config()

    # 1) 全新库 upgrade head → 新索引存在
    command.upgrade(cfg, "head")
    missing = NEW_INDEXES - _index_names(db_url)
    assert not missing, f"upgrade head 后缺少索引: {missing}"

    # 2) 全部回退 base → 新索引随表移除
    command.downgrade(cfg, "base")
    remaining = _index_names(db_url) & NEW_INDEXES
    assert not remaining, f"downgrade base 后仍残留新索引: {remaining}"

    # 3) round-trip：重新 upgrade head → 索引恢复
    command.upgrade(cfg, "head")
    missing = NEW_INDEXES - _index_names(db_url)
    assert not missing, f"round-trip upgrade head 后缺少索引: {missing}"