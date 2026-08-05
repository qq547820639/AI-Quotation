"""AI 远端输出的 Pydantic 结构校验模型（P1 深化：强结构化输出）

远端 LLM 返回的 JSON 必须通过对应模型严格校验，未验证的字段一律不允许写入数据库。
type-misuse / 缺字段 / 类型错误 / 超长均在此拦截，触发结构修复重试或降级本地规则。
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# 单字段文本长度上限，超长视为非法（避免异常超长输出写入）。
MAX_TEXT_LENGTH = 6000


class InquiryDescriptionOutput(BaseModel):
    """询价说明输出：{"description": 非空字符串}"""
    model_config = ConfigDict(extra="ignore")

    description: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)


class QuotationAnomalyOutput(BaseModel):
    """报价异常输出：{"summary", "hasAnomaly", "anomalyCount"}"""
    model_config = ConfigDict(extra="ignore")

    summary: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    hasAnomaly: bool
    anomalyCount: int = Field(..., ge=0, le=10000)


class CompareConclusionOutput(BaseModel):
    """比价结论输出：{"conclusion": 非空字符串}"""
    model_config = ConfigDict(extra="ignore")

    conclusion: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)