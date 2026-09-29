"""P1 认证与权限加固测试

覆盖本次新增/确认的安全点：
- 报价单组织级资源隔离（IDOR）：跨组织 GET/submit/create 报价返回 403，同组织放行
- 管理接口 RBAC：AI 用量统计仅管理员可访问，普通用户 403
- 改密使会话失效：修改密码后旧 token/旧密码失效，新密码可登录
- CSRF：refresh（cookie 认证）校验 Origin，跨站来源 403，可信来源放行
- 登录限流接线（刷新确认仍生效）
"""
import pytest
from fastapi.testclient import TestClient

from app.auth import reset_login_attempts
from app.config import LOGIN_MAX_ATTEMPTS
from app.routers.auth import _canonical_origin

DEMO_PWD = "123456"


def _login_headers(client, user_id, password=DEMO_PWD):
    resp = client.post("/api/auth/login", json={"userId": user_id, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


# ============ 1. 报价单组织级资源隔离（IDOR） ============

def test_quotation_get_cross_org_403(client, monkeypatch):
    """IDOR：华东分部 u-3 访问总部报价 quo-5-1（属 inq-5 总部）→ 403；总部 u-1 放行"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_huadong = _login_headers(client, "u-3")
    h_hq = _login_headers(client, "u-1")
    assert client.get("/api/quotations/quo-5-1", headers=h_huadong).status_code == 403
    assert client.get("/api/quotations/quo-5-1", headers=h_hq).status_code == 200


def test_quotation_submit_cross_org_403(client, monkeypatch):
    """IDOR：跨组织提交报价被拒"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_huadong = _login_headers(client, "u-3")
    r = client.post("/api/quotations/quo-5-1/submit", headers=h_huadong)
    assert r.status_code == 403


def test_create_quotation_cross_org_403(client, monkeypatch):
    """IDOR：为总部询价单 inq-5 创建报价的非总部用户被拒"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_huadong = _login_headers(client, "u-3")
    body = {
        "inquiryId": "inq-5", "supplierId": "sup-1", "supplierName": "测试",
        "status": "DRAFT", "totalAmount": 0, "items": [],
    }
    r = client.post("/api/quotations", json=body, headers=h_huadong)
    assert r.status_code == 403


def test_quotation_same_org_draft_allowed(client, monkeypatch):
    """同组织：总部 u-1 可对总部报价 quo-5-1 保存草稿（access 放行）"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_hq = _login_headers(client, "u-1")
    r = client.put("/api/quotations/quo-5-1/draft", json={"remark": "x"}, headers=h_hq)
    assert r.status_code == 200


# ============ 2. 管理接口 RBAC（AI 用量统计） ============

def test_ai_stats_rbac(client, monkeypatch):
    """普通采购人员访问 AI 用量统计 → 403；管理员 → 200"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    h_buyer = _login_headers(client, "u-1")
    h_supervisor = _login_headers(client, "u-2")
    h_admin = _login_headers(client, "u-6")
    assert client.get("/api/ai/stats", headers=h_buyer).status_code == 403
    assert client.get("/api/ai/stats", headers=h_supervisor).status_code == 403
    assert client.get("/api/ai/stats", headers=h_admin).status_code == 200


# ============ 3. 改密使会话失效 ============

def test_change_password_revokes_sessions(client, monkeypatch):
    """改密：错误当前密码被拒；成功后旧 token 失效、旧密码失效、新密码可登录（随后恢复）"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    from app.database import SessionLocal
    from app.models import User
    from app.auth import hash_password

    r = client.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 当前密码错误 → 400
    r_bad = client.post("/api/auth/change-password", json={
        "currentPassword": "wrong", "newPassword": "newpass123", "confirmPassword": "newpass123",
    }, headers=headers)
    assert r_bad.status_code == 400
    # 两次新密码不一致 → 400
    r_mismatch = client.post("/api/auth/change-password", json={
        "currentPassword": DEMO_PWD, "newPassword": "newpass123", "confirmPassword": "other123",
    }, headers=headers)
    assert r_mismatch.status_code == 400
    # 成功后：旧 access token 失效
    r_ok = client.post("/api/auth/change-password", json={
        "currentPassword": DEMO_PWD, "newPassword": "newpass123", "confirmPassword": "newpass123",
    }, headers=headers)
    assert r_ok.status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    # 旧密码登录失败，新密码登录成功
    assert client.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD}).status_code == 401
    assert client.post("/api/auth/login", json={"userId": "u-1", "password": "newpass123"}).status_code == 200

    # 恢复密码哈希，避免影响其他测试
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == "u-1").first()
        u.password_hash = hash_password(DEMO_PWD)
        db.commit()
    finally:
        db.close()
    reset_login_attempts("u-1", "testclient")


# ============ 4. CSRF：refresh（cookie 认证）Origin 校验 ============

def test_refresh_rejects_cross_origin(client, monkeypatch):
    """跨站 Origin 的 refresh → 403；可信 Origin → 200"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    r = client.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
    assert r.status_code == 200
    refresh_cookie = client.cookies.get("refresh_token")

    c_evil = TestClient(client.app)
    r_csrf = c_evil.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={refresh_cookie}",
        "Origin": "http://evil.example.com",
    })
    assert r_csrf.status_code == 403

    # 可信来源（CORS 白名单）→ 成功轮换
    c_ok = TestClient(client.app)
    r_ok = c_ok.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={refresh_cookie}",
        "Origin": "http://localhost:5173",
    })
    assert r_ok.status_code == 200


def test_refresh_same_origin_behind_reverse_proxy(client, monkeypatch):
    """同源部署（nginx 反代 /api）下，浏览器 Origin 省略默认端口，必须放行。

    前端已接入 refresh_token 自动续期：访问 http://localhost（80 是 http 默认端口，
    浏览器序列化 origin 时会省略）的页面会带 `Origin: http://localhost` 打
    /api/auth/refresh。若只做 CORS 白名单逐字符串比对（白名单里写的是
    http://localhost:80），续期请求会被判 403，自动续期形同虚设并把用户踢回登录页。
    """
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    # 白名单刻意只写带 :80 的形式：验证放行依据是"默认端口归一化/同源"，而非白名单恰好含裸形式
    monkeypatch.setattr("app.routers.auth.CORS_ORIGINS", ["http://localhost:80"])

    def _login(base_url: str) -> TestClient:
        c = TestClient(client.app, base_url=base_url)
        r = c.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
        assert r.status_code == 200, r.text
        assert c.cookies.get("refresh_token")
        return c

    # 1) 默认端口省略形式（浏览器真实发出的头）→ 放行
    c = _login("http://localhost")
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={c.cookies.get('refresh_token')}",
        "Origin": "http://localhost",
    })
    assert r.status_code == 200, r.text

    # 2) 显式带默认端口 → 归一化后与 1) 同源，同样放行
    c = _login("http://localhost")
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={c.cookies.get('refresh_token')}",
        "Origin": "http://localhost:80",
    })
    assert r.status_code == 200, r.text

    # 3) 同源但完全不在白名单里的域名 → 靠"同源"这一条放行（证明不是白名单在兜底）
    c = _login("http://app.internal")
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={c.cookies.get('refresh_token')}",
        "Origin": "http://app.internal",
    })
    assert r.status_code == 200, r.text

    # 4) 反向对照：非白名单域名上的跨站 Origin → 仍须 403（同源判断不得放宽成无条件放行）
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={c.cookies.get('refresh_token')}",
        "Origin": "http://evil.example.com",
    })
    assert r.status_code == 403

    # 5) 反向对照：白名单域名上的跨站 Origin → 仍须 403
    c = _login("http://localhost")
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={c.cookies.get('refresh_token')}",
        "Origin": "http://evil.example.com",
    })
    assert r.status_code == 403


def test_refresh_trusted_by_whitelist_canonicalization_only(client, monkeypatch):
    """白名单那条分支必须自己就认得"省略默认端口"的形状，不能靠同源分支兜过去。

    上面那条 `test_refresh_same_origin_behind_reverse_proxy` 的 1)/2) 实际都是**同源分支**放行的
    （实测：把 `_canonical_origin` 里"丢掉 scheme 默认端口"那一行删掉，它照样 2 passed）。
    也就是说它钉的是"同源部署能续期"，并没有人在钉"白名单条目也要归一化"。
    这条把请求做成跨站（页面域 app.example ≠ 服务域 api.example，同源分支必不成立），
    白名单里只写带 :80 的形式，于是 200 只剩"白名单归一化"一条路可走。
    """
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    monkeypatch.setattr("app.routers.auth.CORS_ORIGINS", ["http://app.example:80"])

    def _login(base_url: str) -> TestClient:
        c = TestClient(client.app, base_url=base_url)
        r = c.post("/api/auth/login", json={"userId": "u-1", "password": DEMO_PWD})
        assert r.status_code == 200, r.text
        assert c.cookies.get("refresh_token")
        return c

    c = _login("http://api.example")
    cookie = c.cookies.get("refresh_token")

    # 反证放前面：先确认白名单外的域照样拒（成功续期会轮换 refresh，先跑正向会让这一条以别的理由红）
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={cookie}",
        "Origin": "http://other.example",
    })
    assert r.status_code == 403, f"跨站且不在白名单，必须拒：{r.status_code} {r.text}"

    # 浏览器真实发出的头（默认端口被省略），白名单里只有带 :80 的写法
    r = c.post("/api/auth/refresh", headers={
        "Cookie": f"refresh_token={cookie}",
        "Origin": "http://app.example",
    })
    assert r.status_code == 200, (
        "运维把白名单写成 http://app.example:80，而浏览器省略默认端口——"
        f"归一化必须让这两个串相等，否则跨域部署的自动续期形同虚设：{r.status_code} {r.text}"
    )


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("http://localhost", "http://localhost"),
        ("http://localhost:80", "http://localhost"),          # 默认端口省略后须等价
        ("HTTP://LocalHost:80/", "http://localhost"),          # 大小写/尾斜杠归一
        ("https://app.example.com:443", "https://app.example.com"),
        ("https://app.example.com", "https://app.example.com"),
        ("http://localhost:8080", "http://localhost:8080"),    # 非默认端口必须保留
        ("http://user:pass@localhost", "http://localhost"),    # 不携带 userinfo
        ("http://", None),                                     # 无 host 不可信
        ("not-an-origin", None),
        ("", None),
        ("http://localhost:99999", None),                      # 非法端口不崩溃
    ],
)
def test_canonical_origin_normalization(raw, expected):
    """origin 归一化：同源/跨站判断的唯一依据，必须可预期且对畸形输入不抛错"""
    assert _canonical_origin(raw) == expected


# ============ 5. 登录限流（接线确认） ============

def test_login_rate_limit_wired(client, monkeypatch):
    """连续失败登录超过阈值 → 429（确认限流在登录接口接线生效）"""
    monkeypatch.setattr("app.routers.auth.APP_DEMO_MODE", False)
    victim = "u-rate-hardening"
    for _ in range(LOGIN_MAX_ATTEMPTS):
        assert client.post("/api/auth/login", json={
            "userId": victim, "password": "wrong",
        }).status_code == 401
    assert client.post("/api/auth/login", json={
        "userId": victim, "password": "wrong",
    }).status_code == 429
    reset_login_attempts(victim, "testclient")