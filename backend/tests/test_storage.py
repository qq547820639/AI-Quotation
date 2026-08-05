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


# ============ P0-8：S3/MinIO 真实探活（probe） ============

class _FakeHeadError(Exception):
    """模拟 head_bucket 对不存在 bucket 抛出的 ClientError（带 S3 错误码）。"""

    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3Client:
    """内存版最小 S3 客户端，用于真实驱动 S3Storage.probe 的往返（head/create/write/read/delete）。"""

    def __init__(self, bucket_exists=True, fail=None):
        self.bucket_exists = bucket_exists
        self.objects = {}
        self.created_bucket = False
        self.fail = set(fail or [])

    def head_bucket(self, **kw):
        if not self.bucket_exists:
            raise _FakeHeadError("NoSuchBucket")

    def create_bucket(self, **kw):
        self.created_bucket = True
        self.bucket_exists = True

    def put_object(self, Bucket=None, Key=None, Body=None):
        if "put" in self.fail:
            raise RuntimeError("put failed")
        self.objects[Key] = Body

    def get_object(self, Bucket=None, Key=None):
        if "get" in self.fail:
            raise RuntimeError("get failed")
        if Key not in self.objects:
            raise KeyError(f"missing {Key}")
        class _Body:
            def __init__(self, data):
                self._data = data
            def read(self):
                return self._data
        return {"Body": _Body(self.objects[Key])}

    def delete_object(self, Bucket=None, Key=None):
        if "delete" in self.fail:
            raise RuntimeError("delete failed")
        self.objects.pop(Key, None)


def _s3_with(client):
    return S3Storage(endpoint="http://minio:9000", bucket="b", access_key="a", secret_key="s", client=client)


def test_s3_probe_roundtrip_success():
    """探活通过 head→write→read→delete 全链路，且无残留临时对象。"""
    client = FakeS3Client(bucket_exists=True)
    assert _s3_with(client).probe() is True
    assert client.objects == {}
    assert client.created_bucket is False


def test_s3_probe_creates_missing_bucket():
    """bucket 不存在时探活会创建（head 404 → create）。"""
    client = FakeS3Client(bucket_exists=False)
    assert _s3_with(client).probe() is True
    assert client.created_bucket is True


def test_s3_probe_fails_on_put_error():
    assert _s3_with(FakeS3Client(fail=["put"])).probe() is False


def test_s3_probe_fails_on_get_error():
    assert _s3_with(FakeS3Client(fail=["get"])).probe() is False


def test_s3_probe_fails_on_delete_error():
    assert _s3_with(FakeS3Client(fail=["delete"])).probe() is False


def test_s3_is_available_uses_real_probe():
    """is_available 不再仅凭客户端创建成功，而是真实往返探活。"""
    assert _s3_with(FakeS3Client(bucket_exists=True)).is_available() is True
    assert _s3_with(FakeS3Client(fail=["put"])).is_available() is False


def test_s3_probe_requires_bucket_name():
    """bucket 为空时探活失败（fail-closed）。"""
    s = S3Storage(endpoint="http://x", bucket="", access_key="a", secret_key="s",
                  client=FakeS3Client(bucket_exists=True))
    assert s.probe() is False


def test_get_storage_prod_required_s3_raises(monkeypatch):
    """S3_REQUIRED=true 但 S3_* 缺失 → 工厂抛错，禁止回退本地磁盘。"""
    import app.storage as storage_mod
    monkeypatch.setattr(storage_mod, "S3_ENDPOINT", "")
    monkeypatch.setattr(storage_mod, "S3_BUCKET", "")
    monkeypatch.setattr(storage_mod, "S3_ACCESS_KEY", "")
    monkeypatch.setattr(storage_mod, "S3_SECRET_KEY", "")
    monkeypatch.setattr(storage_mod, "S3_REQUIRED", True)
    with pytest.raises(RuntimeError):
        get_storage()