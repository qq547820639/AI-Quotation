"""SQLAlchemy engine 与 session"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import DB_URL

engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False},  # SQLite 多线程
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
