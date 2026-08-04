"""AI 服务包（P1-9 Task 14）

- 工厂：根据配置选择 Provider（local / remote），未配置 API Key 时回退 local。
- execute()：统一执行入口，处理远程回退（熔断/超时/异常 → 本地规则）与审计日志。
- 对外提供 get_provider / set_provider / reset_provider（测试用）与 DISCLAIMER。

前端契约保持兼容：
- POST /api/ai/inquiry-description → {description, source, disclaimer}
- POST /api/ai/quotation-anomalies → {summary, hasAnomaly, anomalyCount, source, disclaimer}
- POST /api/ai/compare-conclusion → {conclusion, source, disclaimer}
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

from ..config import (
    AI_API_KEY, AI_BASE_URL, AI_CIRCUIT_COOLDOWN_SECONDS, AI_CIRCUIT_ENABLED,
    AI_CIRCUIT_FAILURE_THRESHOLD, AI_COST_PER_1K_COMPLETION_TOKENS,
    AI_COST_PER_1K_PROMPT_TOKENS, AI_MAX_CONCURRENCY, AI_MAX_RETRIES,
    AI_MODEL, AI_PROVIDER, AI_TIMEOUT_SECONDS,
)
from .base import AIProvider, AIProviderError, ProviderResult
from .local import LocalRuleProvider
from .remote import RemoteLLMProvider

logger = logging.getLogger("procurement.ai")
audit_logger = logging.getLogger("procurement.audit")

# 所有 AI 输出附带免责声明：仅作辅助建议，不作为定标依据。
DISCLAIMER = "AI 生成辅助建议，仅供参考，不作为定标依据"

# 测试可注入的 Provider 覆盖（None 表示用工厂默认）
_provider_override: Optional[AIProvider] = None
_provider_cache: Optional[AIProvider] = None


def _build_provider() -> AIProvider:
    """工厂：AI_PROVIDER=remote 且配置了 AI_API_KEY 时使用远程，否则本地规则。"""
    mode = AI_PROVIDER
    if mode == "remote" and AI_API_KEY:
        return RemoteLLMProvider(
            api_key=AI_API_KEY,
            base_url=AI_BASE_URL,
            model=AI_MODEL,
            timeout_seconds=AI_TIMEOUT_SECONDS,
            max_retries=AI_MAX_RETRIES,
            max_concurrency=AI_MAX_CONCURRENCY,
            circuit_failure_threshold=AI_CIRCUIT_FAILURE_THRESHOLD,
            circuit_cooldown_seconds=AI_CIRCUIT_COOLDOWN_SECONDS,
            circuit_enabled=AI_CIRCUIT_ENABLED,
            cost_per_1k_prompt=AI_COST_PER_1K_PROMPT_TOKENS,
            cost_per_1k_completion=AI_COST_PER_1K_COMPLETION_TOKENS,
        )
    return LocalRuleProvider()


def get_provider() -> AIProvider:
    global _provider_cache
    if _provider_override is not None:
        return _provider_override
    if _provider_cache is None:
        _provider_cache = _build_provider()
    return _provider_cache


def set_provider(provider: AIProvider) -> None:
    """测试注入 Provider。"""
    global _provider_override
    _provider_override = provider


def reset_provider() -> None:
    """清空测试注入，回到默认工厂。"""
    global _provider_override
    _provider_override = None


def _audit(action: str, user_id: str, ok: bool, result: ProviderResult, note: str = "") -> None:
    extra = {
        "extra_fields": {
            "ai_action": action,
            "ai_user_id": user_id,
            "ai_ok": ok,
            "ai_note": note,
            **result.as_extra(),
        }
    }
    if ok:
        audit_logger.info("ai_call %s", action, extra=extra)
    else:
        audit_logger.warning("ai_fallback %s note=%s", action, note, extra=extra)


async def _call_local(action: str, args: dict) -> ProviderResult:
    provider = LocalRuleProvider()
    if action == "inquiry-description":
        return await provider.generate_inquiry_description(args.get("params"))
    if action == "quotation-anomalies":
        return await provider.analyze_quotation_anomalies(
            args.get("inquiry"), args.get("data"), args.get("rows")
        )
    return await provider.generate_compare_conclusion(
        args.get("inquiry"), args.get("data"), args.get("rows")
    )


async def _call_remote(provider: AIProvider, action: str, args: dict) -> ProviderResult:
    if action == "inquiry-description":
        return await provider.generate_inquiry_description(args.get("params"))
    if action == "quotation-anomalies":
        return await provider.analyze_quotation_anomalies(
            args.get("inquiry"), args.get("data"), args.get("rows")
        )
    return await provider.generate_compare_conclusion(
        args.get("inquiry"), args.get("data"), args.get("rows")
    )


async def execute(action: str, args: dict, user_id: str) -> ProviderResult:
    """统一执行入口：远程优先，失败/熔断回退本地规则，并记录审计日志。"""
    start = time.time()
    provider = get_provider()

    if isinstance(provider, RemoteLLMProvider):
        if not provider.circuit.allow_request():
            result = await _call_local(action, args)
            result.latency_ms = int((time.time() - start) * 1000)
            _audit(action, user_id, ok=False, result=result, note="circuit_open_fallback")
            return result
        try:
            result = await _call_remote(provider, action, args)
            provider.circuit.record_success()
            result.latency_ms = int((time.time() - start) * 1000)
            _audit(action, user_id, ok=True, result=result)
            return result
        except Exception as exc:  # noqa: BLE001 - 触发回退本地
            provider.circuit.record_failure()
            result = await _call_local(action, args)
            result.latency_ms = int((time.time() - start) * 1000)
            _audit(action, user_id, ok=False, result=result, note=f"remote_fallback:{type(exc).__name__}")
            return result

    result = await _call_local(action, args)
    result.latency_ms = int((time.time() - start) * 1000)
    _audit(action, user_id, ok=True, result=result)
    return result


# 便于外部直接创建本地 Provider（测试/降级）
def make_local_provider() -> LocalRuleProvider:
    return LocalRuleProvider()