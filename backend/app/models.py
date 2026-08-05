"""SQLAlchemy ORM 模型，对齐前端 src/types/index.ts"""
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, JSON, ForeignKey, Table,
    Numeric, UniqueConstraint, CheckConstraint, Index,
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone

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
    password_hash = Column(String, nullable=True)  # bcrypt 哈希；兼容旧库可空，seed 时写入


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
    history_response_rate = Column(Numeric(6, 4), nullable=False)
    history_fulfillment_rate = Column(Numeric(6, 4), nullable=False)
    avg_delivery_days = Column(Integer, nullable=False)
    last_cooperate_time = Column(String, nullable=True)  # YYYY-MM-DD
    history_coop_count = Column(Integer, nullable=False)


class Attachment(Base):
    """多态归属附件：owner_type + owner_id"""
    __tablename__ = "attachments"
    __table_args__ = (
        Index("ix_attachments_owner", "owner_type", "owner_id"),
    )
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    url = Column(Text, nullable=False)
    size = Column(Integer, nullable=False)
    upload_time = Column(String, nullable=False)
    owner_type = Column(String, nullable=False)  # inquiry/inquiry_item/quotation/quotation_item
    owner_id = Column(String, nullable=False)
    scan_status = Column(String, nullable=False, default="pending")  # pending/scanned/clean/infected/error
    scan_result = Column(Text, nullable=True)


class Inquiry(Base):
    __tablename__ = "inquiries"
    __table_args__ = (
        # Task 7：高频查询索引（组织可见性过滤 / 状态筛选 / 按负责人查询）
        Index("ix_inquiries_organization", "organization"),
        Index("ix_inquiries_status", "status"),
        Index("ix_inquiries_owner_id", "owner_id"),
        # Task 22：搜索(关键词 LIKE) / 创建时间范围过滤使用的高频列索引
        Index("ix_inquiries_subject", "subject"),
        Index("ix_inquiries_owner_name", "owner_name"),
        Index("ix_inquiries_created_at", "created_at"),
    )
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
    version = Column(Integer, nullable=False, default=1)  # 乐观锁版本号（Task 6）

    items = relationship("InquiryItem", back_populates="inquiry", cascade="all, delete-orphan", order_by="InquiryItem.id")
    logs = relationship("InquiryLog", back_populates="inquiry", cascade="all, delete-orphan", order_by="InquiryLog.time")
    approval_nodes = relationship("ApprovalNode", back_populates="inquiry", cascade="all, delete-orphan", order_by="ApprovalNode.node_order")
    quotations = relationship("Quotation", back_populates="inquiry", cascade="all, delete-orphan")
    invited_suppliers = relationship("Supplier", secondary=inquiry_supplier)


class InquiryItem(Base):
    __tablename__ = "inquiry_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_inquiry_items_quantity_positive"),
    )
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
    target_price = Column(Numeric(18, 2), nullable=True)
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
    __table_args__ = (
        UniqueConstraint("inquiry_id", "node_order", name="uq_approval_nodes_inquiry_id_node_order"),
    )
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
    __table_args__ = (
        UniqueConstraint("inquiry_id", "supplier_id", name="uq_quotations_inquiry_id_supplier_id"),
        Index("ix_quotations_status", "status"),
        # Task 22：按供应商/创建时间筛选与稳定排序使用的高频列索引
        Index("ix_quotations_supplier_id", "supplier_id"),
        Index("ix_quotations_created_at", "created_at"),
    )
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=False)
    supplier_name = Column(String, nullable=False)
    status = Column(String, nullable=False)  # QuotationStatus
    submitted_at = Column(String, nullable=True)
    total_amount = Column(Numeric(18, 2), nullable=False)
    receipt_code = Column(String, nullable=True, index=True)
    remark = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    inquiry = relationship("Inquiry", back_populates="quotations")
    items = relationship("QuotationItem", back_populates="quotation", cascade="all, delete-orphan")


class QuotationItem(Base):
    __tablename__ = "quotation_items"
    __table_args__ = (
        CheckConstraint("unit_price >= 0", name="ck_quotation_items_unit_price_nonneg"),
        CheckConstraint("delivery_days >= 0", name="ck_quotation_items_delivery_days_nonneg"),
        CheckConstraint("tax_rate >= 0 AND tax_rate <= 1", name="ck_quotation_items_tax_rate_range"),
    )
    id = Column(String, primary_key=True)
    quotation_id = Column(String, ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False, index=True)
    inquiry_item_id = Column(String, ForeignKey("inquiry_items.id"), nullable=False)
    unit_price = Column(Numeric(18, 2), nullable=False)
    tax_rate = Column(Numeric(10, 4), nullable=False)
    tax_included_total = Column(Numeric(18, 2), nullable=False)
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
    __table_args__ = (
        Index("ix_notifications_user_id", "user_id"),
    )
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
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
    approval_amount_threshold = Column(Numeric(18, 2), nullable=False, default=50000)
    approval_approver_id = Column(String, nullable=False, default="u-2")
    # notification
    notification_deadline_reminder = Column(Boolean, nullable=False, default=True)
    notification_deadline_reminder_hours = Column(Integer, nullable=False, default=24)
    notification_quotation_submitted = Column(Boolean, nullable=False, default=True)
    notification_approval_result = Column(Boolean, nullable=False, default=True)


class UserNotificationPreference(Base):
    """用户级通知偏好（P1-8 Task 12）

    AppSettings 为全局单行配置，用户个人偏好单独建表，便于按用户读写。
    """
    __tablename__ = "user_notification_preferences"
    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    deadline_reminder = Column(Boolean, nullable=False, default=True)
    deadline_reminder_hours = Column(Integer, nullable=False, default=24)
    quotation_submitted = Column(Boolean, nullable=False, default=True)
    approval_result = Column(Boolean, nullable=False, default=True)
    inquiry_sent = Column(Boolean, nullable=False, default=True)


class Session(Base):
    """登录会话（P1-6）：每个会话管理一个可轮换的 Refresh Token。

    - refresh_token 只存 SHA-256 哈希（refresh_token_hash），绝不存明文。
    - 每个会话拥有一个会话 id（供会话列表 / 单会话撤销）。
    - revoked_at 非空表示会话已撤销；revoked_reason 说明撤销原因（logout / logout_all / refresh_reuse）。
    """
    __tablename__ = "sessions"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    refresh_token_hash = Column(String, unique=True, index=True, nullable=False)
    device = Column(String, nullable=True)  # 设备/UA 标识
    family_id = Column(String, nullable=False, index=True)  # 会话族：轮换衍生会话共享，用于重用检测批量撤销
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)  # Refresh Token 过期时间
    revoked_at = Column(DateTime, nullable=True)
    revoked_reason = Column(String, nullable=True)
    last_refresh_at = Column(DateTime, nullable=True)


class Token(Base):
    """Access Token 记录：只存 SHA-256 哈希（token_hash），绝不存明文。

    登录写入，登出撤销，过期清理。session_id 关联所属会话，便于随会话一起撤销。
    """
    __tablename__ = "tokens"
    token_hash = Column(String, primary_key=True)  # access token 的 sha256
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)  # 明确过期时间


class SupplierInvitation(Base):
    """供应商邀请：一个询价单对一个供应商仅一条有效邀请。

    仅存储 token 的 SHA-256 哈希（token_hash），绝不存储原始 token。
    status 取值：pending / sent / opened / revoked / submitted / expired。
    """
    __tablename__ = "supplier_invitations"
    __table_args__ = (
        UniqueConstraint("inquiry_id", "supplier_id", name="uq_supplier_invitations_inquiry_supplier"),
    )
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=False, index=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="pending")
    delivery_status = Column(String, nullable=False, default="pending")  # P1-8 Task 12: pending/sent/delivered/failed/bounced/opened/submitted
    delivery_error = Column(Text, nullable=True)  # 最近一次投递失败原因
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    sent_at = Column(DateTime(timezone=True), nullable=True)
    first_opened_at = Column(DateTime(timezone=True), nullable=True)
    last_opened_at = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)

    inquiry = relationship("Inquiry")
    supplier = relationship("Supplier")


class TaskRecord(Base):
    """持久化任务状态（P1 可靠性）

    每次 Celery 任务执行（含重试）都会更新对应记录；任务最终失败时写入
    status=permanent_failure，可通过 POST /api/tasks/{id}/retry 重置重投。
    idempotency_key 唯一，保证同一业务事件不重复执行。
    """
    __tablename__ = "task_records"
    __table_args__ = (
        Index("ix_task_records_status", "status"),
    )
    id = Column(String, primary_key=True)
    task_id = Column(String, nullable=True)  # Celery task id（可空）
    task_name = Column(String, nullable=False)
    idempotency_key = Column(String, unique=True, index=True, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending/running/succeeded/failed/permanent_failure
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    business_event_id = Column(String, nullable=True, index=True)  # 关联 outbox_events.id
    payload = Column(JSON, nullable=True)


class OutboxEvent(Base):
    """事务 outbox（P1 可靠性）

    业务数据提交时（或紧随其后）写入一条 pending 事件，随后投递到 Celery 并标记
    dispatched。若「DB 已提交但任务未入队」（进程重启/Redis 短暂断开），dispatcher
    可扫描 pending 事件补齐投递，保证不丢失。idempotency_key 唯一，重复入队被跳过。
    """
    __tablename__ = "outbox_events"
    __table_args__ = (
        Index("ix_outbox_events_status", "status"),
    )
    id = Column(String, primary_key=True)
    event_type = Column(String, nullable=False)
    aggregate_id = Column(String, nullable=True, index=True)
    payload = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending/dispatched/failed
    idempotency_key = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    dispatched_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)


class AIUsage(Base):
    """AI 服务调用统计（P1-9 Task 14 + P1 深化 Task 12/13）

    每次 AI 调用记录一条：action / provider / model / tokens / 估算成本 / 归属用户 /
    提示词版本（prompt_version）/ 是否降级（degraded）。
    用于成本与 Token 统计，可通过 GET /api/ai/stats 聚合查询。
    """
    __tablename__ = "ai_usage"
    id = Column(String, primary_key=True)
    action = Column(String, nullable=False, index=True)  # inquiry-description / quotation-anomalies / compare-conclusion
    provider = Column(String, nullable=False)  # local / remote
    model = Column(String, nullable=False)  # 实际使用的模型名（local 为 local-rule）
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    cost = Column(Numeric(18, 6), nullable=False, default=0)
    latency_ms = Column(Integer, nullable=True)
    prompt_version = Column(String, nullable=True)  # 提示词版本号（P1 深化 Task 12）
    degraded = Column(Boolean, nullable=False, default=False)  # 是否降级（远程失败回退本地）
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)


class AIFeedback(Base):
    """AI 输出反馈（P1 深化 Task 13）

    用户在 AI 结果上标记「有帮助 / 无帮助 / 纠正」，用于可解释性与效果改进。
    usage_id 关联到 ai_usage（可为空，当反馈未关联具体调用时）。
    feedback 取值：helpful / not_helpful / correct。
    """
    __tablename__ = "ai_feedback"
    id = Column(String, primary_key=True)
    usage_id = Column(String, ForeignKey("ai_usage.id"), nullable=True, index=True)
    action = Column(String, nullable=True)  # 冗余 action，便于脱离 usage 统计
    feedback = Column(String, nullable=False)  # helpful / not_helpful / correct
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    organization = Column(String, nullable=True)  # 冗余组织机构，便于按组织统计


class UserTablePreference(Base):
    """用户级表格视图/列配置持久化（P2-12 Task 17）

    复合主键 (user_id, page_key)，data 为 JSON 序列化的表格偏好
    （columns 可见性/顺序/固定 + density），与前端 useTablePreferences 结构对齐。
    """
    __tablename__ = "user_table_preferences"
    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    page_key = Column(String, primary_key=True)
    data = Column(JSON, nullable=False, default=dict)
    updated_at = Column(String, nullable=False)


class QuotationSnapshot(Base):
    """报价不可变快照（P2-12 Task 17）

    定标确认时冻结当前报价数据，避免供应商后续修改影响审批/定标记录。
    snapshot 为 JSON：包含 inquiry 摘要 + 全部已提交报价（含 items）的序列化副本。
    """
    __tablename__ = "quotation_snapshots"
    id = Column(String, primary_key=True)
    inquiry_id = Column(String, ForeignKey("inquiries.id", ondelete="CASCADE"), nullable=False, index=True)
    inquiry_code = Column(String, nullable=False)
    snapshot = Column(JSON, nullable=False)
    created_at = Column(String, nullable=False)
    created_by = Column(String, nullable=True)
    created_by_name = Column(String, nullable=True)
