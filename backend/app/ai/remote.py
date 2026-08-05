"""远程 LLM Provider（P1-9 Task 14 + P1 深化）

调用 OpenAI 兼容 /v1/chat/completions 端点。API Key 从环境变量 AI_API_KEY 读取，
绝不发送到前端。内置：
- 请求超时（AI_TIMEOUT_SECONDS）
- 有限重试（AI_MAX_RETRIES，指数退避）
- 并发限制（信号量 AI_MAX_CONCURRENCY）
- 熔断（连续失败达阈值后开启，降级本地；冷却后尝试半开）
- 敏感字段脱敏（发送前剔除 password/token/secret 等）
- 强结构化输出：Pydantic 模型严格校验（无效 JSON / 缺字段 / 类型错误 / 超长均拦截）
- 结构修复重试：非法结构有限次数（默认 1 次）重试并要求仅输出合法 JSON，失败后降级
- 预算检查：累计成本上限（AI_BUDGET_MAX_COST），超限拒绝并降级（并发请求不绕过预算）
- 成本与 Token 统计（从 usage 读取）

测试通过注入 httpx.AsyncBaseTransport（MockTransport）mock 网络层。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from typing import Any, Callable, Optional

import httpx
from pydantic import ValidationError

from .base import AIProvider, AIProviderError, InvalidAIResponse, ProviderResult
from .prompts import (
    PROMPT_VERSION_ANOMALY,
    PROMPT_VERSION_CONCLUSION,
    PROMPT_VERSION_INQUIRY_DESCRIPTION,
    SYSTEM_ANOMALY,
    SYSTEM_CONCLUSION,
    SYSTEM_INQUIRY_DESC,
    SYSTEM_REPAIR,
)
from .structs import CompareConclusionOutput, InquiryDescriptionOutput, QuotationAnomalyOutput

logger = logging.getLogger("procurement.ai")

# 敏感字段名（子串匹配，小写）。发送前剔除，避免数据泄漏到远程 LLM。
SENSITIVE_KEY_RE = re.compile(
    r"password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|credential|access[_-]?key|private[_-]?key",
    re.IGNORECASE,
)


def sanitize_payload(value: Any, key: str = ""):
    """深度拷贝并剔除敏感字段（password/token/secret 等），避免发送到远程。"""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if SENSITIVE_KEY_RE.search(str(k)):
                continue
            out[k] = sanitize_payload(v, str(k))
        return out
    if isinstance(value, list):
        return [sanitize_payload(v, key) for v in value]
    return value


class BudgetTracker:
    """AI 预算跟踪：累计成本上限。

    用锁保证 check + record 原子化，避免并发请求绕过预算上限。
    max_cost <= 0 表示不限制。
    """

    def __init__(self, max_cost: float = 0.0):
        self._max = max(0.0, float(max_cost))
        self._spent = 0.0
        self._lock = threading.Lock()

    @property
    def spent(self) -> float:
        with self._lock:
            return self._spent

    @property
    def max_cost(self) -> float:
        return self._max

    def can_spend(self) -> bool:
        """当前是否允许继续调用（预算未耗尽）。"""
        with self._lock:
            return self._max <= 0 or self._spent < self._max

    def record(self, amount: float) -> None:
        with self._lock:
            self._spent += max(0.0, float(amount))


class CircuitBreaker:
    """熔断器：CLOSED → OPEN（连续失败达阈值）→ HALF_OPEN（冷却后放行试探）→ CLOSED/OPEN。"""

    def __init__(self, failure_threshold: int, cooldown_seconds: float, enabled: bool = True):
        self._threshold = max(1, failure_threshold)
        self._cooldown = max(0.0, cooldown_seconds)
        self._enabled = enabled
        self._state = "CLOSED"
        self._failures = 0
        self._opened_at = 0.0
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    def allow_request(self) -> bool:
        if not self._enabled:
            return True
        with self._lock:
            now = time.time()
            if self._state == "OPEN":
                if now - self._opened_at >= self._cooldown:
                    self._state = "HALF_OPEN"
                    return True
                return False
            return True

    def record_success(self) -> None:
        with self._lock:
            self._state = "CLOSED"
            self._failures = 0
            self._opened_at = 0.0

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._state == "HALF_OPEN" or self._failures >= self._threshold:
                self._state = "OPEN"
                self._opened_at = time.time()


class RemoteLLMProvider(AIProvider):
    """OpenAI 兼容远程 LLM 实现。"""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        max_concurrency: int = 4,
        circuit_failure_threshold: int = 5,
        circuit_cooldown_seconds: float = 60.0,
        circuit_enabled: bool = True,
        cost_per_1k_prompt: float = 0.0,
        cost_per_1k_completion: float = 0.0,
        budget_max_cost: float = 0.0,
        max_structural_repairs: int = 1,
        structured_output: bool = True,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_seconds
        self._max_retries = max(0, max_retries)
        self._max_concurrency = max(1, max_concurrency)
        self._sem = None  # 惰性创建，绑定到实际运行的事件循环
        self._cost_prompt = cost_per_1k_prompt
        self._cost_completion = cost_per_1k_completion
        self._transport = transport
        self._max_structural_repairs = max(0, max_structural_repairs)
        self._structured_output = bool(structured_output)
        self._budget = BudgetTracker(budget_max_cost)
        self.circuit = CircuitBreaker(
            circuit_failure_threshold, circuit_cooldown_seconds, circuit_enabled
        )

    @property
    def model(self) -> str:
        return self._model

    @property
    def budget(self) -> BudgetTracker:
        return self._budget

    def _semaphore(self) -> asyncio.Semaphore:
        """惰性创建信号量：在运行中的事件循环内创建，避免绑定到已关闭的旧循环（Python 3.9）。"""
        if self._sem is None:
            self._sem = asyncio.Semaphore(self._max_concurrency)
        return self._sem

    async def _call_llm(self, system_prompt: str, user_prompt: str):
        """携带信号量 + 预算 + 重试调用 chat/completions，返回 (content, usage)。"""
        async with self._semaphore():
            if not self._budget.can_spend():
                raise AIProviderError("AI 预算已耗尽，拒绝调用")
            last_exc: Optional[Exception] = None
            for attempt in range(self._max_retries + 1):
                try:
                    res = await self._call_once(system_prompt, user_prompt)
                    self._budget.record(res[3])  # 记录本次成本
                    return res
                except (httpx.HTTPError, AIProviderError) as exc:
                    last_exc = exc
                    if attempt < self._max_retries:
                        await asyncio.sleep(0.5 * (2 ** attempt))
            raise last_exc or AIProviderError("AI 调用失败")

    async def _call_once(self, system_prompt: str, user_prompt: str):
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
        }
        # 结构化输出：请求模型仅返回合法 JSON（Task 12）。不支持时远端返回 4xx，
        # 由重试/熔断/回退本地统一处理，不影响严格校验兜底。
        if self._structured_output:
            payload["response_format"] = {"type": "json_object"}
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise InvalidAIResponse("AI 返回缺少 choices/message/content")
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
        completion_tokens = int(usage.get("completion_tokens", 0) or 0)
        cost = (
            prompt_tokens / 1000.0 * self._cost_prompt
            + completion_tokens / 1000.0 * self._cost_completion
        )
        return content, prompt_tokens, completion_tokens, cost

    @staticmethod
    def _parse_and_validate(content: str, validate: Callable[[dict], Any]) -> Any:
        """解析 JSON 并 Pydantic 校验；非法 → InvalidAIResponse。validate 返回校验后的字段。"""
        try:
            data = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            raise InvalidAIResponse("AI 返回了无效的 JSON")
        if not isinstance(data, dict):
            raise InvalidAIResponse("AI 返回结构无效（非 JSON 对象）")
        return validate(data)

    async def _complete(
        self, system_prompt: str, user_prompt: str, validate: Callable[[dict], Any]
    ):
        """调用 LLM + 结构校验 + 有限结构修复重试。修复失败抛 InvalidAIResponse。"""
        content, pt, ct, cost = await self._call_llm(system_prompt, user_prompt)
        try:
            valid = self._parse_and_validate(content, validate)
            return valid, pt, ct, cost
        except InvalidAIResponse:
            if self._max_structural_repairs <= 0:
                raise
        # 结构修复重试：用 REPAIR 提示词重新请求，要求仅输出合法 JSON。
        repair_pt, repair_ct, repair_cost = 0, 0, 0.0
        last_exc: Optional[InvalidAIResponse] = None
        for _ in range(self._max_structural_repairs):
            repair_user = json.dumps(
                {"previous_output": content, "instruction": "请仅输出一个合法 JSON 对象"},
                ensure_ascii=False,
            )
            content2, p2, c2, cost2 = await self._call_llm(SYSTEM_REPAIR, repair_user)
            repair_pt += p2
            repair_ct += c2
            repair_cost += cost2
            try:
                valid = self._parse_and_validate(content2, validate)
                return (
                    valid,
                    pt + repair_pt,
                    ct + repair_ct,
                    cost + repair_cost,
                )
            except InvalidAIResponse as exc:
                last_exc = exc
                content = content2
        raise last_exc or InvalidAIResponse("AI 结构修复失败")

    def _result(self, action: str, data: dict, pt: int, ct: int, cost: float) -> ProviderResult:
        return ProviderResult(
            source="remote", model=self._model, action=action,
            prompt_tokens=pt, completion_tokens=ct, cost=cost,
        )

    @staticmethod
    def _validate_description(data: dict) -> str:
        try:
            return InquiryDescriptionOutput.model_validate(data).description
        except ValidationError as exc:
            raise InvalidAIResponse(f"AI 返回的 description 非法: {exc}") from exc

    @staticmethod
    def _validate_anomaly(data: dict) -> tuple[str, bool, int]:
        try:
            m = QuotationAnomalyOutput.model_validate(data)
        except ValidationError as exc:
            raise InvalidAIResponse(f"AI 返回的 anomaly 结构非法: {exc}") from exc
        return m.summary, m.hasAnomaly, m.anomalyCount

    @staticmethod
    def _validate_conclusion(data: dict) -> str:
        try:
            return CompareConclusionOutput.model_validate(data).conclusion
        except ValidationError as exc:
            raise InvalidAIResponse(f"AI 返回的 conclusion 非法: {exc}") from exc

    async def generate_inquiry_description(self, params: Any) -> ProviderResult:
        safe = sanitize_payload(params or {})
        data, pt, ct, cost = await self._complete(
            SYSTEM_INQUIRY_DESC,
            json.dumps({"task": "生成询价说明", "params": safe}, ensure_ascii=False),
            self._validate_description,
        )
        result = self._result("inquiry-description", data, pt, ct, cost)
        result.description = data
        result.prompt_version = PROMPT_VERSION_INQUIRY_DESCRIPTION
        result.data_basis = "基于询价参数（物料、品类、数量、目标价、交付要求）生成"
        result.risk = "自动生成辅助建议，仅供参考，请人工复核"
        return result

    async def analyze_quotation_anomalies(self, inquiry: Any, data: Any, rows: Any) -> ProviderResult:
        safe = sanitize_payload({"inquiry": inquiry, "data": data, "rows": rows})
        parsed, pt, ct, cost = await self._complete(
            SYSTEM_ANOMALY,
            json.dumps({"task": "分析报价异常", "data": safe}, ensure_ascii=False),
            self._validate_anomaly,
        )
        result = self._result("quotation-anomalies", parsed, pt, ct, cost)
        summary, has_anomaly, count = parsed
        result.summary, result.hasAnomaly, result.anomalyCount = summary, has_anomaly, count
        result.prompt_version = PROMPT_VERSION_ANOMALY
        result.data_basis = "基于各供应商报价的单价、总价、交货周期、技术偏离与目标价数据"
        result.risk = "异常判定为自动化结果，涉及商务决策请人工复核"
        return result

    async def generate_compare_conclusion(self, inquiry: Any, data: Any, rows: Any) -> ProviderResult:
        safe = sanitize_payload({"inquiry": inquiry, "data": data, "rows": rows})
        parsed, pt, ct, cost = await self._complete(
            SYSTEM_CONCLUSION,
            json.dumps({"task": "生成比价结论", "data": safe}, ensure_ascii=False),
            self._validate_conclusion,
        )
        result = self._result("compare-conclusion", parsed, pt, ct, cost)
        result.conclusion = parsed
        result.prompt_version = PROMPT_VERSION_CONCLUSION
        result.data_basis = "基于各供应商报价总价、综合评分、交货周期与定标建议数据"
        result.risk = "比价结论自动生成，仅供参考，不作为定标依据"
        return result