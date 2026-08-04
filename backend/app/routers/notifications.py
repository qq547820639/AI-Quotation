"""通知路由：list / create / markRead / markAllRead / unread-count / preferences

P1-8 Task 12：
- list 按当前用户 user_id 过滤
- 新增 GET /notifications/unread-count 返回未读数
- markRead / markAllRead 只作用于当前用户的通知
- 新增 GET/PUT /notifications/preferences 读写用户级通知偏好（user_notification_preferences 表）
- create 默认归属当前用户
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Notification, UserNotificationPreference
from ..schemas import (
    NotificationSchema, NotificationCreate, SuccessResult,
    UnreadCountSchema, UserNotificationPreferencesSchema,
)
from ..auth import get_current_user
from ..serializers import notification_to_schema, gen_notification_id, now_iso
from ..events import publish

router = APIRouter(prefix="/notifications", tags=["notifications"])

NOTIFICATION_LIMIT = 100


@router.get("", response_model=list[NotificationSchema])
def list_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = db.query(Notification).filter(
        Notification.user_id == user.id,
    ).order_by(Notification.time.desc()).all()
    return [notification_to_schema(n) for n in rows]


@router.get("/unread-count", response_model=UnreadCountSchema)
def unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    count = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.read.is_(False),
    ).count()
    return UnreadCountSchema(count=count)


@router.post("", response_model=NotificationSchema)
def create_notification(
    body: NotificationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = body.model_dump(exclude_unset=True)
    n = Notification(
        id=data.get("id") or gen_notification_id(),
        user_id=data.get("userId") or user.id,
        inquiry_id=data.get("inquiryId"),
        type=data.get("type", "system"),
        title=data.get("title", ""),
        content=data.get("content", ""),
        time=data.get("time") or now_iso(),
        read=False,
    )
    db.add(n)
    db.flush()
    # FIFO 上限 100 条：仅删除当前用户最旧的
    total = db.query(Notification).filter(Notification.user_id == n.user_id).count()
    if total > NOTIFICATION_LIMIT:
        excess = total - NOTIFICATION_LIMIT
        oldest = db.query(Notification).filter(
            Notification.user_id == n.user_id,
        ).order_by(Notification.time.asc()).limit(excess).all()
        for old in oldest:
            db.delete(old)
    db.commit()
    db.refresh(n)
    # P2-12 Task 17：广播通知事件，SSE 订阅端刷新未读数
    publish("notification", {"notificationId": n.id, "userId": n.user_id, "type": n.type})
    return notification_to_schema(n)


@router.post("/{notification_id}/read", response_model=SuccessResult)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ).first()
    if n is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通知不存在")
    n.read = True
    db.commit()
    return SuccessResult(success=True)


@router.post("/read-all", response_model=SuccessResult)
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == user.id,
    ).update({Notification.read: True})
    db.commit()
    return SuccessResult(success=True)


# ============ 用户级通知偏好（P1-8 Task 12） ============

def _get_or_create_preference(db: Session, user_id: str) -> UserNotificationPreference:
    pref = db.query(UserNotificationPreference).filter(
        UserNotificationPreference.user_id == user_id,
    ).first()
    if pref is None:
        pref = UserNotificationPreference(user_id=user_id)
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


@router.get("/preferences", response_model=UserNotificationPreferencesSchema)
def get_preferences(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    pref = _get_or_create_preference(db, user.id)
    return UserNotificationPreferencesSchema(
        deadlineReminder=pref.deadline_reminder,
        deadlineReminderHours=pref.deadline_reminder_hours,
        quotationSubmitted=pref.quotation_submitted,
        approvalResult=pref.approval_result,
        inquirySent=pref.inquiry_sent,
    )


@router.put("/preferences", response_model=UserNotificationPreferencesSchema)
def update_preferences(
    body: UserNotificationPreferencesSchema,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    pref = _get_or_create_preference(db, user.id)
    pref.deadline_reminder = body.deadlineReminder
    pref.deadline_reminder_hours = body.deadlineReminderHours
    pref.quotation_submitted = body.quotationSubmitted
    pref.approval_result = body.approvalResult
    pref.inquiry_sent = body.inquirySent
    db.commit()
    db.refresh(pref)
    return UserNotificationPreferencesSchema(
        deadlineReminder=pref.deadline_reminder,
        deadlineReminderHours=pref.deadline_reminder_hours,
        quotationSubmitted=pref.quotation_submitted,
        approvalResult=pref.approval_result,
        inquirySent=pref.inquiry_sent,
    )