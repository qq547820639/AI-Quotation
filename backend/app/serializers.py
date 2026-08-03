"""ORM → Pydantic 序列化辅助函数

主要处理字段名映射（snake_case → camelCase）与关系字段展开
（如 Inquiry.invited_suppliers → invitedSupplierIds）。
"""
from __future__ import annotations

from datetime import datetime
import time
import secrets
from typing import Any

from .models import (
    Inquiry, InquiryItem, InquiryLog, ApprovalNode,
    Quotation, QuotationItem, Supplier, Material, User,
    Notification, AppSettings, Attachment,
)
from .schemas import (
    InquirySchema, InquiryItemSchema, InquiryLogSchema, ApprovalNodeSchema,
    QuotationSchema, QuotationItemSchema, SupplierSchema, MaterialSchema, UserSchema,
    NotificationSchema, AppSettingsSchema, ApprovalSettings, NotificationSettings,
    AttachmentSchema,
)


# ============ 时间与 ID 生成 ============

def now_str() -> str:
    """统一时间字符串：YYYY-MM-DD HH:mm:ss"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def now_iso() -> str:
    """ISO 时间字符串（用于 Notification.time）"""
    return datetime.now().isoformat()


def gen_id(prefix: str) -> str:
    """生成业务 id：{prefix}-{毫秒时间戳}-{rand4}（避免同毫秒冲突）"""
    return f"{prefix}-{int(time.time() * 1000)}-{secrets.token_hex(2)}"


def gen_notification_id() -> str:
    """通知 id：ntf-{ms}-{rand4}"""
    return f"ntf-{int(time.time() * 1000)}-{secrets.token_hex(2)}"


# ============ 附件查询（多态） ============

def attachments_for(db, owner_type: str, owner_id: str) -> list[AttachmentSchema]:
    rows = db.query(Attachment).filter(
        Attachment.owner_type == owner_type,
        Attachment.owner_id == owner_id,
    ).all()
    return [AttachmentSchema(
        id=a.id, name=a.name, url=a.url, size=a.size, uploadTime=a.upload_time,
    ) for a in rows]


# ============ 实体序列化 ============

def user_to_schema(user: User) -> UserSchema:
    return UserSchema(
        id=user.id, name=user.name, avatar=user.avatar, role=user.role,
        department=user.department, organization=user.organization,
        permissions=user.permissions,
    )


def material_to_schema(mat: Material) -> MaterialSchema:
    return MaterialSchema(
        id=mat.id, code=mat.code, name=mat.name, category=mat.category,
        brand=mat.brand, spec=mat.spec, techParams=mat.tech_params,
        unit=mat.unit, stockQty=mat.stock_qty,
    )


def supplier_to_schema(sup: Supplier) -> SupplierSchema:
    return SupplierSchema(
        id=sup.id, code=sup.code, name=sup.name, region=sup.region,
        contact=sup.contact, phone=sup.phone, email=sup.email,
        mainCategories=sup.main_categories, level=sup.level,
        cooperationStatus=sup.cooperation_status, qualified=sup.qualified,
        historyResponseRate=sup.history_response_rate,
        historyFulfillmentRate=sup.history_fulfillment_rate,
        avgDeliveryDays=sup.avg_delivery_days,
        lastCooperateTime=sup.last_cooperate_time,
        historyCoopCount=sup.history_coop_count,
    )


def inquiry_item_to_schema(item: InquiryItem, db=None) -> InquiryItemSchema:
    return InquiryItemSchema(
        id=item.id,
        inquiryId=item.inquiry_id,
        materialId=item.material_id,
        name=item.name,
        code=item.code,
        category=item.category,
        brand=item.brand,
        spec=item.spec,
        techParams=item.tech_params,
        unit=item.unit,
        quantity=item.quantity,
        targetPrice=item.target_price,
        expectedDeliveryDate=item.expected_delivery_date,
        remark=item.remark,
        attachments=attachments_for(db, "inquiry_item", item.id) if db else [],
    )


def inquiry_log_to_schema(log: InquiryLog) -> InquiryLogSchema:
    return InquiryLogSchema(
        id=log.id,
        inquiryId=log.inquiry_id,
        time=log.time,
        operator=log.operator,
        operatorRole=log.operator_role,
        type=log.type,
        content=log.content,
        result=log.result,
    )


def approval_node_to_schema(node: ApprovalNode) -> ApprovalNodeSchema:
    return ApprovalNodeSchema(
        id=node.id,
        inquiryId=node.inquiry_id,
        nodeOrder=node.node_order,
        approverId=node.approver_id,
        approverName=node.approver_name,
        approverRole=node.approver_role,
        status=node.status,
        comment=node.comment,
        time=node.time,
    )


def quotation_item_to_schema(item: QuotationItem, db=None) -> QuotationItemSchema:
    return QuotationItemSchema(
        id=item.id,
        quotationId=item.quotation_id,
        inquiryItemId=item.inquiry_item_id,
        unitPrice=item.unit_price,
        taxRate=item.tax_rate,
        taxIncludedTotal=item.tax_included_total,
        moq=item.moq,
        deliveryDays=item.delivery_days,
        deliveryDate=item.delivery_date,
        brand=item.brand,
        warrantyMonths=item.warranty_months,
        paymentTerms=item.payment_terms,
        validUntil=item.valid_until,
        techDeviation=item.tech_deviation,
        commercialDeviation=item.commercial_deviation,
        remark=item.remark,
        attachments=attachments_for(db, "quotation_item", item.id) if db else [],
    )


def quotation_to_schema(quotation: Quotation, db=None) -> QuotationSchema:
    return QuotationSchema(
        id=quotation.id,
        inquiryId=quotation.inquiry_id,
        supplierId=quotation.supplier_id,
        supplierName=quotation.supplier_name,
        status=quotation.status,
        submittedAt=quotation.submitted_at,
        items=[quotation_item_to_schema(i, db) for i in quotation.items],
        totalAmount=quotation.total_amount,
        remark=quotation.remark,
        attachments=attachments_for(db, "quotation", quotation.id) if db else [],
        createdAt=quotation.created_at,
        updatedAt=quotation.updated_at,
    )


def inquiry_to_schema(inquiry: Inquiry, db=None) -> InquirySchema:
    """将 ORM Inquiry 转为 InquirySchema，含嵌套关系"""
    return InquirySchema(
        id=inquiry.id,
        code=inquiry.code,
        subject=inquiry.subject,
        organization=inquiry.organization,
        ownerName=inquiry.owner_name,
        ownerId=inquiry.owner_id,
        currency=inquiry.currency,
        deadline=inquiry.deadline,
        expectedDeliveryDate=inquiry.expected_delivery_date,
        deliveryAddress=inquiry.delivery_address,
        contact=inquiry.contact,
        paymentTerms=inquiry.payment_terms,
        invoiceRequirement=inquiry.invoice_requirement,
        description=inquiry.description,
        attachments=attachments_for(db, "inquiry", inquiry.id) if db else [],
        items=[inquiry_item_to_schema(i, db) for i in inquiry.items],
        invitedSupplierIds=[s.id for s in inquiry.invited_suppliers],
        quotations=[quotation_to_schema(q, db) for q in inquiry.quotations],
        logs=[inquiry_log_to_schema(l) for l in inquiry.logs],
        status=inquiry.status,
        createdById=inquiry.created_by_id,
        createdByName=inquiry.created_by_name,
        createdAt=inquiry.created_at,
        updatedAt=inquiry.updated_at,
        selectedSupplierMap=inquiry.selected_supplier_map or {},
        purchaserComments=inquiry.purchaser_comments or {},
        approvalNodes=[approval_node_to_schema(n) for n in inquiry.approval_nodes],
    )


def notification_to_schema(n: Notification) -> NotificationSchema:
    return NotificationSchema(
        id=n.id,
        inquiryId=n.inquiry_id,
        type=n.type,
        title=n.title,
        content=n.content,
        time=n.time,
        read=n.read,
    )


def settings_to_schema(s: AppSettings) -> AppSettingsSchema:
    return AppSettingsSchema(
        approval=ApprovalSettings(
            enabled=s.approval_enabled,
            amountThreshold=s.approval_amount_threshold,
            approverId=s.approval_approver_id,
        ),
        notification=NotificationSettings(
            deadlineReminder=s.notification_deadline_reminder,
            deadlineReminderHours=s.notification_deadline_reminder_hours,
            quotationSubmitted=s.notification_quotation_submitted,
            approvalResult=s.notification_approval_result,
        ),
    )
