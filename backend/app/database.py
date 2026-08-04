"""SQLAlchemy engine 与 session

- SQLite（开发/测试/演示）：仅 SQLite 需要 connect_args={"check_same_thread": False}
- PostgreSQL（生产）：使用 https://postgresql:// 的 psycopg2 驱动（见 requirements.txt），
  并启用连接池（pool_size / max_overflow / pool_pre_ping），避免 SQLite 专属参数污染。
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import DB_URL, DB_POOL_SIZE, DB_MAX_OVERFLOW, DB_POOL_PRE_PING

# SQLite 仅用于开发/演示；PostgreSQL 等服务器数据库走连接池
_IS_SQLITE = DB_URL.startswith("sqlite")

if _IS_SQLITE:
    engine = create_engine(
        DB_URL,
        connect_args={"check_same_thread": False},  # SQLite 多线程
        echo=False,
    )
else:
    # PostgreSQL 等：连接池 + 前置 ping；connect_args 由驱动默认处理
    engine = create_engine(
        DB_URL,
        pool_size=DB_POOL_SIZE,
        max_overflow=DB_MAX_OVERFLOW,
        pool_pre_ping=DB_POOL_PRE_PING,
        echo=False,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖：每请求一个 session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()