"""GET /api/inquiries 的 deadlineFrom/deadlineTo 常驻用例（R109，日粒度闭区间）

被测实现：backend/app/routers/inquiries.py:341-344
    if deadlineFrom: query = query.filter(func.substr(Inquiry.deadline, 1, 10) >= deadlineFrom)
    if deadlineTo:   query = query.filter(func.substr(Inquiry.deadline, 1, 10) <= deadlineTo)
口径来源：待报价页 src/pages/quotation/pending/index.tsx:172-181 原来在整份无界数组上按
dayjs 的 startOf('day')-1ms … endOf('day')+1ms 过滤 deadline；分页改成默认路径后，
这把筛子必须搬上服务端且口径一致（含首末两日整天）。

每一格都断到具体行集，不只断 200：
1. 闭区间含首末两日（钉"含末日整天"）
2. 只给 deadlineFrom ⇒ 当天及以后；只给 deadlineTo ⇒ 当天及以前
3. 与 status 组合（status 是逗号 OR，与日期界是 AND）
4. 同一组日期界在「不带 page」与「page=1&pageSize=50」两条分支行集完全相等
5. 反证：空 deadline 在日期界下的真实走向（见该格函数名，有意记录的分歧）

第 6 格"效力断言"不在本文件里，是一轮手工操作：把实现里的 `<= deadlineTo` 改成
`< deadlineTo`，确认第 1 格变红，再逐字改回。恒真的东西不会因为改实现而红，
所以那一步才是"前 5 格不是恒真"的证据；步骤与读数记在该轮收尾里。

造行写法照抄 test_inquiries_list_filters.py / test_dashboard_workbench.py
（直接写库 + owner_name 唯一标记 + 用例后清理 inquiries/inquiry_items/inquiry_supplier/
quotations/inquiry_logs）。本模块只用 created_by_name 前缀做行集隔离。
"""
from datetime import datetime, timedelta

import pytest

from app.database import SessionLocal
from app.models import (
    Inquiry, InquiryItem, InquiryLog, Quotation, QuotationItem, User,
    inquiry_supplier,
)
from app.routers.dashboard import is_urgent, parse_timestamp

UNITS = "R109DLR"  # 本模块唯一标记：写入 owner_name，作为清理依据


def _today_text(offset_days=0):
    return (datetime.now() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


def _insert_inquiry(inq_id, *, deadline, status="DRAFT", marker=None):
    """直接写库造一条 u-1 可见（同组织）的询价单，只让 deadline 变化，返回 id。"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == "u-1").one()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        m = marker or UNITS
        row = Inquiry(
            id=inq_id,
            code=f"INQ{inq_id}",
            subject=f"{UNITS} 主题 {inq_id}",
            organization=user.organization,
            owner_name=UNITS,
            owner_id=user.id,
            currency="CNY",
            deadline=deadline,
            delivery_address="上海",
            contact="李四",
            payment_terms="款到发货",
            status=status,
            created_by_id=user.id,
            created_by_name=f"{m} c",
            created_at=now,
            updated_at=now,
            selected_supplier_map={},
            purchaser_comments={},
        )
        db.add(row)
        db.commit()
    finally:
        db.close()
    return inq_id


@pytest.fixture
def cleanup_units():
    """每个用例后把本模块造的行删干净（测试库跨模块共享）。"""
    yield
    db = SessionLocal()
    try:
        ids = [r[0] for r in db.query(Inquiry.id).filter(Inquiry.owner_name == UNITS)]
        if ids:
            qids = [r[0] for r in db.query(Quotation.id).filter(Quotation.inquiry_id.in_(ids))]
            if qids:
                db.query(QuotationItem).filter(
                    QuotationItem.quotation_id.in_(qids)
                ).delete(synchronize_session=False)
                db.query(Quotation).filter(Quotation.id.in_(qids)).delete(
                    synchronize_session=False
                )
            db.execute(inquiry_supplier.delete().where(inquiry_supplier.c.inquiry_id.in_(ids)))
            db.query(InquiryItem).filter(InquiryItem.inquiry_id.in_(ids)).delete(
                synchronize_session=False
            )
            db.query(InquiryLog).filter(InquiryLog.inquiry_id.in_(ids)).delete(
                synchronize_session=False
            )
            db.query(Inquiry).filter(Inquiry.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _ids(client, headers, **params):
    """不带分页参数的全量分支：返回 id 列表。"""
    resp = client.get("/api/inquiries", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list), f"无分页参数应返回全量数组，实际 {type(body)}"
    return [r["id"] for r in body]


def _page_ids(client, headers, **params):
    resp = client.get("/api/inquiries", headers=headers, params={
        **params, "page": 1, "pageSize": 50,
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, dict), f"带分页参数应返回分页结构，实际 {type(body)}"
    return [r["id"] for r in body["items"]], body


# 四行只差 deadline：当天早点 / 当天晚点 / 昨天最后一秒 / 明天零点
def _four_rows(m):
    d, dp1, dn1 = _today_text(), _today_text(-1), _today_text(1)
    early = _insert_inquiry(f"{m}-early", deadline=f"{d} 00:00:05", marker=m)
    late = _insert_inquiry(f"{m}-late", deadline=f"{d} 23:59:50", marker=m)
    prev = _insert_inquiry(f"{m}-prev", deadline=f"{dp1} 23:59:59", marker=m)
    nxt = _insert_inquiry(f"{m}-nxt", deadline=f"{dn1} 00:00:00", marker=m)
    return d, dp1, dn1, early, late, prev, nxt


# ============ 1. deadlineFrom/deadlineTo 是日粒度闭区间（含末日整天） ============

def test_deadline_bounds_are_day_inclusive(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T1"
    d, dp1, dn1, early, late, prev, nxt = _four_rows(m)
    all4 = {early, late, prev, nxt}
    # 前提盘：不加日期界时四行都可见 ⇒ 下面的排除只能来自日期界
    assert set(_ids(client, buyer_headers, creator=m)) == all4
    # 钉住"含末日整天"：当天 00:00:05 与 23:59:50 都在，昨天 23:59:59 与明天 00:00:00 都不在
    assert set(_ids(client, buyer_headers, creator=m, deadlineFrom=d, deadlineTo=d)) == {
        early, late,
    }
    # 首末日各自单独闭着：边界那一秒属于它自己那一天
    assert set(_ids(client, buyer_headers, creator=m,
                     deadlineFrom=dp1, deadlineTo=dp1)) == {prev}
    assert set(_ids(client, buyer_headers, creator=m,
                     deadlineFrom=dn1, deadlineTo=dn1)) == {nxt}
    # 三天全区间 ⇒ 四行都在（证明上面不是靠"只留当天"蒙对的）
    assert set(_ids(client, buyer_headers, creator=m,
                     deadlineFrom=dp1, deadlineTo=dn1)) == all4


# ============ 2. 单边给出：当天及以后 / 当天及以前 ============

def test_only_deadline_from_keeps_today_onwards(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T2A"
    d, dp1, dn1, early, late, prev, nxt = _four_rows(m)
    # 只给下界 ⇒ "当天及以后"：昨天那行被排除，两个当天行 + 明天行都在
    assert set(_ids(client, buyer_headers, creator=m, deadlineFrom=d)) == {early, late, nxt}
    # 下界挪到明天 ⇒ 只剩明天那一行（下界自己也是含当天的）
    assert set(_ids(client, buyer_headers, creator=m, deadlineFrom=dn1)) == {nxt}


def test_only_deadline_to_keeps_today_and_before(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T2B"
    d, dp1, dn1, early, late, prev, nxt = _four_rows(m)
    # 只给上界 ⇒ "当天及以前"：明天那行被排除，昨天 + 两个当天行都在
    assert set(_ids(client, buyer_headers, creator=m, deadlineTo=d)) == {prev, early, late}
    # 上界挪到昨天 ⇒ 只剩昨天那一行（上界含当天整天，所以 23:59:59 仍在）
    assert set(_ids(client, buyer_headers, creator=m, deadlineTo=dp1)) == {prev}


# ============ 3. 与 status 组合（日期界与 status 是 AND） ============

def test_deadline_range_combines_with_status(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T3"
    d = _today_text()
    draft = _insert_inquiry(f"{m}-draft", deadline=f"{d} 09:00:00", status="DRAFT", marker=m)
    inquiring = _insert_inquiry(
        f"{m}-inquiring", deadline=f"{d} 17:30:00", status="INQUIRING", marker=m)
    # 前提：同一区间内两行状态不同，不给 status 时两行都在
    assert set(_ids(client, buyer_headers, creator=m, deadlineFrom=d, deadlineTo=d)) == {
        draft, inquiring,
    }
    # 单一状态 ⇒ 只留该状态那一行
    assert _ids(client, buyer_headers, creator=m, status="DRAFT",
                deadlineFrom=d, deadlineTo=d) == [draft]
    assert _ids(client, buyer_headers, creator=m, status="INQUIRING",
                deadlineFrom=d, deadlineTo=d) == [inquiring]
    # status 的逗号是 OR、与日期界是 AND：两个状态都给 ⇒ 回到两行
    assert set(_ids(client, buyer_headers, creator=m, status="DRAFT,INQUIRING",
                    deadlineFrom=d, deadlineTo=d)) == {draft, inquiring}
    # AND 的另一面：状态命中但日期界不命中 ⇒ 空集（status 不会把日期界顶掉）
    assert _ids(client, buyer_headers, creator=m, status="DRAFT",
                deadlineFrom=_today_text(1)) == []


# ============ 4. 全量分支与分页分支行集相同 ============

def test_deadline_range_full_and_paginated_branches_match(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T4"
    d, dp1, dn1, early, late, prev, nxt = _four_rows(m)
    _insert_inquiry(f"{m}-far", deadline=f"{_today_text(9)} 12:00:00", marker=m)
    _insert_inquiry(f"{m}-past", deadline=f"{_today_text(-9)} 12:00:00", marker=m)
    filters = dict(creator=m, deadlineFrom=d, deadlineTo=d)
    full = _ids(client, buyer_headers, **filters)
    assert set(full) == {early, late}
    paged, body = _page_ids(client, buyer_headers, **filters)
    # 这一格是"两条分支行集相同"的正面证据
    assert set(paged) == set(full)
    assert paged == full
    assert body["total"] == len(full) == 2
    assert body["page"] == 1 and body["pageSize"] == 50
    # 区间外那两行在两条分支上都不许出现
    assert prev not in full and nxt not in full
    assert prev not in paged and nxt not in paged


# ============ 5. 反证：空 deadline ============

def test_空deadline在日期界下被排除_与workbench端点的dayjs_invalid口径不同_这是有意记录的分歧(
    client, buyer_headers, cleanup_units
):
    """空 deadline 在日期界下被排除（与 workbench 端点的 dayjs-invalid 口径不同，这是有意记录的分歧）。

    实测走向（不为了变绿而改实现；改前 sha 与恢复证据记在收尾里）：
    - SQLite 的 substr('', 1, 10) 返回 ''，于是 '' >= 'YYYY-MM-DD' 为假 ⇒ 给了 deadlineFrom
      这一行就被排除；而 '' <= 'YYYY-MM-DD' 为真 ⇒ 只给 deadlineTo 时它反而被保留。
      即：下界排除、上界保留，这个不对称就是分歧的第一层。
    - workbench 端点走的是另一套：dashboard.parse_timestamp('') 解不开返回 None
      （对齐 dayjs 的 isValid()），该行仍留在范围里、只是不计入"即将截止"。
      待报价页的 dayjs 筛子同样把 invalid 判成两端都不满足 ⇒ 只给上界时前端会丢它、
      服务端会留它。这里把两边都按一手读数钉住，分歧如实记录、不抹平。
    """
    m = f"{UNITS}T5"
    d = _today_text()
    empty = _insert_inquiry(f"{m}-empty", deadline="", marker=m)
    valid = _insert_inquiry(f"{m}-valid", deadline=f"{d} 10:00:00", marker=m)
    # 前提：不加日期界时两行都可见 ⇒ 下面的排除只能来自日期界
    assert set(_ids(client, buyer_headers, creator=m)) == {empty, valid}
    # 核心断言：给了 deadlineFrom ⇒ 空 deadline 不在结果里（只有正常那行在）
    assert set(_ids(client, buyer_headers, creator=m, deadlineFrom=d)) == {valid}
    assert set(_ids(client, buyer_headers, creator=m,
                    deadlineFrom=d, deadlineTo=d)) == {valid}
    assert set(_ids(client, buyer_headers, creator=m, deadlineFrom=_today_text(-1))) == {valid}
    # 不对称的另一面：只给 deadlineTo 时 substr 语义把 '' 留下了（前端 dayjs 不会）
    assert set(_ids(client, buyer_headers, creator=m, deadlineTo=d)) == {empty, valid}
    # workbench 侧口径（同一行、同一空串）：解析失败但不丢行，只是不算紧急
    assert parse_timestamp("") is None
    assert is_urgent("", datetime.now()) is False
