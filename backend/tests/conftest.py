"""pytest 全局夹具：临时 SQLite + 种子数据 + TestClient

- 通过 DB_PATH 环境变量指向临时数据库，避免污染真实 procurement.db。
- 必须在导入 app 模块之前设置 DB_PATH（config.py 在导入时读取 DB_URL）。
- 每个测试模块共享同一临时库（模块级建表 + 种子），TestClient 的 lifespan 幂等。
"""
import os
import tempfile

# 必须在导入 app 前设置 DB_PATH，指向临时数据库
_tmpdir = tempfile.mkdtemp(prefix="procurement-test-")
os.environ["DB_PATH"] = os.path.join(_tmpdir, "test.db")

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine, SessionLocal
from app.seed import init_db
from app.main import app

# 建表 + 注入种子（TestClient 的 lifespan 也会执行，这里预先执行保证就绪）
Base.metadata.create_all(bind=engine)
_seed_db = SessionLocal()
try:
    init_db(_seed_db)
finally:
    _seed_db.close()


@pytest.fixture
def client():
    """返回 TestClient；使用上下文管理器触发 lifespan（建表+种子，幂等）"""
    with TestClient(app) as c:
        yield c


def _login_headers(client, user_id: str) -> dict:
    resp = client.post("/api/auth/login", json={"userId": user_id})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


@pytest.fixture
def buyer_headers(client):
    """采购人员 u-1（拥有 INQUIRY_CREATE / INQUIRY_SEND，无审批权限）"""
    return _login_headers(client, "u-1")


@pytest.fixture
def supervisor_headers(client):
    """采购主管 u-2（拥有审批/定标权限）"""
    return _login_headers(client, "u-2")


@pytest.fixture
def admin_headers(client):
    """管理员 u-6（拥有供应商启用/停用权限）"""
    return _login_headers(client, "u-6")