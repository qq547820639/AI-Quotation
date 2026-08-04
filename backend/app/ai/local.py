"""本地规则 Provider（P1-9 Task 14）

等价于前端 LocalRuleBackend 的逻辑，返回确定性结果，纯文本/结构化，不调用外部 API。
用于：
- 默认本地模式（AI_PROVIDER=local）
- 远程不可用 / 超时 / 熔断时的降级回退
"""
from __future__ import annotations

from typing import Any, Optional

from .base import AIProvider, ProviderResult


def _fmt(v: Any, digits: int = 2) -> str:
    """数值格式化，保留 digits 位小数。"""
    try:
        return f"{float(v):.{digits}f}"
    except (TypeError, ValueError):
        return "0.00"


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _currency(inquiry: Any) -> str:
    return str(_get(inquiry, "currency", "CNY") or "CNY")


def _fmt_price(v: Any, currency: str) -> str:
    return f"{currency} {_fmt(v)}"


class LocalRuleProvider(AIProvider):
    """本地规则实现：与前端 LocalRuleBackend 对齐的确定性规则。"""

    async def generate_inquiry_description(self, params: Any) -> ProviderResult:
        params = params or {}
        subject = str(_get(params, "subject", "") or "询价")
        items = _get(params, "items", []) or []
        payment_terms = _get(params, "paymentTerms")
        delivery_address = _get(params, "deliveryAddress")
        expected_delivery_date = _get(params, "expectedDeliveryDate")

        lines: list[str] = []
        lines.append("【询价概览】")
        lines.append(f"现就 {subject} 进行询价，共 {len(items)} 项物料。")

        categories = list({str(i.get("category")) for i in items if i.get("category")})
        if categories:
            lines.append("")
            lines.append("【物料品类】")
            lines.append(f"涉及品类：{'、'.join(categories)}。")

        key_items = items[:3]
        if key_items:
            lines.append("")
            lines.append("【关键物料】")
            for idx, item in enumerate(key_items, 1):
                parts = [f"{item.get('name')}（{item.get('code')}）"]
                if item.get("brand"):
                    parts.append(f"品牌：{item['brand']}")
                if item.get("spec"):
                    parts.append(f"规格：{item['spec']}")
                parts.append(f"数量：{item.get('quantity')}{item.get('unit', '')}")
                if item.get("targetPrice"):
                    parts.append(f"目标价：{_fmt_price(item['targetPrice'], _currency(params))}")
                lines.append(f"{idx}. {'；'.join(parts)}。")
            if len(items) > 3:
                lines.append(f"另有 {len(items) - 3} 项物料，详见询价单明细。")

        lines.append("")
        lines.append("【交付要求】")
        if expected_delivery_date:
            lines.append(f"期望交付日期：{expected_delivery_date}。")
        if delivery_address:
            lines.append(f"交付地址：{delivery_address}。")
        lines.append("供应商须确保所供物料为原厂正品并提供质保。")

        if payment_terms:
            lines.append("")
            lines.append("【商务要求】")
            lines.append(f"付款条件：{payment_terms}。")

        lines.append("")
        lines.append("【报价要求】")
        lines.append("1. 请按询价单逐项报价，含税单价、税率、交货周期需明确。")
        lines.append("2. 请一并提供规格书、技术参数及质保承诺。")
        lines.append("3. 请在截止时间前完成报价，逾期未报视为放弃。")

        return ProviderResult(
            source="local", model="local-rule", action="inquiry-description",
            description="\n".join(lines),
        )

    async def analyze_quotation_anomalies(self, inquiry: Any, data: Any, rows: Any) -> ProviderResult:
        inquiry = inquiry or {}
        data = data or {}
        submitted_rows = _get(data, "submittedRows", []) or []
        anomaly_texts: list[str] = []

        # 1. 单价异常（偏高/偏低）
        for item in _get(inquiry, "items", []) or []:
            item_id = item.get("id")
            prices = [
                float(qi.get("unitPrice"))
                for r in submitted_rows
                for qi in (_get(r, "items", []) or [])
                if qi.get("inquiryItemId") == item_id and float(qi.get("unitPrice", 0)) > 0
            ]
            if not prices:
                continue
            avg = sum(prices) / len(prices)
            for r in submitted_rows:
                for qi in (_get(r, "items", []) or []):
                    if qi.get("inquiryItemId") != item_id:
                        continue
                    price = float(qi.get("unitPrice", 0))
                    if avg > 0 and price >= avg * 1.5:
                        anomaly_texts.append(
                            f"{item.get('name')} 供应商 {_get(_get(r, 'supplier', {}), 'name')} 报价 "
                            f"{_fmt_price(price, _currency(inquiry))}，高于均价 {_fmt_price(avg, _currency(inquiry))} 50% 以上。"
                        )
                    elif avg > 0 and price <= avg * 0.5:
                        anomaly_texts.append(
                            f"{item.get('name')} 供应商 {_get(_get(r, 'supplier', {}), 'name')} 报价 "
                            f"{_fmt_price(price, _currency(inquiry))}，低于均价 {_fmt_price(avg, _currency(inquiry))} 50% 以上。"
                        )

        # 2. 总价离散度
        totals = [float(r.get("totalAmount", 0)) for r in submitted_rows if r.get("totalAmount")]
        if len(totals) >= 3:
            mx, mn = max(totals), min(totals)
            if mn > 0:
                spread = (mx - mn) / mn * 100
                if spread > 40:
                    anomaly_texts.append(f"各供应商总价离散度达 {spread:.1f}%，需关注价格差异。")

        # 3. 交货周期异常
        deliveries = [float(r.get("avgDeliveryDays", 0)) for r in submitted_rows if float(r.get("avgDeliveryDays", 0)) > 0]
        if len(deliveries) >= 2:
            mx, mn = max(deliveries), min(deliveries)
            if mn > 0 and mx / mn > 2:
                anomaly_texts.append(f"交货周期差异较大：最快 {mn:.0f} 天，最慢 {mx:.0f} 天。")

        # 4. 技术偏离
        tech_dev = [r for r in submitted_rows if _get(r, "techDeviations", [])]
        if tech_dev:
            anomaly_texts.append(f"有 {len(tech_dev)} 家供应商存在技术偏离，需核实。")

        # 5. 超目标价
        for item in _get(inquiry, "items", []) or []:
            target = item.get("targetPrice")
            if target is None:
                continue
            item_id = item.get("id")
            prices = [
                float(qi.get("unitPrice"))
                for r in submitted_rows
                for qi in (_get(r, "items", []) or [])
                if qi.get("inquiryItemId") == item_id and float(qi.get("unitPrice", 0)) > 0
            ]
            if prices and min(prices) > float(target):
                anomaly_texts.append(
                    f"{item.get('name')} 最低报价 {_fmt_price(min(prices), _currency(inquiry))} "
                    f"仍高于目标价 {_fmt_price(target, _currency(inquiry))}。"
                )

        has_anomaly = len(anomaly_texts) > 0
        summary = (
            f"共发现 {len(anomaly_texts)} 项异常：\n" + "\n".join(f"· {t}" for t in anomaly_texts)
            if has_anomaly
            else "未发现明显异常报价。"
        )
        return ProviderResult(
            source="local", model="local-rule", action="quotation-anomalies",
            summary=summary, hasAnomaly=has_anomaly, anomalyCount=len(anomaly_texts),
        )

    async def generate_compare_conclusion(self, inquiry: Any, data: Any, rows: Any) -> ProviderResult:
        inquiry = inquiry or {}
        data = data or {}
        rows = rows or []
        submitted_rows = _get(data, "submittedRows", []) or []
        lines: list[str] = []
        lines.append("【比价结论】")
        lines.append("")

        invited = len(_get(inquiry, "invitedSupplierIds", []) or [])
        submitted_count = len(submitted_rows)
        rate = round(submitted_count / invited * 100) if invited else 0
        lines.append(f"本次共邀请 {invited} 家供应商，收到 {submitted_count} 份有效报价，回收率 {rate}%。")

        # 价格分析
        lowest_id = _get(data, "lowestTotalSupplierId")
        if lowest_id:
            r = next((x for x in rows if _get(_get(x, "supplier", {}), "id") == lowest_id), None)
            if r:
                lines.append("")
                lines.append(f"报价最低：{_get(_get(r, 'supplier', {}), 'name')}，总价 {_fmt_price(r.get('totalAmount'), _currency(inquiry))}。")
                if len(submitted_rows) >= 2:
                    sorted_r = sorted(submitted_rows, key=lambda x: float(x.get("totalAmount", 0)))
                    second = sorted_r[1]
                    diff = float(second.get("totalAmount", 0)) - float(r.get("totalAmount", 0))
                    pct = (diff / float(r.get("totalAmount", 0)) * 100) if float(r.get("totalAmount", 0)) > 0 else 0
                    lines.append(f"较次低价 {_get(_get(second, 'supplier', {}), 'name')} 低 {_fmt_price(diff, _currency(inquiry))}（{pct:.1f}%）。")

        # 综合评分
        top_id = _get(data, "topScoreSupplierId")
        if top_id:
            r = next((x for x in rows if _get(_get(x, "supplier", {}), "id") == top_id), None)
            scores = _get(data, "scores", {}) or {}
            s = scores.get(top_id)
            if r and s:
                lines.append("")
                lines.append(f"综合评分最高：{_get(_get(r, 'supplier', {}), 'name')}，总分 {_fmt(s.get('total'), 2)}（价格 {_fmt(s.get('price'), 1)} / 交货 {_fmt(s.get('delivery'), 1)} / 等级 {_fmt(s.get('level'), 1)} / 履约 {_fmt(s.get('fulfillment'), 1)}）。")

        # 交货能力
        fast_id = _get(data, "fastestDeliverySupplierId")
        if fast_id:
            r = next((x for x in rows if _get(_get(x, "supplier", {}), "id") == fast_id), None)
            if r:
                days = float(r.get("avgDeliveryDays", 0))
                lines.append("")
                lines.append(f"交货最快：{_get(_get(r, 'supplier', {}), 'name')}，平均 {days:.1f} 天。")

        # 定标建议
        lines.append("")
        lines.append("【定标建议】")
        if top_id:
            top_row = next((x for x in rows if _get(_get(x, "supplier", {}), "id") == top_id), None)
            low_row = next((x for x in rows if _get(_get(x, "supplier", {}), "id") == lowest_id), None) if lowest_id else None
            if top_row:
                if top_id == lowest_id:
                    lines.append(f"综合评分最高且价格最低，建议定标 {_get(_get(top_row, 'supplier', {}), 'name')}。")
                elif low_row:
                    lines.append("建议结合评分与价格权衡：评分最高与实际最低价不同，需按需求侧重点选择。")
        else:
            lines.append("暂无有效报价数据，无法给出定标建议。")

        lines.append("")
        lines.append("本结论由系统自动生成，仅供参考，不作为定标依据。")

        return ProviderResult(
            source="local", model="local-rule", action="compare-conclusion",
            conclusion="\n".join(lines),
        )