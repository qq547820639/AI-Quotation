"""P2-14 Task 19：PostgreSQL 集成测试

当环境提供 PostgreSQL（DATABASE_URL 以 postgresql:// 开头）时，运行真实的 PG 集成测试；
本机/CI 无 PG 时自动跳过（module-level skip），不会导致本地失败。

覆盖：
- 通过 psycopg2 驱动建立 PG 连接并执行基础 CRUD（临时表）
- 验证 app 的 DATABASE_URL 配置正确路由到 PostgreSQL
- 在隔离的临时数据库上执行 Alembic upgrade head（验证迁移在 PG 方言下可执行），随后 downgrade base 清理

说明：CI 中应在提供 PG 的 job（如 docker-e2e 的 compose postgres）运行时设置
DATABASE_URL=postgresql://procurement:procurement@host:5432/procurement。
"""
import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

# 若未安装 psycopg2 驱动，则本模块整体跳过
pytest.importorskip("psycopg2")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL.startswith("postgresql"):
    pytest.skip("未配置 PostgreSQL（DATABASE_URL 未以 postgresql:// 开头），跳过 PG 集成测试", allow_module_level=True)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

import app.config as app_config  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _server_url() -> str:
    """由 DATABASE_URL 派生服务器级 URL（仍连到默认 postgres 库），用于创建/删除临时库"""
    u = urlsplit(DATABASE_URL)
    return urlunsplit((u.scheme, u.netloc, "/postgres", u.query, u.fragment))


def _temporary_database_url(dbname: str) -> str:
    u = urlsplit(DATABASE_URL)
    return urlunsplit((u.scheme, u.netloc, f"/{dbname}", u.query, u.fragment))


def test_connect_and_basic_crud():
    """通过 psycopg2 连接 PG，创建临时表 → 写入 → 查询 → 清理"""
    engine = create_engine(DATABASE_URL, poolclass=NullPool)
    table = f"pg_integ_test_{uuid.uuid4().hex[:8]}"
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE TABLE "{table}" (id INT PRIMARY KEY, name TEXT)'))
        with engine.begin() as conn:
            conn.execute(text(f'INSERT INTO "{table}" VALUES (1, %s)'), ("hello",))
        with engine.connect() as conn:
            row = conn.execute(text(f'SELECT name FROM "{table}" WHERE id=1')).scalar_one()
        assert row == "hello"
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        engine.dispose()


def test_app_config_routes_to_postgres():
    """app.config.DB_URL 应正确路由到配置的 PostgreSQL 连接串"""
    assert app_config.DB_URL == DATABASE_URL
    assert app_config.DB_URL.startswith("postgresql")


def test_alembic_migrations_on_postgres():
    """在隔离的临时 PG 数据库上执行 Alembic upgrade head + downgrade base，验证迁移在 PG 方言下可用"""
    from sqlalchemy import inspect as sa_inspect

    server_engine = create_engine(_server_url(), poolclass=NullPool, isolation_level="AUTOCOMMIT")
    dbname = f"pg_mig_test_{uuid.uuid4().hex[:8]}"
    try:
        with server_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{dbname}"'))
    finally:
        server_engine.dispose()

    db_url = _temporary_database_url(dbname)
    original = app_config.DB_URL
    try:
        app_config.DB_URL = db_url
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        command.upgrade(cfg, "head")
        engine = create_engine(db_url, poolclass=NullPool)
        try:
            tables = set(sa_inspect(engine).get_table_names())
            for core in ("users", "inquiries", "suppliers", "materials", "quotations", "sessions"):
                assert core in tables, f"upgrade head 后 PG 缺少表 {core}"
        finally:
            engine.dispose()
        command.downgrade(cfg, "base")
    finally:
        app_config.DB_URL = original
        cleanup_engine = create_engine(_server_url(), poolclass=NullPool, isolation_level="AUTOCOMMIT")
        try:
            with cleanup_engine.connect() as conn:
                conn.execute(text(f'DROP DATABASE IF EXISTS "{dbname}"'))
        finally:
            cleanup_engine.dispose()