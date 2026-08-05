"""任务队列管理与重试 API（P1 可靠性）

- GET  /api/tasks         任务状态查询（分页，登录用户）
- POST /api/tasks/{id}/retry  重试永久失败任务（管理员）
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import TaskRecord, User
from ..queue_client import retry_failed_task

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _record_to_dict(r: TaskRecord) -> dict:
    return {
        "id": r.id,
        "taskId": r.task_id,
        "taskName": r.task_name,
        "idempotencyKey": r.idempotency_key,
        "status": r.status,
        "attempts": r.attempts,
        "lastError": r.last_error,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
        "startedAt": r.started_at.isoformat() if r.started_at else None,
        "finishedAt": r.finished_at.isoformat() if r.finished_at else None,
        "businessEventId": r.business_event_id,
    }


@router.get("")
def list_tasks(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
):
    """任务状态查询（分页，可按 status 过滤）。"""
    query = db.query(TaskRecord)
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