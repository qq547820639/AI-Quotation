/**
 * 供应商门户报价页共享类型与常量（Task 16 抽取）
 */
import dayjs from 'dayjs';
import type { PortalInquiryItem } from '@/api/portal';

/** 附件（与后端契约一致） */
export interface PortalAttachment {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadTime: string;
}

/** 报价明细表单值 */
export interface QuotationFormItem {
  inquiryItemId: string;
  unitPrice: number | undefined;
  taxRate: number;
  moq: number | undefined;
  deliveryDays: number | undefined;
  deliveryDate: dayjs.Dayjs | null;
  brand: string;
  warrantyMonths: number | undefined;
  paymentTerms: string;
  validUntil: dayjs.Dayjs | null;
  techDeviation: string;
  commercialDeviation: string;
  remark: string;
  attachments: PortalAttachment[];
}

/** 自动保存状态 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** 税率选项 */
export const TAX_RATE_OPTIONS = [
  { label: '13%', value: 0.13 },
  { label: '9%', value: 0.09 },
  { label: '6%', value: 0.06 },
  { label: '0%', value: 0 },
];

/** 付款条件选项 */
export const PAYMENT_TERMS_OPTIONS = [
  { label: '货到验收后 30 天付款', value: '货到验收后 30 天付款' },
  { label: '货到验收后 45 天付款', value: '货到验收后 45 天付款' },
  { label: '货到验收后 60 天付款', value: '货到验收后 60 天付款' },
  { label: '款到发货', value: '款到发货' },
  { label: '预付 30% 发货前付清', value: '预付 30% 发货前付清' },
];

/** 默认付款条件 */
export const DEFAULT_PAYMENT_TERMS = '货到验收后 30 天付款';

/** 批量设置交期常用选项 */
export const DELIVERY_DAYS_OPTIONS = [7, 10, 15, 20, 30, 45, 60];

/** 根据询价明细构造空表单项 */
export function createEmptyItem(inquiryItem: PortalInquiryItem): QuotationFormItem {
  return {
    inquiryItemId: inquiryItem.id,
    unitPrice: undefined,
    taxRate: 0.13,
    moq: undefined,
    deliveryDays: undefined,
    deliveryDate: null,
    brand: inquiryItem.brand || '',
    warrantyMonths: undefined,
    paymentTerms: DEFAULT_PAYMENT_TERMS,
    validUntil: null,
    techDeviation: '',
    commercialDeviation: '',
    remark: '',
    attachments: [],
  };
}

/** 计算单行含税总价（unitPrice 视为含税单价） */
export function calcItemTotal(unitPrice: number | undefined, quantity: number): number {
  if (!unitPrice || unitPrice <= 0) return 0;
  return Number((unitPrice * quantity).toFixed(2));
}

/** 询价是否处于终态（不再可报价） */
export function isTerminalStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'TIMEOUT';
}
