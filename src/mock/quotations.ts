/**
 * 报价单模拟数据
 * - inq-4（部分已报价）：仅 sup-5 提交
 * - inq-5（报价已完成）：3 家全部提交，含异常（sup-3 报价金额异常高、sup-5 交货周期异常长）
 * - inq-6（已超时）：受邀供应商报价状态为 TIMEOUT
 * - inq-7（已完成）：2 家提交，对应已定标结果
 */
import dayjs from 'dayjs';
import { QuotationStatus, type Quotation, type QuotationItem } from '@/types';

const now = dayjs();
const ts = (offsetDays: number, hour = 10, minute = 0): string =>
  now.add(offsetDays, 'day').hour(hour).minute(minute).second(0).format('YYYY-MM-DD HH:mm:ss');
const dateOnly = (offset: number): string => now.add(offset, 'day').format('YYYY-MM-DD');

let itemSeq = 0;
/** 构造报价明细（unitPrice 视为含税单价，taxIncludedTotal = unitPrice * quantity） */
const buildItem = (
  quotationId: string,
  inquiryItemId: string,
  unitPrice: number,
  quantity: number,
  deliveryDays: number,
  brand: string,
  warrantyMonths = 12,
  paymentTerms = '货到验收后 30 天付款',
): QuotationItem => {
  itemSeq += 1;
  return {
    id: `qitem-${itemSeq}`,
    quotationId,
    inquiryItemId,
    unitPrice,
    taxRate: 0.13,
    taxIncludedTotal: Number((unitPrice * quantity).toFixed(2)),
    moq: 1,
    deliveryDays,
    deliveryDate: dateOnly(deliveryDays),
    brand,
    warrantyMonths,
    paymentTerms,
    validUntil: dateOnly(30),
    attachments: [],
  };
};

/** 供应商名称映射 */
const SUP_NAME: Record<string, string> = {
  'sup-1': '上海恒远工业设备有限公司',
  'sup-2': '苏州联创自动化科技有限公司',
  'sup-3': '宁波华泰五金制造有限公司',
  'sup-4': '深圳智联电子科技有限公司',
  'sup-5': '杭州启明供应链有限公司',
  'sup-6': '广东正达包装材料有限公司',
};

/** 报价单列表 */
export const quotations: Quotation[] = [
  // ===== inq-4 部分已报价：仅 sup-5 提交 =====
  {
    id: 'quo-4-5',
    inquiryId: 'inq-4',
    supplierId: 'sup-5',
    supplierName: SUP_NAME['sup-5'],
    status: QuotationStatus.SUBMITTED,
    submittedAt: ts(-2, 14, 30),
    items: [
      buildItem('quo-4-5', 'item-inq-4-1', 4380, 30, 12, '联想', 36, '货到验收后 30 天付款'),
    ],
    totalAmount: 131400,
    remark: '含预装系统及办公软件，提供上门安装服务。',
    attachments: [],
    createdAt: ts(-4, 9, 0),
    updatedAt: ts(-2, 14, 30),
  },

  // ===== inq-5 报价已完成：3 家全部提交，含异常 =====
  {
    id: 'quo-5-1',
    inquiryId: 'inq-5',
    supplierId: 'sup-1',
    supplierName: SUP_NAME['sup-1'],
    status: QuotationStatus.SUBMITTED,
    submittedAt: ts(-4, 16, 0),
    items: [
      buildItem('quo-5-1', 'item-inq-5-1', 32, 200, 7, 'SKF', 24),
      buildItem('quo-5-1', 'item-inq-5-2', 60, 50, 7, '华泰', 24),
    ],
    totalAmount: 9400,
    remark: '战略供应商价格，含材质证明及检验报告。',
    attachments: [],
    createdAt: ts(-6, 9, 0),
    updatedAt: ts(-4, 16, 0),
  },
  {
    // 异常：报价金额显著高于平均水平（轴承单价 80 元，远高于其他供应商约 33 元）
    id: 'quo-5-3',
    inquiryId: 'inq-5',
    supplierId: 'sup-3',
    supplierName: SUP_NAME['sup-3'],
    status: QuotationStatus.SUBMITTED,
    submittedAt: ts(-2, 10, 0),
    items: [
      buildItem('quo-5-3', 'item-inq-5-1', 80, 200, 12, '替代品牌', 12),
      buildItem('quo-5-3', 'item-inq-5-2', 70, 50, 12, '华泰', 12),
    ],
    totalAmount: 19500,
    remark: '轴承需外调，价格略高；法兰可现货供应。',
    attachments: [],
    createdAt: ts(-5, 9, 0),
    updatedAt: ts(-2, 10, 0),
  },
  {
    // 异常：交货周期显著长于平均水平（40 天，较平均约 20 天多 20 天以上）
    id: 'quo-5-2',
    inquiryId: 'inq-5',
    supplierId: 'sup-5',
    supplierName: SUP_NAME['sup-5'],
    status: QuotationStatus.SUBMITTED,
    submittedAt: ts(-3, 15, 0),
    items: [
      buildItem('quo-5-2', 'item-inq-5-1', 34, 200, 40, '替代品牌', 12),
      buildItem('quo-5-2', 'item-inq-5-2', 63, 50, 40, '华泰', 12),
    ],
    totalAmount: 9950,
    remark: '部分物料需调配，交货周期较长。',
    attachments: [],
    createdAt: ts(-5, 14, 0),
    updatedAt: ts(-3, 15, 0),
  },

  // ===== inq-6 已超时：受邀供应商报价状态为 TIMEOUT =====
  {
    id: 'quo-6-1',
    inquiryId: 'inq-6',
    supplierId: 'sup-6',
    supplierName: SUP_NAME['sup-6'],
    status: QuotationStatus.TIMEOUT,
    submittedAt: undefined,
    items: [],
    totalAmount: 0,
    remark: '未在截止时间前提交报价。',
    attachments: [],
    createdAt: ts(-10, 9, 0),
    updatedAt: ts(-5, 18, 0),
  },
  {
    id: 'quo-6-2',
    inquiryId: 'inq-6',
    supplierId: 'sup-5',
    supplierName: SUP_NAME['sup-5'],
    status: QuotationStatus.TIMEOUT,
    submittedAt: undefined,
    items: [],
    totalAmount: 0,
    remark: '未在截止时间前提交报价。',
    attachments: [],
    createdAt: ts(-10, 9, 0),
    updatedAt: ts(-5, 18, 0),
  },

  // ===== inq-7 已完成：2 家提交，对应定标结果 =====
  {
    id: 'quo-7-2',
    inquiryId: 'inq-7',
    supplierId: 'sup-2',
    supplierName: SUP_NAME['sup-2'],
    status: QuotationStatus.SUBMITTED,
    submittedAt: ts(-15, 16, 0),
    items: [
      buildItem('quo-7-2', 'item-inq-7-1', 880, 15, 10, '华为', 36),
      buildItem('quo-7-2', 'item-inq-7-2', 4100, 8, 12, '西门子', 36),
    ],
    totalAmount: 46000,
    remark: '含编程调试服务，PLC 提供现场技术支持。',
    attachments: [],
    createdAt: ts(-17, 9, 0),
    updatedAt: ts(-15, 16, 0),
  },
  {
    id: 'quo-7-4',
    inquiryId: 'inq-7',
    supplierId: 'sup-4',
    supplierName: SUP_NAME['sup-4'],
    status: QuotationStatus.SUBMITTED,
    submittedAt: ts(-14, 15, 0),
    items: [
      buildItem('quo-7-4', 'item-inq-7-1', 820, 15, 9, '华为', 36),
      buildItem('quo-7-4', 'item-inq-7-2', 4300, 8, 11, '西门子', 36),
    ],
    totalAmount: 46700,
    remark: '交换机价格优势明显，可快速交货。',
    attachments: [],
    createdAt: ts(-17, 10, 0),
    updatedAt: ts(-14, 15, 0),
  },
];
