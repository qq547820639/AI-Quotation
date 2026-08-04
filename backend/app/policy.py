"""资源级访问控制：询价单访问/编辑权限校验

- 可访问：管理员 / 所有者（owner_id） / 创建者（created_by_id） / VIEW_ALL_ORG 权限 / 同一组织
- 可编辑：仅管理员 / 所有者 / 创建者
- 创建询价单时：强制覆盖客户端传入的 organization / owner_id / owner_name / created_by_id / created_by_name，由当前用户赋值
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from .models import User, Inquiry


def can_access_inquiry(user: User, inquiry: Inquiry) -> bool:
    """判断用户是否有权限访问该询价单"""
    # 管理员总是可访问
    if user.role == "管理员":
        return True
    # 所有者或创建者可访问
    if inquiry.owner_id == user.id or inquiry.created_by_id == user.id:
        return True
    # 有 VIEW_ALL_ORG 权限 → 可访问同组织下所有
    perms = user.permissions or []
    if "VIEW_ALL_ORG" in perms and inquiry.organization == user.organization:
        return True
    # 同一组织组织级共享
    if inquiry.organization == user.organization:
        return True
    return False


def can_edit_inquiry(user: User, inquiry: Inquiry) -> bool:
    """判断用户是否有权限编辑该询价单"""
    # 管理员总是可编辑
    if user.role == "管理员":
        return True
    # 仅所有者/创建者可编辑
    if inquiry.owner_id == user.id or inquiry.created_by_id == user.id:
        return True
    return False


def require_inquiry_access(user: User, inquiry: Inquiry) -> None:
    """要求用户必须有访问权限，否则 raise 403"""
    if not can_access_inquiry(user, inquiry):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问该询价单",
        )


def require_inquiry_edit(user: User, inquiry: Inquiry) -> None:
    """要求用户必须有编辑权限，否则 raise 403"""
    if not can_edit_inquiry(user, inquiry):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权编辑该询价单",
        )


def filter_visible_inquiries(query, user: User):
    """过滤当前用户可见的询价单（加 WHERE 条件到查询）"""
    if user.role == "管理员":
        return query
    perms = user.permissions or []
    if "VIEW_ALL_ORG" in perms:
        # 同组织 + 用户自己创建的
        return query.filter(
            or_(
                Inquiry.owner_id == user.id,
                Inquiry.created_by_id == user.id,
                Inquiry.organization == user.organization,
            )
        )
    # 默认只看自己创建的和同组织
    return query.filter(
        or_(
            Inquiry.owner_id == user.id,
            Inquiry.created_by_id == user.id,
            Inquiry.organization == user.organization,
        )
    )


def set_create_ownership(inquiry_data: dict, user: User) -> None:
    """创建询价单时强制设置组织/所有者/创建者为当前用户，忽略客户端提交的值。

    注意：inquiry_data 是构造 Inquiry 前的字典，原地修改。
    """
    inquiry_data["organization"] = user.organization
    inquiry_data["owner_id"] = user.id
    inquiry_data["owner_name"] = user.name
    inquiry_data["created_by_id"] = user.id
    inquiry_data["created_by_name"] = user.name