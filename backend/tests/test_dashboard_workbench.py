"""行动工作台聚合端点集成测试（R107）

覆盖：鉴权、响应形状、各计数与库内独立读数的对账、筛选单调性、
"异常报价不按询价范围过滤"这条刻意口径，以及三条有牙的边界用例
（紧急窗口 47 h/49 h、失败投递按受邀槽位计、未报价槽位排除已提交）。

逐条差分（本端点 vs 前端纯函数 computeDashboardActions）由常驻闸
scripts/check-workbench-parity.mjs 负责，这里只钉端点自己的语义。
"""
from datetime import datetime, timedelta

import pytest

from app.database import SessionLocal
from app.models import Inquiry, InquiryLog, Quotation, User, inquiry_supplier
from app.policy import filter_visible_inquiries

UNITS = "R107UNIT"  # 本模块造的行都带上这个负责人，便于隔离与清理


def _db():
    return SessionLocal()


def _user_row(user_id):
    db = _db()
    try:
        return db.query(User).filter(User.id == user_id).one()
    finally:
        db.close()


def _insert_inquiry(**kw):
    """造一条属于 u-1 组织的询价单；返回 id。"""
    db = _db()
    try:
        user = db.query(User).filter(User.id == "u-1").one()
        now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row = Inquiry(
            id=kw["id"],
            code=f"INQ-{kw['id']}",
            subject=f"{UNITS} {kw['id']}",
            organization=user.organization,
            owner_name=kw.get("owner_name", UNITS),
            owner_id=user.id,
            currency="CNY",
            deadline=kw.get("deadline", "2099-12-31 18:00:00"),
            delivery_address="上海",
            contact="李四",
            payment_terms="款到发货",
            status=kw["status"],
            created_by_id=user.id,
            created_by_name=user.name,
            created_at=kw.get("created_at", now_text),
            updated_at=kw.get("updated_at", now_text),
            selected_supplier_map={},
            purchaser_comments={},
        )
        db.add(row)
        for sid in kw.get("suppliers", []):
            # 计数只看关联表，不要求 suppliers 里真有这一行（SQLite 默认不强制外键）
            db.execute(inquiry_supplier.insert().values(inquiry_id=row.id, supplier_id=sid))
        for log in kw.get("logs", []):
            db.add(
                InquiryLog(
                    id=f"{row.id}-log-{log['type']}",
                    inquiry_id=row.id,
                    time=now_text,
                    operator=user.name,
                    type=log["type"],
                    content="测试日志",
                    result=log.get("result"),
                )
            )
        db.commit()
    finally:
        db.close()


def _insert_quotation(inquiry_id, supplier_id, status):
    db = _db()
    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        db.add(
            Quotation(
                id=f"{UNITS}-q-{inquiry_id}-{supplier_id}",
                inquiry_id=inquiry_id,
                supplier_id=supplier_id,
                supplier_name=f"供应商{supplier_id}",
                status=status,
                total_amount=0,
                created_at=now_text,
                updated_at=now_text,
            )
        )
        db.commit()
    finally:
        db.close()


@pytest.fixture
def cleanup_units():
    """每个用例后把本模块造的行删干净（测试库跨模块共享）。"""
    yield
    db = _db()
    try:
        ids = [row[0] for row in db.query(Inquiry.id).filter(Inquiry.owner_name == UNITS)]
        if ids:
            db.execute(inquiry_supplier.delete().where(inquiry_supplier.c.inquiry_id.in_(ids)))
            db.query(InquiryLog).filter(InquiryLog.inquiry_id.in_(ids)).delete(
                synchronize_session=False
            )
            db.query(Quotation).filter(Quotation.inquiry_id.in_(ids)).delete(
                synchronize_session=False
            )
            db.query(Inquiry).filter(Inquiry.id.in_(ids)).delete(synchronize_session=False)
        db.query(Quotation).filter(Quotation.id.like(f"{UNITS}%")).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def _get(client, headers, **params):
    resp = client.get("/api/dashboard/workbench", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


KEYS = {
    "pendingSend",
    "deadlineApproaching",
    "unquotedSuppliers",
    "failedDeliveries",
    "abnormalQuotations",
    "pendingApproval",
    "approvalTimeout",
    "pendingConfirm",
}


def test_requires_auth(client):
    resp = client.get("/api/dashboard/workbench")
    assert resp.status_code in (401, 403), resp.text


def test_shape_and_nonneg(client, buyer_headers):
    body = _get(client, buyer_headers)
    assert KEYS <= set(body)
    for key in KEYS:
        assert isinstance(body[key], int) and body[key] >= 0, key
    assert isinstance(body["owners"], list)
    assert body["total"] >= 0


def test_pending_send_matches_independent_count(client, buyer_headers, cleanup_units):
    _insert_inquiry(id=f"{UNITS}-ps1", status="PENDING_SEND")
    _insert_inquiry(id=f"{UNITS}-ps2", status="PENDING_SEND")
    _insert_inquiry(id=f"{UNITS}-other", status="COMPLETED")

    body = _get(client, buyer_headers, owner=UNITS)
    assert body["pendingSend"] == 2
    assert body["total"] == 3

    db = _db()
    try:
        user = db.query(User).filter(User.id == "u-1").one()
        direct = (
            filter_visible_inquiries(db.query(Inquiry), user)
            .filter(Inquiry.status == "PENDING_SEND")
            .count()
        )
        scoped = _get(client, buyer_headers)
        assert scoped["pendingSend"] == direct
    finally:
        db.close()


def test_abnormal_quotations_ignore_inquiry_scope(client, buyer_headers, cleanup_units):
    """异常报价 = 全表 TIMEOUT 报价数：参考实现用的是整个报价数组，不带询价范围。"""
    _insert_inquiry(id=f"{UNITS}-aq", status="COMPLETED", suppliers=["sup-r107-aq"])
    _insert_quotation(f"{UNITS}-aq", "sup-r107-aq", "TIMEOUT")
    db = _db()
    try:
        whole_table = db.query(Quotation).filter(Quotation.status == "TIMEOUT").count()
    finally:
        db.close()
    assert _get(client, buyer_headers)["abnormalQuotations"] == whole_table
    # 同一份全表读数不能因为"选了别的负责人"而变小——这是口径，不是缺陷
    assert (
        _get(client, buyer_headers, owner="与本项目无关的负责人")["abnormalQuotations"]
        == whole_table
    )


def test_urgent_window_is_two_days(client, buyer_headers, cleanup_units):
    """紧急窗口 47 h 计入、49 h 不计入 ⇒ 钉住"deadline < now + 2 天"这条与 dayjs 对齐的判据。"""
    _insert_inquiry(
        id=f"{UNITS}-near",
        status="INQUIRING",
        deadline=(datetime.now() + timedelta(hours=47)).strftime("%Y-%m-%d %H:%M:%S"),
    )
    _insert_inquiry(
        id=f"{UNITS}-far",
        status="INQUIRING",
        deadline=(datetime.now() + timedelta(hours=49)).strftime("%Y-%m-%d %H:%M:%S"),
    )
    _insert_inquiry(
        id=f"{UNITS}-expired",
        status="INQUIRING",
        deadline=(datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"),
    )
    _insert_inquiry(id=f"{UNITS}-bogus", status="INQUIRING", deadline="")
    body = _get(client, buyer_headers, owner=UNITS)
    # 47 h 与已超时各计 1，共 2；49 h 不计；空串按 dayjs 判无效也不计
    assert body["deadlineApproaching"] == 2


def test_approval_timeout_uses_same_window(client, buyer_headers, cleanup_units):
    _insert_inquiry(
        id=f"{UNITS}-ap1",
        status="PENDING_APPROVAL",
        deadline=(datetime.now() + timedelta(hours=12)).strftime("%Y-%m-%d %H:%M:%S"),
    )
    _insert_inquiry(
        id=f"{UNITS}-ap2",
        status="PENDING_APPROVAL",
        deadline=(datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S"),
    )
    body = _get(client, buyer_headers, owner=UNITS)
    assert body["pendingApproval"] == 2
    assert body["approvalTimeout"] == 1


def test_unquoted_slots_exclude_submitted(client, buyer_headers, cleanup_units):
    """受邀 3 个槽位：1 个已提交、1 个草稿、1 个无报价 ⇒ 未报价 2（草稿不算已报价）。"""
    _insert_inquiry(
        id=f"{UNITS}-uq",
        status="INQUIRING",
        suppliers=["sup-r107-1", "sup-r107-2", "sup-r107-3"],
    )
    _insert_quotation(f"{UNITS}-uq", "sup-r107-1", "SUBMITTED")
    _insert_quotation(f"{UNITS}-uq", "sup-r107-2", "DRAFT")
    assert _get(client, buyer_headers, owner=UNITS)["unquotedSuppliers"] == 2


def test_failed_deliveries_count_invited_slots(client, buyer_headers, cleanup_units):
    """有失败投递日志的询价，其受邀槽位全部计入；成功日志的那条不计。"""
    _insert_inquiry(
        id=f"{UNITS}-fd1",
        status="INQUIRING",
        suppliers=["sup-r107-f1", "sup-r107-f2"],
        logs=[{"type": "SEND_INQUIRY", "result": "投递失败"}],
    )
    _insert_inquiry(
        id=f"{UNITS}-fd2",
        status="INQUIRING",
        suppliers=["sup-r107-f3"],
        logs=[{"type": "SEND_INQUIRY", "result": "已投递"}],
    )
    assert _get(client, buyer_headers, owner=UNITS)["failedDeliveries"] == 2


def test_owner_options_are_scoped_and_deduped(client, buyer_headers, cleanup_units):
    _insert_inquiry(id=f"{UNITS}-o1", status="DRAFT", owner_name="R107甲")
    _insert_inquiry(id=f"{UNITS}-o2", status="DRAFT", owner_name="R107甲")
    _insert_inquiry(id=f"{UNITS}-o3", status="DRAFT", owner_name="R107乙")
    body = _get(client, buyer_headers)
    assert "R107甲" in body["owners"] and "R107乙" in body["owners"]
    assert len(body["owners"]) == len(set(body["owners"]))
    # 选了负责人之后，选项仍按"该用户可见 + 该组织"给出，不随 owner 参数收窄
    assert _get(client, buyer_headers, owner="R107甲")["owners"] == body["owners"]


def test_date_bounds_are_day_inclusive(client, buyer_headers, cleanup_units):
    """dateFrom=dateTo=当天 ⇒ 当天创建的可见行全部落在区间内（含当日）。"""
    today = datetime.now().strftime("%Y-%m-%d")
    _insert_inquiry(id=f"{UNITS}-d1", status="DRAFT", created_at=f"{today} 00:00:05")
    _insert_inquiry(id=f"{UNITS}-d2", status="DRAFT", created_at=f"{today} 23:59:50")
    _insert_inquiry(id=f"{UNITS}-d3", status="DRAFT", created_at="2020-01-01 10:00:00")
    body = _get(client, buyer_headers, owner=UNITS, dateFrom=today, dateTo=today)
    assert body["total"] == 2


def test_unknown_organization_has_no_rows(client, buyer_headers):
    body = _get(client, buyer_headers, organization="不存在的组织")
    assert body["total"] == 0
    assert body["pendingSend"] == 0
    assert body["owners"] == []


def test_admin_sees_at_least_buyer(client, buyer_headers, admin_headers):
    buyer = _get(client, buyer_headers)
    admin = _get(client, admin_headers)
    assert admin["total"] >= buyer["total"]
