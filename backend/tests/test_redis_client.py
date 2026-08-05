"""Redis 客户端抽象测试：内存回退存储 + Redis 客户端加固（超时/重试/ping）。

测试环境无 REDIS_URL，get_store() 应回退到 _MemoryStore。Redis 客户端路径
通过不可达端点验证重试与 ping 失败行为（无需真实 Redis 服务器）。
"""
import types

import pytest

from app.redis_client import _MemoryStore, get_store, _build_store


def test_memory_store_set_get():
    store = _MemoryStore()
    store.set("k", {"a": 1}, ttl=60)
    assert store.get("k") == {"a": 1}


def test_memory_store_expire_get_none():
    store = _MemoryStore()
    store.set("k", "v", ttl=1)
    store.expire("k", -1)  # 立即过期
    assert store.get("k") is None


def test_memory_store_incr():
    store = _MemoryStore()
    assert store.incr("c", ttl=60) == 1
    assert store.incr("c", ttl=60) == 2
    assert store.incr("c", ttl=60) == 3


def test_memory_store_incr_expired_resets():
    store = _MemoryStore()
    store.incr("c", ttl=1)
    store.expire("c", -1)
    assert store.incr("c", ttl=60) == 1


def test_memory_store_delete_and_ping():
    store = _MemoryStore()
    store.set("k", "v")
    store.delete("k")
    assert store.get("k") is None
    assert store.ping() is True


def test_memory_store_clear():
    store = _MemoryStore()
    store.set("a", 1)
    store.set("b", 2)
    store.clear()
    assert store.get("a") is None
    assert store.get("b") is None


def test_build_store_returns_memory_when_no_redis_url(monkeypatch):
    monkeypatch.setattr("app.redis_client.REDIS_URL", "")
    assert isinstance(_build_store(), _MemoryStore)


def test_get_store_interface():
    store = get_store()
    assert callable(store.get)
    assert callable(store.set)
    assert callable(store.incr)
    assert callable(store.expire)
    assert callable(store.ping)


def test_get_store_ping_memory():
    assert get_store().ping() is True


@pytest.mark.skipif(not pytest.importorskip("redis"), reason="redis 未安装")
def test_redis_store_ctor_uses_redis_client():
    from app.redis_client import _RedisStore
    store = _RedisStore("redis://127.0.0.1:6379/0")
    # from_url 不建立连接；连接参数应被设置
    assert store._client.connection_pool.connection_kwargs.get("socket_connect_timeout") is not None
    assert store._client.connection_pool.connection_kwargs.get("decode_responses") is True


@pytest.mark.skipif(not pytest.importorskip("redis"), reason="redis 未安装")
def test_redis_store_retry_then_raise_unreachable():
    """不可达端点：有限重试后抛连接异常（而非静默成功）。"""
    from app.redis_client import _RedisStore
    store = _RedisStore("redis://127.0.0.1:1/0")
    with pytest.raises(Exception):
        store.get("some-key")


@pytest.mark.skipif(not pytest.importorskip("redis"), reason="redis 未安装")
def test_redis_store_ping_fails_unreachable():
    from app.redis_client import _RedisStore
    store = _RedisStore("redis://127.0.0.1:1/0")
    with pytest.raises(Exception):
        store.ping()


@pytest.mark.skipif(not pytest.importorskip("redis"), reason="redis 未安装")
def test_redis_store_with_retry_retries_on_failure(monkeypatch):
    from app.redis_client import _RedisStore
    store = _RedisStore("redis://127.0.0.1:6379/0")
    calls = []

    class _Fail:
        def get(self, *a, **k):
            calls.append(1)
            if len(calls) < 3:
                raise ConnectionError("boom")
            return "ok"

    store._client = _Fail()
    assert store._with_retry(lambda: store._client.get("k")) == "ok"
    assert len(calls) == 3