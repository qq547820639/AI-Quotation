"""AI 服务抽象接口与结果类型（P1-9 Task 14）

- AIProvider：可插拔 Provider 抽象接口，三个方法对应前端 AIBackend 的三个能力。
- ProviderResult：统一结果结构，携带输出字段 + 来源(provider)/模型/Token/成本/耗时。
- 所有 Provider 返回 ProviderResult，路由层据此组装响应并记录 usage。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional


class AIProviderError(Exception):
    """AI Provider 调用失败（remote 超时/网络/结构非法等），用于触发回退本地规则。"""


class InvalidAIResponse(AIProviderError):
    """远程返回的结构非法（无效 JSON / 字段缺失 / 类型错误）。"""


@dataclass
class ProviderResult:
    """统一 AI 结果。不同 action 复用对应字段，其余为 None。"""
    source: str = "local"  # local / remote
    model: str = "local-rule"
    action: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: float = 0.0
    latency_ms: int = 0
    # inquiry-description
    description: Optional[str] = None
    # quotation-anomalies
    summary: Optional[str] = None
    hasAnomaly: Optional[bool] = None
    anomalyCount: Optional[int] = None
    # compare-conclusion
    conclusion: Optional[str] = None
    # 可解释性（P1 深化 Task 13）
    prompt_version: Optional[str] = None  # 提示词版本号
    data_basis: Optional[str] = None  # 使用的数据依据说明
    references: list = field(default_factory=list)  # 关联的报价行/供应商
    anomalies: list = field(default_factory=list)  # 命中的异常字段
    risk: Optional[str] = None  # 风险说明
    degraded: bool = False  # 是否降级（远程失败回退本地）
    generated_at: Optional[str] = None  # 生成时间（ISO）

    def __post_init__(self) -> None:
        if self.generated_at is None:
            self.generated_at = datetime.now(timezone.utc).isoformat()

    def as_extra(self) -> dict[str, Any]:
        """供审计日志 extra_fields 使用的统计字段。"""
        return {
            "ai_source": self.source,
            "ai_model": self.model,
            "ai_action": self.action,
            "ai_prompt_tokens": self.prompt_tokens,
            "ai_completion_tokens": self.completion_tokens,
            "ai_cost": round(self.cost, 6),
            "ai_latency_ms": self.latency_ms,
            "ai_prompt_version": self.prompt_version,
            "ai_degraded": self.degraded,
        }


class AIProvider(ABC):
    """AI Provider 抽象接口。

    每个方法接收结构化输入（与前端契约一致），返回 ProviderResult。
    本地实现返回确定性结果；远程实现调用 LLM 并校验结构。
    """

    @abstractmethod
    async def generate_inquiry_description(self, params: Any) -> ProviderResult:
        """根据询价参数生成询价说明。"""

    @abstractmethod
    async def analyze_quotation_anomalies(self, inquiry: Any, data: Any, rows: Any) -> ProviderResult:
        """分析报价异常，返回 summary/hasAnomaly/anomalyCount。"""

    @abstractmethod
    async def generate_compare_conclusion(self, inquiry: Any, data: Any, rows: Any) -> ProviderResult:
        """生成比价结论文本。"""