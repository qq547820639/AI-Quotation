"""Alembic 迁移环境

- 从 app.config 读取 DB_URL（alembic.ini 中 sqlalchemy.url 留空）
- target_metadata = Base.metadata，导入 app.models 触发全部 ORM 模型注册
- 支持在线（连接数据库执行）与离线（仅生成 SQL）两种模式
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# 读取应用配置与模型元数据
from app.config import DB_URL
from app import models  # noqa: F401  导入以注册全部 ORM 模型到 Base.metadata
from app.database import Base

config = context.config

# 从应用配置读取数据库 URL（alembic.ini 中留空）
config.set_main_option("sqlalchemy.url", DB_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """离线模式：仅生成 SQL，不连接数据库"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连接数据库执行迁移"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()