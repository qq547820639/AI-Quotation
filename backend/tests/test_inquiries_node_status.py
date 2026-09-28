"""GET /api/inquiries 的 nodeStatus 常驻用例（R110，逗号分隔审批节点状态 → EXISTS approval_nodes）

被测实现：backend/app/routers/inquiries.py:351-361
    if nodeStatus:
        nodes = [s.strip() for s in nodeStatus.split(",") if s.strip()]
        if nodes:
            query = query.filter(exists().where(and_(
                ApprovalNode.inquiry_id == Inquiry.id,
                ApprovalNode.status.in_(nodes))))

动机：审批页 src/pages/approval/index.tsx:127（历史页签 listQuery）与 145-148
（"已通过/已驳回"两张统计卡）原来靠扫整份无界 inquiries 数组的 approvalNodes 算
（同文件 109-118 的 historyList useMemo），分页成为默认取数路径后这把筛子必须搬上服务端；
MSW 侧同形实现在 src/mocks/handlers.ts:272-277。

审批节点状态字面量（两处一手核对，不照抄任何口头描述）：
- 前端枚举 src/types/index.ts:569-576：PENDING / APPROVED / REJECTED
- 后端常量 backend/app/routers/inquiries.py:60-62：APV_PENDING / APV_APPROVED / APV_REJECTED
- 落库列 backend/app/models.py:173（status，nullable=False）
本模块另设 autouse 夹具逐一对账实现常量：字面量一旦漂移，每一格立刻红，
不会静默退化成"筛不出行"的假绿。

approval_nodes 表列（backend/app/models.py:162-176）：
id / inquiry_id / node_order / approver_id / approver_name / approver_role / status 非空，
comment / time 可空；(inquiry_id, node_order) 唯一。造行时审批人取自种子里的 u-2。

七格各断到具体行集（行集由 creator=<本格唯一标记> 圈到自造行，标记写进 created_by_name）：
1. 单值：A(APPROVED) / B(REJECTED×2) / C(PENDING) ⇒ nodeStatus=APPROVED 只剩 A
2. CSV 多值：APPROVED,REJECTED ⇒ 恰好 A、B 两行（钉"逗号分隔是并集"，与 status 参数同语义）
3. 与 status（询价状态）组合：status=COMPLETED&nodeStatus=REJECTED ⇒ 只剩 B（两个筛子是 AND）
4. 分页一致性：同一 nodeStatus 在「不带 page」与「page=1&pageSize=50」下 id 集合完全相等
5. 空值 / 垃圾值：nodeStatus=（空）与 nodeStatus=NOT_A_STATUS 各一格，都 200 且行集只含
   真带该状态节点的行（垃圾值为空集），不许 500
6. 无审批节点的询价不被拉进来：不带 nodeStatus 时它在、带任一真实节点状态时它不在（正反两半）
7. 效力臂不在本文件里，是一轮手工操作：把实现里的 `ApprovalNode.inquiry_id == Inquiry.id`
   临时换成恒真（`ApprovalNode.id.isnot(None)`），确认第 1 格与第 6 格变红，再逐字改回；
   改前改后的 sha256 与 git diff --stat 记在该轮收尾里。恒真的东西不会因改实现而红，
   所以那一步才是"前 6 格不是恒真"的证据。

造行写法照抄同目录 test_inquiries_deadline_range.py（直接写库 + owner_name 唯一标记 +
用例后清理 inquiries/inquiry_items/inquiry_supplier/quotations/inquiry_logs），
本模块额外清理自己造的 approval_nodes，免得孤儿节点留在跨模块共享的测试库里。
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
    S_COMPLETED, S_PENDING_APPROVAL,
)

UNITS = "R110NS"  # 本模块唯一标记：写入 owner_name 作为清理依据

# 审批节点状态字面量（见模块 docstring 的两处一手出处；由 autouse 夹具对账实现常量）
NODE_PENDING = "PENDING"
NODE_APPROVED = "APPROVED"
NODE_REJECTED = "REJECTED"

# 询价状态字面量（backend/app/routers/inquiries.py:52、56）
INQ_PENDING_APPROVAL = "PENDING_APPROVAL"
INQ_COMPLETED = "COMPLETED"

GARBAGE = "NOT_A_STATUS"


@pytest.fixture(autouse=True)
def _literal_drift_guard():
    """字面量对账：本文件写的状态必须与实现常量同值。

    不这么做的话，实现侧改枚举名会让 nodeStatus 筛子谁都匹配不上，
    而第 1/2/3/6 格那种"结果集变小"的断言会一起假绿。
    """
    assert (NODE_PENDING, NODE_APPROVED, NODE_REJECTED) == (
        APV_PENDING, APV_APPROVED, APV_REJECTED
    )
    assert (INQ_PENDING_APPROVAL, INQ_COMPLETED) == (S_PENDING_APPROVAL, S_COMPLETED)


def _insert_inquiry(inq_id, *, status=INQ_PENDING_APPROVAL, marker):
    """直接写库造一条 u-1 可见（同组织）的询价单，返回 id。"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == "u-1").one()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row = Inquiry(
            id=inq_id,
            code=f"INQ{inq_id}",
            subject=f"{marker} 主题 {inq_id}",
            organization=user.organization,
            owner_name=UNITS,
            owner_id=user.id,
            currency="CNY",
            deadline=(datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d 12:00:00"),
            delivery_address="上海",
            contact="李四",
            payment_terms="款到发货",
            status=status,
            created_by_id=user.id,
            created_by_name=f"{marker} c",
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


def _get(client, headers, **params):
    resp = client.get("/api/inquiries", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp


def _ids(client, headers, **params):
    """不带分页参数的全量分支：返回 id 列表。"""
    body = _get(client, headers, **params).json()
    assert isinstance(body, list), f"无分页参数应返回全量数组，实际 {type(body)}"
    return [r["id"] for r in body]


def _page_ids(client, headers, *, page=1, pageSize=50, **params):
    resp = _get(client, headers, **{**params, "page": page, "pageSize": pageSize})
    body = resp.json()
    assert isinstance(body, dict), f"带分页参数应返回分页结构，实际 {type(body)}"
    return [r["id"] for r in body["items"]], body


def _rows_abc(m):
    """A 有一个 APPROVED 节点；B 有两个 REJECTED 节点（顺带钉 EXISTS 不放大行数）；
    C 只有一个 PENDING 节点。三行状态都相同，行集差异只来自节点状态。"""
    a = _insert_inquiry(f"{m}-A", marker=m)
    _insert_node(a, 1, NODE_APPROVED)
    b = _insert_inquiry(f"{m}-B", marker=m)
    _insert_node(b, 1, NODE_REJECTED)
    _insert_node(b, 2, NODE_REJECTED)
    c = _insert_inquiry(f"{m}-C", marker=m)
    _insert_node(c, 1, NODE_PENDING)
    return a, b, c


# ============ 1. 单值：只剩真带该状态节点的那一行 ============

def test_single_node_status_keeps_only_that_row(client, buyer_headers, cleanup_units):
    m = f"{UNITS}N1"
    a, b, c = _rows_abc(m)
    three = {a, b, c}
    # 前提盘：不加 nodeStatus 时三行都可见 ⇒ 下面的排除只能来自 nodeStatus
    assert set(_ids(client, buyer_headers, creator=m)) == three
    # 核心：APPROVED 只剩 A；列表长度 1 同时钉住"EXISTS 不因 B 有两个节点而放大行数"
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_APPROVED) == [a]
    # 另外两个字面量各自也只命中自己那一行（证明不是"蒙对了 A"）
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_REJECTED) == [b]
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_PENDING) == [c]
    # 分页分支同效（审批页两张统计卡走的就是这条分支）
    paged, body = _page_ids(client, buyer_headers, nodeStatus=NODE_APPROVED, creator=m)
    assert paged == [a] and body["total"] == 1


# ============ 2. CSV 多值：逗号是并集，与 status 参数同语义 ============

def test_csv_multi_value_is_union(client, buyer_headers, cleanup_units):
    m = f"{UNITS}N2"
    a, b, c = _rows_abc(m)
    # 恰好 A、B 两行：并集而不是交集（C 只有 PENDING，落在两值之外）
    assert set(_ids(client, buyer_headers, creator=m,
                    nodeStatus=f"{NODE_APPROVED},{NODE_REJECTED}")) == {a, b}
    # 实现走 s.strip()：值两侧的空格与尾随逗号不改变行集
    assert set(_ids(client, buyer_headers, creator=m,
                    nodeStatus=f" {NODE_APPROVED} , {NODE_REJECTED} ,")) == {a, b}
    # 并进去三个值才多出行——反证上一格不是"只留第一个值"
    assert set(_ids(client, buyer_headers, creator=m, nodeStatus=(
        f"{NODE_APPROVED},{NODE_REJECTED},{NODE_PENDING}"))) == {a, b, c}
    # 单值时 B 不在：证明逗号那一格确实是并集语义而非被忽略
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_APPROVED) == [a]
    # 分页分支同一并集行集，total 由同一个 EXISTS 数出来
    paged, body = _page_ids(client, buyer_headers,
                            nodeStatus=f"{NODE_APPROVED},{NODE_REJECTED}", creator=m)
    assert set(paged) == {a, b} and body["total"] == 2


# ============ 3. 与 status（询价状态）组合：两个筛子是 AND ============

def test_node_status_and_inquiry_status_are_and(client, buyer_headers, cleanup_units):
    m = f"{UNITS}N3"
    a = _insert_inquiry(f"{m}-A", status=INQ_PENDING_APPROVAL, marker=m)
    _insert_node(a, 1, NODE_APPROVED)
    b = _insert_inquiry(f"{m}-B", status=INQ_COMPLETED, marker=m)
    _insert_node(b, 1, NODE_REJECTED)
    # 前提盘：两个筛子都不给时两行都在，且 status 与 nodeStatus 各自单独都给两行
    assert set(_ids(client, buyer_headers, creator=m)) == {a, b}
    assert set(_ids(client, buyer_headers, creator=m, status=INQ_COMPLETED)) == {b}
    assert set(_ids(client, buyer_headers, creator=m, nodeStatus=NODE_REJECTED)) == {b}
    # 核心格：status=COMPLETED&nodeStatus=REJECTED ⇒ 只剩 B
    assert _ids(client, buyer_headers, creator=m,
                status=INQ_COMPLETED, nodeStatus=NODE_REJECTED) == [b]
    # AND 的另一半：各有一边命中另一边不命中 ⇒ 空集（谁也不把谁顶掉）
    assert _ids(client, buyer_headers, creator=m,
                status=INQ_PENDING_APPROVAL, nodeStatus=NODE_REJECTED) == []
    assert _ids(client, buyer_headers, creator=m,
                status=INQ_COMPLETED, nodeStatus=NODE_APPROVED) == []
    # status 自己的逗号仍是 OR，与 nodeStatus 的 AND 关系不变
    assert _ids(client, buyer_headers, creator=m,
                status=f"{INQ_PENDING_APPROVAL},{INQ_COMPLETED}",
                nodeStatus=NODE_REJECTED) == [b]
    assert _ids(client, buyer_headers, creator=m,
                status=f"{INQ_PENDING_APPROVAL},{INQ_COMPLETED}",
                nodeStatus=NODE_APPROVED) == [a]


# ============ 4. 全量分支与分页分支行集相同 ============

def test_full_and_paginated_branches_return_same_ids(client, buyer_headers, cleanup_units):
    m = f"{UNITS}N4"
    a, b, c = _rows_abc(m)
    d = _insert_inquiry(f"{m}-D", status=INQ_PENDING_APPROVAL, marker=m)  # 无节点
    filters = dict(creator=m, nodeStatus=f"{NODE_APPROVED},{NODE_REJECTED}")
    full = _ids(client, buyer_headers, **filters)
    assert set(full) == {a, b}
    paged, body = _page_ids(client, buyer_headers, **filters)
    # 这一格是"两条分支行集相同"的正面证据
    assert set(paged) == set(full)
    assert paged == full
    assert body["total"] == len(full) == 2
    assert body["page"] == 1 and body["pageSize"] == 50
    # 落在筛子外的两行（C 只有 PENDING、D 无节点）在两条分支上都不许出现
    for _row in (c, d):
        assert _row not in full and _row not in paged
    # 逐页拼回来的行集也与全量分支相同（EXISTS 在 offset/limit 上同样生效）
    p1, b1 = _page_ids(client, buyer_headers, page=1, pageSize=1, **filters)
    p2, b2 = _page_ids(client, buyer_headers, page=2, pageSize=1, **filters)
    assert p1 + p2 == full
    assert b1["total"] == b2["total"] == 2


# ============ 5. 空值 / 垃圾值：200 且不 500，行集只含真带该状态节点的行 ============

def test_empty_node_status_leaves_rowset_unfiltered(client, buyer_headers, cleanup_units):
    m = f"{UNITS}N5A"
    a, b, c = _rows_abc(m)
    d = _insert_inquiry(f"{m}-D", status=INQ_PENDING_APPROVAL, marker=m)  # 无节点
    four = {a, b, c, d}
    assert set(_ids(client, buyer_headers, creator=m)) == four
    # nodeStatus=（空串）：`if nodeStatus:` 为假 ⇒ 这把筛子整个不加，四行都在（含无节点的 D）
    assert set(_ids(client, buyer_headers, creator=m, nodeStatus="")) == four
    # 只有空白 / 只有逗号：外层进得去、内层 nodes 解析成空列表 ⇒ 同样不加筛子
    assert set(_ids(client, buyer_headers, creator=m, nodeStatus="   ")) == four
    assert set(_ids(client, buyer_headers, creator=m, nodeStatus=",,")) == four
    # 上面这条与 MSW 分支不一致，按实现如实记录：静态读 src/mocks/handlers.ts:274-277，
    # 空 nodes 会让 `approvalNodes.some(n => [].includes(...))` 全假 ⇒ demo 档返回空集，
    # 真后端返回未加筛子的整批（本轮只读了那段源码，没跑 demo 档实测）。
    # 这里钉的是后端现状（不 500、不静默清空），不是 endorsing 该分歧。
    assert set(_page_ids(client, buyer_headers, nodeStatus=",,", creator=m)[0]) == four
    # 与"根本没给这个参数"完全等价
    assert _ids(client, buyer_headers, creator=m, nodeStatus="") == _ids(
        client, buyer_headers, creator=m)


def test_garbage_node_status_returns_only_rows_with_that_node(client, buyer_headers,
                                                               cleanup_units):
    m = f"{UNITS}N5B"
    a, b, c = _rows_abc(m)
    d = _insert_inquiry(f"{m}-D", status=INQ_PENDING_APPROVAL, marker=m)
    four = {a, b, c, d}
    # 前提盘：不带 nodeStatus 时四行都在 ⇒ 下面的空集只来自那个不存在的状态值
    assert set(_ids(client, buyer_headers, creator=m)) == four
    # 垃圾值：200 + 空集（"结果集只含真带该状态节点的行"在这种状态下就是零行）
    assert _ids(client, buyer_headers, creator=m, nodeStatus=GARBAGE) == []
    paged, body = _page_ids(client, buyer_headers, nodeStatus=GARBAGE, creator=m)
    assert paged == [] and body["total"] == 0
    # 垃圾值混进并集不影响真命中的那一行（逗号里坏一个不整体作废）
    assert set(_ids(client, buyer_headers, creator=m,
                    nodeStatus=f"{NODE_APPROVED},{GARBAGE}")) == {a}
    assert set(_ids(client, buyer_headers, creator=m,
                    nodeStatus=f"{GARBAGE},{NODE_APPROVED}")) == {a}
    # 大小写：与 status 参数一样按字面量精确比对（String 列，SQL 侧 IN 不做大小写折叠）
    assert _ids(client, buyer_headers, creator=m, nodeStatus="approved") == []
    # 空串与垃圾值走的是两条不同分支（前者不加筛子、后者筛成空集），这里把差别钉住
    assert set(_ids(client, buyer_headers, creator=m, nodeStatus=GARBAGE)) != four


# ============ 6. 无审批节点的询价不会被拉进来（正反两半） ============

def test_inquiry_without_nodes_never_pulled_in(client, buyer_headers, cleanup_units):
    m = f"{UNITS}N6"
    n = _insert_inquiry(f"{m}-NODELESS", status=INQ_PENDING_APPROVAL, marker=m)
    y = _insert_inquiry(f"{m}-Y", status=INQ_PENDING_APPROVAL, marker=m)
    _insert_node(y, 1, NODE_APPROVED)
    z = _insert_inquiry(f"{m}-Z", status=INQ_PENDING_APPROVAL, marker=m)
    _insert_node(z, 1, NODE_PENDING)
    # 正半：不带 nodeStatus 时它照样出现（证明它没被别的条件挡在门外）
    full = _ids(client, buyer_headers, creator=m)
    assert set(full) == {n, y, z}
    assert n in full
    assert set(_page_ids(client, buyer_headers, creator=m)[0]) == {n, y, z}
    # 反半：三个真实节点状态逐个筛，无节点那一行都不许被拉进来
    for status_value in (NODE_APPROVED, NODE_REJECTED, NODE_PENDING):
        got = _ids(client, buyer_headers, creator=m, nodeStatus=status_value)
        assert n not in got, f"{status_value} 把无节点的 {n} 拉进来了：{got}"
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_APPROVED) == [y]
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_PENDING) == [z]
    assert _ids(client, buyer_headers, creator=m, nodeStatus=NODE_REJECTED) == []
    # 分页分支同一极性：审批页历史页签走的正是这条
    paged, body = _page_ids(client, buyer_headers,
                            nodeStatus=f"{NODE_APPROVED},{NODE_REJECTED},{NODE_PENDING}",
                            creator=m)
    assert set(paged) == {y, z} and n not in paged and body["total"] == 2
