"""迁移测试（Task 11.2）：全新库升级 / 上一版本降级 / 关键迁移 downgrade / round-trip

在独立临时 SQLite 文件库上执行 Alembic 迁移，验证：
- 全新库 upgrade head 后关键表存在
- 关键迁移 downgrade（0003→0002）正确回退（sessions 表被移除）
- round-trip（downgrade 后重新 upgrade head）后表恢复
- 全部 downgrade base 后无业务表

注意：env.py 通过 `from app.config import DB_URL` 读取连接串，因此通过 monkeypatch
覆盖 app.config.DB_URL 指向临时库，与 conftest 使用的共享库隔离，避免污染其他测试。
"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

import app.config as app_config

BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"

# 迁移后应存在的关键表（0001 建表 + 0003 sessions 等）
CORE_TABLES = {"users", "inquiries", "suppliers", "materials", "quotations", "sessions"}
# 0009 持久化任务队列新增表
TASK_QUEUE_TABLES = {"task_records", "outbox_events"}


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def _table_names(db_url: str) -> set:
    engine = create_engine(db_url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_migration_round_trip(monkeypatch, tmp_path):
    db_file = tmp_path / "migration.db"
    db_url = f"sqlite:///{db_file}"
    # env.py 通过 `from app.config import DB_URL` 读取；monkeypatch 指向临时库
    monkeypatch.setattr(app_config, "DB_URL", db_url)
    cfg = _alembic_config()

    # 1) 全新库 upgrade head
    command.upgrade(cfg, "head")
    tables = _table_names(db_url)
    missing = CORE_TABLES - tables
    assert not missing, f"upgrade head 后缺少表: {missing}"
    missing_task = TASK_QUEUE_TABLES - tables
    assert not missing_task, f"upgrade head 后缺少任务队列表: {missing_task}"

    # 2) 关键迁移 downgrade：0003 → 0002（移除 sessions 表）
    command.downgrade(cfg, "0002")
    tables = _table_names(db_url)
    assert "sessions" not in tables, "downgrade 0003→0002 后 sessions 表应被移除"
    assert "users" in tables and "inquiries" in tables, "downgrade 后核心表应保留"
    leaked_task = TASK_QUEUE_TABLES & tables
    assert not leaked_task, f"downgrade 0009→0002 后任务队列表应被回退: {leaked_task}"

    # 3) re-upgrade head（round-trip）
    command.upgrade(cfg, "head")
    tables = _table_names(db_url)
    missing = CORE_TABLES - tables
    assert not missing, f"re-upgrade head 后缺少表: {missing}"
    missing_task = TASK_QUEUE_TABLES - tables
    assert not missing_task, f"re-upgrade head 后缺少任务队列表: {missing_task}"

    # 4) 全部回退到 base，确认无业务表残留
    command.downgrade(cfg, "base")
    tables = _table_names(db_url)
    assert "users" not in tables and "sessions" not in tables, "downgrade base 后应有业务表残留"