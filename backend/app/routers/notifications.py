"""通知路由：list / create / markRead / markAllRead"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Notification
from ..schemas import NotificationSchema, NotificationCreate, SuccessResult
from ..auth import get_current_user
from ..serializers import notification_to_schema, gen_notification_id, now_iso

router = APIRouter(prefix="/notifications", tags=["notifications"])

NOTIFICATION_LIMIT = 100


@router.get("", response_model=list[NotificationSchema])
def list_notifications(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Notification).order_by(Notification.time.desc()).all()
    return [notification_to_schema(n) for n in rows]


@router.post("", response_model=NotificationSchema)
def create_notification(
    body: NotificationCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = body.model_dump(exclude_unset=True)
    n = Notification(
        id=data.get("id") or gen_notification_id(),
        inquiry_id=data.get("inquiryId"),
        type=data.get("type", "system"),
        title=data.get("title", ""),
        content=data.get("content", ""),
        time=data.get("time") or now_iso(),
        read=False,
    )
    db.add(n)
    db.flush()
    # FIFO 上限 100 条：删除最旧的
    total = db.query(Notification).count()
    if total > NOTIFICATION_LIMIT:
        excess = total - NOTIFICATION_LIMIT
        oldest = db.query(Notification).order_by(Notification.time.asc()).limit(excess).all()
        for old in oldest:
            db.delete(old)
    db.commit()
    db.refresh(n)
    return notification_to_schema(n)


@router.post("/{notification_id}/read", response_model=SuccessResult)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    n = db.query(Notification).filter(Notification.id == notification_id).first()
    if n is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通知不存在")
    n.read = True
    db.commit()
    return SuccessResult(success=True)


@router.post("/read-all", response_model=SuccessResult)
def mark_all_read(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    db.query(Notification).update({Notification.read: True})
    db.commit()
    return SuccessResult(success=True)
