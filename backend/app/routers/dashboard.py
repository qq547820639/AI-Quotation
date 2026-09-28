"""行动工作台聚合计数（R107）

前端原来为算 8 个卡片数字拉两份全量集合（`GET /api/inquiries` 无参 + `GET /api/quotations`
无参），脏库实测那条全量列表自己就占 2.6 s（R105 四的表）。这里把计数下推到 SQL：
一次请求只回 8 个整数、负责人选项与总数，不再序列化嵌套关系。

口径与前端参考实现 `src/pages/dashboard/workbenchActions.ts` 逐条对齐，
由常驻差分闸 `scripts/check-workbench-parity.mjs` 钉住（TS 参考实现 vs 本端点）。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Inquiry, InquiryLog, Quotation, User, inquiry_supplier
from ..policy import filter_visible_inquiries
from ..schemas import DashboardWorkbenchSchema

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# 与 InquiryStatus / QuotationStatus / LogType 的枚举字面量一致（src/types/index.ts）
ST_PENDING_SEND = "PENDING_SEND"
ST_INQUIRING = "INQUIRING"
ST_PARTIAL_QUOTED = "PARTIAL_QUOTED"
ST_PENDING_APPROVAL = "PENDING_APPROVAL"
ST_PENDING_CONFIRM = "PENDING_CONFIRM"
Q_SUBMITTED = "SUBMITTED"
Q_TIMEOUT = "TIMEOUT"
LOG_SEND_INQUIRY = "SEND_INQUIRY"

ACTIVE_STATUSES = (ST_INQUIRING, ST_PARTIAL_QUOTED)

# 前端 getRemainingTime 的 urgent = 已超时 或 end.diff(now,'day') <= 1；
# dayjs 的 'day' 差按整天向下取整，两支合起来等价于 deadline < now + 2 天。
URGENT_WINDOW = timedelta(days=2)

# 与前端 isFailureResult(/失败|投递失败|delivery.?fail|bounced|error/i) 同判据
FAILURE_RESULT_RE = re.compile(r"失败|投递失败|delivery.?fail|bounced|error", re.IGNORECASE)

_TIMESTAMP_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d")


def parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    """把库存的时间串解析成 naive datetime；解不开返回 None（对齐 dayjs 的 isValid()）。

    参考实现走 `dayjs(deadline)`，解不开时 urgent=false，不计入"即将截止"。
    这里只接受本仓写入口实际产出的形状：serializers.now_str 与前端
    dayjs format('YYYY-MM-DD HH:mm:ss')，另收 ISO-T 与日期-only（dayjs 也认）。
    """
    if not value:
        return None
    text = value.strip()
    for fmt in _TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def is_urgent(deadline: Optional[str], now: datetime) -> bool:
    parsed = parse_timestamp(deadline)
    if parsed is None:
        return False
    return parsed < now + URGENT_WINDOW


def _apply_filters(query, user: User, organization: Optional[str], owner: Optional[str],
                   date_from: Optional[str], date_to: Optional[str]):
    """可见性 + 组织/负责人/创建日期范围（日粒度闭区间）。

    日期界与参考实现同步改成"含首末两日"：旧的前端实现把 dateTo 交给
    `new Date('YYYY-MM-DD')`（按 UTC 零点解析），于是选"到今天我"会把今天的单子整日丢掉，
    与该函数自己的注释（from <= t <= to）矛盾。本轮把口径写死为服务端日粒度闭区间。
    """
    query = filter_visible_inquiries(query, user)
    if organization and organization != "__ALL__":
        query = query.filter(Inquiry.organization == organization)
    if owner:
        query = query.filter(Inquiry.owner_name == owner)
    if date_from:
        query = query.filter(func.substr(Inquiry.created_at, 1, 10) >= date_from)
    if date_to:
        query = query.filter(func.substr(Inquiry.created_at, 1, 10) <= date_to)
    return query


@router.get("/workbench", response_model=DashboardWorkbenchSchema)
def workbench_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    owner: Optional[str] = Query(default=None),
    dateFrom: Optional[str] = Query(default=None),
    dateTo: Optional[str] = Query(default=None),
    organization: Optional[str] = Query(default=None),
):
    """行动工作台 8 个卡片计数 + 负责人选项 + 范围内的询价单总数。

    只投影 id/status/deadline 三列（不是整张询价单），其余各计数由 SQL 聚合完成，
    因此随行数增长的序列化成本不再出现在这条路径上。
    """
    now = datetime.now()
    date_from, date_to = dateFrom, dateTo  # 查询参数按前端 camelCase，内部用 snake_case

    # 1) 范围内的询价单：只取三列，供状态计数与"即将截止"判定
    scope_query = _apply_filters(
        db.query(Inquiry.id, Inquiry.status, Inquiry.deadline),
        user, organization, owner, date_from, date_to,
    )
    scoped = scope_query.all()

    pending_send = 0
    pending_approval = 0
    pending_confirm = 0
    deadline_approaching = 0
    approval_timeout = 0
    for _id, status_value, deadline in scoped:
        if status_value == ST_PENDING_SEND:
            pending_send += 1
        elif status_value == ST_PENDING_APPROVAL:
            pending_approval += 1
            if is_urgent(deadline, now):
                approval_timeout += 1
        elif status_value == ST_PENDING_CONFIRM:
            pending_confirm += 1
        elif status_value in ACTIVE_STATUSES:
            if is_urgent(deadline, now):
                deadline_approaching += 1

    # 2) 尚未报价供应商：范围内"进行中"询价的受邀槽位里，没有已提交报价的那些
    unquoted_query = (
        db.query(func.count(inquiry_supplier.c.supplier_id))
        .select_from(inquiry_supplier)
        .join(Inquiry, Inquiry.id == inquiry_supplier.c.inquiry_id)
        .filter(Inquiry.status.in_(ACTIVE_STATUSES))
        .filter(
            ~exists().where(
                (Quotation.inquiry_id == inquiry_supplier.c.inquiry_id)
                & (Quotation.supplier_id == inquiry_supplier.c.supplier_id)
                & (Quotation.status == Q_SUBMITTED)
            )
        )
    )
    unquoted_suppliers = int(
        _apply_filters(unquoted_query, user, organization, owner, date_from, date_to).scalar() or 0
    )

    # 3) 发送失败邀请：有失败 SEND_INQUIRY 日志的询价单，其受邀供应商全部计入
    log_rows = _apply_filters(
        db.query(InquiryLog.inquiry_id, InquiryLog.result)
        .join(Inquiry, Inquiry.id == InquiryLog.inquiry_id)
        .filter(InquiryLog.type == LOG_SEND_INQUIRY),
        user, organization, owner, date_from, date_to,
    ).all()
    failed_ids = {rid for rid, result in log_rows if FAILURE_RESULT_RE.search(result or "")}
    if failed_ids:
        invited_query = (
            db.query(Inquiry.id, func.count(inquiry_supplier.c.supplier_id))
            .outerjoin(inquiry_supplier, inquiry_supplier.c.inquiry_id == Inquiry.id)
            .group_by(Inquiry.id)
        )
        invited_counts = dict(_apply_filters(
            invited_query, user, organization, owner, date_from, date_to
        ).all())
        failed_deliveries = sum(invited_counts.get(iid, 0) for iid in failed_ids)
    else:
        failed_deliveries = 0

    # 4) 异常报价：超时报价数。参考实现用的是"整个报价数组"（报价列表端点本就按全表返回、
    #    不按询价可见性过滤），所以这里同样不带范围条件——带上了就少算。
    abnormal_quotations = int(
        db.query(func.count(Quotation.id)).filter(Quotation.status == Q_TIMEOUT).scalar() or 0
    )

    # 5) 负责人选项：按"最近更新的先出现"排序，贴近旧数组（updated_at desc）的首次出现顺序
    owner_query = (
        db.query(Inquiry.owner_name)
        .filter(Inquiry.owner_name.isnot(None), Inquiry.owner_name != "")
        .group_by(Inquiry.owner_name)
        .order_by(func.max(Inquiry.updated_at).desc(), func.min(Inquiry.id).asc())
    )
    owners: List[str] = [
        row[0]
        for row in _apply_filters(
            owner_query, user, organization, owner=None, date_from=None, date_to=None
        ).all()
    ]

    return DashboardWorkbenchSchema(
        pendingSend=pending_send,
        deadlineApproaching=deadline_approaching,
        unquotedSuppliers=unquoted_suppliers,
        failedDeliveries=failed_deliveries,
        abnormalQuotations=abnormal_quotations,
        pendingApproval=pending_approval,
        approvalTimeout=approval_timeout,
        pendingConfirm=pending_confirm,
        owners=owners,
        total=len(scoped),
    )
