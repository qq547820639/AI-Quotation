"""SQLAlchemy ORM 模型，对齐前端 src/types/index.ts"""
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, JSON, ForeignKey, Table,
)
from sqlalchemy.orm import relationship
from datetime import datetime

from .database import Base


# 询价-供应商 多对多关联表
inquiry_supplier = Table(
    "inquiry_supplier",
    Base.metadata,
    Column("inquiry_id", String, ForeignKey("inquiries.id", ondelete="CASCADE"), primary_key=True),
    Column("supplier_id", String, ForeignKey("suppliers.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    avatar = Column(Text, nullable=True)
    role = Column(String, nullable=False)  # 采购人员/采购主管/管理员
    department = Column(String, nullable=False)
    organization = Column(String, nullable=False)
    permissions = Column(JSON, nullable=True)  # List[str]，空则走角色默认


class Material(Base):
    __tablename__ = "materials"
    id = Column(String, primary_key=True)
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    brand = Column(String, nullable=False)
    spec = Column(String, nullable=False)
    tech_params = Column(Text, nullable=False)
    unit = Column(String, nullable=False)
    stock_qty = Column(Integer, nullable=True)


class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(String, primary_key=True)
    code = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    region = Column(String, nullable=False)
    contact = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=False)
    main_categories = Column(JSON, nullable=False)  # List[str]
    level = Column(String, nullable=False)  # SupplierLevel
    cooperation_status = Column(String, nullable=False)  # CooperationStatus
    qualified = Column(Boolean, nullable=False)
    history_response_rate = Column(Float, nullable=False)
    history_fulfillment_rate = Column(Float, nullable=False)
    avg_delivery_days = Column(Integer, nullable=False)
    last_cooperate_time = Column(String, nullable=True)  # YYYY-MM-DD
    history_coop_count = Column(Integer, nullable=False)


class Attachment(Base):
    """多态归属附件：owner_type + owner_id"""
    __tablename__ = "attachments"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    url = Column(Text, nullable=False)
    size = Column(Integer, nullable=False)
    upload_time = Column(String, nullable=False)
    owner_type = Column(String, nullable=False)  # inquiry/inquiry_item/quotation/quotation_item
    owner_id = Column(String, nullable=False)


class Inquiry(Base):
    __tablename__ = "inquiries"
    id = Column(String, primary_key=True)
    code = Column(String, unique=True, nullable=False, index=True)
    subject = Column(String, nullable=False)
    organization = Column(String, nullable=False)
    owner_name = Column(String, nullable=False)
    owner_id = Column(String, nullable=False)
    currency = Column(String, nullable=False)  # CNY/USD/EUR
    deadline = Column(String, nullable=False)  # YYYY-MM-DD HH:mm:ss
    expected_delivery_date = Column(String, nullable=True)
    delivery_address = Column(Text, nullable=False)
    contact = Column(String, nullable=False)
    payment_terms = Column(String, nullable=False)
    invoice_requirement = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False)  # InquiryStatus
    created_by_id = Column(String, nullable=False)
    created_by_name = Column(String, nullable=False)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
    selected_supplier_map = Column(JSON, nullable=False, default=dict)  # {itemId: supplierId}
    purchaser_comments = Column(JSON, nullable=False, default=dict)  # {supplierId: comment}

    items = relationship("InquiryItem", back_populates="inquiry", cascade="all, delete-orphan", order_by="InquiryItem.id")
    logs = relationship("InquiryLog", back_populates="inquiry", cascade="all, delete-orphan", order_by="InquiryLog.time")
    approval_nodes = relationship("ApprovalNode", back_populates="inquiry", cascade="all, delete-orphan", order_by="ApprovalNode.node_order")
    quotations = relationship("Quotation", back_populates="inquiry", cascade="all, delete-orphan")
    invited_suppliers = relationship("Supplier", secondary=inquiry_supplier)


class InquiryItem(Base):
    __tablename__ = "inquiry_items"
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False)
    category = Column(String, nullable=False)
    brand = Column(String, nullable=False)
    spec = Column(String, nullable=False)
    tech_params = Column(Text, nullable=False)
    unit = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    target_price = Column(Float, nullable=True)
    expected_delivery_date = Column(String, nullable=True)
    remark = Column(Text, nullable=True)

    inquiry = relationship("Inquiry", back_populates="items")


class InquiryLog(Base):
    __tablename__ = "inquiry_logs"
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    time = Column(String, nullable=False)
    operator = Column(String, nullable=False)
    operator_role = Column(String, nullable=True)
    type = Column(String, nullable=False)  # LogType
    content = Column(Text, nullable=False)
    result = Column(String, nullable=True)

    inquiry = relationship("Inquiry", back_populates="logs")


class ApprovalNode(Base):
    __tablename__ = "approval_nodes"
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    node_order = Column(Integer, nullable=False)
    approver_id = Column(String, nullable=False)
    approver_name = Column(String, nullable=False)
    approver_role = Column(String, nullable=False)
    status = Column(String, nullable=False)  # ApprovalNodeStatus
    comment = Column(Text, nullable=True)
    time = Column(String, nullable=True)

    inquiry = relationship("Inquiry", back_populates="approval_nodes")


class Quotation(Base):
    __tablename__ = "quotations"
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = Column(String, nullable=False)
    supplier_name = Column(String, nullable=False)
    status = Column(String, nullable=False)  # QuotationStatus
    submitted_at = Column(String, nullable=True)
    total_amount = Column(Float, nullable=False)
    remark = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    inquiry = relationship("Inquiry", back_populates="quotations")
    items = relationship("QuotationItem", back_populates="quotation", cascade="all, delete-orphan")


class QuotationItem(Base):
    __tablename__ = "quotation_items"
    id = Column(String, primary_key=True)
    quotation_id = Column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False, index=True)
    inquiry_item_id = Column(String, nullable=False)
    unit_price = Column(Float, nullable=False)
    tax_rate = Column(Float, nullable=False)
    tax_included_total = Column(Float, nullable=False)
    moq = Column(Integer, nullable=True)
    delivery_days = Column(Integer, nullable=False)
    delivery_date = Column(String, nullable=True)
    brand = Column(String, nullable=True)
    warranty_months = Column(Integer, nullable=True)
    payment_terms = Column(String, nullable=True)
    valid_until = Column(String, nullable=True)
    tech_deviation = Column(Text, nullable=True)
    commercial_deviation = Column(Text, nullable=True)
    remark = Column(Text, nullable=True)

    quotation = relationship("Quotation", back_populates="items")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, nullable=True)
    type = Column(String, nullable=False)  # NotificationType
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    time = Column(String, nullable=False)  # ISO 字符串
    read = Column(Boolean, nullable=False, default=False)


class AppSettings(Base):
    """单行配置表（id 固定为 1）"""
    __tablename__ = "app_settings"
    id = Column(Integer, primary_key=True, default=1)
    # approval
    approval_enabled = Column(Boolean, nullable=False, default=True)
    approval_amount_threshold = Column(Float, nullable=False, default=50000)
    approval_approver_id = Column(String, nullable=False, default="u-2")
    # notification
    notification_deadline_reminder = Column(Boolean, nullable=False, default=True)
    notification_deadline_reminder_hours = Column(Integer, nullable=False, default=24)
    notification_quotation_submitted = Column(Boolean, nullable=False, default=True)
    notification_approval_result = Column(Boolean, nullable=False, default=True)


class Token(Base):
    """简单 token 表：登录写入，登出删除"""
    __tablename__ = "tokens"
    token = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
