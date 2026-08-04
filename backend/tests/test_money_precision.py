"""P2-14 Task 19：金额与税额精度补充测试

test_portal_and_security.py 已覆盖基础金额工具（rounding / item total / 税率校验 / 空与极大值）。
本文件补充税额含税总额、多明细求和、Decimal 无浮点误差的真实断言。
"""
from decimal import Decimal

from app.money import compute_item_totals, compute_quotation_total


def test_tax_included_total_precision():
    """不同税率的含税总额：2 位小数、ROUND_HALF_UP"""
    assert compute_item_totals("0.1", 3, 0.13) == Decimal("0.30")
    assert compute_item_totals("0.07", 3, 0.13) == Decimal("0.21")
    assert compute_item_totals("1234.567", 10, 0.13) == Decimal("12345.67")
    # 零税率不影响金额（单价即含税总额）
    assert compute_item_totals("100.005", 1, 0) == Decimal("100.01")


def test_quotation_total_sums_multiple_tax_lines():
    """多明细含税总额求和"""
    items = [
        {"unitPrice": "10.50", "quantity": 2, "taxRate": 0.13},
        {"unitPrice": "99.99", "quantity": 1, "taxRate": 0.13},
    ]
    assert compute_quotation_total(items) == Decimal("120.99")


def test_no_float_point_error():
    """0.1 + 0.2 的浮点经典陷阱，Decimal 下应为 0.30 而非 0.30000000000000004"""
    assert compute_quotation_total(
        [{"unitPrice": "0.1", "quantity": 1}, {"unitPrice": "0.2", "quantity": 1}]
    ) == Decimal("0.30")
    assert compute_quotation_total(
        [{"unitPrice": "0.1", "quantity": 1}, {"unitPrice": "0.2", "quantity": 1}]
    ) != Decimal("0.30000000000000004")


def test_high_tax_rate_rounding_preserved():
    """高税率仅作展示校验，不影响总额；合法税率仍正确舍入"""
    assert compute_item_totals("0.005", 1, 0.06) == Decimal("0.01")
    assert compute_item_totals("2.675", 1, 0.13) == Decimal("2.68")