"""状态机：询价单状态转移合法性校验

严格定义哪些状态转换是合法的，非法转换返回 409 Conflict。
"""
from __future__ import annotations

from typing import Set, Dict

from fastapi import HTTPException, status

# 询价单状态枚举（对齐种子数据）
S_DRAFT = "DRAFT"
S_PENDING_SEND = "PENDING_SEND"
S_INQUIRING = "INQUIRING"
S_PARTIAL_QUOTED = "PARTIAL_QUOTED"
S_ALL_QUOTED = "ALL_QUOTED"
S_TIMEOUT = "TIMEOUT"
S_COMPLETED = "COMPLETED"
S_CANCELLED = "CANCELLED"
S_PENDING_APPROVAL = "PENDING_APPROVAL"
S_PENDING_CONFIRM = "PENDING_CONFIRM"
S_RETURNED = "RETURNED"  # 已驳回：可重新编辑并再次提交审批

# 报价单状态枚举
Q_DRAFT = "DRAFT"
Q_SUBMITTED = "SUBMITTED"
Q_TIMEOUT = "TIMEOUT"

# 终端状态：不再转出
TERMINAL_STATES: Set[str] = {S_COMPLETED, S_CANCELLED, S_TIMEOUT}

# 询价状态转移表：(from_status) -> set[allowed to_status]
# 说明：DRAFT 允许直接 send 到 INQUIRING（保持现有 E2E 快乐路径 DRAFT->send->INQUIRING 可用）。
INQUIRY_TRANSITIONS: Dict[str, Set[str]] = {
    S_DRAFT: {S_PENDING_SEND, S_INQUIRING, S_CANCELLED},
    S_PENDING_SEND: {S_INQUIRING, S_CANCELLED},
    S_INQUIRING: {S_PARTIAL_QUOTED, S_ALL_QUOTED, S_TIMEOUT, S_CANCELLED, S_PENDING_APPROVAL},
    S_PARTIAL_QUOTED: {S_ALL_QUOTED, S_TIMEOUT, S_CANCELLED, S_PENDING_APPROVAL},
    S_ALL_QUOTED: {S_COMPLETED, S_CANCELLED, S_PENDING_APPROVAL},
    S_PENDING_APPROVAL: {S_PENDING_CONFIRM, S_CANCELLED, S_RETURNED},
    S_PENDING_CONFIRM: {S_COMPLETED, S_CANCELLED},
    # 已驳回：可重新编辑并再次提交审批（RETURNED -> PENDING_APPROVAL），或取消
    S_RETURNED: {S_PENDING_APPROVAL, S_CANCELLED},
    # 终端状态不能转出
    S_COMPLETED: set(),
    S_CANCELLED: set(),
    S_TIMEOUT: set(),
}

# 报价状态转移表
QUOTATION_TRANSITIONS: Dict[str, Set[str]] = {
    Q_DRAFT: {Q_SUBMITTED},
    Q_SUBMITTED: {Q_DRAFT},  # 允许供应商回退修改（revised）
    Q_TIMEOUT: set(),
}


def validate_inquiry_transition(from_status: str, to_status: str) -> bool:
    """校验询价单状态转换是否合法"""
    if from_status == to_status:
        return True  # 同一状态无需转换，合法
    if from_status not in INQUIRY_TRANSITIONS:
        return False
    return to_status in INQUIRY_TRANSITIONS[from_status]


def assert_inquiry_transition(from_status: str, to_status: str) -> None:
    """断言询价状态转换合法，非法则 raise 409"""
    if not validate_inquiry_transition(from_status, to_status):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"状态转换不合法：从 {from_status} 到 {to_status}",
                "error_type": "invalid_state_transition",
                "from_status": from_status,
                "to_status": to_status,
            },
        )


def validate_quotation_transition(from_status: str, to_status: str) -> bool:
    """校验报价单状态转换是否合法"""
    if from_status == to_status:
        return True
    if from_status not in QUOTATION_TRANSITIONS:
        return False
    return to_status in QUOTATION_TRANSITIONS[from_status]


def assert_quotation_transition(from_status: str, to_status: str) -> None:
    """断言报价状态转换合法，非法则 raise 409"""
    if not validate_quotation_transition(from_status, to_status):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"报价状态转换不合法：从 {from_status} 到 {to_status}",
                "error_type": "invalid_quotation_transition",
                "from_status": from_status,
                "to_status": to_status,
            },
        )


def can_revise_submitted_quotation(inquiry_status: str) -> bool:
    """是否允许已提交报价撤回修改"""
    # 只有在 INQUIRING / PARTIAL_QUOTED / ALL_QUOTED 状态下允许修改
    return inquiry_status in (S_INQUIRING, S_PARTIAL_QUOTED, S_ALL_QUOTED)