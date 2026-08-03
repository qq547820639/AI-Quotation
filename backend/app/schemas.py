"""Pydantic 请求/响应 schema，对齐前端 src/types/index.ts 字段"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict


# ============ 基础类型 ============

class AttachmentSchema(BaseModel):
    id: str
    name: str
    url: str
    size: int
    uploadTime: str
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


# ============ 请求 schema ============

class InquiryCreate(BaseModel):
    """允许全字段透传，extra allow 兼容前端传完整对象"""
    model_config = ConfigDict(extra="allow")


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


class AppSettingsSchema(BaseModel):
    approval: ApprovalSettings
    notification: NotificationSettings
    model_config = ConfigDict(from_attributes=True)


# ============ 认证 ============

class LoginParams(BaseModel):
    userId: str


class LoginResult(BaseModel):
    user: UserSchema
    token: str


class SuccessResult(BaseModel):
    success: bool = True
