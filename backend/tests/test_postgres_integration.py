"""P0-1：PostgreSQL 集成测试（真实数据库，非 mock）

当环境提供 PostgreSQL（DATABASE_URL 以 postgresql:// 开头）时运行真实 PG 集成测试；
本地无 PG 时自动跳过（module-level skip），不影响本地 SQLite 测试。
CI 通过 postgres service 容器提供 DATABASE_URL，测试真实连接并真正执行，绝不静默跳过。

覆盖：
- 通过真实 PG 连接建立独立临时数据库，执行完整 alembic upgrade head
- 验证关键业务表、唯一约束、高频索引存在
- 核心 CRUD（SQLAlchemy 2 命名参数 :name + 字典绑定，禁止 %s / ? 位置占位符）
- 事务回滚（rollback 后数据不落库）
- 唯一约束冲突（重复唯一键触发 IntegrityError）
- 并发写入同一唯一键（两个连接同时写，一个成功、一个 IntegrityError），最终仅保留一行
- 每个测试在独立临时数据库中执行，测试结束 DROP DATABASE 可靠清理
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

# 若未安装 psycopg2 驱动，则本模块整体跳过（CI 中 requirements.txt 已含 psycopg2-binary）
pytest.importorskip("psycopg2")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL.startswith("postgresql"):
    pytest.skip("未配置 PostgreSQL（DATABASE_URL 未以 postgresql:// 开头），跳过 PG 集成测试", allow_module_level=True)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, inspect, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

import app.config as app_config  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent

# 关键业务表（alembic upgrade head 后必须存在）
CORE_TABLES = (
    "users", "materials", "suppliers", "attachments", "inquiries", "inquiry_items",
    "inquiry_logs", "approval_nodes", "quotations", "quotation_items", "notifications",
    "app_settings", "tokens", "inquiry_supplier", "sessions", "alembic_version",
)

# 关键唯一约束（upgrade head 后必须存在）
CORE_UNIQUE_CONSTRAINTS = {
    "materials": "uq_materials_code",
    "suppliers": "uq_suppliers_code",
    "inquiries": "uq_inquiries_code",
    "sessions": "uq_sessions_refresh_token_hash",
}

# 关键索引（upgrade head 后必须存在，含 0010/0011 高频索引）
CORE_INDEXES_BY_TABLE = {
    "inquiries": ("ix_inquiries_code", "ix_inquiries_status", "ix_inquiries_subject"),
    "quotations": ("ix_quotations_status", "ix_quotations_supplier_id"),
    "notifications": ("ix_notifications_user_id",),
    "sessions": ("ix_sessions_user_id",),
}

_MATERIALS_INSERT = (
    "INSERT INTO materials (id, code, name, category, brand, spec, tech_params, unit) "
    "VALUES (:id, :code, :name, :category, :brand, :spec, :tech_params, :unit)"
)


def _server_url() -> str:
    """由 DATABASE_URL 派生服务器级 URL（连到默认 postgres 库），用于创建/删除临时库"""
    u = urlsplit(DATABASE_URL)
    return urlunsplit((u.scheme, u.netloc, "/postgres", u.query, u.fragment))


def _temporary_database_url(dbname: str) -> str:
    u = urlsplit(DATABASE_URL)
    return urlunsplit((u.scheme, u.netloc, f"/{dbname}", u.query, u.fragment))


def _server_engine():
    return create_engine(_server_url(), poolclass=NullPool, isolation_level="AUTOCOMMIT")


def _create_temp_db(name: str) -> None:
    with _server_engine().connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))


def _drop_temp_db(name: str) -> None:
    with _server_engine().connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))


def _alembic_upgrade_head() -> Config:
    """对 app_config.DB_URL 指向的数据库执行完整 alembic upgrade head"""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")
    return cfg


@pytest.fixture
def migrated_db_url():
    """创建独立临时 PG 数据库并执行完整 alembic upgrade head；测试结束 DROP 清理"""
    dbname = f"pg_itest_{uuid.uuid4().hex[:8]}"
    _create_temp_db(dbname)
    db_url = _temporary_database_url(dbname)
    original = app_config.DB_URL
    try:
        # alembic env.py 从 app.config.DB_URL 读取连接串，须在其导入前临时改写
        app_config.DB_URL = db_url
        _alembic_upgrade_head()
        yield db_url
    finally:
        app_config.DB_URL = original
        _drop_temp_db(dbname)


def test_connect_and_basic_crud():
    """通过真实 PG 连接 + SQLAlchemy 2 命名参数执行基础 CRUD（临时表，结束后清理）"""
    engine = create_engine(DATABASE_URL, poolclass=NullPool)
    table = f"pg_int_test_{uuid.uuid4().hex[:8]}"
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE TABLE "{table}" (id INT PRIMARY KEY, name TEXT)'))
        with engine.begin() as conn:
            conn.execute(text(f'INSERT INTO "{table}" (id, name) VALUES (:id, :name)'), {"id": 1, "name": "hello"})
        with engine.connect() as conn:
            row = conn.execute(text(f'SELECT name FROM "{table}" WHERE id = :id'), {"id": 1}).scalar_one()
        assert row == "hello"
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        engine.dispose()


def test_app_config_routes_to_postgres():
    """app.config.DB_URL 应正确路由到配置的 PostgreSQL 连接串"""
    assert app_config.DB_URL == DATABASE_URL
    assert app_config.DB_URL.startswith("postgresql")


def test_alembic_head_schema_tables_constraints_indexes():
    """完整 alembic upgrade head 后：关键业务表、唯一约束、高频索引均存在"""
    dbname = f"pg_schema_{uuid.uuid4().hex[:8]}"
    _create_temp_db(dbname)
    db_url = _temporary_database_url(dbname)
    original = app_config.DB_URL
    try:
        app_config.DB_URL = db_url
        _alembic_upgrade_head()
        engine = create_engine(db_url, poolclass=NullPool)
        try:
            insp = inspect(engine)
            tables = set(insp.get_table_names())
            for t in CORE_TABLES:
                assert t in tables, f"upgrade head 后 PG 缺少表 {t}"
            # 关键列契约（防止模型与迁移漂移，如 tokens.token_hash / session_id）
            tokens_cols = {c["name"] for c in insp.get_columns("tokens")}
            assert "token_hash" in tokens_cols, "tokens 表缺少 token_hash 列（模型仅存哈希）"
            assert "session_id" in tokens_cols, "tokens 表缺少 session_id 列（会话级撤销）"
            # 唯一约束
            for tname, uqc in CORE_UNIQUE_CONSTRAINTS.items():
                uq_names = {c["name"] for c in insp.get_unique_constraints(tname)}
                assert uqc in uq_names, f"表 {tname} 缺少唯一约束 {uqc}"
            # 索引
            for tname, expect in CORE_INDEXES_BY_TABLE.items():
                idx_names = {i["name"] for i in insp.get_indexes(tname)}
                for ix in expect:
                    assert ix in idx_names, f"表 {tname} 缺少索引 {ix}"
        finally:
            engine.dispose()
    finally:
        app_config.DB_URL = original
        _drop_temp_db(dbname)


def test_crud_and_transaction_rollback(migrated_db_url):
    """核心 CRUD + 事务回滚（rollback 后数据不落库）"""
    engine = create_engine(migrated_db_url, poolclass=NullPool)
    mid = f"m-crud-{uuid.uuid4().hex[:8]}"
    try:
        # CREATE
        with engine.begin() as conn:
            conn.execute(text(_MATERIALS_INSERT), {
                "id": mid, "code": f"C-{mid}", "name": "碳钢", "category": "钢材",
                "brand": "宝钢", "spec": "Q235", "tech_params": "热轧", "unit": "kg",
            })
        # READ
        with engine.connect() as conn:
            name = conn.execute(text("SELECT name FROM materials WHERE id = :id"), {"id": mid}).scalar_one()
        assert name == "碳钢"
        # UPDATE
        with engine.begin() as conn:
            conn.execute(text("UPDATE materials SET unit = :unit WHERE id = :id"), {"id": mid, "unit": "吨"})
        with engine.connect() as conn:
            unit = conn.execute(text("SELECT unit FROM materials WHERE id = :id"), {"id": mid}).scalar_one()
        assert unit == "吨"
        # 事务回滚不落库
        rollback_id = f"{mid}-rollback"
        conn = engine.connect()
        tx = conn.begin()
        conn.execute(text(_MATERIALS_INSERT), {
            "id": rollback_id, "code": f"C-{rollback_id}", "name": "应被丢弃", "category": "钢材",
            "brand": "宝钢", "spec": "Q235", "tech_params": "热轧", "unit": "kg",
        })
        tx.rollback()
        conn.close()
        with engine.connect() as conn:
            cnt = conn.execute(text("SELECT COUNT(*) FROM materials WHERE id = :id"), {"id": rollback_id}).scalar_one()
        assert cnt == 0, "rollback 后数据不应落库"
        # DELETE
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM materials WHERE id = :id"), {"id": mid})
        with engine.connect() as conn:
            cnt = conn.execute(text("SELECT COUNT(*) FROM materials WHERE id = :id"), {"id": mid}).scalar_one()
        assert cnt == 0, "DELETE 后数据应被删除"
    finally:
        engine.dispose()


def test_unique_constraint_violation(migrated_db_url):
    """唯一约束冲突：重复 code 触发 IntegrityError"""
    engine = create_engine(migrated_db_url, poolclass=NullPool)
    code = f"UQ-{uuid.uuid4().hex[:8]}"
    try:
        with engine.begin() as conn:
            conn.execute(text(_MATERIALS_INSERT), {
                "id": "m-uq-1", "code": code, "name": "A", "category": "钢材",
                "brand": "B", "spec": "S", "tech_params": "T", "unit": "kg",
            })
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(text(_MATERIALS_INSERT), {
                    "id": "m-uq-2", "code": code, "name": "B", "category": "钢材",
                    "brand": "B", "spec": "S", "tech_params": "T", "unit": "kg",
                })
    finally:
        engine.dispose()


def test_concurrent_unique_key_writes(migrated_db_url):
    """并发写入同一唯一键：两个连接同时写同 code，一个成功、一个 IntegrityError，最终仅一行"""
    engine = create_engine(migrated_db_url, poolclass=NullPool)
    code = f"CONC-{uuid.uuid4().hex[:8]}"

    def insert(worker_id):
        conn = engine.connect()
        try:
            with conn.begin():
                conn.execute(text(_MATERIALS_INSERT), {
                    "id": f"m-conc-{worker_id}", "code": code, "name": "并发", "category": "钢材",
                    "brand": "B", "spec": "S", "tech_params": "T", "unit": "kg",
                })
            return "ok"
        except IntegrityError:
            return "IntegrityError"
        finally:
            conn.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            results = list(ex.map(insert, [1, 2]))
    finally:
        engine.dispose()

    assert sorted(results) == ["IntegrityError", "ok"], f"并发写入同一唯一键应恰好一个成功一个冲突，实际 {results}"

    # 唯一键约束下最终仅保留一行
    engine2 = create_engine(migrated_db_url, poolclass=NullPool)
    try:
        with engine2.connect() as conn:
            cnt = conn.execute(text("SELECT COUNT(*) FROM materials WHERE code = :code"), {"code": code}).scalar_one()
        assert cnt == 1, f"唯一键下最终应仅一行，实际 {cnt}"
    finally:
        engine2.dispose()