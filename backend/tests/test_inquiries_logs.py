"""GET /api/inquiries/logs 常驻用例（R112，操作日志按**日志行**分页）

被测实现（本轮逐行开过，行号为 git 工作区当前状态）：
- backend/app/routers/inquiries.py:484-541 `list_logs`：
  `db.query(InquiryLog).join(Inquiry, …)` + `filter_visible_inquiries`（:514）、
  operator/content 走 `_contains(func.lower(col), …)`（:517/:519）、type 精确等值（:521）、
  timeFrom/timeTo 走 `func.substr(time,1,10) >= / <=`（:523/:525）、
  `order_by(<白名单列>, InquiryLog.id)`（:531）、`count()` + `offset/limit`（:533-534）
- backend/app/routers/inquiries.py:271-279 `_contains`：子串匹配前先把输入里的
  `%` 与 `_` 转义成字面量（`LIKE … ESCAPE '\'`）——本文件第 8 格钉的就是这一条
- backend/app/routers/inquiries.py:268 `_LOG_SORT_FIELDS = {"time": InquiryLog.time}`
- backend/app/schemas.py:116-125 `InquiryLogSchema`（8 个字段）、:481-491 `PaginatedLogsSchema`
- backend/app/policy.py:63-84 `filter_visible_inquiries`：管理员不加 WHERE，
  其余按 owner_id / created_by_id / organization 三选一可见
- backend/app/models.py:148-159 `InquiryLog`：`id` 是 String 主键 ⇒ 次排序键是**字符串**序
- backend/app/serializers.py:113-123 `inquiry_log_to_schema`（下划线 → camelCase 的唯一映射处）
- 鉴权 backend/app/auth.py:145 `HTTPBearer(auto_error=False)` + :157-160 ⇒ 无 token 走 401

为什么每一格都要拿 Python 参考序列对账：`src/pages/log/index.tsx:66-67`（`aggregateLogs`）
原来把整份询价数组（每条带全部 logs）拉下来 `flatMap` 再排序、然后在客户端过滤
（:108-140 `filteredLogs`）；新端点的存在理由就是"一页 10 行只付 10 行的价"。
所以"服务端分页 + 下推筛子的结果 == 把全部行在客户端排一遍筛一遍"必须被独立核到。
本文件每一格的参考序列都由 `_reference()` 现算：它只做**无 WHERE 的 ORM 全量读**
（`db.query(InquiryLog).all()` / `db.query(Inquiry).all()`），可见性与四把筛子在
**Python 里**按 app/policy.py:63-84 的三条 OR 与子串/等值/日粒度语义重实现，
排序用两次稳定 sort 复现 (time, id) 双键——也就是说参考序列与端点 SQL 没有共用了 
一句谓词，两边不一致才会红。

一条由起草者实测、当轮就判成真缺陷并修掉的口径差（记录顺序重要，别当成事后补的装饰）：
`operator`/`keyword` 原来把用户输入原样拼进 `LIKE '%…%'`，没转义 SQL 通配符 `%` 与 `_`。
种子库（35 行日志）实测 `?keyword=%` → total 35、`?keyword=_` → total 35，与不带筛子完全相同
——即"把全部行都当成子串命中"。而前端 `src/pages/log/index.tsx` 与服务端桩
`src/mocks/handlers.ts` 用的都是 `.includes()` 的字面语义，三条路径在此不同形，
所以这不是"宽松度待裁"，是缺陷。本轮改成 `_contains()`（:271-279，`ESCAPE '\'`），
并由本文件 `test_like_wildcards_in_user_input_match_literally` 钉住：
`%`/`_` 只命中字面含该字符的行，且命中集等于 Python `in` 现算的参考集。
同一条转义也一并落在询价侧的 keyword/code/subject/creator/category 五把筛子上
（`_apply_inquiry_filters`），那边由 test_inquiries_list_filters.py 的同名格钉。

造行/清理写法照抄同目录 test_inquiries_node_status.py 与 test_inquiries_counts.py
（直接写库 + owner_name 唯一标记 UNITS + 用例后清 inquiry_logs/inquiries），
夹具名沿用 backend/tests/conftest.py 的 `client` / `buyer_headers`(u-1) / `admin_headers`(u-6)；
跨组织用户 u-3 的登录 helper 照抄 test_inquiries_counts.py:176-179 `_login_headers`。
"""
from datetime import datetime, timedelta
from itertools import groupby

import pytest

from app.database import SessionLocal
from app.models import Inquiry, InquiryLog, User
from app.routers.inquiries import router as inquiries_router
from app.routers.inquiries import (
    LOG_APPROVE, LOG_CANCEL, LOG_SEND_INQUIRY, _LOG_SORT_FIELDS,
)

UNITS = "R112LOG"  # 本模块唯一标记：写入 owner_name 作为清理依据
LOGS_URL = "/api/inquiries/logs"
DETAIL_URL_TPL = "/api/inquiries/{}"

# 日志类型字面量（backend/app/routers/inquiries.py:69-74，由 autouse 夹具对账实现常量）
TYPE_APPROVE = "APPROVE"
TYPE_CANCEL = "CANCEL"
TYPE_SEND = "SEND_INQUIRY"

# 分页上限（:478 `Query(default=10, ge=1, le=200)`）——两侧极性由第 6 格钉
PAGE_SIZE_MAX = 200
PAGE_SIZE_MIN = 1

# 响应字段名（app/schemas.py:116-125 InquiryLogSchema 的顺序与拼写）
ITEM_KEYS = ("id", "inquiryId", "time", "operator", "operatorRole", "type", "content", "result")


@pytest.fixture(autouse=True)
def _literal_drift_guard():
    """字面量对账：本文件钉的类型/白名单/参考序列前提必须与实现同值。

    不这么做的话：实现侧改枚举名会让 type 筛子谁都匹配不上，而"total 变小"那半边仍全绿；
    白名单哪天加一列（例如 `result`）会让"未知键退回默认"那格的反证失效；
    参考序列里 `"管理员"` 这个分支判据一改，第 5 格可见性会整批假绿。
    """
    assert (TYPE_APPROVE, TYPE_CANCEL, TYPE_SEND) == (
        LOG_APPROVE, LOG_CANCEL, LOG_SEND_INQUIRY
    )
    assert set(_LOG_SORT_FIELDS) == {"time"}, "排序白名单已变，第 6 格的反证臂要跟着改"
    assert _LOG_SORT_FIELDS["time"] is InquiryLog.time
    # 参考序列按 policy.py:63-84 的 `user.role == "管理员"` 分叉：种子数据里这条前提得成立
    db = SessionLocal()
    try:
        assert db.query(User).filter(User.id == "u-6").one().role == "管理员"
        assert db.query(User).filter(User.id == "u-3").one().organization != \
            db.query(User).filter(User.id == "u-1").one().organization
    finally:
        db.close()


# ============ 造行 helper（直接写库，照抄同目录两个模块） ============

def _day(offset_days=0):
    return (datetime.now() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


def _ts(offset_days, hhmmss="09:00:00"):
    """日志时间列的落库格式与种子一致：'YYYY-MM-DD HH:MM:SS'（app/seed.py:153-160）。"""
    return f"{_day(offset_days)} {hhmmss}"


def _insert_inquiry(inq_id, *, marker, as_user="u-1"):
    """直接写库造一条询价单：组织/owner/创建人全部取自 `as_user`，返回 id。"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == as_user).one()
        now = _ts(0, "08:00:00")
        db.add(Inquiry(
            id=inq_id,
            code=f"INQ{inq_id}",
            subject=f"{marker} 主题 {inq_id}",
            organization=user.organization,
            owner_name=UNITS,
            owner_id=user.id,
            currency="CNY",
            deadline=f"{_day(3)} 12:00:00",
            delivery_address="上海",
            contact="李四",
            payment_terms="款到发货",
            status="PENDING_APPROVAL",
            created_by_id=user.id,
            created_by_name=f"{marker} c",
            created_at=now,
            updated_at=now,
            selected_supplier_map={},
            purchaser_comments={},
        ))
        db.commit()
    finally:
        db.close()
    return inq_id


def _insert_log(log_id, inq_id, *, time, operator, log_type, content,
                operator_role="采购人员", result=None):
    """直接写库造一条日志行；id 是 String 主键（app/models.py:150）⇒ 次排序按字符串序。"""
    db = SessionLocal()
    try:
        db.add(InquiryLog(
            id=log_id, inquiry_id=inq_id, time=time, operator=operator,
            operator_role=operator_role, type=log_type, content=content, result=result,
        ))
        db.commit()
    finally:
        db.close()
    return log_id


@pytest.fixture
def cleanup_units():
    """每个用例后把本模块造的行删干净（测试库跨模块共享）。"""
    yield
    db = SessionLocal()
    try:
        ids = [r[0] for r in db.query(Inquiry.id).filter(Inquiry.owner_name == UNITS)]
        if ids:
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


# ============ 参考序列：无 WHERE 的 ORM 全量读 + 纯 Python 复现口径 ============

def _visible_rows(user_id):
    """返回该用户**应当**看得见的日志行元组（未排序），全部判断在 Python 里做。

    刻意不借用实现的任何一句 SQL：可见性按 app/policy.py:63-84 的三条 OR 重写在下面，
    连接语义按 `INNER JOIN inquiries` 重写成"父单不存在就丢掉"。
    """
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).one()
        role, org, uid = user.role, user.organization, user.id
        inqs = {
            i.id: (i.owner_id, i.created_by_id, i.organization)
            for i in db.query(Inquiry).all()
        }
        logs = [
            (r.id, r.inquiry_id, r.time, r.operator, r.operator_role,
             r.type, r.content, r.result)
            for r in db.query(InquiryLog).all()
        ]
    finally:
        db.close()
    out = []
    for row in logs:
        inq = inqs.get(row[1])
        if inq is None:                      # INNER JOIN：父单不存在的日志行读不到
            continue
        if role == "管理员":                  # 管理员不加 WHERE（policy.py:64-65）
            out.append(row)
            continue
        owner_id, created_by_id, organization = inq
        if owner_id == uid or created_by_id == uid or organization == org:
            out.append(row)
    return out


# 端点认识的筛子参数名（与 _reference 共用同一套键名，避免"两边各翻一遍参数名"的漂移）
_FILTER_KEYS = {"operator", "keyword", "type", "timeFrom", "timeTo"}


def _reference(user_id="u-6", asc=False, **filters):
    """Python 侧参考序列：筛子在 Python 里判，排序用两次稳定 sort 复现双键。

    `filters` 用的就是端点那套查询参数名（operator/keyword/type/timeFrom/timeTo），
    所以测试里同一个 dict 可以同时喂给 HTTP 调用和这份参考——参数名翻译没得漂。
    日粒度闭区间复现 `substr(time,1,10) >= / <=`：取时间串前 10 个字符按串比。
    """
    unknown = set(filters) - _FILTER_KEYS
    assert not unknown, f"参考序列不认识这些筛子名，喂进去会被丢掉：{sorted(unknown)}"
    rows = _visible_rows(user_id)
    operator = filters.get("operator")
    keyword = filters.get("keyword")
    log_type = filters.get("type")
    time_from = filters.get("timeFrom")
    time_to = filters.get("timeTo")
    if operator:
        needle = operator.strip().lower()
        rows = [r for r in rows if needle in (r[3] or "").lower()]
    if keyword:
        needle = keyword.strip().lower()
        rows = [r for r in rows if needle in (r[6] or "").lower()]
    if log_type:
        rows = [r for r in rows if r[5] == log_type.strip()]
    if time_from:
        rows = [r for r in rows if r[2][:10] >= time_from]
    if time_to:
        rows = [r for r in rows if r[2][:10] <= time_to]
    rows = sorted(rows, key=lambda r: r[0])              # 次排序键 id 升序
    return sorted(rows, key=lambda r: r[2], reverse=not asc)   # 主排序键 time


# ============ 端点读数 helper ============

def _item_to_tuple(item):
    """响应里的一条日志 → 与参考序列同形状的元组（顺带钉 schema 字段名与数量）。"""
    assert set(item) == set(ITEM_KEYS), f"字段名与 InquiryLogSchema 不符：{sorted(item)}"
    return tuple(item[k] for k in ITEM_KEYS)


def _get(client, headers, *, expect=200, **params):
    resp = client.get(LOGS_URL, headers=headers, params=params)
    assert resp.status_code == expect, f"{params} -> {resp.status_code} {resp.text}"
    if expect != 200:
        return resp
    body = resp.json()
    assert isinstance(body, dict), f"应返回分页结构，实际 {type(body)}"
    assert set(body) == {"items", "total", "page", "pageSize"}, sorted(body)
    return body


def _rows(client, headers, *, pageSize=PAGE_SIZE_MAX, **params):
    """单页读数（够装下全部结果时用），返回 (元组序列, total)。"""
    body = _get(client, headers, page=1, pageSize=pageSize, **params)
    return [_item_to_tuple(i) for i in body["items"]], body["total"]


def _walk(client, headers, *, pageSize=3, **params):
    """一页 pageSize 行翻到底：逐页读数拼成一条序列。

    同时钉三件翻页才会暴露的事：每一页回显的 total 相同、拼回来的行数 == total
    （不重不漏的长度半边）、id 集合无重复（不重不漏的形状半边）。
    """
    first = _get(client, headers, page=1, pageSize=pageSize, **params)
    total = first["total"]
    pages = max(1, -(-total // pageSize))
    rows = [_item_to_tuple(i) for i in first["items"]]
    assert first["page"] == 1 and first["pageSize"] == pageSize
    for p in range(2, pages + 1):
        body = _get(client, headers, page=p, pageSize=pageSize, **params)
        assert body["total"] == total, f"第 {p} 页 total 抖动：{body['total']} != {total}"
        assert body["page"] == p and body["pageSize"] == pageSize
        rows.extend(_item_to_tuple(i) for i in body["items"])
    assert len(rows) == total, f"翻页拼回来 {len(rows)} 行，total 说 {total} 行"
    assert len({r[0] for r in rows}) == total, "翻页有重复行（id 撞了）"
    return rows, total, pages


def _ids(rows):
    return [r[0] for r in rows]


def _assert_ids_asc_within_each_second(rows):
    """次排序键的方向：主键相同的每一段里，id 必须升序且这段连续。

    只在"确实存在并列秒"时才开火（种子数据里同一秒有多条日志），
    所以这里顺带把前提断出来——没有并列秒就说明夹具塌了，这一格什么也没钉。
    """
    tied = 0
    for _t, grp in groupby(rows, key=lambda r: r[2]):
        got = [r[0] for r in grp]
        assert got == sorted(got), f"time={_t} 段内 id 非升序：{got}"
        tied += len(got) > 1
    assert tied, "没有同一秒的并列行，次排序键这一面没被钉到"


# ============ 1. 无筛子：逐页翻到底 == Python 参考序列（time desc, id asc） ============

def test_all_pages_without_filters_equal_python_reference_ordering(
    client, admin_headers, cleanup_units
):
    m = f"{UNITS}L1"
    before = _get(client, admin_headers, page=1, pageSize=1)["total"]
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    mine = [
        _insert_log(f"{m}-lg{n}", inq, time=_ts(-2, f"10:00:0{n}"),
                    operator=f"{m}op", log_type=TYPE_APPROVE,
                    content=f"{m} c{n}", result=f"R{n}")
        for n in (1, 2, 3, 4)
    ]
    ref = _reference("u-6")

    rows, total, pages = _walk(client, admin_headers, pageSize=3)
    # 核心：整条拼接序列与参考序列逐字段相等（不是只比 id、更不是只断 200）
    assert rows == ref
    assert _ids(rows) == _ids(ref)
    # total 就是参考序列长度；seed 差分 4 钉"自造四行真进了结果"
    assert total == len(ref) == before + 4
    assert pages == -(-total // 3)
    assert set(mine) <= set(_ids(rows))
    # 我造的四行时间递增 ⇒ 在 desc 序列里逆序出现（参考序列之外的一条绝对断言）
    assert [i for i in _ids(rows) if i in set(mine)] == list(reversed(mine))
    # 末之后一页：空 items，total 不变（翻页越界不许 500、也不许回绕）
    tail = _get(client, admin_headers, page=pages + 1, pageSize=3)
    assert tail["items"] == [] and tail["total"] == total
    # 八个字段逐个点名（app/serializers.py:113-123 的 snake→camel 映射只在端点侧看得见）
    one = next(r for r in rows if r[0] == f"{m}-lg1")
    assert one == (f"{m}-lg1", inq, _ts(-2, "10:00:01"), f"{m}op", "采购人员",
                   TYPE_APPROVE, f"{m} c1", "R1"), one


# ============ 2. 同一秒并列：次排序键 id 让翻页边界不重不漏 ============

def test_same_second_ties_are_stable_and_not_duplicated_across_pages(
    client, admin_headers, cleanup_units
):
    """四行以上**完全相同**的 time：主排序键分不出先后，边界全靠次排序键 id。

    id 取成字典序 ≠ 插入序 ≠ 数字序（L1 < L10 < L2 < L20 < L3），这样"次排序键没生效"
    时 SQLite 会按插入序返回，本格就会红；只测"数量对"是看不见这种退化的。
    实测过这条前提：同一个 tie 块 `ORDER BY time DESC` 给出 ['T-L2','T-L10','T-L1','T-L20','T-L3']
    （插入序），加上 `, id ASC` 给出 ['T-L1','T-L10','T-L2','T-L20','T-L3']（字典序）。
    """
    m = f"{UNITS}L2"
    tie_time = _ts(0, "23:30:00")
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    insertion = [f"{m}-L2", f"{m}-L10", f"{m}-L1", f"{m}-L20", f"{m}-L3"]
    for n, log_id in enumerate(insertion):
        _insert_log(log_id, inq, time=tie_time, operator=f"{m}op",
                    log_type=TYPE_CANCEL, content=f"{m} tie {n}")
    tie = set(insertion)
    expected = sorted(insertion)                       # 字符串升序，与实现的次排序键同向
    assert expected != insertion, "夹具没造出「插入序 != 字典序」，这一格会假绿"

    ref = _reference("u-6")
    rows, total, _pages = _walk(client, admin_headers, pageSize=3)
    # 整条序列仍与参考序列逐字段相等（并列块横跨多个 pageSize=3 的边界）
    assert rows == ref and total == len(ref)
    got = [i for i in _ids(rows) if i in tie]
    # 并列块内部：不重（set 大小）、不漏（长度）、顺序 = id 升序
    assert len(got) == len(tie) == 5, f"并列行少了：{got}"
    assert got == expected, f"次排序键没生效：{got} != {expected}"
    # 并列块在序列里连续（同一秒的行不会被别的秒插进来）
    positions = [_ids(rows).index(i) for i in got]
    assert positions == list(range(positions[0], positions[0] + 5))
    # 一页装得下时也是同一顺序（单页读数与翻页读数不得各说一套）
    single, _total = _rows(client, admin_headers)
    assert [i for i in _ids(single) if i in tie] == expected
    assert single == rows
    # 全表范围的次排序键方向也核一遍（不只我造的那一块）
    _assert_ids_asc_within_each_second(rows)


# ============ 3a. operator 筛子：大小写不敏感子串，命中与近似不命中都对账 ============

def test_operator_filter_matches_case_insensitive_substring(client, admin_headers, cleanup_units):
    m = f"{UNITS}L3A"
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    a = _insert_log(f"{m}-a", inq, time=_ts(0, "10:00:00"), operator=f"{m}alphA",
                    log_type=TYPE_APPROVE, content=f"{m} ca")
    b = _insert_log(f"{m}-b", inq, time=_ts(0, "11:00:00"), operator=f"{m}BETA",
                    log_type=TYPE_APPROVE, content=f"{m} cb")
    c = _insert_log(f"{m}-c", inq, time=_ts(0, "12:00:00"), operator=f"Other {m}gamma",
                    log_type=TYPE_APPROVE, content=f"{m} cc")

    # 命中：查询串整体小写、数据里大小写混着 ⇒ 两行（a 与 c 的 operator 都含 m）
    hit, total = _rows(client, admin_headers, operator=m)
    assert total == 3 and set(_ids(hit)) == {a, b, c}
    assert hit == _reference("u-6", operator=m)
    # 命中：大小写反过来（数据 alphA / 查询 ALPHA），且是"子串"不是"前缀"
    one, total = _rows(client, admin_headers, operator=f"{m.lower()}gamma")
    assert total == 1 and _ids(one) == [c] and one == _reference("u-6", operator=f"{m.lower()}gamma")
    two, total = _rows(client, admin_headers, operator=f"{m}AL")
    assert total == 1 and _ids(two) == [a]
    assert two == _reference("u-6", operator=f"{m}AL")
    # 近似不命中：差一个字符 / 大小写之外还多一个字符 ⇒ 0 行（不是"匹配前缀"）
    for near_miss in (f"{m}alphB", f"{m}alphaZZ", f"{m}eps"):
        empty, total = _rows(client, admin_headers, operator=near_miss)
        assert (total, empty) == (0, []), (near_miss, total, empty)
        assert empty == _reference("u-6", operator=near_miss)
    # 空白：实现走 `.strip()`（:506）⇒ 空串/纯空格不加这把筛子
    whole, total = _rows(client, admin_headers, operator="   ")
    assert total == len(_reference("u-6")) and total >= 3
    assert whole == _reference("u-6")


# ============ 3b. keyword 筛子：content 的大小写不敏感子串 ============

def test_keyword_filter_matches_content_substring_case_insensitively(
    client, admin_headers, cleanup_units
):
    m = f"{UNITS}L3B"
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    a = _insert_log(f"{m}-a", inq, time=_ts(0, "10:00:00"), operator=f"{m}op",
                    log_type=TYPE_APPROVE, content=f"{m} Needle Here")
    b = _insert_log(f"{m}-b", inq, time=_ts(0, "11:00:00"), operator=f"{m}op",
                    log_type=TYPE_APPROVE, content=f"{m} OTHER text")
    # keyword 命中的是 content，不看 operator：把 operator 做成含 needle 也不该多出来
    c = _insert_log(f"{m}-c", inq, time=_ts(0, "12:00:00"), operator=f"{m} Needle Too",
                    log_type=TYPE_APPROVE, content=f"{m} plain")

    hit, total = _rows(client, admin_headers, keyword=f"{m}")
    assert total == 3 and set(_ids(hit)) == {a, b, c}
    assert hit == _reference("u-6", keyword=m)
    # 混合大小写子串命中一行（数据 "Needle Here" / 查询 "nEEDLE hERE"）
    one, total = _rows(client, admin_headers, keyword="nEEDLE hERE")
    assert total == 1 and _ids(one) == [a]
    assert one == _reference("u-6", keyword="nEEDLE hERE")
    two, total = _rows(client, admin_headers, keyword=f"{m.lower()} needle")
    assert total == 1 and _ids(two) == [a] and two == _reference("u-6", keyword=f"{m.lower()} needle")
    # 只在 operator 里出现、content 里没有 ⇒ 0 行（keyword 不越界去查 operator）
    none, total = _rows(client, admin_headers, keyword="needle too")
    assert (total, none) == (0, []) and none == _reference("u-6", keyword="needle too")
    # 近似不命中
    near, total = _rows(client, admin_headers, keyword=f"{m}needleX")
    assert (total, near) == (0, [])
    # content 是 Text 列（app/models.py:156），长串中段子串也要命中
    mid, total = _rows(client, admin_headers, keyword="other te")
    ids = set(_ids(mid))
    assert b in ids and a not in ids
    assert mid == _reference("u-6", keyword="other te")


# ============ 3c. type 筛子：精确等值；垃圾值 200 + 空集 ============

def test_type_filter_is_exact_equality_and_bogus_value_returns_empty(
    client, admin_headers, cleanup_units
):
    m = f"{UNITS}L3C"
    # baseline 必须在 seed 之前读：种子里 SEND_INQUIRY / CANCEL 都有现成行，
    # 只有"同一筛子 seed 前后的差分"能钉这把筛子真的加上了（绝对值里混着种子）
    before = {t: _get(client, admin_headers, page=1, pageSize=1, type=t)["total"]
              for t in (TYPE_SEND, TYPE_CANCEL, TYPE_APPROVE)}
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    sent = _insert_log(f"{m}-sent", inq, time=_ts(0, "10:00:00"), operator=f"{m}op",
                       log_type=TYPE_SEND, content=f"{m} s")
    cancelled = _insert_log(f"{m}-cancel", inq, time=_ts(0, "11:00:00"), operator=f"{m}op",
                            log_type=TYPE_CANCEL, content=f"{m} c")
    approved = _insert_log(f"{m}-ap", inq, time=_ts(0, "12:00:00"), operator=f"{m}op",
                           log_type=TYPE_APPROVE, content=f"{m} a")

    # 真实值命中：SEND_INQUIRY 只留 SEND_INQUIRY 行（差分 +1 且行集与参考序列相同）
    rows, total = _rows(client, admin_headers, type=TYPE_SEND)
    assert total == before[TYPE_SEND] + 1, (total, before[TYPE_SEND])
    assert sent in _ids(rows) and cancelled not in _ids(rows) and approved not in _ids(rows)
    assert rows == _reference("u-6", type=TYPE_SEND)
    assert {r[5] for r in rows} == {TYPE_SEND}
    # 另外两个真实值同样只命中自己那一类（证明不是"蒙对了一个值"）
    rows2, total2 = _rows(client, admin_headers, type=TYPE_APPROVE)
    assert approved in _ids(rows2) and sent not in _ids(rows2)
    assert total2 == before[TYPE_APPROVE] + 1, (total2, before[TYPE_APPROVE])
    assert rows2 == _reference("u-6", type=TYPE_APPROVE)
    assert {r[5] for r in rows2} == {TYPE_APPROVE}
    rows_cancel, total_cancel = _rows(client, admin_headers, type=TYPE_CANCEL)
    assert cancelled in _ids(rows_cancel) and sent not in _ids(rows_cancel)
    assert approved not in _ids(rows_cancel)
    assert total_cancel == before[TYPE_CANCEL] + 1
    assert rows_cancel == _reference("u-6", type=TYPE_CANCEL)
    # 等值不带大小写折叠：小写形式一行都没有（本模块自造值，可断绝对零）
    lower = f"{m}approve".lower()
    bad_case, total_lc = _rows(client, admin_headers, type=lower)
    assert (total_lc, bad_case) == (0, []) and bad_case == _reference("u-6", type=lower)
    # 垃圾值：200 + total=0 + items=[]，不是 500、不是"退回全集"
    bogus = f"{m}NO_SUCH_TYPE"
    items, total4 = _rows(client, admin_headers, type=bogus)
    assert total4 == 0 and items == []
    assert items == _reference("u-6", type=bogus)
    body = _get(client, admin_headers, page=1, pageSize=10, type=bogus)
    assert body == {"items": [], "total": 0, "page": 1, "pageSize": 10}
    # 空白值：实现 `if type:` 为假 ⇒ 不加这把筛子（与"根本没给参数"等价）
    assert _get(client, admin_headers, page=1, pageSize=1, type="")["total"] == \
        _get(client, admin_headers, page=1, pageSize=1)["total"]


# ============ 3d. timeFrom / timeTo：日粒度、两端都闭 ============

def test_time_bounds_are_inclusive_on_both_days(client, admin_headers, cleanup_units):
    m = f"{UNITS}L3D"
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    d_minus, d_same, d_plus = _day(-1), _day(0), _day(1)
    outside_lo = _insert_log(f"{m}-outlo", inq, time=_ts(-2, "23:59:59"), operator=f"{m}op",
                             log_type=TYPE_APPROVE, content=f"{m} o1")
    lo = _insert_log(f"{m}-lo", inq, time=f"{d_minus} 00:00:00", operator=f"{m}op",
                     log_type=TYPE_APPROVE, content=f"{m} l")
    day_start = _insert_log(f"{m}-ds", inq, time=f"{d_same} 00:00:01", operator=f"{m}op",
                            log_type=TYPE_APPROVE, content=f"{m} ds")
    day_end = _insert_log(f"{m}-de", inq, time=f"{d_same} 23:59:59", operator=f"{m}op",
                          log_type=TYPE_APPROVE, content=f"{m} de")
    hi = _insert_log(f"{m}-hi", inq, time=f"{d_plus} 23:59:59", operator=f"{m}op",
                     log_type=TYPE_APPROVE, content=f"{m} h")
    outside_hi = _insert_log(f"{m}-outhi", inq, time=_ts(2, "00:00:00"), operator=f"{m}op",
                             log_type=TYPE_APPROVE, content=f"{m} o2")
    mine = {outside_lo, lo, day_start, day_end, hi, outside_hi}

    def ids(**params):
        return set(_ids(_rows(client, admin_headers, **params)[0]))

    def check(label, **params):
        rows, total = _rows(client, admin_headers, **params)
        assert rows == _reference("u-6", **params), label
        assert total == len(rows), label
        return set(_ids(rows)) & mine, rows

    # 两端都闭：timeFrom=d(-1)&timeTo=d(+1) ⇒ 中间四行全进，两侧各留一行在外
    kept, _ = check("both", timeFrom=d_minus, timeTo=d_plus)
    assert kept == {lo, day_start, day_end, hi}, kept
    # 只给 timeFrom=d(0)：d(-1) 那两行（含 00:00:00 那条）整日排除
    kept, _ = check("from", timeFrom=d_same)
    assert kept == {day_start, day_end, hi, outside_hi}, kept
    assert outside_lo not in kept and lo not in kept
    # 只给 timeTo=d(0)：d(+1) 之后整日排除
    kept, _ = check("to", timeTo=d_same)
    assert kept == {outside_lo, lo, day_start, day_end}, kept
    assert hi not in kept and outside_hi not in kept
    # 边界各推一天：只剩那一行的那一端（"闭"的证据，不是左闭右开）
    kept, _ = check("from=+1", timeFrom=d_plus)
    assert kept == {hi, outside_hi}, kept
    kept, _ = check("to=-1", timeTo=d_minus)
    assert kept == {outside_lo, lo}, kept
    # 同一天的两端都闭：只剩当天两行
    kept, _ = check("same day", timeFrom=d_same, timeTo=d_same)
    assert kept == {day_start, day_end}, kept
    # 区间收窄到一天之内、且当天没有行 ⇒ 空（不是"忽略筛子回全集"）
    kept, rows = check("empty window", timeFrom=_day(5), timeTo=_day(6))
    assert kept == set() and rows == []
    # 差分：无筛子时六行全进
    assert mine <= ids()


# ============ 4. 组合筛子：三把一起 AND，结果 == 三个谓词同时成立的参考序列 ============

def test_combined_filters_are_anded(client, admin_headers, cleanup_units):
    m = f"{UNITS}L4"
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    r1 = _insert_log(f"{m}-r1", inq, time=_ts(0, "10:00:00"), operator=f"{m}Alpha",
                     log_type=TYPE_APPROVE, content=f"{m} one")
    r2 = _insert_log(f"{m}-r2", inq, time=_ts(0, "11:00:00"), operator=f"{m}Alpha",
                     log_type=TYPE_CANCEL, content=f"{m} two")
    r3 = _insert_log(f"{m}-r3", inq, time=_ts(0, "12:00:00"), operator=f"{m}Beta",
                     log_type=TYPE_APPROVE, content=f"{m} three")
    r4 = _insert_log(f"{m}-r4", inq, time=_ts(-5, "10:00:00"), operator=f"{m}Alpha",
                     log_type=TYPE_APPROVE, content=f"{m} four")   # 区间外
    r5 = _insert_log(f"{m}-r5", inq, time=_ts(-5, "11:00:00"), operator=f"{m}Beta",
                     log_type=TYPE_CANCEL, content=f"{m} five")
    all_five = {r1, r2, r3, r4, r5}

    combo = {"operator": f"{m}alPha", "type": TYPE_APPROVE, "timeFrom": _day(-1)}
    # 三把各自命中更多：operator 3 行 / type 3 行 / timeFrom 3 行；组合只剩 r1
    assert set(_ids(_rows(client, admin_headers, operator=combo["operator"])[0])) & all_five == \
        {r1, r2, r4}
    assert set(_ids(_rows(client, admin_headers, type=TYPE_APPROVE)[0])) & all_five == {r1, r3, r4}
    assert set(_ids(_rows(client, admin_headers, timeFrom=_day(-1))[0])) & all_five == {r1, r2, r3}
    # 组合是交集而不是并集/首把筛子（AND 语义）
    rows, total = _rows(client, admin_headers, **combo)
    assert _ids(rows) == _ids(_reference("u-6", **combo))
    assert set(_ids(rows)) & all_five == {r1}, _ids(rows)
    assert total == len(_reference("u-6", **combo))
    # 再叠第四把（keyword）仍然是 AND
    rows4, total4 = _rows(client, admin_headers, **combo, keyword=f"{m} one")
    assert rows4 == _reference("u-6", keyword=f"{m} one", **combo)
    assert set(_ids(rows4)) & all_five == {r1} and total4 == len(rows4)
    # 组合到空：三把都合法但交集为空 ⇒ 200 + 0 行
    empty, total_e = _rows(client, admin_headers, operator=f"{m}Beta",
                           type=TYPE_CANCEL, timeFrom=_day(-1))
    assert empty == _reference("u-6", operator=f"{m}Beta", type=TYPE_CANCEL,
                               timeFrom=_day(-1))
    assert total_e == 0 and empty == []
    # 组合走翻页也同一套（分页与筛子不互相吞）：标记串唯一 ⇒ 恰好自造五行
    walked, wtotal, wp = _walk(client, admin_headers, pageSize=3, operator=m)
    assert walked == _reference("u-6", operator=m)
    assert wtotal == 5 and set(_ids(walked)) == all_five and wp == 2


# ============ 5. 可见性：非管理员只看得见自己组织的日志行 ============

def test_visibility_is_inherited_from_visible_inquiries(client, buyer_headers, admin_headers,
                                                        cleanup_units):
    m = f"{UNITS}L5"
    hq = _insert_inquiry(f"{m}-hq", marker=m, as_user="u-1")        # 总部采购中心
    east = _insert_inquiry(f"{m}-east", marker=m, as_user="u-3")    # 华东分部
    hq_logs = [
        _insert_log(f"{m}-hq{i}", hq, time=_ts(0, f"10:00:0{i}"), operator=f"{m}opHQ",
                    log_type=TYPE_APPROVE, content=f"{m} hq{i}") for i in (1, 2)
    ]
    east_logs = [
        _insert_log(f"{m}-ea{i}", east, time=_ts(0, f"11:00:0{i}"), operator=f"{m}opEA",
                    log_type=TYPE_APPROVE, content=f"{m} ea{i}") for i in (1, 2, 3)
    ]
    huadong = _login_headers(client, "u-3")

    # 差分前提：管理员看得见自造五行；两个非管理员各自只看得见本组织那几行
    admin_rows, admin_total, pages = _walk(client, admin_headers, pageSize=3)
    assert admin_rows == _reference("u-6")
    assert admin_total == len(_reference("u-6"))
    assert set(hq_logs + east_logs) <= set(_ids(admin_rows))

    u3_rows, u3_total, _ = _walk(client, huadong, pageSize=3)
    u1_rows, u1_total, _ = _walk(client, buyer_headers, pageSize=3)
    # 严格小于，且各自等于自己的参考序列（"数出来碰巧小"过不了这一行）
    assert u3_total < admin_total and u1_total < admin_total
    assert u3_rows == _reference("u-3") and u3_total == len(_reference("u-3"))
    assert u1_rows == _reference("u-1") and u1_total == len(_reference("u-1"))
    u3_ids = set(_ids(u3_rows))
    u1_ids = set(_ids(u1_rows))
    # 另一组织的日志 id 一次都没出现（不是"总数小一点"，而是逐 id 排除）
    assert not (set(hq_logs) & u3_ids), f"总部日志漏进 u-3：{set(hq_logs) & u3_ids}"
    assert set(east_logs) <= u3_ids
    assert not (set(east_logs) & u1_ids), f"华东日志漏进 u-1：{set(east_logs) & u1_ids}"
    assert set(hq_logs) <= u1_ids
    # 每一页 total 都稳定，且不超过管理员那一档
    for headers, mine in ((huadong, u3_total), (buyer_headers, u1_total)):
        for p in range(1, pages + 1):
            assert _get(client, headers, page=p, pageSize=3)["total"] == mine
    # 自造五行的归属分账（绝对数）：u-3 只进华东三行、u-1 只进总部两行，谁也进不了对方的
    assert len(_reference("u-3", operator=f"{m}opEA")) == 3
    assert len(_reference("u-3", operator=f"{m}opHQ")) == 0
    assert len(_reference("u-1", operator=f"{m}opHQ")) == 2
    assert len(_reference("u-1", operator=f"{m}opEA")) == 0
    assert len(_reference("u-6", operator=m)) == 5
    # 端点侧同数：可见性谓词只减不增，差额至少覆盖落在门外的行
    assert _rows(client, huadong, operator=f"{m}opEA")[1] == 3
    assert _rows(client, huadong, operator=f"{m}opHQ")[1] == 0
    assert _rows(client, buyer_headers, operator=f"{m}opHQ")[1] == 2
    assert _rows(client, buyer_headers, operator=f"{m}opEA")[1] == 0
    assert _rows(client, admin_headers, operator=m)[1] == 5
    assert admin_total - u3_total >= 2 and admin_total - u1_total >= 3


# ============ 6a. 校验：page / pageSize 边界两侧 ============

def test_pagination_bounds_rejected_on_both_polarities(client, admin_headers, cleanup_units):
    assert PAGE_SIZE_MIN == 1 and PAGE_SIZE_MAX == 200
    # 四侧各钉一个具体的校验类型：只断 422 的话"任何参数写错都 422"也能过
    for bad, loc, err_type in (
        ({"page": 0}, "page", "greater_than_equal"),
        ({"page": -1}, "page", "greater_than_equal"),
        ({"pageSize": 0}, "pageSize", "greater_than_equal"),
        ({"pageSize": -5}, "pageSize", "greater_than_equal"),
    ):
        detail = _get(client, admin_headers, expect=422, **bad).json()["detail"]
        assert isinstance(detail, list) and detail, bad      # pydantic 校验错，不是 500
        assert [p["loc"] for p in detail] == [["query", loc]], bad
        assert [p["type"] for p in detail] == [err_type], bad
    # 上限两侧：恰好 200 ⇒ 200；201 ⇒ 422（只测一侧的话 le 写成 < 也测不出来）
    ok = _get(client, admin_headers, page=1, pageSize=PAGE_SIZE_MAX)
    assert ok["pageSize"] == PAGE_SIZE_MAX and ok["total"] == len(_reference("u-6"))
    assert len(ok["items"]) == min(PAGE_SIZE_MAX, ok["total"])
    detail = _get(client, admin_headers, expect=422, page=1, pageSize=PAGE_SIZE_MAX + 1)\
        .json()["detail"]
    assert [p["loc"] for p in detail] == [["query", "pageSize"]]
    assert detail[0]["type"] == "less_than_equal"
    # 界值就写在上限上（本仓的异常处理器把 ctx 里的数序列化成串，所以按串比）
    assert str(PAGE_SIZE_MAX) in detail[0]["msg"], detail[0]["msg"]
    assert detail[0]["ctx"]["le"] == str(PAGE_SIZE_MAX), detail[0]["ctx"]
    # page 给到极大值不报错（只是空页）
    far = _get(client, admin_headers, page=10 ** 6, pageSize=10)
    assert far["items"] == [] and far["total"] == ok["total"]


def test_logs_endpoint_requires_authentication(client, cleanup_units):
    resp = client.get(LOGS_URL)
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"] == "未认证"
    # 坏 token 同样 401（走 auth.py:163-166 的分支，不是 500）
    bad = client.get(LOGS_URL, headers={"Authorization": "Bearer not-a-real-token"})
    assert bad.status_code == 401, bad.text


def test_unknown_sort_key_falls_back_to_default_order(client, admin_headers, cleanup_units):
    m = f"{UNITS}L6"
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    for n, t in enumerate(("05", "01", "03", "02", "04")):
        _insert_log(f"{m}-lg{n}", inq, time=_ts(0, f"12:{t}:00"), operator=f"{m}op",
                    log_type=TYPE_APPROVE, content=f"{m} s{n}")
    ref = _reference("u-6")
    baseline = _ids(ref)
    # 未知键：200 且不换序（既不 500，也不"顺手变成另一列"）
    for junk in ("NOT_A_KEY", "operator", "result", "time;DROP", "content:desc", ":"):
        rows, total = _rows(client, admin_headers, sort=junk)
        assert total == len(ref), junk
        assert _ids(rows) == baseline, f"未知 sort={junk!r} 把顺序改了"
        assert rows == ref, junk
    # 空串与不传参数等价
    assert _rows(client, admin_headers, sort="")[0] == ref
    # 白名单内的值仍按 time desc；asc 极性证明 sort 不是被整个忽略
    asc_ref = _reference("u-6", asc=True)
    rows, total = _rows(client, admin_headers, sort="time:asc")
    assert _ids(rows) == _ids(asc_ref) and rows == asc_ref and total == len(asc_ref)
    # 我造五行时间互不相同（lg0=12:05, lg1=12:01, lg2=12:03, lg3=12:02, lg4=12:04）：
    # asc 读数里它们的次序必须与 desc 读数正好相反 —— 这是"sort 没被整个忽略"的证据
    mine_ids = {f"{m}-lg{n}" for n in range(5)}
    expect_asc = [f"{m}-lg1", f"{m}-lg3", f"{m}-lg2", f"{m}-lg4", f"{m}-lg0"]
    assert [i for i in _ids(rows) if i in mine_ids] == expect_asc
    assert [i for i in baseline if i in mine_ids] == list(reversed(expect_asc))
    # 同一秒的并列块在 asc 档里也必须按 id 升序（次排序键方向与主键无关）
    _assert_ids_asc_within_each_second(rows)
    # 显式 desc 与默认同序
    assert _rows(client, admin_headers, sort="time:desc")[0] == ref
    # 白名单本身就只有 time 一键（与 autouse 夹具同源，这里再钉一次方向）
    assert set(_LOG_SORT_FIELDS) == {"time"}


# ============ 7. 路由顺序守卫：/api/inquiries/logs 不被 /{inquiry_id} 吞掉 ============

def test_logs_route_resolves_before_inquiry_id_detail_route(client, admin_headers, cleanup_units):
    """`GET /api/inquiries/logs` 必须命中日志分页，而不是 `GET /api/inquiries/{inquiry_id}`。

    存在理由：两条路由共享同一个前缀 `/api/inquiries`，而 FastAPI 是按**声明顺序**匹配的——
    `/logs`（app/routers/inquiries.py:473）只有排在 `/{inquiry_id}`（:552）之前才拿得到这个 URL。
    顺序一旦被调换（有人把详情端点上移、或新加一条 `/{inquiry_id}` 形态的路由），
    "logs" 就会被当成 inquiry_id 传给详情端点：库里没有 id 为 logs 的询价单 ⇒ 整页 404，
    而响应形状差异（分页 dict vs InquirySchema 对象）是这里唯一能机检的信号。
    所以本格三分都钉：路由表里的先后、命中端点的响应形状、以及反证"详情端点对不存在的 id 就是 404"。
    """
    # 1) 声明顺序：两条路由在同一个 APIRouter 里的先后（FastAPI 按声明顺序匹配）
    declared = [r.path for r in inquiries_router.routes if "GET" in (r.methods or set())]
    assert "/inquiries/logs" in declared and "/inquiries/{inquiry_id}" in declared
    assert declared.index("/inquiries/logs") < declared.index("/inquiries/{inquiry_id}"), (
        f"声明顺序被调换：{declared.index('/inquiries/logs')} !< "
        f"{declared.index('/inquiries/{inquiry_id}')}（全表 {declared}）"
    )
    # 2) 形状：分页 dict（有 total / items），不是询价单详情对象
    body = _get(client, admin_headers, page=1, pageSize=5)
    assert set(body) == {"items", "total", "page", "pageSize"}
    assert isinstance(body["total"], int) and isinstance(body["items"], list)
    for k in ("subject", "status", "code"):
        assert k not in body, f"响应里有 {k}：这是询价单详情端点的形状，路由被吞了"
    # 库里确实没有 id='logs' 的询价单 ⇒ 反证 3 的 404 是真的，不是恰好撞上
    db = SessionLocal()
    try:
        assert db.query(Inquiry).filter(Inquiry.id == "logs").first() is None
    finally:
        db.close()
    # 3) 反证：详情端点对不存在的 id 的读数就是 404 + "询价单不存在"
    #    （若 /logs 被它接管，这一格与第 2 格会给出互相矛盾的形状）
    miss = client.get(DETAIL_URL_TPL.format("logs-not-an-inquiry-id"), headers=admin_headers)
    assert miss.status_code == 404, miss.text
    assert miss.json()["detail"] == "询价单不存在"
    # 4) 极端情形：库里真有一张 id='logs' 的询价单时，/api/inquiries/logs 仍走日志分页
    #    （它的 owner_name=UNITS ⇒ cleanup_units 会把这条连子行一起清掉）
    m = f"{UNITS}L7"
    _insert_inquiry("logs", marker=m)
    probe = _insert_log(f"{m}-lg", "logs", time=_ts(0, "23:50:00"), operator=f"{m}op",
                        log_type=TYPE_APPROVE, content=f"{m} shadow")
    again = _get(client, admin_headers, page=1, pageSize=PAGE_SIZE_MAX)
    assert set(again) == {"items", "total", "page", "pageSize"}
    assert again["total"] == len(_reference("u-6"))
    assert probe in _ids(_rows(client, admin_headers)[0])
    # 5) /logs 也没把整个前缀吞掉：别的 id 照旧落回详情端点（两把路由共存）
    other = _insert_inquiry(f"{m}-inq", marker=m)
    detail = client.get(DETAIL_URL_TPL.format(other), headers=admin_headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["id"] == other and "total" not in detail.json()


# ============ 8. LIKE 通配符必须按字面量命中（R112 本轮修掉的缺陷） ============

def test_like_wildcards_in_user_input_match_literally(
    client, admin_headers, cleanup_units
):
    """`%` / `_` / `\\` 出现在筛子输入里时必须当普通字符。

    这条钉的是 `_contains()`（app/routers/inquiries.py:271-279）。修之前是
    `col.like(f"%{输入}%")`：`%`＝任意串、`_`＝任意单字符，于是 `keyword=%`
    会把全部行都判成命中（起草者实测 35/35，与不带筛子完全相同），
    而前端与 MSW 桩都是 `.includes()` 的字面语义——三条路径不同形，是缺陷不是宽松度。
    判据一侧用 `_reference()`（Python `in`）当 oracle，所以"改回不转义"必然翻红。
    """
    m = f"{UNITS}L8"
    inq = _insert_inquiry(f"{m}-inq", marker=m)
    pct = _insert_log(f"{m}-pct", inq, time=_ts(0, "10:00:00"), operator=f"{m}op",
                      log_type=TYPE_APPROVE, content=f"{m} 折扣 50% 封顶")
    und = _insert_log(f"{m}-und", inq, time=_ts(0, "11:00:00"), operator=f"{m}op",
                      log_type=TYPE_APPROVE, content=f"{m} 键名 x_y 值")
    wild = _insert_log(f"{m}-wild", inq, time=_ts(0, "12:00:00"), operator=f"{m}op",
                       log_type=TYPE_APPROVE, content=f"{m} 像 xay 但不含下划线")
    bs = _insert_log(f"{m}-bs", inq, time=_ts(0, "13:00:00"), operator=f"{m}op",
                     log_type=TYPE_APPROVE, content=f"{m} 路径 C:\\temp")

    # 前提：四行都在，且不带筛子时它们全进（否则下面的"只命中 1 行"是空集上的恒真）
    allrows, total = _rows(client, admin_headers, keyword=m)
    assert total == 4 and set(_ids(allrows)) == {pct, und, wild, bs}, _ids(allrows)

    # `%` 只命中字面含 % 的那一行；旧写法会命中全部 4 行
    got, t = _rows(client, admin_headers, keyword="50%")
    assert (t, _ids(got)) == (1, [pct]) and got == _reference("u-6", keyword="50%")
    bare, t = _rows(client, admin_headers, keyword="%")
    assert t == 1 and _ids(bare) == [pct], _ids(bare)
    assert bare == _reference("u-6", keyword="%")

    # `_` 不当"任意单字符"：`x_y` 不得命中 "xay"
    got, t = _rows(client, admin_headers, keyword="x_y")
    assert (t, _ids(got)) == (1, [und]) and got == _reference("u-6", keyword="x_y")

    # 转义符自身也按字面量：`\\` 只命中带反斜杠的那行，且不得把别的行的转义拆开
    got, t = _rows(client, admin_headers, keyword="\\temp")
    assert (t, _ids(got)) == (1, [bs]) and got == _reference("u-6", keyword="\\temp")

    # operator 那一侧同样走 `_contains(func.lower(col), …)`：造一条含 % 的操作人名
    op_pct = _insert_log(f"{m}-op", inq, time=_ts(0, "14:00:00"), operator=f"{m} 100%质检",
                         log_type=TYPE_APPROVE, content=f"{m} 另一条内容")
    got, t = _rows(client, admin_headers, operator="100%")
    assert (t, _ids(got)) == (1, [op_pct]) and got == _reference("u-6", operator="100%")
    # 旧写法在这里会把 operator 含任意字符的行都捞进来（`%` 是任意串）
    got, t = _rows(client, admin_headers, operator="%")
    assert t == 1 and _ids(got) == [op_pct], _ids(got)
