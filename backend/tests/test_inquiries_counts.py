"""POST /api/inquiries/counts 常驻用例（R111，一次请求问完多档计数）

被测实现（本轮逐行开过，行号为 git 工作区当前状态）：
- backend/app/routers/inquiries.py:426-459 `inquiry_counts`：三道校验（空/空白 label → 400
  "label 不能为空"；重复 label → 400 "label 不得重复"；档数 > `_MAX_COUNT_ITEMS` → 400），
  随后逐档 `filter_visible_inquiries(db.query(Inquiry), user)` + `_apply_inquiry_filters` + `count()`
  （:456-458），返回 `{"counts": {label: int}}`
- backend/app/routers/inquiries.py:260-322 `_apply_inquiry_filters`：唯一一份筛子谓词，
  列表端点在 :376 调它、计数端点在 :457 调同一个函数
- backend/app/routers/inquiries.py:257 `_MAX_COUNT_ITEMS = 32`
- backend/app/schemas.py:445-478 `InquiryFilterSet`（`extra="forbid"`，无 sort/page 字段）、
  `InquiryCountSpec`（`filters` 有默认值 ⇒ 省略即空筛子）、`InquiryCountsRequest`、`InquiryCountsSchema`
- backend/app/policy.py:63-84 `filter_visible_inquiries`：管理员不加 WHERE，
  其余按 owner_id / created_by_id / organization 三选一可见
- 鉴权：backend/app/auth.py:145 `HTTPBearer(auto_error=False)` + :159-160 ⇒ 无 token 走 401

存在理由：审批页 R110 那版是发四次 `pageSize=1` 的分页请求拼四个 total（进页请求数按"几格"线性涨），
R111 压成一次 POST——现在那四档筛子就在 src/pages/approval/index.tsx:144-151，
其中前两档（status / nodeStatus 两值逗号串）就是本文件第 1 格用的组合。
压完之后的风险只有一个——计数端点与列表端点各说一套，
所以本模块每一格都拿**同一组筛子**去读 `GET /api/inquiries` 的 `total` 逐档对账，而不是只断 200。

"筛子真的加上了"由 baseline 差分钉住：seed 前先用同一批筛子读一遍 total，seed 后再读一遍，
差值必须等于本格设计上命中该筛子的自造行数。筛子若被静默忽略，各档差值会一起变成"自造行总数"
这一个数（各格都按此排好了差值互不相等）。档位上限两侧都测（32 ⇒ 200、33 ⇒ 400），
只测一侧的话上限挪一位也测不出来。

造行/清理写法照抄同目录 test_inquiries_node_status.py（直接写库 + owner_name 唯一标记 UNITS +
用例后清 inquiries/inquiry_items/inquiry_supplier/quotations/inquiry_logs/approval_nodes），
夹具名沿用 backend/tests/conftest.py 的 `client` / `buyer_headers`(u-1) / `admin_headers`(u-6)；
跨组织用户 u-3 的登录 helper 照抄同目录 test_task_authorization.py:35-38。
"""
import pytest
from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import (
    ApprovalNode, Inquiry, InquiryItem, InquiryLog, Quotation, QuotationItem, User,
    inquiry_supplier,
)
from app.routers.inquiries import (
    APV_APPROVED, APV_PENDING, APV_REJECTED,
    S_COMPLETED, S_PENDING_APPROVAL, _MAX_COUNT_ITEMS,
)

UNITS = "R111CNT"  # 本模块唯一标记：写入 owner_name 作为清理依据
COUNTS_URL = "/api/inquiries/counts"

# 审批节点状态字面量（backend/app/routers/inquiries.py:60-62）
NODE_PENDING = "PENDING"
NODE_APPROVED = "APPROVED"
NODE_REJECTED = "REJECTED"
# 询价状态字面量（backend/app/routers/inquiries.py:52、56，由 state_machine 导出）
INQ_PENDING_APPROVAL = "PENDING_APPROVAL"
INQ_COMPLETED = "COMPLETED"


@pytest.fixture(autouse=True)
def _literal_drift_guard():
    """字面量对账：本文件写的状态/上限必须与实现常量同值。

    不这么做的话，实现侧改枚举名或改档数上限，会让"筛子筛出 N 行"的差分静默退化成
    "筛出 0 行"，而 `counts == total` 那半边仍然全绿。
    """
    assert (NODE_PENDING, NODE_APPROVED, NODE_REJECTED) == (
        APV_PENDING, APV_APPROVED, APV_REJECTED
    )
    assert (INQ_PENDING_APPROVAL, INQ_COMPLETED) == (S_PENDING_APPROVAL, S_COMPLETED)
    assert _MAX_COUNT_ITEMS == 32


# ============ 造行与调用helper ============

def _now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _day(offset_days=0):
    return (datetime.now() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


def _insert_inquiry(inq_id, *, marker, as_user="u-1", status=INQ_PENDING_APPROVAL,
                    code=None, subject=None, created_by_name=None,
                    created_at=None, deadline=None, categories=()):
    """直接写库造一条询价单：组织/owner/创建人全部取自 `as_user`，
    可见性由 app/policy.py:63-84 的三条 OR 决定；返回 id。"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == as_user).one()
        now = _now_text()
        row = Inquiry(
            id=inq_id,
            code=code or f"INQ{inq_id}",
            subject=subject or f"{marker} 主题 {inq_id}",
            organization=user.organization,
            owner_name=UNITS,
            owner_id=user.id,
            currency="CNY",
            deadline=deadline or f"{_day(3)} 12:00:00",
            delivery_address="上海",
            contact="李四",
            payment_terms="款到发货",
            status=status,
            created_by_id=user.id,
            created_by_name=created_by_name or f"{marker} c",
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
        db.commit()
    finally:
        db.close()
    return inq_id


def _insert_node(inq_id, order, node_status):
    """照实造审批节点：审批人取种子里的 u-2，comment/time 留空（两列可空）。"""
    db = SessionLocal()
    try:
        approver = db.query(User).filter(User.id == "u-2").one()
        db.add(ApprovalNode(
            id=f"apv-{inq_id}-{order}",
            inquiry_id=inq_id,
            node_order=order,
            approver_id=approver.id,
            approver_name=approver.name,
            approver_role=approver.role,
            status=node_status,
        ))
        db.commit()
    finally:
        db.close()
    return f"apv-{inq_id}-{order}"


@pytest.fixture
def cleanup_units():
    """每个用例后把本模块造的行删干净（测试库跨模块共享）。"""
    yield
    db = SessionLocal()
    try:
        ids = [r[0] for r in db.query(Inquiry.id).filter(Inquiry.owner_name == UNITS)]
        if ids:
            db.query(ApprovalNode).filter(ApprovalNode.inquiry_id.in_(ids)).delete(
                synchronize_session=False
            )
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


def _login_headers(client, user_id: str) -> dict:
    resp = client.post("/api/auth/login", json={"userId": user_id})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def _total(client, headers, **params):
    """分页端点的 total（`GET /api/inquiries?page=1&pageSize=1&…`）——对账用的权威读数。"""
    resp = client.get("/api/inquiries", headers=headers,
                      params={**params, "page": 1, "pageSize": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, dict), f"带分页参数应返回分页结构，实际 {type(body)}"
    return body["total"]


def _totals(client, headers, scopes):
    """label -> filters 的整张表逐档读 total（seed 前后各读一次，用来做差分）。"""
    return {label: _total(client, headers, **filters) for label, filters in scopes.items()}


def _full_ids(client, headers):
    resp = client.get("/api/inquiries", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list), f"无分页参数应返回全量数组，实际 {type(body)}"
    return [r["id"] for r in body]


def _items(scopes):
    return [{"label": label, "filters": filters} for label, filters in scopes.items()]


def _post_counts(client, headers, scopes):
    """一次 POST 拿回整张 counts（校验类用例走 `_post` 自己断状态码）。"""
    resp = _post(client, headers, _items(scopes))
    assert resp.status_code == 200, resp.text
    return resp.json()["counts"]


def _post(client, headers, items):
    return client.post(COUNTS_URL, headers=headers, json={"items": items})


def _assert_each_label_equals_paged_total(client, headers, scopes, counts):
    """核心对账：逐档 counts[label] == 同筛子下分页端点的 total（不是只断整包 200）。"""
    for label, filters in scopes.items():
        assert counts[label] == _total(client, headers, **filters), (
            f"档位 {label!r} 的计数 {counts[label]!r} 与 GET /api/inquiries 的 "
            f"total 不一致（筛子 {filters}）"
        )


# ============ 1. 审批页四档 + 无筛子档：逐档与分页端点 total 相等 ============

APPROVAL_SCOPES = {
    # src/pages/approval/index.tsx:144-151 的四档
    "pending": {"status": INQ_PENDING_APPROVAL},
    "history": {"nodeStatus": f"{NODE_APPROVED},{NODE_REJECTED}"},
    "approved": {"nodeStatus": NODE_APPROVED},
    "rejected": {"nodeStatus": NODE_REJECTED},
    "all": {},
}


def _rows_approval_page(m):
    """五行只差"询价状态 + 审批节点"：
    A 只有一个 APPROVED 节点；B 只有一个 REJECTED 节点；C APPROVED+REJECTED 都有；
    D 一个节点也没有（neither）；E 是 COMPLETED 单但带 APPROVED 节点（落在 status 档之外）。
    """
    a = _insert_inquiry(f"{m}-A", marker=m)
    _insert_node(a, 1, NODE_APPROVED)
    b = _insert_inquiry(f"{m}-B", marker=m)
    _insert_node(b, 1, NODE_REJECTED)
    c = _insert_inquiry(f"{m}-C", marker=m)
    _insert_node(c, 1, NODE_APPROVED)
    _insert_node(c, 2, NODE_REJECTED)
    d = _insert_inquiry(f"{m}-D", marker=m)                       # neither
    e = _insert_inquiry(f"{m}-E", marker=m, status=INQ_COMPLETED)  # 非待审批，但带 APPROVED
    _insert_node(e, 1, NODE_APPROVED)
    return a, b, c, d, e


def test_approval_page_scopes_each_equal_paged_total(client, buyer_headers, cleanup_units):
    m = f"{UNITS}A1"
    before = _totals(client, buyer_headers, APPROVAL_SCOPES)
    a, b, c, d, e = _rows_approval_page(m)
    five = {a, b, c, d, e}
    after = _totals(client, buyer_headers, APPROVAL_SCOPES)
    counts = _post_counts(client, buyer_headers, APPROVAL_SCOPES)

    # 逐档对账：counts == GET total（同一份 _apply_inquiry_filters，结构上不许各说一套）
    _assert_each_label_equals_paged_total(client, buyer_headers, APPROVAL_SCOPES, counts)
    assert counts == after
    # 前提盘：自造五行都在无筛子档里冒过 ⇒ 下面的差分只由 status/nodeStatus 造成
    assert set(_full_ids(client, buyer_headers)) >= five

    # 差分钉"每档真的加了自己的筛子"：
    # pending=A,B,C,D（E 是 COMPLETED）；history=A,B,C,E（D 无节点）；
    # approved=A,C,E；rejected=B,C；all=五行全进
    deltas = {k: after[k] - before[k] for k in APPROVAL_SCOPES}
    assert deltas == {
        "pending": 4, "history": 4, "approved": 3, "rejected": 2, "all": 5,
    }
    # 五档至少四种数：筛子退化成"谁也不筛"或"只认第一档"都会红
    assert len(set(deltas.values())) >= 4
    # 反证 C 有两个节点不被放大成两行（EXISTS 语义 ⇒ history 比 approved 多一档的行数差为 1）
    assert after["history"] - after["approved"] == before["history"] - before["approved"] + 1
    # 无筛子档与全量数组分支也一致（分页/非分页两条取数路都在同一可见集上）
    assert counts["all"] == len(_full_ids(client, buyer_headers))


# ============ 2. 一次请求多档：每档各自等于对应的分页 total ============

def test_one_request_several_scopes_each_matches_its_own_paged_query(
    client, buyer_headers, cleanup_units
):
    """一次 POST 换掉四次 GET：断的是"每一档的数 == 那一档自己的 GET total"，
    不是"整包返回 200"——后者在筛子全部退化成同一个全集时也会绿。"""
    m = f"{UNITS}A2"
    scopes = {
        "待审批": {"status": INQ_PENDING_APPROVAL},
        "审批历史": {"nodeStatus": f"{NODE_APPROVED},{NODE_REJECTED}"},
        "试剂明细": {"category": "试剂"},
        "主题含试剂": {"subject": f"{m}试剂"},
        "编号含GAMMA": {"code": f"{m}GAMMA"},
    }
    # baseline 必须在 seed 之前读：绝对值里有种子数据和其他模块看不见的行，
    # 只有"seed 前后同一筛子的差分"能钉住这一档确实筛了
    before = _totals(client, buyer_headers, scopes)
    before["裸档"] = _total(client, buyer_headers)

    r1 = _insert_inquiry(
        f"{m}-r1", marker=m, code=f"INQ{m}ALPHA", subject=f"{m}设备采购单",
        categories=["检验试剂"], deadline=f"{_day(0)} 18:00:00",
    )
    _insert_node(r1, 1, NODE_APPROVED)
    r2 = _insert_inquiry(
        f"{m}-r2", marker=m, code=f"INQ{m}BETA", subject=f"{m}试剂采购单",
        categories=["耗材"], status=INQ_COMPLETED, deadline=f"{_day(7)} 18:00:00",
        created_at=f"{_day(-40)} 09:00:00",
    )
    _insert_node(r2, 1, NODE_REJECTED)
    r3 = _insert_inquiry(
        f"{m}-r3", marker=m, code=f"INQ{m}GAMMA", subject=f"{m}五金采购单",
        categories=["耗材"], status=INQ_COMPLETED, deadline=f"{_day(7)} 09:00:00",
    )
    assert {r1, r2, r3} <= set(_full_ids(client, buyer_headers))

    items = _items(scopes)
    # `filters` 省略即空筛子（app/schemas.py:469 InquiryCountSpec 的默认值）
    items.append({"label": "裸档"})
    resp = client.post(COUNTS_URL, headers=buyer_headers, json={"items": items})
    assert resp.status_code == 200, resp.text
    counts = resp.json()["counts"]

    assert set(counts) == {it["label"] for it in items}
    _assert_each_label_equals_paged_total(client, buyer_headers, scopes, counts)
    assert counts["裸档"] == _total(client, buyer_headers)
    # 每档设计上命中几行自造数据：待审批 1（r1）/审批历史 2（r1,r2）/试剂明细 1（r1）/
    # 主题含试剂 1（r2）/编号含GAMMA 1（r3）/裸档 3（三行全进）——
    # 筛子被忽略时六档会清一色变成 3
    assert {k: counts[k] - before[k] for k in counts} == {
        "待审批": 1, "审批历史": 2, "试剂明细": 1, "主题含试剂": 1,
        "编号含GAMMA": 1, "裸档": 3,
    }
    # 六档不是同一个数（"一次换多次"要成立，每档得各自筛各自的）
    assert len({counts[k] for k in counts}) >= 3


def test_multi_scope_counts_are_the_same_numbers_as_four_separate_paged_calls(
    client, buyer_headers, cleanup_units
):
    """把"一次换四次"钉成等式：一次 POST 的四档读数 == 四次 GET 的四个 total。"""
    m = f"{UNITS}A2B"
    scopes = {
        "pending": {"status": INQ_PENDING_APPROVAL},
        "history": {"nodeStatus": f"{NODE_APPROVED},{NODE_REJECTED}"},
        "approved": {"nodeStatus": NODE_APPROVED},
        "rejected": {"nodeStatus": NODE_REJECTED},
    }
    # 逐档 GET 的读数（审批页 R110 的取数形状：page=1&pageSize=1 读 total）
    per_get = {label: _total(client, buyer_headers, **filters)
               for label, filters in scopes.items()}
    counts = _post_counts(client, buyer_headers, scopes)
    assert counts == per_get
    # 加一行"待审批 + 带 APPROVED 节点"的单：pending/history/approved 各 +1，rejected 不动
    # （四档各自筛各自的，一次 POST 就顶掉四次 GET）
    a = _insert_inquiry(f"{m}-A", marker=m)
    _insert_node(a, 1, NODE_APPROVED)
    expect = {**per_get, "pending": per_get["pending"] + 1,
              "history": per_get["history"] + 1, "approved": per_get["approved"] + 1,
              "rejected": per_get["rejected"]}
    assert _post_counts(client, buyer_headers, scopes) == expect
    assert _post_counts(client, buyer_headers, scopes) == {
        label: _total(client, buyer_headers, **filters) for label, filters in scopes.items()
    }


# ============ 3. 筛子覆盖面：七种筛子逐一对账分页 total ============

def test_every_filter_key_matches_paged_endpoint(client, buyer_headers, cleanup_units):
    m = f"{UNITS}A3"
    scopes = {
        # keyword：OR(code, subject, owner_name) —— 只有 r1/r3 的编号带 KWORDER
        "keyword": {"keyword": f"{m}KWORDER"},
        # code × subject 同给是 AND：r3 编号命中但主题不命中 ⇒ 只剩 r1
        "code_and_subject": {"code": f"{m}KWORDER", "subject": "试剂"},
        "category": {"category": "试剂"},
        "deadline_range": {"deadlineFrom": _day(0), "deadlineTo": _day(0)},
        "date_range": {"dateFrom": _day(0), "dateTo": _day(0)},
        "creator": {"creator": f"{m} 李四光"},
        # status × nodeStatus 组合：AND 语义 ⇒ 只剩 r1（OR 语义会数到 r3）
        "status_and_node": {"status": INQ_PENDING_APPROVAL, "nodeStatus": NODE_APPROVED},
    }
    before = _totals(client, buyer_headers, scopes)

    r1 = _insert_inquiry(
        f"{m}-r1", marker=m, code=f"INQ{m}KWORDER1", subject=f"{m}甲 试剂采购",
        created_by_name=f"{m} 张三丰", categories=["检验试剂"],
        deadline=f"{_day(0)} 12:00:00", created_at=f"{_day(0)} 08:00:00",
    )
    _insert_node(r1, 1, NODE_APPROVED)
    r2 = _insert_inquiry(
        f"{m}-r2", marker=m, code=f"INQ{m}PLAIN2", subject=f"{m}乙 耗材采购",
        created_by_name=f"{m} 张三丰", categories=["耗材"],
        deadline=f"{_day(0)} 20:00:00", created_at=f"{_day(0)} 22:00:00",
    )
    _insert_node(r2, 1, NODE_REJECTED)
    r3 = _insert_inquiry(
        f"{m}-r3", marker=m, code=f"INQ{m}KWORDER3", subject=f"{m}丙 设备采购",
        created_by_name=f"{m} 李四光", categories=["电子设备"], status=INQ_COMPLETED,
        deadline=f"{_day(30)} 12:00:00", created_at=f"{_day(-30)} 12:00:00",
    )
    assert {r1, r2, r3} <= set(_full_ids(client, buyer_headers))

    counts = _post_counts(client, buyer_headers, scopes)
    _assert_each_label_equals_paged_total(client, buyer_headers, scopes, counts)
    # 七档各命中几行自造数据：2/1/1/2/2/1/1——筛子若被忽略会七档清一色 3
    assert {k: counts[k] - before[k] for k in scopes} == {
        "keyword": 2, "code_and_subject": 1, "category": 1,
        "deadline_range": 2, "date_range": 2, "creator": 1, "status_and_node": 1,
    }
    # 每档都非零、且没有一档等于"三行全进"（防"筛子写成恒真"）
    assert all(counts[k] > 0 for k in scopes)
    assert all(counts[k] - before[k] < 3 for k in scopes)


# ============ 4. 校验：422 / 400 / 上限两侧 / 空 items ============

def test_unknown_filter_key_is_422(client, buyer_headers, cleanup_units):
    """`extra="forbid"`（app/schemas.py:451）：写错键名一律 422，不静默忽略——
    静默忽略会把"筛子没生效的全集数"当成这一格的数报出去。"""
    for bad in ({"bogus": 1}, {"status": "DRAFT", "statuses": "DRAFT"},
                {"node_status": NODE_APPROVED}):
        resp = _post(client, buyer_headers, [{"label": "x", "filters": bad}])
        assert resp.status_code == 422, (bad, resp.text)
    # sort / 分页不属于筛子集（InquiryFilterSet 无此字段）⇒ 同样 422，不许被当成筛子吃下
    for bad in ({"sort": "itemsCount:desc"}, {"page": 1, "pageSize": 20}, {"label": "y"}):
        resp = _post(client, buyer_headers, [{"label": "x", "filters": bad}])
        assert resp.status_code == 422, (bad, resp.text)


def test_duplicate_label_is_400(client, buyer_headers, cleanup_units):
    resp = _post(client, buyer_headers, [
        {"label": "dup", "filters": {"status": INQ_PENDING_APPROVAL}},
        {"label": "other", "filters": {}},
        {"label": "dup", "filters": {}},
    ])
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "label 不得重复"


def test_empty_or_whitespace_label_is_400(client, buyer_headers, cleanup_units):
    for blank in ("", "   ", "\t"):
        resp = _post(client, buyer_headers, [{"label": blank, "filters": {}}])
        assert resp.status_code == 400, (repr(blank), resp.text)
        assert resp.json()["detail"] == "label 不能为空"


def test_item_cap_32_passes_and_33_rejected(client, buyer_headers, cleanup_units):
    """上限两侧都测：恰好 32 档 ⇒ 200 且逐档给出数；33 档 ⇒ 400。
    只测拒绝一侧的话 `> _MAX_COUNT_ITEMS` 写成 `>=` 也测不出来。"""
    cap = _MAX_COUNT_ITEMS
    scoped = [{"label": f"L{i}", "filters": {}} for i in range(cap)]
    ok = client.post(COUNTS_URL, headers=buyer_headers, json={"items": scoped})
    assert ok.status_code == 200, ok.text
    assert len(ok.json()["counts"]) == cap

    over = scoped + [{"label": f"L{cap}", "filters": {}}]
    bad = client.post(COUNTS_URL, headers=buyer_headers, json={"items": over})
    assert bad.status_code == 400, bad.text
    assert bad.json()["detail"] == f"items 最多 {cap} 档"


def test_empty_items_returns_empty_counts(client, buyer_headers, cleanup_units):
    resp = _post(client, buyer_headers, [])
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"counts": {}}


def test_missing_or_malformed_body_is_422(client, buyer_headers, cleanup_units):
    """items 必填（app/schemas.py:474）；缺 items 或档位缺 label 都是 pydantic 422，不是 500。"""
    resp = client.post(COUNTS_URL, headers=buyer_headers, json={})
    assert resp.status_code == 422, resp.text
    resp = client.post(COUNTS_URL, headers=buyer_headers, json={"items": [{"filters": {}}]})
    assert resp.status_code == 422, resp.text


def test_counts_endpoint_requires_authentication(client, buyer_headers, cleanup_units):
    resp = client.post(COUNTS_URL, json={"items": [{"label": "all", "filters": {}}]})
    assert resp.status_code == 401, resp.text


# ============ 5. 可见性：同一份筛子，非管理员数出来的必须是自己看得见的那部分 ============

def test_non_admin_counts_are_strictly_smaller_than_admin_and_match_own_list(
    client, buyer_headers, admin_headers, cleanup_units
):
    m = f"{UNITS}A5"
    # u-1（总部采购中心）三行、u-3（华东分部）两行；创建人名都带同一个标记 m
    own = [_insert_inquiry(f"{m}-h{i}", marker=m, as_user="u-1") for i in (1, 2, 3)]
    foreign = [_insert_inquiry(f"{m}-e{i}", marker=m, as_user="u-3") for i in (1, 2)]
    scopes = {"all": {}, "marker": {"creator": m}}
    huadong_headers = _login_headers(client, "u-3")

    counts_admin = _post_counts(client, admin_headers, scopes)
    counts_buyer = _post_counts(client, buyer_headers, scopes)
    counts_huadong = _post_counts(client, huadong_headers, scopes)

    # 同一份请求体、同一档：管理员看得见五行，u-1 只看得见三行，u-3 只看得见两行
    # （标记 m 是本格独有的，所以这里可以断绝对值）
    assert counts_admin["marker"] == 5
    assert counts_buyer["marker"] == 3
    assert counts_huadong["marker"] == 2
    # 严格小于，不是"约等于"：跨组织那两行对 u-1 不可见、本组织三行对 u-3 不可见
    assert counts_buyer["marker"] < counts_admin["marker"]
    assert counts_huadong["marker"] < counts_admin["marker"]
    assert counts_buyer["all"] < counts_admin["all"]
    assert counts_huadong["all"] < counts_admin["all"]
    # 每一档都等于该身份自己的 GET /api/inquiries total（可见性谓词与列表端点同源）
    for who, got in ((admin_headers, counts_admin), (buyer_headers, counts_buyer),
                     (huadong_headers, counts_huadong)):
        _assert_each_label_equals_paged_total(client, who, scopes, got)
    # 反证：跨组织那两行确实不在 u-1 的列表里（不是"数出来碰巧小"）
    buyer_ids = set(_full_ids(client, buyer_headers))
    assert set(own) <= buyer_ids
    assert not (set(foreign) & buyer_ids)
