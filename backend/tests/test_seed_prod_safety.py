"""P0-3：生产环境不得注入演示种子数据。

验证：
1. seed_demo 在 prod（非 demo 模式）时拒绝（抛 RuntimeError），不写任何 demo 行。
2. bootstrap_admin 幂等创建首个管理员，且不产生 demo 用户/供应商/物料/询价/报价。
3. ensure_app_settings 在空库补齐 AppSettings 单行（配置数据，prod 也允许）。
4. seed-demo CLI 在 prod 时拒绝（返回非零），bootstrap-admin 可正常引导。
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import seed
from app.scripts import bootstrap_admin as cli
from app.models import User, Inquiry, Supplier, Material, AppSettings
from app.database import Base


@pytest.fixture
def prod_db(monkeypatch):
    """模拟生产环境（APP_ENV=prod、非 demo 模式）+ 全新空库。"""
    monkeypatch.setattr("app.seed.APP_ENV", "prod")
    monkeypatch.setattr("app.seed.APP_DEMO_MODE", False)
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        yield db, engine
    finally:
        db.close()
        Base.metadata.drop_all(engine)


def test_seed_demo_refuses_in_prod(prod_db):
    """生产空库执行 seed_demo 必须拒绝，且不产生任何 demo 数据。"""
    db, _ = prod_db
    with pytest.raises(RuntimeError):
        seed.seed_demo(db)
    assert db.query(User).count() == 0
    assert db.query(Supplier).count() == 0
    assert db.query(Material).count() == 0
    assert db.query(Inquiry).count() == 0


def test_bootstrap_admin_prod_only_admin(prod_db):
    """迁移后的空生产库执行 bootstrap-admin：仅创建首个管理员，无 demo 业务数据。"""
    db, _ = prod_db
    seed.bootstrap_admin(
        db, name="Root Admin", password="prod-secret-123",
        department="信息中心", organization="总部",
    )
    users = db.query(User).all()
    assert len(users) == 1
    assert users[0].role == "管理员"
    assert users[0].password_hash is not None
    assert db.query(Supplier).count() == 0
    assert db.query(Material).count() == 0
    assert db.query(Inquiry).count() == 0


def test_bootstrap_admin_idempotent(prod_db):
    """重复运行 bootstrap-admin 不重复创建管理员。"""
    db, _ = prod_db
    u1 = seed.bootstrap_admin(db, name="Admin A", password="p1", department="信息中心", organization="总部")
    u2 = seed.bootstrap_admin(db, name="Admin B", password="p2", department="信息中心", organization="总部")
    assert u1.id == u2.id
    assert db.query(User).count() == 1


def test_ensure_app_settings_prod(prod_db):
    """生产环境 ensure_app_settings 仅补齐配置单行，不产生 demo 用户。"""
    db, _ = prod_db
    seed.ensure_app_settings(db)
    assert db.query(AppSettings).count() == 1
    assert db.query(User).count() == 0


def test_seed_demo_cli_refuses_in_prod(prod_db, monkeypatch, capsys):
    """seed-demo CLI 在生产环境返回非零退出码并打印错误。"""
    monkeypatch.setattr("app.seed.APP_ENV", "prod")
    monkeypatch.setattr("app.seed.APP_DEMO_MODE", False)
    monkeypatch.setattr(cli, "APP_ENV", "prod")
    monkeypatch.setattr(cli, "APP_DEMO_MODE", False)
    rc = cli.main(["seed-demo"])
    assert rc == 1
    assert "生产环境禁止注入演示数据" in capsys.readouterr().err


def test_bootstrap_admin_cli_ok(prod_db, monkeypatch, capsys):
    """bootstrap-admin CLI（携带 --password）在生产空库成功引导首个管理员。"""
    monkeypatch.setattr("app.seed.APP_ENV", "prod")
    monkeypatch.setattr("app.seed.APP_DEMO_MODE", False)
    # 让 CLI 使用与测试库同一引擎的独立 session（避免 CLI 关闭测试用 session）
    engine = prod_db[1]
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(cli, "SessionLocal", Session)
    rc = cli.main(["bootstrap-admin", "--name", "Root", "--password", "tok-secret"])
    assert rc == 0
    assert "管理员就绪" in capsys.readouterr().out
    db = prod_db[0]
    assert db.query(User).count() == 1
    assert db.query(Supplier).count() == 0
    assert db.query(Inquiry).count() == 0