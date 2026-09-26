/**
 * actionWorkbench 纯计算模块测试（P2 Task 14）
 * - 8 个行动卡片数量计算
 * - 负责人 / 时间范围筛选
 * - 发送失败邀请识别
 */
import { describe, it, expect, beforeAll } from 'vitest';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import {
  computeDashboardActions,
  countFailedDeliveries,
  filterByOwner,
  filterByDate,
  applyWorkbenchFilter,
  getOwnerOptions,
  isFailureResult,
} from '../workbenchActions';
import {
  InquiryStatus,
  LogType,
  QuotationStatus,
  Currency,
  type Inquiry,
  type Quotation,
} from '@/types';

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ001',
    subject: '测试询价',
    organization: '总部采购中心',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: '2099-12-31 18:00:00',
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [],
    invitedSupplierIds: [],
    quotations: [],
    logs: [],
    status: InquiryStatus.DRAFT,
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
    status: QuotationStatus.DRAFT,
    items: [],
    totalAmount: 100,
    remark: '',
    attachments: [],
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

describe('isFailureResult', () => {
  it('识别各失败结果标记', () => {
    expect(isFailureResult('投递失败')).toBe(true);
    expect(isFailureResult('delivery failed')).toBe(true);
    expect(isFailureResult('bounced')).toBe(true);
    expect(isFailureResult('Error: SMTP')).toBe(true);
  });

  it('非失败结果返回 false', () => {
    expect(isFailureResult('已投递')).toBe(false);
    expect(isFailureResult('sent')).toBe(false);
    expect(isFailureResult(undefined)).toBe(false);
    expect(isFailureResult('')).toBe(false);
  });
});

describe('countFailedDeliveries', () => {
  it('统计含失败日志询价单的受邀供应商数', () => {
    const inq = makeInquiry({
      invitedSupplierIds: ['s1', 's2', 's3'],
      logs: [
        {
          id: 'l1',
          inquiryId: 'inq-1',
          type: LogType.SEND_INQUIRY,
          time: '2026-08-01 10:00:00',
          operator: '采购员',
          content: '发送',
          result: '投递失败',
        },
      ],
    });
    expect(countFailedDeliveries([inq])).toBe(3);
  });

  it('无失败日志不计入', () => {
    const inq = makeInquiry({
      invitedSupplierIds: ['s1'],
      logs: [
        {
          id: 'l1',
          inquiryId: 'inq-1',
          type: LogType.SEND_INQUIRY,
          time: '2026-08-01 10:00:00',
          operator: '采购员',
          content: '发送',
          result: 'success',
        },
      ],
    });
    expect(countFailedDeliveries([inq])).toBe(0);
  });

  it('非 SEND_INQUIRY 日志不计入', () => {
    const inq = makeInquiry({
      invitedSupplierIds: ['s1'],
      logs: [
        {
          id: 'l1',
          inquiryId: 'inq-1',
          type: LogType.SUBMIT_QUOTATION,
          time: '2026-08-01 10:00:00',
          operator: '供应商',
          content: '提交',
          result: '投递失败',
        },
      ],
    });
    expect(countFailedDeliveries([inq])).toBe(0);
  });
});

describe('筛选函数', () => {
  const a = makeInquiry({ id: 'i-a', ownerName: '张三', createdAt: '2026-08-01 10:00:00' });
  const b = makeInquiry({ id: 'i-b', ownerName: '李四', createdAt: '2026-08-10 10:00:00' });

  it('filterByOwner 按负责人过滤', () => {
    expect(filterByOwner([a, b], '张三').map((i) => i.id)).toEqual(['i-a']);
    expect(filterByOwner([a, b], undefined)).toHaveLength(2);
  });

  it('filterByDate 半开区间过滤', () => {
    expect(filterByDate([a, b], '2026-08-05', null).map((i) => i.id)).toEqual(['i-b']);
    expect(filterByDate([a, b], null, '2026-08-05').map((i) => i.id)).toEqual(['i-a']);
  });

  it('applyWorkbenchFilter 组合负责人与时间', () => {
    const r = applyWorkbenchFilter([a, b], {
      owner: '张三',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-05',
    });
    expect(r.map((i) => i.id)).toEqual(['i-a']);
  });

  it('getOwnerOptions 去重且保留顺序', () => {
    const c = makeInquiry({ id: 'i-c', ownerName: '张三' });
    expect(getOwnerOptions([a, b, c])).toEqual(['张三', '李四']);
    expect(getOwnerOptions([makeInquiry({ ownerName: '' })])).toEqual([]);
  });
});

describe('computeDashboardActions', () => {
  it('统计待发送 / 待审批 / 待定标', () => {
    const inqs = [
      makeInquiry({ id: '1', status: InquiryStatus.PENDING_SEND }),
      makeInquiry({
        id: '2',
        status: InquiryStatus.PENDING_APPROVAL,
        deadline: '2099-01-01 00:00:00',
      }),
      makeInquiry({ id: '3', status: InquiryStatus.PENDING_CONFIRM }),
    ];
    const r = computeDashboardActions(inqs, []);
    expect(r.pendingSend).toBe(1);
    expect(r.pendingApproval).toBe(1);
    expect(r.pendingConfirm).toBe(1);
    expect(r.approvalTimeout).toBe(0);
  });

  it('即将截止：进行中且 deadline 临近（≤1 天）', () => {
    const near = makeInquiry({
      id: '1',
      status: InquiryStatus.INQUIRING,
      deadline: dayjs().add(2, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    });
    const far = makeInquiry({
      id: '2',
      status: InquiryStatus.INQUIRING,
      deadline: '2099-01-01 00:00:00',
    });
    const r = computeDashboardActions([near, far], []);
    expect(r.deadlineApproaching).toBe(1);
  });

  it('即将超时审批：待审批且 deadline 临近', () => {
    const near = makeInquiry({
      id: '1',
      status: InquiryStatus.PENDING_APPROVAL,
      deadline: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    });
    const far = makeInquiry({
      id: '2',
      status: InquiryStatus.PENDING_APPROVAL,
      deadline: '2099-01-01 00:00:00',
    });
    const r = computeDashboardActions([near, far], []);
    expect(r.approvalTimeout).toBe(1);
    expect(r.pendingApproval).toBe(2);
  });

  it('尚未报价供应商：进行中询价中受邀但未提交的槽位', () => {
    const inq = makeInquiry({
      id: 'i1',
      status: InquiryStatus.INQUIRING,
      invitedSupplierIds: ['s1', 's2', 's3'],
    });
    const quotes = [
      makeQuotation({ inquiryId: 'i1', supplierId: 's1', status: QuotationStatus.SUBMITTED }),
      makeQuotation({ inquiryId: 'i1', supplierId: 's2', status: QuotationStatus.DRAFT }),
    ];
    const r = computeDashboardActions([inq], quotes);
    // s1 已提交，s2 DRAFT 不算提交，s3 未提交 → 2 个未报价槽位
    expect(r.unquotedSuppliers).toBe(2);
  });

  it('异常报价：TIMEOUT 报价计数', () => {
    const quotes = [
      makeQuotation({
        id: 'q1',
        inquiryId: 'i1',
        supplierId: 's1',
        status: QuotationStatus.TIMEOUT,
      }),
      makeQuotation({
        id: 'q2',
        inquiryId: 'i1',
        supplierId: 's2',
        status: QuotationStatus.SUBMITTED,
      }),
    ];
    const r = computeDashboardActions(
      [makeInquiry({ id: 'i1', status: InquiryStatus.INQUIRING })],
      quotes,
    );
    expect(r.abnormalQuotations).toBe(1);
  });

  it('发送失败邀请来自失败日志', () => {
    const inq = makeInquiry({
      id: 'i1',
      invitedSupplierIds: ['s1', 's2'],
      logs: [
        {
          id: 'l1',
          inquiryId: 'inq-1',
          type: LogType.SEND_INQUIRY,
          time: '2026-08-01 10:00:00',
          operator: '采购员',
          content: '发送',
          result: '投递失败',
        },
      ],
    });
    const r = computeDashboardActions([inq], []);
    expect(r.failedDeliveries).toBe(2);
  });

  it('全部为 0 时返回全 0', () => {
    const r = computeDashboardActions([makeInquiry({ id: '1', status: InquiryStatus.DRAFT })], []);
    expect(r).toEqual({
      pendingSend: 0,
      deadlineApproaching: 0,
      unquotedSuppliers: 0,
      failedDeliveries: 0,
      abnormalQuotations: 0,
      pendingApproval: 0,
      approvalTimeout: 0,
      pendingConfirm: 0,
    });
  });
});
