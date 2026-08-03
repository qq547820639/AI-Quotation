/**
 * 核心数据类型定义
 * 包含询价单、供应商、物料、报价、日志等所有领域模型的类型与枚举
 */
import type { TagProps } from 'antd';

/* ==================== 枚举定义 ==================== */

/** 询价单状态 */
export enum InquiryStatus {
  /** 草稿 */
  DRAFT = 'DRAFT',
  /** 待发送 */
  PENDING_SEND = 'PENDING_SEND',
  /** 询价中 */
  INQUIRING = 'INQUIRING',
  /** 部分已报价 */
  PARTIAL_QUOTED = 'PARTIAL_QUOTED',
  /** 报价已完成 */
  ALL_QUOTED = 'ALL_QUOTED',
  /** 已超时 */
  TIMEOUT = 'TIMEOUT',
  /** 待确认 */
  PENDING_CONFIRM = 'PENDING_CONFIRM',
  /** 待审批（W5） */
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  /** 已完成 */
  COMPLETED = 'COMPLETED',
  /** 已取消 */
  CANCELLED = 'CANCELLED',
}

/** 询价单状态中英文 label 映射 */
export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  [InquiryStatus.DRAFT]: '草稿',
  [InquiryStatus.PENDING_SEND]: '待发送',
  [InquiryStatus.INQUIRING]: '询价中',
  [InquiryStatus.PARTIAL_QUOTED]: '部分已报价',
  [InquiryStatus.ALL_QUOTED]: '报价已完成',
  [InquiryStatus.TIMEOUT]: '已超时',
  [InquiryStatus.PENDING_CONFIRM]: '待确认',
  [InquiryStatus.PENDING_APPROVAL]: '待审批',
  [InquiryStatus.COMPLETED]: '已完成',
  [InquiryStatus.CANCELLED]: '已取消',
};

/** 询价单状态对应的 antd Tag 颜色映射 */
export const INQUIRY_STATUS_COLOR: Record<InquiryStatus, TagProps['color']> = {
  [InquiryStatus.DRAFT]: 'default',
  [InquiryStatus.PENDING_SEND]: 'processing',
  [InquiryStatus.INQUIRING]: 'processing',
  [InquiryStatus.PARTIAL_QUOTED]: 'warning',
  [InquiryStatus.ALL_QUOTED]: 'success',
  [InquiryStatus.TIMEOUT]: 'error',
  [InquiryStatus.PENDING_CONFIRM]: 'gold',
  [InquiryStatus.PENDING_APPROVAL]: 'orange',
  [InquiryStatus.COMPLETED]: 'green',
  [InquiryStatus.CANCELLED]: 'default',
};

/** 供应商等级 */
export enum SupplierLevel {
  /** 战略 */
  STRATEGIC = 'STRATEGIC',
  /** 优质 */
  PREMIUM = 'PREMIUM',
  /** 合格 */
  QUALIFIED = 'QUALIFIED',
  /** 待评估 */
  PENDING = 'PENDING',
}

export const SUPPLIER_LEVEL_LABEL: Record<SupplierLevel, string> = {
  [SupplierLevel.STRATEGIC]: '战略',
  [SupplierLevel.PREMIUM]: '优质',
  [SupplierLevel.QUALIFIED]: '合格',
  [SupplierLevel.PENDING]: '待评估',
};

export const SUPPLIER_LEVEL_COLOR: Record<SupplierLevel, TagProps['color']> = {
  [SupplierLevel.STRATEGIC]: 'gold',
  [SupplierLevel.PREMIUM]: 'purple',
  [SupplierLevel.QUALIFIED]: 'blue',
  [SupplierLevel.PENDING]: 'default',
};

/** 合作状态 */
export enum CooperationStatus {
  /** 合作中 */
  COOPERATING = 'COOPERATING',
  /** 合格 */
  QUALIFIED = 'QUALIFIED',
  /** 停用 */
  DISABLED = 'DISABLED',
  /** 黑名单 */
  BLACKLIST = 'BLACKLIST',
}

export const COOPERATION_STATUS_LABEL: Record<CooperationStatus, string> = {
  [CooperationStatus.COOPERATING]: '合作中',
  [CooperationStatus.QUALIFIED]: '合格',
  [CooperationStatus.DISABLED]: '停用',
  [CooperationStatus.BLACKLIST]: '黑名单',
};

export const COOPERATION_STATUS_COLOR: Record<CooperationStatus, TagProps['color']> = {
  [CooperationStatus.COOPERATING]: 'success',
  [CooperationStatus.QUALIFIED]: 'blue',
  [CooperationStatus.DISABLED]: 'default',
  [CooperationStatus.BLACKLIST]: 'error',
};

/** 币种 */
export enum Currency {
  CNY = 'CNY',
  USD = 'USD',
  EUR = 'EUR',
}

export const CURRENCY_LABEL: Record<Currency, string> = {
  [Currency.CNY]: '人民币',
  [Currency.USD]: '美元',
  [Currency.EUR]: '欧元',
};

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  [Currency.CNY]: '¥',
  [Currency.USD]: '$',
  [Currency.EUR]: '€',
};

/** 日志类型 */
export enum LogType {
  CREATE = 'CREATE',
  SAVE_DRAFT = 'SAVE_DRAFT',
  UPDATE = 'UPDATE',
  ADD_SUPPLIER = 'ADD_SUPPLIER',
  SEND_INQUIRY = 'SEND_INQUIRY',
  SUPPLIER_VIEW = 'SUPPLIER_VIEW',
  SAVE_QUOTATION_DRAFT = 'SAVE_QUOTATION_DRAFT',
  SUBMIT_QUOTATION = 'SUBMIT_QUOTATION',
  QUOTATION_DEADLINE = 'QUOTATION_DEADLINE',
  VIEW_QUOTATION = 'VIEW_QUOTATION',
  SELECT_SUPPLIER = 'SELECT_SUPPLIER',
  CONFIRM_RESULT = 'CONFIRM_RESULT',
  CANCEL = 'CANCEL',
  /** 提交审批（W5） */
  SUBMIT_APPROVAL = 'SUBMIT_APPROVAL',
  /** 审批通过（W5） */
  APPROVE = 'APPROVE',
  /** 审批驳回（W5） */
  REJECT = 'REJECT',
}

export const LOG_TYPE_LABEL: Record<LogType, string> = {
  [LogType.CREATE]: '创建',
  [LogType.SAVE_DRAFT]: '保存草稿',
  [LogType.UPDATE]: '修改',
  [LogType.ADD_SUPPLIER]: '添加供应商',
  [LogType.SEND_INQUIRY]: '发送询价',
  [LogType.SUPPLIER_VIEW]: '供应商查看',
  [LogType.SAVE_QUOTATION_DRAFT]: '暂存报价',
  [LogType.SUBMIT_QUOTATION]: '提交报价',
  [LogType.QUOTATION_DEADLINE]: '报价截止',
  [LogType.VIEW_QUOTATION]: '查看报价',
  [LogType.SELECT_SUPPLIER]: '选择供应商',
  [LogType.CONFIRM_RESULT]: '确认结果',
  [LogType.CANCEL]: '取消',
  [LogType.SUBMIT_APPROVAL]: '提交审批',
  [LogType.APPROVE]: '审批通过',
  [LogType.REJECT]: '审批驳回',
};

/** 报价状态 */
export enum QuotationStatus {
  /** 暂存 */
  DRAFT = 'DRAFT',
  /** 已提交 */
  SUBMITTED = 'SUBMITTED',
  /** 已超时 */
  TIMEOUT = 'TIMEOUT',
}

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  [QuotationStatus.DRAFT]: '暂存',
  [QuotationStatus.SUBMITTED]: '已提交',
  [QuotationStatus.TIMEOUT]: '已超时',
};

export const QUOTATION_STATUS_COLOR: Record<QuotationStatus, TagProps['color']> = {
  [QuotationStatus.DRAFT]: 'default',
  [QuotationStatus.SUBMITTED]: 'success',
  [QuotationStatus.TIMEOUT]: 'error',
};

/* ==================== 下拉选项常量 ==================== */

export interface OptionItem<T = string> {
  label: string;
  value: T;
}

/** 询价状态筛选下拉选项 */
export const INQUIRY_STATUS_OPTIONS: OptionItem<InquiryStatus>[] = (
  Object.keys(INQUIRY_STATUS_LABEL) as InquiryStatus[]
).map((value) => ({ label: INQUIRY_STATUS_LABEL[value], value }));

/** 供应商等级下拉选项 */
export const SUPPLIER_LEVEL_OPTIONS: OptionItem<SupplierLevel>[] = (
  Object.keys(SUPPLIER_LEVEL_LABEL) as SupplierLevel[]
).map((value) => ({ label: SUPPLIER_LEVEL_LABEL[value], value }));

/** 合作状态下拉选项 */
export const COOPERATION_STATUS_OPTIONS: OptionItem<CooperationStatus>[] = (
  Object.keys(COOPERATION_STATUS_LABEL) as CooperationStatus[]
).map((value) => ({ label: COOPERATION_STATUS_LABEL[value], value }));

/** 币种下拉选项 */
export const CURRENCY_OPTIONS: OptionItem<Currency>[] = (Object.keys(CURRENCY_LABEL) as Currency[]).map(
  (value) => ({ label: CURRENCY_LABEL[value], value }),
);

/** 日志类型下拉选项 */
export const LOG_TYPE_OPTIONS: OptionItem<LogType>[] = (Object.keys(LOG_TYPE_LABEL) as LogType[]).map(
  (value) => ({ label: LOG_TYPE_LABEL[value], value }),
);

/* ==================== 实体类型 ==================== */

/** 用户角色（W4 扩展为 3 角色） */
export type UserRole = '采购人员' | '采购主管' | '管理员';

/** 权限点（W4 RBAC） */
export type Permission =
  | 'INQUIRY_CREATE' // 创建询价单
  | 'INQUIRY_EDIT' // 编辑询价单
  | 'INQUIRY_SEND' // 发送询价
  | 'INQUIRY_APPROVE' // 审批询价（W5 用）
  | 'INQUIRY_CONFIRM' // 确认定标
  | 'INQUIRY_CANCEL' // 取消询价
  | 'SUPPLIER_MANAGE' // 供应商管理（增删改）
  | 'SUPPLIER_DISABLE' // 启用/停用供应商（仅 ADMIN）
  | 'MATERIAL_MANAGE' // 物料管理
  | 'SETTINGS_MANAGE' // 系统设置（仅 ADMIN）
  | 'VIEW_ALL_ORG' // 查看全部组织（仅 ADMIN）
  | 'VIEW_LOG'; // 查看操作日志

/** 角色默认权限矩阵（W4 RBAC） */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  采购人员: ['INQUIRY_CREATE', 'INQUIRY_EDIT', 'INQUIRY_SEND', 'MATERIAL_MANAGE'],
  采购主管: [
    'INQUIRY_CREATE',
    'INQUIRY_EDIT',
    'INQUIRY_SEND',
    'INQUIRY_APPROVE',
    'INQUIRY_CONFIRM',
    'INQUIRY_CANCEL',
    'MATERIAL_MANAGE',
    'VIEW_LOG',
  ],
  管理员: [
    'INQUIRY_CREATE',
    'INQUIRY_EDIT',
    'INQUIRY_SEND',
    'INQUIRY_APPROVE',
    'INQUIRY_CONFIRM',
    'INQUIRY_CANCEL',
    'SUPPLIER_MANAGE',
    'SUPPLIER_DISABLE',
    'MATERIAL_MANAGE',
    'SETTINGS_MANAGE',
    'VIEW_ALL_ORG',
    'VIEW_LOG',
  ],
};

/** 附件 */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadTime: string;
}

/** 用户 */
export interface User {
  id: string;
  name: string;
  avatar?: string;
  role: UserRole;
  department: string;
  organization: string;
  /** 可选：覆盖角色默认权限（不填则用 ROLE_PERMISSIONS[role]） */
  permissions?: Permission[];
}

/** 物料 */
export interface Material {
  id: string;
  /** 物料编码，如 MAT001 */
  code: string;
  name: string;
  category: string;
  brand: string;
  spec: string;
  techParams: string;
  unit: string;
  /** 库存数量（可选） */
  stockQty?: number;
}

/** 询价明细 */
export interface InquiryItem {
  id: string;
  inquiryId: string;
  /** 物料引用（可内联物料字段） */
  material?: Material;
  name: string;
  code: string;
  category: string;
  brand: string;
  spec: string;
  techParams: string;
  unit: string;
  quantity: number;
  /** 目标价 */
  targetPrice?: number;
  /** 期望交货日期 */
  expectedDeliveryDate?: string;
  remark?: string;
  attachments: Attachment[];
}

/** 供应商 */
export interface Supplier {
  id: string;
  /** 供应商编码，如 SUP001 */
  code: string;
  name: string;
  region: string;
  contact: string;
  phone: string;
  email: string;
  /** 主营品类 */
  mainCategories: string[];
  level: SupplierLevel;
  cooperationStatus: CooperationStatus;
  /** 是否合格 */
  qualified: boolean;
  /** 历史响应率 0-1 */
  historyResponseRate: number;
  /** 历史履约率 0-1 */
  historyFulfillmentRate: number;
  /** 平均交货天数 */
  avgDeliveryDays: number;
  /** 上次合作时间 */
  lastCooperateTime?: string;
  /** 历史合作次数 */
  historyCoopCount: number;
}

/** 询价单供应商匹配信息 */
export interface SupplierMatch {
  supplier: Supplier;
  /** 匹配原因 */
  reason: string;
  /** 匹配评分 0-100 */
  matchScore: number;
  /** 是否被选中 */
  selected: boolean;
  /** 是否禁用 */
  disabled: boolean;
  /** 禁用原因 */
  disabledReason?: string;
}

/** 报价明细 */
export interface QuotationItem {
  id: string;
  quotationId: string;
  inquiryItemId: string;
  /** 单价（含税或不含税取决于业务，此处为含税单价口径由 taxRate 描述） */
  unitPrice: number;
  /** 税率，如 0.13 */
  taxRate: number;
  /** 含税总价 */
  taxIncludedTotal: number;
  /** 最小起订量 */
  moq?: number;
  /** 交货周期（天） */
  deliveryDays: number;
  /** 交货日期 */
  deliveryDate?: string;
  brand?: string;
  /** 质保期（月） */
  warrantyMonths?: number;
  /** 付款条件 */
  paymentTerms?: string;
  /** 报价有效期 */
  validUntil?: string;
  /** 技术偏离说明 */
  techDeviation?: string;
  /** 商务偏离说明 */
  commercialDeviation?: string;
  remark?: string;
  attachments: Attachment[];
}

/** 报价单 */
export interface Quotation {
  id: string;
  inquiryId: string;
  supplierId: string;
  supplierName: string;
  status: QuotationStatus;
  submittedAt?: string;
  items: QuotationItem[];
  /** 总金额 */
  totalAmount: number;
  remark?: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** 询价操作日志 */
export interface InquiryLog {
  id: string;
  inquiryId: string;
  /** 时间 */
  time: string;
  /** 操作人 */
  operator: string;
  /** 操作人角色 */
  operatorRole?: string;
  type: LogType;
  content: string;
  result?: string;
}

/** 询价单 */
export interface Inquiry {
  id: string;
  /** 询价单编号，如 INQ20260801001 */
  code: string;
  subject: string;
  /** 采购组织 */
  organization: string;
  /** 负责人姓名 */
  ownerName: string;
  ownerId: string;
  currency: Currency;
  /** 报价截止时间 */
  deadline: string;
  /** 期望交货日期 */
  expectedDeliveryDate?: string;
  /** 交货地址 */
  deliveryAddress: string;
  /** 联系人 */
  contact: string;
  /** 付款条件 */
  paymentTerms: string;
  /** 发票要求 */
  invoiceRequirement?: string;
  /** 需求描述 */
  description?: string;
  attachments: Attachment[];
  items: InquiryItem[];
  /** 受邀供应商 id 列表 */
  invitedSupplierIds: string[];
  quotations: Quotation[];
  logs: InquiryLog[];
  status: InquiryStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  /** 已选供应商映射：inquiryItemId -> supplierId */
  selectedSupplierMap: Record<string, string>;
  /** 采购员备注：supplierId -> 备注 */
  purchaserComments: Record<string, string>;
  /** 审批节点（W5，无审批时为空数组） */
  approvalNodes: ApprovalNode[];
}

/* ==================== 通用视图模型 ==================== */

/** 剩余时间信息 */
export interface RemainingTime {
  text: string;
  /** 是否紧急（剩余 <= 1 天） */
  urgent: boolean;
  /** 是否已过期 */
  expired: boolean;
}

/* ==================== 通知 ==================== */

/** 通知类型 */
export enum NotificationType {
  /** 询价已发送 */
  INQUIRY_SENT = 'inquiry_sent',
  /** 报价已提交 */
  QUOTATION_SUBMITTED = 'quotation_submitted',
  /** 报价即将截止 */
  DEADLINE_APPROACHING = 'deadline_approaching',
  /** 审批相关 */
  APPROVAL = 'approval',
  /** 系统 */
  SYSTEM = 'system',
}

/** 通知 */
export interface Notification {
  id: string;
  /** 关联询价单 id（可选） */
  inquiryId?: string;
  type: NotificationType;
  title: string;
  content: string;
  /** ISO 时间 */
  time: string;
  read: boolean;
}

/* ==================== 审批（W5） ==================== */

/** 审批节点状态 */
export enum ApprovalNodeStatus {
  /** 待审批 */
  PENDING = 'PENDING',
  /** 已通过 */
  APPROVED = 'APPROVED',
  /** 已驳回 */
  REJECTED = 'REJECTED',
}

export const APPROVAL_NODE_STATUS_LABEL: Record<ApprovalNodeStatus, string> = {
  [ApprovalNodeStatus.PENDING]: '待审批',
  [ApprovalNodeStatus.APPROVED]: '已通过',
  [ApprovalNodeStatus.REJECTED]: '已驳回',
};

export const APPROVAL_NODE_STATUS_COLOR: Record<ApprovalNodeStatus, TagProps['color']> = {
  [ApprovalNodeStatus.PENDING]: 'processing',
  [ApprovalNodeStatus.APPROVED]: 'success',
  [ApprovalNodeStatus.REJECTED]: 'error',
};

/** 审批节点 */
export interface ApprovalNode {
  id: string;
  inquiryId: string;
  /** 节点序号（从 1 开始） */
  nodeOrder: number;
  approverId: string;
  approverName: string;
  approverRole: string;
  status: ApprovalNodeStatus;
  /** 审批意见 */
  comment?: string;
  /** 审批时间 */
  time?: string;
}

/** 审批配置（写入 Settings） */
export interface ApprovalConfig {
  /** 是否启用审批流程 */
  enabled: boolean;
  /** 触发审批的最低报价总额阈值（含税，超过则需审批） */
  amountThreshold: number;
  /** 审批人用户 id */
  approverId: string;
}
