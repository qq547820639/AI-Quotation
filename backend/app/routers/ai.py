"""AI 服务路由（P1-9 Task 14 + P1 深化 Task 12/13）

挂载于 /api/ai，需登录用户（get_current_user）。供应商门户基于邀请 token 认证，
无内部账号，天然无法访问本路由（供应商门户不可用 AI）。

端点：
- POST /api/ai/inquiry-description → AI 结果 + 可解释性元数据
- POST /api/ai/quotation-anomalies → AI 结果 + 可解释性元数据
- POST /api/ai/compare-conclusion → AI 结果 + 可解释性元数据
- GET  /api/ai/stats → SQL 聚合统计（管理员，支持分页/时间范围/组织过滤）
- POST /api/ai/feedback → 记录「有帮助/无帮助/纠正」反馈

AI 不可用（超时/熔断/预算耗尽/异常）时回退本地规则，source 标记为 local，
degraded 标记为 true。Provider 通过依赖注入（get_ai_provider）可替换/测试 mock。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ..ai import DISCLAIMER, build_provider, execute, get_provider_override
from ..ai.base import AIProvider, ProviderResult
from ..ai.usage import (
    FEEDBACK_VALUES,
    get_ai_feedback_summary,
    get_ai_stats,
    record_feedback,
    record_usage,
)
from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import AppSettings, User

router = APIRouter(prefix="/ai", tags=["ai"])


def get_ai_provider(db: Session = Depends(get_db)) -> AIProvider:
    """依据设置页（DB）的 AI 配置构建 Provider；测试时可先用 set_provider 注入覆盖。"""
    override = get_provider_override()
    if override is not None:
        return override
    s = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if s is None:
        return build_provider()
    return build_provider(
        provider_mode=s.ai_provider or "local",
        api_key=s.ai_api_key or "",
        base_url=s.ai_base_url or "",
        model=s.ai_model or "",
        structured_output=s.ai_structured_output,
    )


# ============ 请求体（AI 视为不透明数据，宽松透传） ============

class InquiryDescriptionParams(BaseModel):
    model_config = ConfigDict(extra="allow")
    subject: str = ""
    items: list[Any] = []
    paymentTerms: Optional[str] = None
    deliveryAddress: Optional[str] = None
    expectedDeliveryDate: Optional[str] = None


class InquiryDescriptionRequest(BaseModel):
    params: InquiryDescriptionParams


class AnomaliesRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    inquiry: Any = {}
    data: Any = {}
    rows: list[Any] = []


class ConclusionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    inquiry: Any = {}
    data: Any = {}
    rows: list[Any] = []


class FeedbackRequest(BaseModel):
    """AI 输出反馈（可解释性）：helpful / not_helpful / correct"""
    feedback: str
    usage_id: Optional[str] = None
    action: Optional[str] = None
    comment: Optional[str] = None


# ============ 可解释性元数据 ============

def _meta(result: ProviderResult) -> dict:
    """组装可解释性元数据字段。"""
    return {
        "dataBasis": result.data_basis,
        "references": result.references,
        "risk": result.risk,
        "model": result.model,
        "degraded": result.degraded,
        "generatedAt": result.generated_at,
        "promptVersion": result.prompt_version,
    }


# ============ 端点 ============

@router.post("/inquiry-description")
async def inquiry_description(
    body: InquiryDescriptionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    provider: AIProvider = Depends(get_ai_provider),
):
    result = await execute("inquiry-description", {"params": body.params.model_dump()}, user.id, provider)
    record_usage(db, user.id, result)
    return {
        "description": result.description,
        "source": result.source,
        "disclaimer": DISCLAIMER,
        **_meta(result),
    }


@router.post("/quotation-anomalies")
async def quotation_anomalies(
    body: AnomaliesRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    provider: AIProvider = Depends(get_ai_provider),
):
    result = await execute(
        "quotation-anomalies",
        {"inquiry": body.inquiry, "data": body.data, "rows": body.rows},
        user.id,
        provider,
    )
    record_usage(db, user.id, result)
    return {
        "summary": result.summary,
        "hasAnomaly": result.hasAnomaly,
        "anomalyCount": result.anomalyCount,
        "source": result.source,
        "disclaimer": DISCLAIMER,
        **_meta(result),
    }


@router.post("/compare-conclusion")
async def compare_conclusion(
    body: ConclusionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    provider: AIProvider = Depends(get_ai_provider),
):
    result = await execute(
        "compare-conclusion",
        {"inquiry": body.inquiry, "data": body.data, "rows": body.rows},
        user.id,
        provider,
    )
    record_usage(db, user.id, result)
    return {
        "conclusion": result.conclusion,
        "source": result.source,
        "disclaimer": DISCLAIMER,
        **_meta(result),
    }


@router.post("/feedback")
async def ai_feedback(
    body: FeedbackRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """记录 AI 输出反馈（有帮助/无帮助/纠正）。"""
    fb = body.feedback.strip().lower()
    if fb not in FEEDBACK_VALUES:
        raise HTTPException(status_code=422, detail=f"feedback 取值必须为 {'/'.join(FEEDBACK_VALUES)}")
    record = record_feedback(
        db,
        created_by=user.id,
        feedback=fb,
        usage_id=body.usage_id,
        action=body.action,
        comment=body.comment,
        organization=user.organization,
    )
    return {"success": True, "id": record.id}


@router.get("/stats")
async def ai_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    action: Optional[str] = Query(default=None),
    organization: Optional[str] = Query(default=None),
    start: Optional[datetime] = Query(default=None),
    end: Optional[datetime] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """AI 用量统计：仅管理员可访问（RBAC）。SQL 聚合 + 分页 + 时间范围 + 组织过滤。"""
    return get_ai_stats(
        db,
        organization=organization,
        action=action,
        start_time=start,
        end_time=end,
        page=page,
        page_size=page_size,
    )


@router.get("/feedback-summary")
async def ai_feedback_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    organization: Optional[str] = Query(default=None),
):
    """AI 反馈聚合统计（管理员）：按反馈取值计数。"""
    return get_ai_feedback_summary(db, organization=organization)