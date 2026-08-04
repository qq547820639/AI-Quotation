"""金额计算工具：一律使用 Decimal，避免浮点误差。

- 统一 2 位小数、ROUND_HALF_UP 舍入规则。
- tax_included_total = unit_price * quantity（unit_price 为含税单价，与前端一致）。
- 服务器端总是基于 items 重算总价，不信任客户端传入的 total。
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Iterable

# 金额精度（2 位小数）
MONEY_QUANTUM = Decimal("0.01")


def to_decimal(value) -> Decimal:
    """将任意值安全转换为 Decimal（float/int/str/Decimal/None）"""
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def quantize_money(value) -> Decimal:
    """舍入到 2 位小数（ROUND_HALF_UP）"""
    return to_decimal(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def compute_item_totals(unit_price, quantity, tax_rate=0, tax_included=True) -> Decimal:
    """计算单个报价明细行的含税总额。

    tax_included_total = unit_price * quantity（unit_price 为含税单价）。
    tax_rate 保留用于展示/校验，不影响总额计算（与当前前端行为一致）。
    """
    price = to_decimal(unit_price)
    qty = to_decimal(quantity)
    # 校验税率范围（0<=rate<=1）
    rate = to_decimal(tax_rate)
    if rate < 0 or rate > 1:
        raise ValueError("税率必须在 0~1 之间")
    return quantize_money(price * qty)


def compute_quotation_total(items: Iterable) -> Decimal:
    """对报价明细列表求和，返回 2 位小数的 Decimal 总额。

    每项支持 dict（含 taxIncludedTotal/unitPrice/quantity）或带 tax_included_total 属性的对象。
    """
    total = Decimal("0")
    for item in items:
        if isinstance(item, dict):
            if "taxIncludedTotal" in item:
                total += to_decimal(item["taxIncludedTotal"])
            elif "unitPrice" in item:
                total += compute_item_totals(
                    item.get("unitPrice"),
                    item.get("quantity", 1),
                    item.get("taxRate", 0),
                )
            else:
                total += to_decimal(item.get("unit_price", 0))
        else:
            # ORM 对象（QuotationItem）
            total += to_decimal(getattr(item, "tax_included_total", None))
    return quantize_money(total)