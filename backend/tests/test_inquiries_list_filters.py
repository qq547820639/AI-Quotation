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
# R113 新增格子的取数与字面量对账用（写法照抄同目录 test_inquiries_counts.py:41-44
# 与 test_inquiries_logs.py:45-53：测试侧直接引用路由器模块的私有谓词与实现常量）
from app.routers import inquiries as inquiries_api
from app.schemas import InquiryFilterSet
from app.state_machine import Q_SUBMITTED

UNITS = "R108LNKF"  # 本模块唯一标记：写入 owner_name，作为清理依据
# 报价"已提交"状态字面量（backend/app/state_machine.py:26 Q_SUBMITTED）。
# 新增的 R113 格子一律用它造报价行，并由
# test_has_submitted_quotation_filters_on_the_state_machine_constant 与实现常量互相对账：
# 任何一侧改了拼写都会在那里判红，而不是让真值档安静地返回空集。
QUOTATION_SUBMITTED = "SUBMITTED"


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


# ============ 12. R112：LIKE 通配符按字面量命中（四把子串筛子共用 _contains） ============

def test_like_wildcards_match_literally_across_the_four_substring_filters(
    client, buyer_headers, cleanup_units
):
    """`%` / `_` 在 code / subject / creator / category / keyword 上都必须是普通字符。

    这五把筛子都走 `backend/app/routers/inquiries.py:271-279 _contains()`
    （R112 之前是 `col.like(f"%{输入}%")`，`%`＝任意串、`_`＝任意单字符）。
    口径的来源不是"我觉得应该字面"：`src/pages/inquiry/list/index.tsx` 的客户端筛子
    与 `src/mocks/handlers.ts` 的桩都用 `.includes()`，两条路径一直是字面语义，
    服务端比它们宽就是缺陷——所以这条断言钉的是"服务端==前端==桩"。
    """
    m = f"{UNITS}T12"
    pct = _insert_inquiry(f"{m}-pct", code=f"INQ{m}50%OFF", subject=f"{m} 普通主题",
                          created_by_name=f"{m} 张三丰")
    und = _insert_inquiry(f"{m}-und", code=f"INQ{m}PLAIN", subject=f"{m} 键 x_y 主题",
                          created_by_name=f"{m} 李四光", categories=("合金材料",))
    plain = _insert_inquiry(f"{m}-plain", code=f"INQ{m}OTHER", subject=f"{m} 像 xay 的主题",
                            created_by_name=f"{m} 王五")
    # 基础盘：三行都在（否则下面的"只剩一行"可能是空集上的恒真）
    assert set(_full(client, buyer_headers, code=f"INQ{m}")) == {pct, und, plain}

    # code：`50%` 只命中字面含它的那行；旧写法里 `%` 会当任意串吃掉别的行
    assert _full(client, buyer_headers, code="50%") == [pct]
    assert _full(client, buyer_headers, code="%") == [pct]
    # subject：`x_y` 不得命中 "xay"
    assert _full(client, buyer_headers, subject="x_y") == [und]
    assert _full(client, buyer_headers, subject="xay") == [plain]   # 字面 xay 命中第三行
    # creator / category 同一把尺
    assert _full(client, buyer_headers, creator="李四光") == [und]
    assert _full(client, buyer_headers, category="合%") == []        # 没有哪一行的品类含字面 "合%"
    # `_` 当"任意单字符"时 "合_材" 会命中品类 "合金材料"；转义后必须只剩字面量，即空集
    assert _full(client, buyer_headers, category="合_材") == []
    assert _full(client, buyer_headers, category="金%") == []        # 同理：字面 "金%" 不存在
    assert _full(client, buyer_headers, category="合金材料") == [und]
    # keyword 是 OR(code,subject,owner_name) 三支，每支都得转义：
    # `%` 只该命中 code 里带字面 % 的那行（owner_name 全是 UNITS 标记，不含 %）
    assert _full(client, buyer_headers, keyword="50%") == [pct]


# ============ 13. R113：hasSubmittedQuotation（比价页"可对比清单"搬上服务端） ============
#
# 被测实现（本轮逐行开过，行号为 git 工作区当前状态）：
# - backend/app/routers/inquiries.py:349-368 `_apply_inquiry_filters` 的 hasSubmittedQuotation 一支：
#   真值串 1/true/yes ⇒ `EXISTS(quotations WHERE inquiry_id = inquiries.id AND status = Q_SUBMITTED)`；
#   伪值串 0/false/no ⇒ 取反的 `NOT (EXISTS …)`；其余值两支都不进（if/elif 没有 else）⇒ 整把筛子不加
# - backend/app/routers/inquiries.py:390 与 :442：`list_inquiries` 的同名 query 参数与转填
# - backend/app/schemas.py:466 `InquiryFilterSet.hasSubmittedQuotation`
#   （counts 端点与列表端点共用这一个模型，所以两份 WHERE 不分叉）
# - backend/app/state_machine.py:26 `Q_SUBMITTED`、:53 `QUOTATION_TRANSITIONS[Q_SUBMITTED] = {Q_DRAFT}`
#   （已提交可退回修改 ⇒ 落库形态就是"只剩一条 DRAFT 报价"）
# - backend/app/policy.py:63-84 `filter_visible_inquiries`（第 3 格的跨组织不可见按它）
#
# 存在理由：`src/pages/quotation/compare/index.tsx` 原来在整份无上限的询价数组上做
# `getQuotationsByInquiry(i.id).some(q => q.status === SUBMITTED)` 来算"可对比清单"，
# 本轮把这道筛子交给服务端。它一旦静默失效，页面就会列出没法比价的单且没人发现，
# 所以这一节每一格都断到具体 id 集合/具体数，不只断 200。

def _reown(inq_id, user_id):
    """把 `_insert_inquiry` 造的 u-1 行改挂到另一个用户名下：组织/owner_id/created_by_id 三列一起换，
    于是 policy.py:78-83 的三条 OR 全部断开（u-3 在华东分部，u-1 在总部采购中心）。
    owner_name 保留 UNITS 标记 ⇒ cleanup_units 照常删得掉；created_by_name 不动 ⇒
    下面的 creator 筛子对两个身份都命中，看得见/看不见就只差可见性谓词。
    """
    db = SessionLocal()
    try:
        other = db.query(User).filter(User.id == user_id).one()
        row = db.query(Inquiry).filter(Inquiry.id == inq_id).one()
        row.organization = other.organization
        row.owner_id = other.id
        row.created_by_id = other.id
        db.commit()
    finally:
        db.close()
    return inq_id


def _paged(client, headers, **params):
    """带 page/pageSize 的分页分支：断言返回分页结构，取 (id 列表, total)。"""
    resp = client.get("/api/inquiries", headers=headers,
                      params={**params, "page": 1, "pageSize": 50})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, dict), f"带分页参数应返回分页结构，实际 {type(body)}"
    return [r["id"] for r in body["items"]], body["total"]


def test_has_submitted_quotation_true_false_and_nonsense_polarity(
    client, buyer_headers, cleanup_units
):
    """三态极性钉在一批自造行上：真值串只剩那一条，伪值串是其余两条，乱值==省略。"""
    m = f"{UNITS}T13"
    with_sub = _insert_inquiry(f"{m}-sub", created_by_name=f"{m} c")
    only_draft = _insert_inquiry(f"{m}-draft", created_by_name=f"{m} c")
    no_quotation = _insert_inquiry(f"{m}-none", created_by_name=f"{m} c")
    _insert_quotation(with_sub, f"sup{m}1", QUOTATION_SUBMITTED)
    _insert_quotation(only_draft, f"sup{m}2", "DRAFT")
    # no_quotation：一份报价都没有
    three = {with_sub, only_draft, no_quotation}
    # 前提盘：三行都可见，否则下面"只剩一行"可能是空集上的恒真
    assert set(_full(client, buyer_headers, creator=m)) == three

    # 真值三支（含 strip/lower：实现做的是 `flag.strip().lower()`）都只给 with_sub
    for truthy in ("1", "true", "yes", " TRUE ", "Yes"):
        assert set(_full(client, buyer_headers, creator=m,
                         hasSubmittedQuotation=truthy)) == {with_sub}, truthy
    # 伪值三支给"没有已提交报价"的那两条
    for falsy in ("0", "false", "no", " FALSE "):
        assert set(_full(client, buyer_headers, creator=m,
                         hasSubmittedQuotation=falsy)) == {only_draft, no_quotation}, falsy

    # 空串/纯空白 == 省略该参数：整把筛子不加（inquiries.py 的 `elif flag:` 那一支之外）
    for blank in ("", "  "):
        assert set(_full(client, buyer_headers, creator=m,
                         hasSubmittedQuotation=blank)) == three, repr(blank)
    assert _full(client, buyer_headers, creator=m, hasSubmittedQuotation="") == \
        _full(client, buyer_headers, creator=m)
    # 乱值判 400，不静默当"没筛"（R113 复核时子代理点出：本模型的规矩是"错的东西不许静默变成没筛"，
    # extra="forbid" 对键名就是这么判的；值这一侧若当 no-op，调用方会把全集读成这一档，
    # 比价页那种情况下等于退回整份无界清单——本轮要拆掉的东西）。
    # 两条分支都要判：真后端的判点在 `_apply_inquiry_filters`，全量分支与分页分支都过它。
    for nonsense in ("maybe", "2", "TRUEISH", "on", "NULL", "y", "truthy"):
        for send in ({}, {"page": 1, "pageSize": 50}):
            resp = client.get("/api/inquiries", headers=buyer_headers,
                              params={"creator": m, "hasSubmittedQuotation": nonsense, **send})
            assert resp.status_code == 400, (nonsense, send, resp.text[:200])
            assert "hasSubmittedQuotation" in resp.text, (nonsense, resp.text[:200])
    # 反证 400 不是因为 creator 标记打不出行：同一个 creator 不带乱值仍是 200 三行
    assert set(_full(client, buyer_headers, creator=m)) == three
    # 真/伪两支互斥且并起来是全集：写成"两支都返回全集"或"两支互为同一个集合"都会红
    hit = set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="1"))
    miss = set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="0"))
    assert not (hit & miss)
    assert hit | miss == three


def test_has_submitted_quotation_tests_the_status_column_not_quotation_existence(
    client, buyer_headers, cleanup_units
):
    """EXISTS 里带 status=SUBMITTED：只有一条 DRAFT/TIMEOUT 报价的行不算"可对比"。

    撤回提交的那条按 app/state_machine.py:53 是 SUBMITTED→DRAFT，落库后就是"有一条 DRAFT 报价、
    没有任何 SUBMITTED 报价"——把谓词写成 `EXISTS(quotations WHERE inquiry_id = …)`（不带状态列）
    会把这几行一起放进来，那一行写法就是本格的靶。
    """
    m = f"{UNITS}T14"
    live = _insert_inquiry(f"{m}-live", created_by_name=f"{m} c", status="INQUIRING")
    approval = _insert_inquiry(f"{m}-approval", created_by_name=f"{m} c",
                               status="PENDING_APPROVAL")
    withdrawn = _insert_inquiry(f"{m}-withdrawn", created_by_name=f"{m} c", status="INQUIRING")
    timed_out = _insert_inquiry(f"{m}-timeout", created_by_name=f"{m} c", status="INQUIRING")
    _insert_quotation(live, f"sup{m}A", QUOTATION_SUBMITTED)
    _insert_quotation(approval, f"sup{m}B", QUOTATION_SUBMITTED)
    _insert_quotation(withdrawn, f"sup{m}C", "DRAFT")      # 提交过、又退回修改
    _insert_quotation(timed_out, f"sup{m}D", "TIMEOUT")    # 有报价行，但不是已提交
    four = {live, approval, withdrawn, timed_out}
    assert set(_full(client, buyer_headers, creator=m)) == four

    # 只剩两份真 SUBMITTED；撤回提交那行与超时那行都不算"可对比"
    assert set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="1")) == \
        {live, approval}
    assert set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="false")) == \
        {withdrawn, timed_out}
    # 询价单自己的状态不参与这把筛子：live 与 approval 的 inquiries.status 不同却同档，
    # withdrawn 与 live 的 inquiries.status 相同却分档 ⇒ 分档只由 quotations.status 造成
    assert set(_full(client, buyer_headers, creator=m, status="INQUIRING",
                     hasSubmittedQuotation="1")) == {live}
    # 反证 EXISTS 判的是"任一报价行"而不是"最后一行/最新一行"：
    # 给已经退回 DRAFT 的那行再补一份另一个供应商的已提交报价 ⇒ 它必须进真值档
    _insert_quotation(withdrawn, f"sup{m}E", QUOTATION_SUBMITTED)
    assert set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="true")) == \
        {live, approval, withdrawn}
    assert set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="no")) == {timed_out}


def test_has_submitted_quotation_array_and_paged_branches_agree_and_hide_foreign_rows(
    client, buyer_headers, admin_headers, cleanup_units
):
    """同一把筛子在两条取数分支给完全相同的行集与 total；跨组织那行对非管理员一律不出现。"""
    m = f"{UNITS}T15"
    sub = _insert_inquiry(f"{m}-sub", created_by_name=f"{m} c")
    draft = _insert_inquiry(f"{m}-draft", created_by_name=f"{m} c")
    none = _insert_inquiry(f"{m}-none", created_by_name=f"{m} c")
    foreign = _insert_inquiry(f"{m}-foreign", created_by_name=f"{m} c")
    _insert_quotation(sub, f"sup{m}1", QUOTATION_SUBMITTED)
    _insert_quotation(draft, f"sup{m}2", "DRAFT")
    _insert_quotation(foreign, f"sup{m}3", QUOTATION_SUBMITTED)  # 已提交报价，但挂在 u-3 名下
    _reown(foreign, "u-3")

    # 参考集由测试侧自己按"这条单有没有至少一份 SUBMITTED 报价"现算（不是复读实现的谓词），
    # 否则两支共用一个 query 对象时，"把筛子整个删掉"也能让 page_ids == full_ids 恒真。
    expect_true = [sub, foreign]        # 带 SUBMITTED 报价的两条（foreign 只被可见性挡）
    expect_false = [draft, none]
    for flag in ("1", "0", ""):
        full_ids = _full(client, buyer_headers, creator=m, hasSubmittedQuotation=flag)
        page_ids, total = _paged(client, buyer_headers, creator=m, hasSubmittedQuotation=flag)
        assert page_ids == full_ids, flag            # 行集与顺序都同形（分页路径没漏掉这把筛子）
        assert total == len(full_ids), (flag, total, full_ids)
    # 空值那一档等于不筛：四行里 u-1 看得见的三条（foreign 被可见性挡）
    assert set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="")) == \
        set(expect_true[:1] + expect_false)
    # 前提：上面三组等式不是在"两条分支都返回空"上恒真
    assert _full(client, buyer_headers, creator=m, hasSubmittedQuotation="1") == [sub]
    assert set(_full(client, buyer_headers, creator=m, hasSubmittedQuotation="0")) == {draft, none}

    # 可见性：带已提交报价的跨组织那行，非管理员在全量分支与分页分支都看不见
    assert foreign not in _full(client, buyer_headers, creator=m, hasSubmittedQuotation="1")
    assert foreign not in _paged(client, buyer_headers, creator=m, hasSubmittedQuotation="1")[0]
    assert foreign not in _full(client, buyer_headers, creator=m)
    # 反证它不是"其实没有已提交报价"：管理员同一档能读到它
    assert set(_full(client, admin_headers, creator=m, hasSubmittedQuotation="1")) == {sub, foreign}
    admin_page_ids, admin_total = _paged(client, admin_headers, creator=m,
                                         hasSubmittedQuotation="1")
    assert (set(admin_page_ids), admin_total) == ({sub, foreign}, 2)
    # 伪值档也不许漏：跨组织那行既不在 u-1 的真值档，也不该出现在他的伪值档
    assert foreign not in _full(client, buyer_headers, creator=m, hasSubmittedQuotation="0")
    assert set(_full(client, admin_headers, creator=m, hasSubmittedQuotation="0")) == {draft, none}


def test_has_submitted_quotation_counts_endpoint_matches_paged_total_per_scope(
    client, buyer_headers, cleanup_units
):
    """POST /api/inquiries/counts 在新键上与列表端点逐档同数，且真/伪两档正好二分。

    这把筛子挂在 `_apply_inquiry_filters` 上（inquiries.py:349），counts 端点调的是同一个函数
    （inquiries.py:507-510），所以"两份 WHERE 不分叉"（R111）在这一键上必须能被逐档核出来；
    二分等式则钉住"真值档+伪值档==不带该键的档"——任一支写成恒真/恒假都会在这里红。
    """
    m = f"{UNITS}T16"
    sub = _insert_inquiry(f"{m}-sub", created_by_name=f"{m} c")
    sub2 = _insert_inquiry(f"{m}-sub2", created_by_name=f"{m} c")
    draft = _insert_inquiry(f"{m}-draft", created_by_name=f"{m} c")
    none = _insert_inquiry(f"{m}-none", created_by_name=f"{m} c")
    _insert_quotation(sub, f"sup{m}1", QUOTATION_SUBMITTED)
    _insert_quotation(sub2, f"sup{m}2", QUOTATION_SUBMITTED)
    _insert_quotation(draft, f"sup{m}3", "DRAFT")

    scopes = {
        "标记内有": {"creator": m, "hasSubmittedQuotation": "1"},
        "标记内无": {"creator": m, "hasSubmittedQuotation": "0"},
        "标记内全部": {"creator": m},
        # 不加分组筛子的整张可见盘：u-1 看得见的全集也要被真/伪两支二分
        "全库有": {"hasSubmittedQuotation": "1"},
        "全库无": {"hasSubmittedQuotation": "0"},
        "全库裸": {},
    }
    resp = client.post("/api/inquiries/counts", headers=buyer_headers,
                       json={"items": [{"label": k, "filters": v}
                                        for k, v in scopes.items()]})
    assert resp.status_code == 200, resp.text
    counts = resp.json()["counts"]
    assert set(counts) == set(scopes)

    # 逐档对账：counts[label] == 同一组参数下分页端点的 total（不是只断整包 200）
    for label, filters in scopes.items():
        assert counts[label] == _paged(client, buyer_headers, **filters)[1], (label, filters)
    # 二分：真值档 + 伪值档 == 不带该键的档（标记内与整张可见盘各核一次）
    assert counts["标记内有"] + counts["标记内无"] == counts["标记内全部"]
    assert counts["全库有"] + counts["全库无"] == counts["全库裸"]
    # 乱值档整包 400（判点与 GET 同一个 `_apply_inquiry_filters`）：
    # 计数端点更要把"筛子没生效的全集数"拦下来——审批页那种格子读到的就是一个看起来正常的数字
    bad = client.post(
        "/api/inquiries/counts",
        headers=buyer_headers,
        json={"items": [{"label": "乱", "filters": {"creator": m, "hasSubmittedQuotation": "maybe"}}]},
    )
    assert bad.status_code == 400, bad.text
    assert "hasSubmittedQuotation" in bad.text, bad.text
    # 两支同形：JSON 布尔 true 与查询串 "true" 必须落到同一个值。
    # 名字是布尔形状的筛子，客户端第一种写法很可能就是布尔；一支 422 一支 200 就是分叉。
    boolish = client.post(
        "/api/inquiries/counts",
        headers=buyer_headers,
        json={"items": [
            {"label": "布尔真", "filters": {"creator": m, "hasSubmittedQuotation": True}},
            {"label": "字符串真", "filters": {"creator": m, "hasSubmittedQuotation": "true"}},
            {"label": "布尔假", "filters": {"creator": m, "hasSubmittedQuotation": False}},
            {"label": "字符串假", "filters": {"creator": m, "hasSubmittedQuotation": "0"}},
        ]},
    )
    assert boolish.status_code == 200, boolish.text
    bc = boolish.json()["counts"]
    assert bc["布尔真"] == bc["字符串真"] == 2, bc
    assert bc["布尔假"] == bc["字符串假"] == 2, bc
    # 反证布尔那两支不是"没筛"：不带该键的档是 4
    assert bc["布尔真"] != counts["标记内全部"], bc
    # 前提：不是 0+4==4 或 0+N==N 的恒真——自造四行里两有两无
    assert counts["标记内有"] == 2 and counts["标记内无"] == 2
    assert counts["标记内全部"] == 4
    assert counts["全库有"] >= 2 and counts["全库无"] >= 2


def test_has_submitted_quotation_filters_on_the_state_machine_constant():
    """字面量对账：筛子绑进 SQL 的那个状态值必须就是它 import 的 state_machine 常量。

    写法照抄 test_inquiries_logs.py:74-94 与 test_inquiries_counts.py:58-69（本地字面量 ==
    实现常量），并把它推进一层：不看渲染文本（SQLAlchemy 版本升级会改 EXISTS 的拼法），
    只看编译出来的**绑定值**——那才是 `Quotation.status == Q_SUBMITTED` 真正比的那个字符串。
    少了这一格，任一侧改了枚举拼写的表现是"真值档安静地返回空集"，
    比价页从此列不出任何单，而 counts==total、二分等式那几半边仍可以全绿。
    """
    assert QUOTATION_SUBMITTED == Q_SUBMITTED
    # 端点运行时解析到的那个名字（inquiries.py:49-51 `from ..state_machine import … Q_SUBMITTED`）
    assert inquiries_api.Q_SUBMITTED == Q_SUBMITTED
    db = SessionLocal()
    try:
        for flag in ("1", "true", "yes", "0", "false", "no"):
            params = inquiries_api._apply_inquiry_filters(
                db.query(Inquiry), InquiryFilterSet(hasSubmittedQuotation=flag)
            ).statement.compile().params
            # 两支绑的都是同一个"已提交"值，差别只在 EXISTS 取不取反
            assert set(params.values()) == {QUOTATION_SUBMITTED}, (flag, params)
        # 空串/纯空白两支都不进 ⇒ 连状态值都不绑（"等于不传"的谓词形状）
        for blank in ("", "   "):
            noop = inquiries_api._apply_inquiry_filters(
                db.query(Inquiry), InquiryFilterSet(hasSubmittedQuotation=blank)
            ).statement.compile().params
            assert noop == {}, (repr(blank), noop)
        # 乱值：判点在谓词构造处，抛的是 400 的 HTTPException（不是静默 no-op）
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            inquiries_api._apply_inquiry_filters(
                db.query(Inquiry), InquiryFilterSet(hasSubmittedQuotation="maybe")
            )
        assert exc.value.status_code == 400, exc.value.status_code
        # 布尔形状经 schema 的 validator 归一后才到这里，所以谓词层只认规范串：
        # 直接给它 True 会被 validator 换成 "1"，而裸 "TRUE"/2 会被判 400
        assert InquiryFilterSet(hasSubmittedQuotation=True).hasSubmittedQuotation == "1"
        assert InquiryFilterSet(hasSubmittedQuotation=False).hasSubmittedQuotation == "0"
        assert InquiryFilterSet(hasSubmittedQuotation=1).hasSubmittedQuotation == "1"
        # 同一枚常量还得覆盖"排序表达式"那一处：`sort=submittedCount` 与这把筛子
        # 比的是同一个列同一个值，两处若各写一份字面量，改枚举时只会红一边。
        sort_bound = inquiries_api._SUBMITTED_COUNT_EXPR.compile().params
        assert QUOTATION_SUBMITTED in set(sort_bound.values()), sort_bound
    finally:
        db.close()



def test_inquiries_router_binds_no_bare_submitted_literal():
    """字面量普查（AST）：`routers/inquiries.py` 里不许再出现裸的 "SUBMITTED" 字符串常量。

    为什么不用"编译出来的绑定值 == 常量"那种对账（上一格就是那种写法）：
    实现把 `Quotation.status == Q_SUBMITTED` 换回 `== "SUBMITTED"` 时，绑出来的值一字不差，
    那种对账照样全绿——它只钉得住"枚举拼写改了没人跟着改"，钉不住"同一个值又多了第二个来源"。
    本格判的是**写法**：走 AST 取常量节点，注释里的字面量不算（所以第 252 行那段说明不会误红）。
    少这一格，下一次有人再加筛子时会照抄导出路径那种写法，而 R113 刚把 `_SUBMITTED_COUNT_EXPR`
    和导出路径两处都换成常量——全仓其他 routers 还各自抄了一份，那部分记在登记册 R113 六的开放项里。
    """
    import ast
    import inspect

    source = inspect.getsource(inquiries_api)
    tree = ast.parse(source)
    bare = [
        (node.lineno, node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
        and node.value == QUOTATION_SUBMITTED
    ]
    assert bare == [], f"routers/inquiries.py 里还有 {len(bare)} 处裸字面量：{bare}"
    # 反向对照的前提：本文件真的在用那个常量（否则"零字面量"是因为整个功能被删了）
    used = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and node.id == "Q_SUBMITTED"
    ]
    assert len(used) >= 3, f"Q_SUBMITTED 只出现 {len(used)} 次，取值 {used}"
