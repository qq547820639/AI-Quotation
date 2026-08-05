"""任务队列管理与重试 API（P1 可靠性 / P0-7 安全边界）

- GET  /api/tasks         任务状态查询（分页，登录用户，按归属/组织隔离）
- POST /api/tasks/{id}/retry  重试永久失败任务（管理员）
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import TaskRecord, User
from ..queue_client import retry_failed_task

router = APIRouter(prefix="/tasks", tags=["tasks"])
logger = logging.getLogger("procurement.tasks")

# 错误信息中若出现这些敏感特征（堆栈/连接串/文件路径/数据库方言），一律脱敏为通用文案（P0-7）
_ERROR_SENSITIVE_PATTERNS = (
    "Traceback", "File \"", " File ", "://", "psycopg", "sqlalchemy",
    "OperationalError", "ConnectionError", "redis", "amqp",
)
_ERROR_REDACTED_MESSAGE = "任务执行失败，请查看服务端日志"
_ERROR_MAX_LEN = 200


def _sanitize_error(err: str | None) -> str | None:
    """对 last_error 脱敏：截断 + 命中敏感特征则替换为通用文案，避免泄露堆栈/库/中间件/路径。"""
    if not err:
        return None
    s = str(err)
    low = s.lower()
    for pat in _ERROR_SENSITIVE_PATTERNS:
        if pat.lower() in low:
            return _ERROR_REDACTED_MESSAGE
    if len(s) > _ERROR_MAX_LEN:
        return s[:_ERROR_MAX_LEN] + "..."
    return s


def _record_to_dict(r: TaskRecord) -> dict:
    """序列化任务记录：仅暴露非敏感字段，剔除内部 task_name / idempotency_key / business_event_id。"""
    return {
        "id": r.id,
        "taskId": r.task_id,
        "status": r.status,
        "attempts": r.attempts,
        "lastError": _sanitize_error(r.last_error),
        "createdAt": r.created_at.isoformat() if r.created_at else None,
        "startedAt": r.started_at.isoformat() if r.started_at else None,
        "finishedAt": r.finished_at.isoformat() if r.finished_at else None,
    }


@router.get("")
def list_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
):
    """任务状态查询（分页，可按 status 过滤）。

    可见性隔离（P0-7）：
    - 普通用户：仅可见「自己触发的任务（user_id == 自己）或所属组织（organization == 自己组织）」。
    - 管理员：可见跨组织任务，并记录结构化审计日志（user_id / organization / request_id）。
    """
    query = db.query(TaskRecord)
    if user.role == "管理员":
        # 管理员跨组织访问：审计日志
        logger.info(
            "admin_task_list_access",
            extra={"extra_fields": {
                "user_id": user.id,
                "organization": user.organization,
                "scope": "all",
            }},
        )
    else:
        query = query.filter(
            or_(
                TaskRecord.organization == user.organization,
                TaskRecord.user_id == user.id,
            )
        )
    if status:
        query = query.filter(TaskRecord.status == status)
    total = query.count()
    rows = query.order_by(TaskRecord.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [_record_to_dict(r) for r in rows],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.post("/{task_id}/retry")
def retry_task(
    task_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """重试永久失败任务：重置为 pending 并重新投递。仅管理员。"""
    ok = retry_failed_task(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="任务不存在或不可重试")
    return {"success": True, "taskId": task_id}