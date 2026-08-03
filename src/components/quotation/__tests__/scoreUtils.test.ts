import { describe, it, expect } from 'vitest';
import {
  prepareCompareData,
  sortRows,
  isHighPrice,
  isLowPrice,
  getMinUnitPrice,
  getFastestDelivery,
  getAvgUnitPrice,
  SUPPLIER_LEVEL_SCORE,
  SCORE_WEIGHTS,
} from '../scoreUtils';
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

/* ==================== 数据构造辅助 ==================== */

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

function makeItem(overrides: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: 'item-1',
    inquiryId: 'inq-1',
    name: '物料A',
    code: 'MAT001',
    category: '工业电子',
    brand: '',
    spec: '',
    techParams: '',
    unit: '个',
    quantity: 10,
    attachments: [],
    ...overrides,
  };
}

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ20260801001',
    subject: '测试询价',
    organization: '总部采购中心',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: '2026-08-10 18:00',
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    items: [makeItem()],
    invitedSupplierIds: ['sup-1', 'sup-2'],
    quotations: [],
    logs: [],
    status: InquiryStatus.INQUIRING,
    createdById: 'u-1',
    createdByName: '采购员',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
    attachments: [],
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
        taxRate: 0.13,
        taxIncludedTotal: 1130,
        deliveryDays: 10,
        attachments: [],
      },
    ],
    totalAmount: 1130,
    attachments: [],
    createdAt: '2026-08-02',
    updatedAt: '2026-08-02',
    ...overrides,
  };
}

/* ==================== 测试 ==================== */

describe('SUPPLIER_LEVEL_SCORE / SCORE_WEIGHTS', () => {
  it('等级基础分映射正确', () => {
    expect(SUPPLIER_LEVEL_SCORE[SupplierLevel.STRATEGIC]).toBe(95);
    expect(SUPPLIER_LEVEL_SCORE[SupplierLevel.PREMIUM]).toBe(85);
    expect(SUPPLIER_LEVEL_SCORE[SupplierLevel.QUALIFIED]).toBe(70);
    expect(SUPPLIER_LEVEL_SCORE[SupplierLevel.PENDING]).toBe(60);
  });

  it('权重总和为 1', () => {
    const sum = SCORE_WEIGHTS.price + SCORE_WEIGHTS.delivery + SCORE_WEIGHTS.level + SCORE_WEIGHTS.fulfillment;
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe('isHighPrice / isLowPrice', () => {
  it('高于均价 50% 判定为偏高', () => {
    expect(isHighPrice(150, 100)).toBe(true);
    expect(isHighPrice(149, 100)).toBe(false);
  });
  it('低于均价 50% 判定为偏低', () => {
    expect(isLowPrice(50, 100)).toBe(true);
    expect(isLowPrice(51, 100)).toBe(false);
  });
  it('均价为 0 不判定', () => {
    expect(isHighPrice(100, 0)).toBe(false);
    expect(isLowPrice(100, 0)).toBe(false);
  });
});

describe('prepareCompareData', () => {
  it('正确计算最低价 / 最快交货 / 评分最高供应商', () => {
    const supA = makeSupplier({
      id: 'sup-a',
      name: '供应商A',
      level: SupplierLevel.STRATEGIC,
      historyFulfillmentRate: 1,
    });
    const supB = makeSupplier({
      id: 'sup-b',
      name: '供应商B',
      level: SupplierLevel.QUALIFIED,
      historyFulfillmentRate: 0.8,
    });
    const inquiry = makeInquiry();
    const qA = makeQuotation({
      id: 'q-a',
      supplierId: 'sup-a',
      supplierName: '供应商A',
      totalAmount: 1000,
      items: [
        {
          id: 'qi-a',
          quotationId: 'q-a',
          inquiryItemId: 'item-1',
          unitPrice: 100,
          taxRate: 0.13,
          taxIncludedTotal: 1000,
          deliveryDays: 10,
          attachments: [],
        },
      ],
    });
    const qB = makeQuotation({
      id: 'q-b',
      supplierId: 'sup-b',
      supplierName: '供应商B',
      totalAmount: 1200,
      items: [
        {
          id: 'qi-b',
          quotationId: 'q-b',
          inquiryItemId: 'item-1',
          unitPrice: 120,
          taxRate: 0.13,
          taxIncludedTotal: 1200,
          deliveryDays: 15,
          attachments: [],
        },
      ],
    });

    const data = prepareCompareData(inquiry, [supA, supB], [qA, qB]);

    expect(data.minTotal).toBe(1000);
    expect(data.fastestAvgDelivery).toBe(10);
    expect(data.lowestTotalSupplierId).toBe('sup-a');
    expect(data.fastestDeliverySupplierId).toBe('sup-a');
    expect(data.topScoreSupplierId).toBe('sup-a');

    // A 评分：price 50 + delivery 20 + level 14.25 + fulfillment 15 = 99.25
    expect(data.scores['sup-a'].total).toBe(99.25);
    // B 评分：price 41.67 + delivery 13.33 + level 10.5 + fulfillment 12 = 77.5
    expect(data.scores['sup-b'].total).toBe(77.5);
  });

  it('TIMEOUT 报价行展示但不计入已提交', () => {
    const supA = makeSupplier({ id: 'sup-a' });
    const inquiry = makeInquiry();
    const qTimeout = makeQuotation({
      id: 'q-to',
      supplierId: 'sup-a',
      status: QuotationStatus.TIMEOUT,
    });
    const data = prepareCompareData(inquiry, [supA], [qTimeout]);
    expect(data.rows).toHaveLength(1);
    expect(data.submittedRows).toHaveLength(0);
    expect(data.minTotal).toBe(0);
  });

  it('DRAFT 报价不参与对比', () => {
    const supA = makeSupplier({ id: 'sup-a' });
    const inquiry = makeInquiry();
    const qDraft = makeQuotation({
      id: 'q-d',
      supplierId: 'sup-a',
      status: QuotationStatus.DRAFT,
    });
    const data = prepareCompareData(inquiry, [supA], [qDraft]);
    expect(data.rows).toHaveLength(0);
  });
});

describe('sortRows', () => {
  it('totalAsc 按总价升序', () => {
    const inquiry = makeInquiry();
    const supA = makeSupplier({ id: 'sup-a' });
    const supB = makeSupplier({ id: 'sup-b' });
    const qA = makeQuotation({ id: 'q-a', supplierId: 'sup-a', totalAmount: 1200 });
    const qB = makeQuotation({ id: 'q-b', supplierId: 'sup-b', totalAmount: 1000 });
    const data = prepareCompareData(inquiry, [supA, supB], [qA, qB]);
    const sorted = sortRows(data.rows, 'totalAsc', data.scores);
    expect(sorted[0].supplier.id).toBe('sup-b');
    expect(sorted[1].supplier.id).toBe('sup-a');
  });

  it('scoreDesc 按评分降序', () => {
    const inquiry = makeInquiry();
    const supA = makeSupplier({ id: 'sup-a', level: SupplierLevel.STRATEGIC, historyFulfillmentRate: 1 });
    const supB = makeSupplier({ id: 'sup-b', level: SupplierLevel.QUALIFIED, historyFulfillmentRate: 0.8 });
    const qA = makeQuotation({ id: 'q-a', supplierId: 'sup-a', totalAmount: 1000 });
    const qB = makeQuotation({ id: 'q-b', supplierId: 'sup-b', totalAmount: 1000 });
    const data = prepareCompareData(inquiry, [supA, supB], [qA, qB]);
    const sorted = sortRows(data.rows, 'scoreDesc', data.scores);
    expect(sorted[0].supplier.id).toBe('sup-a');
  });
});

describe('getMinUnitPrice / getFastestDelivery / getAvgUnitPrice', () => {
  it('取已提交供应商的最低单价', () => {
    const inquiry = makeInquiry();
    const supA = makeSupplier({ id: 'sup-a' });
    const supB = makeSupplier({ id: 'sup-b' });
    const qA = makeQuotation({
      id: 'q-a',
      supplierId: 'sup-a',
      items: [
        {
          id: 'qi-a',
          quotationId: 'q-a',
          inquiryItemId: 'item-1',
          unitPrice: 100,
          taxRate: 0.13,
          taxIncludedTotal: 1000,
          deliveryDays: 10,
          attachments: [],
        },
      ],
    });
    const qB = makeQuotation({
      id: 'q-b',
      supplierId: 'sup-b',
      items: [
        {
          id: 'qi-b',
          quotationId: 'q-b',
          inquiryItemId: 'item-1',
          unitPrice: 80,
          taxRate: 0.13,
          taxIncludedTotal: 800,
          deliveryDays: 5,
          attachments: [],
        },
      ],
    });
    const data = prepareCompareData(inquiry, [supA, supB], [qA, qB]);
    expect(getMinUnitPrice(data.rows, 'item-1')).toBe(80);
    expect(getFastestDelivery(data.rows, 'item-1')).toBe(5);
    expect(getAvgUnitPrice(data.rows, 'item-1')).toBe(90);
  });

  it('无已提交报价返回 undefined', () => {
    const rows = [] as Parameters<typeof getMinUnitPrice>[0];
    expect(getMinUnitPrice(rows, 'item-1')).toBeUndefined();
  });
});
