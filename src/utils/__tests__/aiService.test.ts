/**
 * aiService 测试（阶段 1.2）
 * 覆盖 3 个 AI 函数：询价说明生成、报价异常分析、比价结论生成
 */
import { describe, it, expect } from 'vitest';
import {
  generateInquiryDescription,
  analyzeQuotationAnomalies,
  generateCompareConclusion,
} from '../aiService';
import { prepareCompareData, type SupplierQuoteRow } from '@/components/quotation/scoreUtils';
import {
  CooperationStatus,
  Currency,
  InquiryStatus,
  QuotationStatus,
  SupplierLevel,
  type Inquiry,
  type InquiryItem,
  type Quotation,
  type Supplier,
} from '@/types';

/* ==================== 工厂函数 ==================== */

function makeItem(overrides: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: 'item-1',
    inquiryId: 'inq-1',
    name: '物料A',
    code: 'MAT001',
    category: '工业电子',
    brand: '品牌X',
    spec: '规格Y',
    techParams: '',
    unit: '个',
    quantity: 10,
    targetPrice: 100,
    attachments: [],
    ...overrides,
  };
}

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    code: 'SUP001',
    name: '供应商A',
    region: '华东',
    contact: '张三',
    phone: '13800000000',
    email: 'a@test.com',
    mainCategories: ['工业电子'],
    level: SupplierLevel.STRATEGIC,
    cooperationStatus: CooperationStatus.COOPERATING,
    qualified: true,
    historyResponseRate: 0.9,
    historyFulfillmentRate: 1,
    avgDeliveryDays: 10,
    historyCoopCount: 5,
    ...overrides,
  };
}

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ20260801001',
    subject: '测试采购',
    organization: '总部',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: '2026-12-31 18:00:00',
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [makeItem()],
    invitedSupplierIds: ['sup-1', 'sup-2', 'sup-3'],
    quotations: [],
    logs: [],
    status: InquiryStatus.ALL_QUOTED,
    createdById: 'u-1',
    createdByName: '采购员',
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
    ...overrides,
  };
}

function makeQuotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: 'q-1',
    inquiryId: 'inq-1',
    supplierId: 'sup-1',
    supplierName: '供应商A',
    status: QuotationStatus.SUBMITTED,
    items: [
      {
        id: 'qi-1',
        quotationId: 'q-1',
        inquiryItemId: 'item-1',
        unitPrice: 100,
        taxIncludedTotal: 1000,
        taxRate: 0.13,
        attachments: [],
        deliveryDays: 10,
        deliveryDate: '2026-08-20',
        warrantyMonths: 12,
        paymentTerms: '款到发货',
        techDeviation: '',
        commercialDeviation: '',
        remark: '',
      },
    ],
    totalAmount: 1000,
    attachments: [],
    submittedAt: '2026-08-05 10:00:00',
    createdAt: '2026-08-05 09:00:00',
    updatedAt: '2026-08-05 10:00:00',
    ...overrides,
  };
}

/* ==================== 测试 ==================== */

describe('generateInquiryDescription', () => {
  it('生成包含采购概述、品类、关键物料、交付要求、报价要求的说明', async () => {
    const text = await generateInquiryDescription({
      subject: '测试采购',
      items: [makeItem(), makeItem({ id: 'item-2', name: '物料B', code: 'MAT002' })],
      paymentTerms: '款到发货',
      deliveryAddress: '上海',
      expectedDeliveryDate: '2026-08-20',
    });
    expect(text).toContain('测试采购');
    expect(text).toContain('2 项物料');
    expect(text).toContain('工业电子');
    expect(text).toContain('物料A');
    expect(text).toContain('上海');
    expect(text).toContain('2026-08-20');
    expect(text).toContain('款到发货');
    expect(text).toContain('报价要求');
  });

  it('超过 3 项物料时显示"详见附件清单"', async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `item-${i + 1}`, name: `物料${i + 1}`, code: `MAT00${i + 1}` }),
    );
    const text = await generateInquiryDescription({ subject: '批量采购', items });
    expect(text).toContain('共 5 项物料');
    expect(text).toContain('详见附件清单');
  });

  it('无付款条件时不输出商务条款段', async () => {
    const text = await generateInquiryDescription({
      subject: '测试',
      items: [makeItem()],
    });
    expect(text).not.toContain('商务条款');
  });
});

describe('analyzeQuotationAnomalies', () => {
  it('报价整体正常时 hasAnomaly=false', async () => {
    const inquiry = makeInquiry();
    const suppliers = [
      makeSupplier({ id: 'sup-1', name: 'A' }),
      makeSupplier({ id: 'sup-2', name: 'B' }),
      makeSupplier({ id: 'sup-3', name: 'C' }),
    ];
    const quotations = [
      makeQuotation({ id: 'q-1', supplierId: 'sup-1', supplierName: 'A', totalAmount: 1000 }),
      makeQuotation({ id: 'q-2', supplierId: 'sup-2', supplierName: 'B', totalAmount: 1100 }),
      makeQuotation({ id: 'q-3', supplierId: 'sup-3', supplierName: 'C', totalAmount: 1050 }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const result = await analyzeQuotationAnomalies(inquiry, data);
    expect(result.hasAnomaly).toBe(false);
    expect(result.anomalyCount).toBe(0);
    expect(result.summary).toContain('正常');
  });

  it('单价偏高 50%+ 触发异常', async () => {
    const inquiry = makeInquiry();
    const suppliers = [
      makeSupplier({ id: 'sup-1', name: 'A' }),
      makeSupplier({ id: 'sup-2', name: 'B' }),
    ];
    // 均价 = (100 + 300) / 2 = 200，300 >= 200 * 1.5 = 300 → 触发虚高
    const quotations = [
      makeQuotation({
        id: 'q-1',
        supplierId: 'sup-1',
        supplierName: 'A',
        totalAmount: 1000,
        items: [{ id: 'qi-1', quotationId: 'q-1', inquiryItemId: 'item-1', unitPrice: 100, taxIncludedTotal: 1000, taxRate: 0.13, attachments: [], deliveryDays: 10 }],
      }),
      makeQuotation({
        id: 'q-2',
        supplierId: 'sup-2',
        supplierName: 'B',
        totalAmount: 3000,
        items: [{ id: 'qi-2', quotationId: 'q-2', inquiryItemId: 'item-1', unitPrice: 300, taxIncludedTotal: 3000, taxRate: 0.13, attachments: [], deliveryDays: 10 }],
      }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const result = await analyzeQuotationAnomalies(inquiry, data);
    expect(result.hasAnomaly).toBe(true);
    expect(result.anomalyCount).toBeGreaterThan(0);
    expect(result.summary).toContain('虚高');
  });

  it('总价离散度 > 40% 触发异常（需 >=3 家）', async () => {
    const inquiry = makeInquiry();
    const suppliers = [
      makeSupplier({ id: 'sup-1', name: 'A' }),
      makeSupplier({ id: 'sup-2', name: 'B' }),
      makeSupplier({ id: 'sup-3', name: 'C' }),
    ];
    const quotations = [
      makeQuotation({ id: 'q-1', supplierId: 'sup-1', supplierName: 'A', totalAmount: 1000 }),
      makeQuotation({ id: 'q-2', supplierId: 'sup-2', supplierName: 'B', totalAmount: 1100 }),
      makeQuotation({ id: 'q-3', supplierId: 'sup-3', supplierName: 'C', totalAmount: 2000 }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const result = await analyzeQuotationAnomalies(inquiry, data);
    expect(result.summary).toContain('离散度');
  });

  it('交货周期差异 > 2 倍触发异常', async () => {
    const inquiry = makeInquiry();
    const suppliers = [
      makeSupplier({ id: 'sup-1', name: 'A' }),
      makeSupplier({ id: 'sup-2', name: 'B' }),
    ];
    const quotations = [
      makeQuotation({
        id: 'q-1',
        supplierId: 'sup-1',
        supplierName: 'A',
        totalAmount: 1000,
        items: [{ id: 'qi-1', quotationId: 'q-1', inquiryItemId: 'item-1', unitPrice: 100, taxIncludedTotal: 1000, taxRate: 0.13, attachments: [], deliveryDays: 5 }],
      }),
      makeQuotation({
        id: 'q-2',
        supplierId: 'sup-2',
        supplierName: 'B',
        totalAmount: 1000,
        items: [{ id: 'qi-2', quotationId: 'q-2', inquiryItemId: 'item-1', unitPrice: 100, taxIncludedTotal: 1000, taxRate: 0.13, attachments: [], deliveryDays: 30 }],
      }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const result = await analyzeQuotationAnomalies(inquiry, data);
    expect(result.summary).toContain('交货周期');
  });

  it('存在技术偏离触发异常', async () => {
    const inquiry = makeInquiry();
    const suppliers = [makeSupplier({ id: 'sup-1', name: 'A' }), makeSupplier({ id: 'sup-2', name: 'B' })];
    const quotations = [
      makeQuotation({
        id: 'q-1',
        supplierId: 'sup-1',
        supplierName: 'A',
        totalAmount: 1000,
        items: [{ id: 'qi-1', quotationId: 'q-1', inquiryItemId: 'item-1', unitPrice: 100, taxIncludedTotal: 1000, taxRate: 0.13, attachments: [], deliveryDays: 10, techDeviation: '偏离技术要求' }],
      }),
      makeQuotation({
        id: 'q-2',
        supplierId: 'sup-2',
        supplierName: 'B',
        totalAmount: 1000,
        items: [{ id: 'qi-2', quotationId: 'q-2', inquiryItemId: 'item-1', unitPrice: 100, taxIncludedTotal: 1000, taxRate: 0.13, attachments: [], deliveryDays: 10 }],
      }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const result = await analyzeQuotationAnomalies(inquiry, data);
    expect(result.summary).toContain('技术偏离');
  });
});

describe('generateCompareConclusion', () => {
  it('生成包含回收率、价格分析、综合评分、定标建议的结论', async () => {
    const inquiry = makeInquiry();
    const suppliers = [
      makeSupplier({ id: 'sup-1', name: '供应商A' }),
      makeSupplier({ id: 'sup-2', name: '供应商B' }),
    ];
    const quotations = [
      makeQuotation({ id: 'q-1', supplierId: 'sup-1', supplierName: '供应商A', totalAmount: 1000 }),
      makeQuotation({ id: 'q-2', supplierId: 'sup-2', supplierName: '供应商B', totalAmount: 1200 }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const rows: SupplierQuoteRow[] = data.rows;
    const text = await generateCompareConclusion(inquiry, data, rows);
    expect(text).toContain('比价结论');
    expect(text).toContain('回收率');
    expect(text).toContain('供应商A'); // 最低价
    expect(text).toContain('定标建议');
  });

  it('综合评分最高且报价最低时推荐性价比最优', async () => {
    const inquiry = makeInquiry();
    const suppliers = [
      makeSupplier({ id: 'sup-1', name: '优商', level: SupplierLevel.STRATEGIC, historyFulfillmentRate: 1 }),
      makeSupplier({ id: 'sup-2', name: '普商', level: SupplierLevel.QUALIFIED, historyFulfillmentRate: 0.7 }),
    ];
    const quotations = [
      makeQuotation({ id: 'q-1', supplierId: 'sup-1', supplierName: '优商', totalAmount: 1000 }),
      makeQuotation({ id: 'q-2', supplierId: 'sup-2', supplierName: '普商', totalAmount: 1500 }),
    ];
    const data = prepareCompareData(inquiry, suppliers, quotations);
    const text = await generateCompareConclusion(inquiry, data, data.rows);
    expect(text).toContain('性价比最优');
  });
});
