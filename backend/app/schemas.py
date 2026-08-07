"""Pydantic 请求/响应 schema，对齐前端 src/types/index.ts 字段"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict, field_validator


# ============ 基础类型 ============

class AttachmentSchema(BaseModel):
    id: str
    name: str
    url: str
    size: int
    uploadTime: str
    scanStatus: Optional[str] = "pending"
    scanResult: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class UserSchema(BaseModel):
    id: str
    name: str
    avatar: Optional[str] = None
    role: str
    department: str
    organization: str
    permissions: Optional[List[str]] = None
    model_config = ConfigDict(from_attributes=True)


class MaterialSchema(BaseModel):
    id: str
    code: str
    name: str
    category: str
    brand: str
    spec: str
    techParams: str
    unit: str
    stockQty: Optional[int] = None
    model_config = ConfigDict(from_attributes=True)


class MaterialCreate(BaseModel):
    """允许部分字段缺失，便于 create/update 复用"""
    model_config = ConfigDict(extra="allow")
    id: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    spec: Optional[str] = None
    techParams: Optional[str] = None
    unit: Optional[str] = None
    stockQty: Optional[int] = None


class SupplierSchema(BaseModel):
    id: str
    code: str
    name: str
    region: str
    contact: str
    phone: str
    email: str
    mainCategories: List[str]
    level: str
    cooperationStatus: str
    qualified: bool
    historyResponseRate: float
    historyFulfillmentRate: float
    avgDeliveryDays: int
    lastCooperateTime: Optional[str] = None
    historyCoopCount: int
    model_config = ConfigDict(from_attributes=True)


class SupplierCreate(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    region: Optional[str] = None
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    mainCategories: Optional[List[str]] = None
    level: Optional[str] = None
    cooperationStatus: Optional[str] = None
    qualified: Optional[bool] = None
    historyResponseRate: Optional[float] = None
    historyFulfillmentRate: Optional[float] = None
    avgDeliveryDays: Optional[int] = None
    lastCooperateTime: Optional[str] = None
    historyCoopCount: Optional[int] = None


class InquiryItemSchema(BaseModel):
    id: str
    inquiryId: str
    materialId: Optional[str] = None
    name: str
    code: str
    category: str
    brand: str
    spec: str
    techParams: str
    unit: str
    quantity: int
    targetPrice: Optional[float] = None
    expectedDeliveryDate: Optional[str] = None
    remark: Optional[str] = None
    attachments: List[AttachmentSchema] = []
    model_config = ConfigDict(from_attributes=True)


class InquiryLogSchema(BaseModel):
    id: str
    inquiryId: str
    time: str
    operator: str
    operatorRole: Optional[str] = None
    type: str
    content: str
    result: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class ApprovalNodeSchema(BaseModel):
    id: str
    inquiryId: str
    nodeOrder: int
    approverId: str
    approverName: str
    approverRole: str
    status: str
    comment: Optional[str] = None
    time: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class QuotationItemSchema(BaseModel):
    id: str
    quotationId: str
    inquiryItemId: str
    unitPrice: float
    taxRate: float
    taxIncludedTotal: float
    moq: Optional[int] = None
    deliveryDays: int
    deliveryDate: Optional[str] = None
    brand: Optional[str] = None
    warrantyMonths: Optional[int] = None
    paymentTerms: Optional[str] = None
    validUntil: Optional[str] = None
    techDeviation: Optional[str] = None
    commercialDeviation: Optional[str] = None
    remark: Optional[str] = None
    attachments: List[AttachmentSchema] = []
    model_config = ConfigDict(from_attributes=True)


class QuotationSchema(BaseModel):
    id: str
    inquiryId: str
    supplierId: str
    supplierName: str
    status: str
    submittedAt: Optional[str] = None
    items: List[QuotationItemSchema]
    totalAmount: float
    remark: Optional[str] = None
    attachments: List[AttachmentSchema] = []
    createdAt: str
    updatedAt: str
    model_config = ConfigDict(from_attributes=True)


class InquirySchema(BaseModel):
    id: str
    code: str
    subject: str
    organization: str
    ownerName: str
    ownerId: str
    currency: str
    deadline: str
    expectedDeliveryDate: Optional[str] = None
    deliveryAddress: str
    contact: str
    paymentTerms: str
    invoiceRequirement: Optional[str] = None
    description: Optional[str] = None
    attachments: List[AttachmentSchema] = []
    items: List[InquiryItemSchema]
    invitedSupplierIds: List[str]
    quotations: List[QuotationSchema]
    logs: List[InquiryLogSchema]
    status: str
    createdById: str
    createdByName: str
    createdAt: str
    updatedAt: str
    selectedSupplierMap: Dict[str, str]
    purchaserComments: Dict[str, str]
    approvalNodes: List[ApprovalNodeSchema]
    version: int = 1
    model_config = ConfigDict(from_attributes=True)


class NotificationSchema(BaseModel):
    id: str
    inquiryId: Optional[str] = None
    type: str
    title: str
    content: str
    time: str
    read: bool
    model_config = ConfigDict(from_attributes=True)


# ============ 通知偏好 / 交付状态（P1-8 Task 12） ============

class UserNotificationPreferencesSchema(BaseModel):
    deadlineReminder: bool = True
    deadlineReminderHours: int = 24
    quotationSubmitted: bool = True
    approvalResult: bool = True
    inquirySent: bool = True
    model_config = ConfigDict(from_attributes=True)


class UnreadCountSchema(BaseModel):
    count: int


class DeliveryRecordSchema(BaseModel):
    """逐供应商交付状态（采购端查看）"""
    supplierId: str
    supplierName: str
    deliveryStatus: str  # pending/sent/delivered/failed/bounced/opened/submitted
    invitationStatus: str
    sentAt: Optional[str] = None
    openedAt: Optional[str] = None
    submittedAt: Optional[str] = None
    deliveryError: Optional[str] = None


class DeliverySummarySchema(BaseModel):
    """询价发送结果汇总（用于前端展示，避免谎报"已全部发送成功"）"""
    total: int
    pending: int
    sent: int
    delivered: int
    failed: int
    submitted: int
    allDelivered: bool


# ============ 请求 schema ============

class InquiryCreate(BaseModel):
    """允许全字段透传，extra allow 兼容前端传完整对象；subject 必填（Task 17.2）"""
    model_config = ConfigDict(extra="allow")
    subject: str

    @field_validator("subject")
    @classmethod
    def subject_not_blank(cls, v: str) -> str:
        """询价主题必填：缺失或空白均触发 422 校验错误"""
        if not v or not v.strip():
            raise ValueError("询价主题不能为空")
        return v


class InquiryUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")


class QuotationCreate(BaseModel):
    model_config = ConfigDict(extra="allow")


class QuotationDraft(BaseModel):
    model_config = ConfigDict(extra="allow")


class NotificationCreate(BaseModel):
    model_config = ConfigDict(extra="allow")


class ApprovalAction(BaseModel):
    comment: Optional[str] = None
    version: Optional[int] = None  # 乐观锁版本号（Task 6）


class VersionBody(BaseModel):
    """动作端点携带的乐观锁版本号（Task 6）"""
    version: Optional[int] = None


class BatchMaterials(BaseModel):
    items: List[Dict[str, Any]]


# ============ 设置 ============

class ApprovalSettings(BaseModel):
    enabled: bool
    amountThreshold: float
    approverId: str


class NotificationSettings(BaseModel):
    deadlineReminder: bool
    deadlineReminderHours: int
    quotationSubmitted: bool
    approvalResult: bool


class AISettings(BaseModel):
    """AI 服务配置（P2-15：设置页可配置）。

    provider ∈ {local, demo, remote}：
    - local：本地规则引擎，不调用外部 API。
    - demo：内置演示密钥，开箱即用指向火山引擎 Ark（密钥存服务端，前端不持有）。
    - remote：用户自填 API Key 的远程大模型（OpenAI 兼容）。

    apiKey 回显时脱敏（仅尾 4 位），避免完整密钥离开服务端。hasApiKey 用于前端
    判断 remote 模式是否已配置。提交时若 apiKey 为空或为脱敏形态（含 *），视为保持不变。
    """
    provider: str = "local"
    baseUrl: str = ""
    model: str = ""
    apiKey: str = ""
    hasApiKey: bool = False
    structuredOutput: bool = True


class AppSettingsSchema(BaseModel):
    approval: ApprovalSettings
    notification: NotificationSettings
    ai: AISettings
    model_config = ConfigDict(from_attributes=True)


# ============ 认证 ============

class LoginParams(BaseModel):
    userId: str
    password: Optional[str] = None  # 生产模式必填；演示模式可省略


class ChangePasswordParams(BaseModel):
    """修改密码请求体：须提供当前密码与两次新密码"""
    currentPassword: str
    newPassword: str
    confirmPassword: Optional[str] = None


class LoginResult(BaseModel):
    user: UserSchema
    token: str


class SuccessResult(BaseModel):
    success: bool = True


class RefreshResult(BaseModel):
    """刷新接口返回：新的 access token + 用户信息（refresh token 走 HttpOnly Cookie）"""
    user: UserSchema
    token: str


class SessionInfo(BaseModel):
    """会话列表项"""
    id: str
    device: Optional[str] = None
    createdAt: str
    expiresAt: str
    revokedAt: Optional[str] = None
    lastRefreshAt: Optional[str] = None
    current: bool = False


# ============ P2-12 Task 17：分页 / 表格偏好 / 报价快照 / 导出 ============

class PaginatedInquiriesSchema(BaseModel):
    """询价列表服务端分页响应（P2-12 Task 17）"""
    items: List[InquirySchema]
    total: int
    page: int
    pageSize: int


class PaginatedQuotationsSchema(BaseModel):
    """报价列表服务端分页响应（P2 Task 22：分页结构与其他列表统一）"""
    items: List[QuotationSchema]
    total: int
    page: int
    pageSize: int


class TablePreferencesSchema(BaseModel):
    """用户级表格偏好（JSON 透传，与前端 useTablePreferences 结构对齐）"""
    pageKey: str
    data: Dict[str, Any] = {}


class QuotationSnapshotSchema(BaseModel):
    """报价不可变快照概要"""
    id: str
    inquiryId: str
    inquiryCode: str
    createdAt: str
    createdBy: Optional[str] = None
    createdByName: Optional[str] = None
    # snapshot 本体（含冻结的报价与询价摘要），透传
    snapshot: Dict[str, Any] = {}


class ExportRequest(BaseModel):
    """服务端导出请求体（P2-12 Task 17）"""
    format: str = "xlsx"  # pdf | xlsx
    scope: str = "compare"  # inquiry | compare
