"""对象存储抽象测试：sanitize_filename / _get_key 校验 / S3 配置缺失行为 / LocalStorage 读写。"""
import pytest

from app.storage import (
    LocalStorage,
    S3Storage,
    get_extension,
    get_storage,
    sanitize_filename,
)


# ============ sanitize_filename / get_extension ============

def test_sanitize_filename_removes_path_traversal():
    assert "../evil.pdf" != sanitize_filename("../evil.pdf")
    assert "/" not in sanitize_filename("../../etc/passwd")
    assert ".." not in sanitize_filename("..\\..\\win.ini")
    assert sanitize_filename("report.pdf") == "report.pdf"


def test_sanitize_filename_keeps_chinese_and_extension():
    assert "报价单.pdf" == sanitize_filename("报价单.pdf")
    assert sanitize_filename("a b  c.png").endswith(".png")


def test_sanitize_filename_empty_fallback():
    assert sanitize_filename("") == "unnamed"


def test_get_extension():
    assert get_extension("doc.pdf") == ".pdf"
    assert get_extension("noext") == ""


# ============ LocalStorage 正常读写 ============

def test_local_storage_save_read_delete(tmp_path):
    storage = LocalStorage(upload_dir=tmp_path)
    ok, err = storage.save("att-1", b"hello", "report.pdf")
    assert ok and err == ""
    assert storage.read("att-1") == b"hello"
    assert storage.url_for("att-1", "report.pdf") == "/api/portal/attachments/att-1/download"
    assert storage.get_local_path("att-1") is not None
    assert storage.delete("att-1") is True
    assert storage.read("att-1") is None


def test_local_storage_url_for_uses_download_endpoint(tmp_path):
    storage = LocalStorage(upload_dir=tmp_path)
    assert "/download" in storage.url_for("x", "f.pdf")


# ============ S3Storage._get_key 严格校验 ============

def test_get_key_valid_attachment_id():
    s = S3Storage(endpoint="http://x", bucket="b", access_key="a", secret_key="s")
    assert s._get_key("att-12345-ab12", "file.pdf") == "attachments/att-12345-ab12.pdf"


def test_get_key_rejects_path_traversal():
    s = S3Storage(endpoint="http://x", bucket="b", access_key="a", secret_key="s")
    for bad in ["../etc/passwd", "a../b", "att/../../x", "..", "a\\b"]:
        with pytest.raises(ValueError):
            s._get_key(bad, "f.pdf")


def test_get_key_rejects_dangerous_attachment_id():
    s = S3Storage(endpoint="http://x", bucket="b", access_key="a", secret_key="s")
    with pytest.raises(ValueError):
        s._get_key("att@x!semi;", "f.pdf")


def test_get_key_rejects_bad_extension():
    s = S3Storage(endpoint="http://x", bucket="b", access_key="a", secret_key="s")
    # 含危险字符的扩展名（如最终组件含 ; 等）应被拒绝
    with pytest.raises(ValueError):
        s._get_key("att-1", "report.pdf;cat")


# ============ S3Storage 配置缺失行为 ============

def test_s3_missing_config_not_available():
    s = S3Storage()  # 默认空配置
    assert s.is_available() is False
    ok, err = s.save("att-1", b"data", "f.pdf")
    assert ok is False and "not initialized" in err
    assert s.read("att-1") is None


def test_s3_storage_returns_local_path_none():
    s = S3Storage(endpoint="http://x", bucket="b", access_key="a", secret_key="s")
    assert s.get_local_path("att-1") is None


# ============ get_storage 工厂 ============

def test_get_storage_returns_local_when_no_s3_config(monkeypatch):
    import app.storage as storage_mod
    monkeypatch.setattr(storage_mod, "S3_ENDPOINT", "")
    monkeypatch.setattr(storage_mod, "S3_BUCKET", "")
    monkeypatch.setattr(storage_mod, "S3_ACCESS_KEY", "")
    monkeypatch.setattr(storage_mod, "S3_SECRET_KEY", "")
    assert isinstance(get_storage(), LocalStorage)


def test_get_storage_returns_s3_when_full_config(monkeypatch):
    import app.storage as storage_mod
    monkeypatch.setattr(storage_mod, "S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setattr(storage_mod, "S3_BUCKET", "b")
    monkeypatch.setattr(storage_mod, "S3_ACCESS_KEY", "a")
    monkeypatch.setattr(storage_mod, "S3_SECRET_KEY", "s")
    assert isinstance(get_storage(), S3Storage)