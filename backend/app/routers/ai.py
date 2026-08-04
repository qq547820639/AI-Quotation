"""AI 服务路由（P1-9 Task 14）

挂载于 /api/ai，需登录用户（get_current_user）。供应商门户基于邀请 token 认证，
无内部账号，天然无法访问本路由（供应商门户不可用 AI）。

端点：
- POST /api/ai/inquiry-description → {description, source, disclaimer}
- POST /api/ai/quotation-anomalies → {summary, hasAnomaly, anomalyCount, source, disclaimer}
- POST /api/ai/compare-conclusion → {conclusion, source, disclaimer}
- GET  /api/ai/stats → 聚合统计（可选，需登录）

AI 不可用（超时/熔断/异常）时回退本地规则，source 标记为 local。
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ..ai import DISCLAIMER, execute
from ..ai.usage import get_ai_stats, record_usage
from ..auth import get_current_user
from ..database import get_db
from ..models import User

router = APIRouter(prefix="/ai", tags=["ai"])


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


# ============ 端点 ============

@router.post("/inquiry-description")
async def inquiry_description(
    body: InquiryDescriptionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await execute("inquiry-description", {"params": body.params.model_dump()}, user.id)
    record_usage(db, user.id, result)
    return {
        "description": result.description,
        "source": result.source,
        "disclaimer": DISCLAIMER,
    }


@router.post("/quotation-anomalies")
async def quotation_anomalies(
    body: AnomaliesRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await execute(
        "quotation-anomalies",
        {"inquiry": body.inquiry, "data": body.data, "rows": body.rows},
        user.id,
    )
    record_usage(db, user.id, result)
    return {
        "summary": result.summary,
        "hasAnomaly": result.hasAnomaly,
        "anomalyCount": result.anomalyCount,
        "source": result.source,
        "disclaimer": DISCLAIMER,
    }


@router.post("/compare-conclusion")
async def compare_conclusion(
    body: ConclusionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await execute(
        "compare-conclusion",
        {"inquiry": body.inquiry, "data": body.data, "rows": body.rows},
        user.id,
    )
    record_usage(db, user.id, result)
    return {
        "conclusion": result.conclusion,
        "source": result.source,
        "disclaimer": DISCLAIMER,
    }


@router.get("/stats")
async def ai_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return get_ai_stats(db)