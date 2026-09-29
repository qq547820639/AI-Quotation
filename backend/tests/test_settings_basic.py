"""设置页"有读者的三项"服务端持久化（R49 → R57 → 本片）

覆盖三件事，缺一不可：
1. 值真的落进库——不是"响应里回显了"：PUT 之后换一个**新 session** 直接读表。
2. 坏值被写边界拒绝（422），而不是静默退回默认（R35 的家规）。
3. 币种取值域与前端 `enum Currency` 逐字对账，且这条对账本身带反向控制——
   解析不到就判失败，绝不允许"没解析到 = 一致"。
"""
import re
from pathlib import Path

import pytest

from app.database import SessionLocal
from app.models import AppSettings
from app.schemas import SUPPORTED_CURRENCIES

ROOT = Path(__file__).resolve().parents[2]
TYPES_FILE = ROOT / "src" / "types" / "index.ts"

BASIC = {"systemName": "华东采购询价台", "currency": "USD", "deadlineLeadDays": 9}


def _row() -> AppSettings:
    """换一个 session 读，绕开请求内 session 的身份映射缓存。"""
    db = SessionLocal()
    try:
        return db.query(AppSettings).filter(AppSettings.id == 1).first()
    finally:
        db.close()


def _restore(system_name: str, currency: str, lead_days: int) -> None:
    db = SessionLocal()
    try:
        s = db.query(AppSettings).filter(AppSettings.id == 1).first()
        s.system_name, s.default_currency, s.inquiry_deadline_lead_days = system_name, currency, lead_days
        db.commit()
    finally:
        db.close()


def test_basic_settings_round_trip_reaches_the_database(client, admin_headers):
    """PUT 之后换新 session 读表：三项都在库里，且不是默认值的巧合。"""
    before = _row()
    assert before is not None
    _restore("哨兵原名", "CNY", 1)

    body = client.get("/api/settings", headers=admin_headers).json()
    assert body["basic"]["systemName"] == "哨兵原名"  # 读侧也确实在读表，不是常量
    body["basic"] = BASIC
    r = client.put("/api/settings", json=body, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["basic"] == BASIC

    after = _row()
    assert (after.system_name, after.default_currency, after.inquiry_deadline_lead_days) == (
        BASIC["systemName"],
        BASIC["currency"],
        BASIC["deadlineLeadDays"],
    )

    # GET 第二次仍给同值 ⇒ 不是把请求体原样回显
    assert client.get("/api/settings", headers=admin_headers).json()["basic"] == BASIC
    _restore(before.system_name, before.default_currency, before.inquiry_deadline_lead_days)


def test_basic_persistence_survives_a_new_app_session(client, admin_headers):
    """跨"下一次进程级读取"仍在：模拟换浏览器——只有服务端有它才谈得上跨设备。"""
    body = client.get("/api/settings", headers=admin_headers).json()
    body["basic"] = {**BASIC, "systemName": "跨会话标题"}
    assert client.put("/api/settings", json=body, headers=admin_headers).status_code == 200

    fresh = client.get("/api/settings", headers=admin_headers)
    assert fresh.status_code == 200
    assert fresh.json()["basic"]["systemName"] == "跨会话标题"

    db = SessionLocal()
    try:
        s = db.query(AppSettings).filter(AppSettings.id == 1).first()
        s.system_name = "采购询价系统"
        s.default_currency = "CNY"
        s.inquiry_deadline_lead_days = 3
        db.commit()
    finally:
        db.close()


@pytest.mark.parametrize(
    "broken, why",
    [
        ({"currency": "RUB"}, "不在 SUPPORTED_CURRENCIES 里的币种"),
        ({"currency": "cny"}, "大小写不合法的币种"),
        ({"currency": ""}, "空串币种"),
        ({"deadlineLeadDays": -1}, "负数会让默认截止日落到过去"),
        ({"deadlineLeadDays": 9999}, "超出实际上界的默认截止提前量"),
    ],
)
def test_write_boundary_rejects_bad_values(client, admin_headers, broken, why):
    """坏值一律 422，不许静默退回默认：退了就等于把用户的输入吞掉还说"已保存"。"""
    body = client.get("/api/settings", headers=admin_headers).json()
    original = dict(body["basic"])
    body["basic"] = {**original, **broken}
    r = client.put("/api/settings", json=body, headers=admin_headers)
    assert r.status_code == 422, f"{why} 应当被拒，实际 {r.status_code}"
    # 被拒之后库里必须仍是原值（拒绝不能留下半成品）
    assert _row().default_currency == original["currency"]
    assert _row().inquiry_deadline_lead_days == original["deadlineLeadDays"]


def test_missing_basic_group_is_rejected(client, admin_headers):
    """PUT 是整体替换：少了 basic 必须 422，而不是"这一组保持不变"。"""
    body = client.get("/api/settings", headers=admin_headers).json()
    body.pop("basic")
    r = client.put("/api/settings", json=body, headers=admin_headers)
    assert r.status_code == 422


def test_currency_domain_matches_frontend_enum():
    """后端 SUPPORTED_CURRENCIES 必须与前端 enum Currency 的取值集合逐字相同。

    反向控制（防"没解析到 = 一致"这条最常见的假绿）：
    文件读不到、解析不到任何成员、或解析出的集合为空 —— 一律直接失败。
    """
    assert TYPES_FILE.is_file(), f"前端类型文件不存在：{TYPES_FILE}"
    text = TYPES_FILE.read_text(encoding="utf-8")
    m = re.search(r"export enum Currency\s*\{(.*?)\}", text, re.S)
    assert m, "没在 src/types/index.ts 里解析到 `export enum Currency` ⇒ 这条对账没在比对任何东西"
    frontend = set(re.findall(r"=\s*'([^']+)'", m.group(1)))
    assert frontend, "解析到 enum 但取值为空 ⇒ 正则失效，不要当成一致"
    assert frontend == set(SUPPORTED_CURRENCIES), (
        f"币种取值域漂移：前端 {sorted(frontend)} vs 后端 {sorted(SUPPORTED_CURRENCIES)}"
    )


def test_positive_control_frontend_parses_more_than_the_minimum():
    """已知非恒真对照：前端 enum 至少要有 3 个取值，否则上一条用例的分母可能是 1 个巧合。"""
    text = TYPES_FILE.read_text(encoding="utf-8")
    m = re.search(r"export enum Currency\s*\{(.*?)\}", text, re.S)
    assert m and len(re.findall(r"=\s*'([^']+)'", m.group(1))) >= 3
