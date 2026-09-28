"""GET /api/inquiries 的 R108 列表筛选/排序常驻用例（四独立筛子 + 三个数出来的排序键 + 日粒度闭区间）

每一格都断到具体行集或具体顺序，不只断 200：
1. code 与 subject 同给 = AND 交集（不再是 keyword 的 OR / 挤成一个）
2. creator 命中 created_by_name 子串，不命中的行被排除
3. category 走明细行 EXISTS；"明细行很多但都不命中 ⇒ 空集"
4. 同一组筛选参数在「全量数组」与「page/pageSize」两条分支给出完全相同的行集与顺序
5. sort=itemsCount 的 desc/asc 顺序
6. sort=submittedCount（只数 SUBMITTED）与 sort=invitedCount
7. dateFrom/dateTo 是日粒度闭区间（含末日的整天）
8. 未知 sort 键退回默认序，不 500、不是空集
9. 反证：keyword 老行为没被改坏

造行写法参照 test_dashboard_workbench.py（直接写库 + owner_name 唯一标记 + 用例后清理），
关联表 inquiry_items / inquiry_supplier / quotations / inquiry_logs 一并清掉。
"""
from datetime import datetime, timedelta

import pytest

from app.database import SessionLocal
from app.models import (
    Inquiry, InquiryItem, InquiryLog, Quotation, QuotationItem, User,
    inquiry_supplier,
)

UNITS = "R108LNKF"  # 本模块唯一标记：写入 owner_name，作为清理依据


def _now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _insert_inquiry(inq_id, *, code=None, subject=None, created_by_name=None,
                    created_at=None, categories=(), suppliers=(), status="DRAFT"):
    """直接写库造一条 u-1 组织（可见范围内）的询价单，返回 id。

    categories 给几个字符串就写几条明细行；suppliers 给几个 id 就写几条受邀关联。
    """
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == "u-1").one()
        now = _now_text()
        row = Inquiry(
            id=inq_id,
            code=code or f"INQ{inq_id}",
            subject=subject or f"{UNITS} 主题 {inq_id}",
            organization=user.organization,
            owner_name=UNITS,
            owner_id=user.id,
            currency="CNY",
            deadline="2099-12-31 18:00:00",
            delivery_address="上海",
            contact="李四",
            payment_terms="款到发货",
            status=status,
            created_by_id=user.id,
            created_by_name=created_by_name or f"{UNITS}默认创建人",
            created_at=created_at or now,
            updated_at=now,
            selected_supplier_map={},
            purchaser_comments={},
        )
        db.add(row)
        for n, cat in enumerate(categories):
            db.add(InquiryItem(
                id=f"{inq_id}-it{n}", inquiry_id=inq_id,
                name=f"物料{n}", code=f"MAT{n}", category=cat,
                brand="测试牌", spec="规格", tech_params="", unit="件", quantity=1,
            ))
        for sid in suppliers:
            # 计数只看关联表，不要求 suppliers 里真有这一行（SQLite 默认不强制外键）
            db.execute(inquiry_supplier.insert().values(inquiry_id=inq_id, supplier_id=sid))
        db.commit()
    finally:
        db.close()
    return inq_id


def _insert_quotation(inquiry_id, supplier_id, status):
    db = SessionLocal()
    now = _now_text()
    try:
        db.add(Quotation(
            id=f"{UNITS}-q-{inquiry_id}-{supplier_id}",
            inquiry_id=inquiry_id,
            supplier_id=supplier_id,
            supplier_name=f"供应商{supplier_id}",
            status=status,
            total_amount=0,
            created_at=now,
            updated_at=now,
        ))
        db.commit()
    finally:
        db.close()


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


def _full(client, headers, **params):
    """不带分页参数分支：断言返回数组，取 id 列表。"""
    resp = client.get("/api/inquiries", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list), f"无分页参数应返回全量数组，实际 {type(body)}"
    return [r["id"] for r in body]


# ============ 1. code × subject = AND 交集 ============

def test_code_and_subject_are_independent_and_filters(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T1"
    codeq, subj = f"{m}CODE", f"{m}SUBJ"
    x = _insert_inquiry(f"{m}-x", code=f"INQ{codeq}X", subject=f"{m}X 只编号命中")
    y = _insert_inquiry(f"{m}-y", code=f"INQ{m}Y", subject=f"{subj}Y 只主题命中")
    z = _insert_inquiry(f"{m}-z", code=f"INQ{codeq}Z", subject=f"{subj}Z 两者都命中")
    # 单筛子各自命中两行
    assert set(_full(client, buyer_headers, code=codeq)) == {x, z}
    assert set(_full(client, buyer_headers, subject=subj)) == {y, z}
    # 同时给 ⇒ 只剩交集那一行（若是 OR 语义会剩三行，若挤成一个筛子会漏掉一路）
    assert _full(client, buyer_headers, code=codeq, subject=subj) == [z]


# ============ 2. creator 子串命中 created_by_name ============

def test_creator_filters_on_created_by_name_substring(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T2"
    p = _insert_inquiry(f"{m}-p", created_by_name=f"张三丰-{m}")
    q = _insert_inquiry(f"{m}-q", created_by_name=f"李四光-{m}")
    # 基础盘：标记相同则两行都在（证明下面那格排除的原因是创建人，不是别的）
    assert set(_full(client, buyer_headers, creator=m)) == {p, q}
    # 子串只命中张三丰那行，李四光行被排除
    assert set(_full(client, buyer_headers, creator=f"张三丰-{m}")) == {p}


# ============ 3. category 走明细行 EXISTS ============

def test_category_matches_any_item_row(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T3"
    a = _insert_inquiry(f"{m}-a", created_by_name=f"{m}甲", categories=["检验试剂"])
    b = _insert_inquiry(f"{m}-b", created_by_name=f"{m}乙", categories=["耗材", "耗材"])
    assert set(_full(client, buyer_headers, creator=m, category="试剂")) == {a}
    # 反向：命中"耗材"的是另外两行里的 B（这里只有 B 有耗材）
    assert set(_full(client, buyer_headers, creator=m, category="耗材")) == {b}


def test_category_many_items_none_matching_is_empty(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T3D"
    _insert_inquiry(
        f"{m}-d", created_by_name=f"{m}丁",
        categories=["耗材", "电子设备", "五金件", "包装材料", "办公设备"],
    )
    # 明细行很多但都不含"试剂" ⇒ 空集，而不是"有一行命中就算整单命中"的误报
    assert _full(client, buyer_headers, creator=f"{m}丁", category="试剂") == []


# ============ 4. 全量分支与分页分支行集一致 ============

def test_full_and_paginated_branches_return_same_rows(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T4"
    r1 = _insert_inquiry(
        f"{m}-r1", created_by_name=f"{m} creator",
        categories=["检验试剂", "试剂", "试剂"], suppliers=[f"sup{m}1", f"sup{m}2"],
    )
    r2 = _insert_inquiry(f"{m}-r2", created_by_name=f"{m} creator", categories=["耗材"])
    r3 = _insert_inquiry(
        f"{m}-r3", created_by_name=f"{m} creator", categories=["试剂", "电子设备"],
    )
    filters = dict(creator=m, category="试剂", sort="itemsCount:desc")
    full_ids = _full(client, buyer_headers, **filters)
    assert full_ids == [r1, r3]  # r2 无试剂明细被排除；r1(3 明细) 按 itemsCount 排在 r3(2) 前
    resp = client.get("/api/inquiries", headers=buyer_headers,
                      params={**filters, "page": 1, "pageSize": 50})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    page_ids = [r["id"] for r in body["items"]]
    assert set(page_ids) == set(full_ids)
    assert page_ids == full_ids
    assert body["total"] == len(full_ids)
    assert body["page"] == 1 and body["pageSize"] == 50


# ============ 5. sort=itemsCount ============

def test_sort_by_items_count_desc_and_asc(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T5"
    one = _insert_inquiry(f"{m}-one", created_by_name=f"{m} c", categories=["耗材"])
    three = _insert_inquiry(
        f"{m}-three", created_by_name=f"{m} c", categories=["耗材", "设备", "试剂"]
    )
    two = _insert_inquiry(f"{m}-two", created_by_name=f"{m} c", categories=["耗材", "设备"])
    desc = _full(client, buyer_headers, creator=m, sort="itemsCount:desc")
    assert desc == [three, two, one]
    asc = _full(client, buyer_headers, creator=m, sort="itemsCount:asc")
    assert asc == [one, two, three]


# ============ 6. sort=submittedCount / invitedCount ============

def test_sort_by_submitted_count_only_counts_submitted(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T6S"
    three = _insert_inquiry(f"{m}-three", created_by_name=f"{m} c")
    one = _insert_inquiry(f"{m}-one", created_by_name=f"{m} c")
    two = _insert_inquiry(f"{m}-two", created_by_name=f"{m} c")
    for i in range(1, 4):
        _insert_quotation(three, f"sup{m}T{i}", "SUBMITTED")
    _insert_quotation(one, f"sup{m}O1", "SUBMITTED")
    for i in range(1, 4):  # 3 条 DRAFT 不应计入 submittedCount
        _insert_quotation(one, f"sup{m}D{i}", "DRAFT")
    for i in range(1, 3):
        _insert_quotation(two, f"sup{m}W{i}", "SUBMITTED")
    desc = _full(client, buyer_headers, creator=m, sort="submittedCount:desc")
    # 若把 DRAFT 也数进去，one 会有 4 条排第一——这一行钉住"只数 SUBMITTED"
    assert desc == [three, two, one]
    assert _full(client, buyer_headers, creator=m, sort="submittedCount:asc") == [one, two, three]


def test_sort_by_invited_count(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T6I"
    four = _insert_inquiry(
        f"{m}-four", created_by_name=f"{m} c",
        suppliers=[f"sup{m}A", f"sup{m}B", f"sup{m}C", f"sup{m}E"],
    )
    three = _insert_inquiry(
        f"{m}-three", created_by_name=f"{m} c",
        suppliers=[f"sup{m}F", f"sup{m}G", f"sup{m}H"],
    )
    two = _insert_inquiry(
        f"{m}-two", created_by_name=f"{m} c", suppliers=[f"sup{m}I", f"sup{m}J"]
    )
    assert _full(client, buyer_headers, creator=m, sort="invitedCount:desc") == [four, three, two]
    assert _full(client, buyer_headers, creator=m, sort="invitedCount:asc") == [two, three, four]


# ============ 7. dateFrom/dateTo 日粒度闭区间 ============

def test_date_bounds_are_day_inclusive(client, buyer_headers, cleanup_units):
    m = f"{UNITS}T7"
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    early = _insert_inquiry(
        f"{m}-early", created_by_name=f"{m} c", created_at=f"{today} 00:00:05")
    late = _insert_inquiry(
        f"{m}-late", created_by_name=f"{m} c", created_at=f"{today} 23:59:50")
    yday = _insert_inquiry(
        f"{m}-yday", created_by_name=f"{m} c", created_at=f"{yesterday} 12:00:00")
    ids = set(_full(client, buyer_headers, creator=m, dateFrom=today, dateTo=today))
    # 钉住"含末日的整天"：当天 00:00:05 与 23:59:50 都在，昨天的不在
    assert ids == {early, late}
    # 闭区间两端各自含当天：昨天那行只在 dateFrom=昨天 时出现
    assert set(_full(client, buyer_headers, creator=m,
                     dateFrom=yesterday, dateTo=today)) == {early, late, yday}
    assert set(_full(client, buyer_headers, creator=m, dateFrom=yesterday, dateTo=yesterday)) == {yday}


# ============ 8. 未知 sort 键退回默认序，不 500 ============

def test_unknown_sort_key_falls_back_not_500(client, buyer_headers, cleanup_units):
    baseline = _full(client, buyer_headers)
    assert baseline, "前提：u-1 至少能看到种子行"
    bogus = _full(client, buyer_headers, sort="bogus:desc")
    # 与不带 sort 完全一致（退回 updated_at desc + id 稳定次序），不是报错也不是空集
    assert bogus == baseline


# ============ 9. 反证 keyword 老行为未被破坏 ============

def test_keyword_branch_still_works(client, buyer_headers, cleanup_units):
    ids = _full(client, buyer_headers, keyword="INQ20260801002")
    # 种子里 u-1 可见、code 恰为该全值的只有 inq-2
    assert ids == ["inq-2"]
    # 片段同样命中（LIKE 子串语义没被动过）
    assert "inq-2" in _full(client, buyer_headers, keyword="20260801002")
