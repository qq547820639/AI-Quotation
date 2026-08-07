"""设置路由：get / update（持久化到 AppSettings 单行表）"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, AppSettings
from ..schemas import AppSettingsSchema, ApprovalSettings, NotificationSettings
from ..auth import get_current_user, require_permission
from ..serializers import settings_to_schema

router = APIRouter(prefix="/settings", tags=["settings"])

SETTINGS_ID = 1


def _get_or_create_settings(db: Session) -> AppSettings:
    s = db.query(AppSettings).filter(AppSettings.id == SETTINGS_ID).first()
    if s is None:
        s = AppSettings(id=SETTINGS_ID)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("", response_model=AppSettingsSchema)
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = _get_or_create_settings(db)
    return settings_to_schema(s)


@router.put("", response_model=AppSettingsSchema)
def update_settings(
    body: AppSettingsSchema,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("SETTINGS_MANAGE")),
):
    """整体更新设置（持久化写回 DB）"""
    s = _get_or_create_settings(db)
    s.approval_enabled = body.approval.enabled
    s.approval_amount_threshold = body.approval.amountThreshold
    s.approval_approver_id = body.approval.approverId
    s.notification_deadline_reminder = body.notification.deadlineReminder
    s.notification_deadline_reminder_hours = body.notification.deadlineReminderHours
    s.notification_quotation_submitted = body.notification.quotationSubmitted
    s.notification_approval_result = body.notification.approvalResult
    # AI 配置：apiKey 为空或为脱敏形态（含 *）时保持不变，避免覆盖已有密钥
    if body.ai.apiKey and "*" not in body.ai.apiKey:
        s.ai_api_key = body.ai.apiKey
    s.ai_provider = body.ai.provider
    s.ai_base_url = body.ai.baseUrl
    s.ai_model = body.ai.model
    s.ai_structured_output = body.ai.structuredOutput
    db.commit()
    db.refresh(s)
    return settings_to_schema(s)
