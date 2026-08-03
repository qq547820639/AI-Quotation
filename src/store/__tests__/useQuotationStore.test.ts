/**
 * useQuotationStore 状态机测试（阶段 H）
 * 保护报价 store 的暂存/提交/查询行为
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useQuotationStore } from '../useQuotationStore';
import { useInquiryStore } from '../useInquiryStore';
import { useNotificationStore } from '../useNotificationStore';
import { NotificationType, QuotationStatus, type Quotation } from '@/types';

// mock API 层，避免真实网络请求（store 内为 fire-and-forget）
vi.mock('@/api', () => ({
  quotationApi: {
    list: vi.fn().mockResolvedValue([]),
    listByInquiry: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    saveDraft: vi.fn().mockResolvedValue({}),
    submit: vi.fn().mockResolvedValue({}),
  },
}));

/** 构造测试用 Quotation */
function makeQuotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: 'quo-test-1',
    inquiryId: 'inq-test-1',
    supplierId: 'sup-1',
    supplierName: '测试供应商',
    status: QuotationStatus.DRAFT,
    items: [],
    totalAmount: 1000,
    remark: '',
    attachments: [],
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    ...overrides,
  };
}

/** 重置 store 状态 */
function resetStore(quotations: Quotation[] = []) {
  useQuotationStore.setState({ quotations });
}

beforeEach(() => {
  resetStore([]);
  // mock 依赖 store，避免污染
  vi.spyOn(useInquiryStore.getState(), 'addLog').mockImplementation(() => {});
  vi.spyOn(useNotificationStore.getState(), 'addNotification').mockImplementation(() => {});
});

describe('useQuotationStore', () => {
  describe('初始状态', () => {
    it('quotations 为数组', () => {
      expect(Array.isArray(useQuotationStore.getState().quotations)).toBe(true);
    });

    it('重置后 quotations 为空', () => {
      resetStore([]);
      expect(useQuotationStore.getState().quotations).toHaveLength(0);
    });
  });

  describe('saveQuotationDraft', () => {
    it('暂存新报价：状态置为 DRAFT 并加入列表', () => {
      resetStore([]);
      const q = makeQuotation({ id: 'quo-draft', status: QuotationStatus.SUBMITTED });
      useQuotationStore.getState().saveQuotationDraft(q);
      const list = useQuotationStore.getState().quotations;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('quo-draft');
      expect(list[0].status).toBe(QuotationStatus.DRAFT);
    });

    it('已存在的报价更新而非新增，且状态强制为 DRAFT', () => {
      const existing = makeQuotation({ id: 'quo-draft', totalAmount: 1000 });
      resetStore([existing]);
      useQuotationStore.getState().saveQuotationDraft(
        makeQuotation({ id: 'quo-draft', totalAmount: 2000, status: QuotationStatus.SUBMITTED }),
      );
      const list = useQuotationStore.getState().quotations;
      expect(list).toHaveLength(1);
      expect(list[0].totalAmount).toBe(2000);
      expect(list[0].status).toBe(QuotationStatus.DRAFT);
    });

    it('暂存时同步记录 SAVE_QUOTATION_DRAFT 日志到询价单', () => {
      const addLog = vi.spyOn(useInquiryStore.getState(), 'addLog');
      resetStore([]);
      useQuotationStore.getState().saveQuotationDraft(
        makeQuotation({ id: 'quo-x', supplierName: '供应商X' }),
      );
      expect(addLog).toHaveBeenCalledWith(
        'inq-test-1',
        expect.anything(),
        expect.stringContaining('供应商X'),
      );
    });
  });

  describe('submitQuotation', () => {
    it('提交报价：状态从 DRAFT 转 SUBMITTED 并写入 submittedAt', () => {
      const q = makeQuotation({ id: 'quo-sub', status: QuotationStatus.DRAFT });
      resetStore([q]);
      useQuotationStore.getState().submitQuotation('quo-sub');
      const updated = useQuotationStore.getState().getQuotationById('quo-sub');
      expect(updated?.status).toBe(QuotationStatus.SUBMITTED);
      expect(updated?.submittedAt).toBeTruthy();
    });

    it('提交报价：发送 QUOTATION_SUBMITTED 通知', () => {
      const q = makeQuotation({ id: 'quo-ntf', status: QuotationStatus.DRAFT, totalAmount: 1234.5 });
      resetStore([q]);
      const addNotification = vi.spyOn(useNotificationStore.getState(), 'addNotification');
      useQuotationStore.getState().submitQuotation('quo-ntf');
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.QUOTATION_SUBMITTED }),
      );
    });

    it('提交报价：记录 SUBMIT_QUOTATION 日志', () => {
      const q = makeQuotation({ id: 'quo-log', status: QuotationStatus.DRAFT });
      resetStore([q]);
      const addLog = vi.spyOn(useInquiryStore.getState(), 'addLog');
      useQuotationStore.getState().submitQuotation('quo-log');
      expect(addLog).toHaveBeenCalledWith(
        'inq-test-1',
        expect.anything(),
        expect.stringContaining('提交报价'),
      );
    });

    it('提交不存在的报价不抛错', () => {
      resetStore([]);
      expect(() => useQuotationStore.getState().submitQuotation('not-exist')).not.toThrow();
    });
  });

  describe('upsertQuotation', () => {
    it('新增报价：追加到列表', () => {
      resetStore([]);
      useQuotationStore.getState().upsertQuotation(makeQuotation({ id: 'quo-new' }));
      expect(useQuotationStore.getState().quotations).toHaveLength(1);
    });

    it('更新已有报价', () => {
      resetStore([makeQuotation({ id: 'quo-up', totalAmount: 1000 })]);
      useQuotationStore.getState().upsertQuotation(
        makeQuotation({ id: 'quo-up', totalAmount: 3000 }),
      );
      const list = useQuotationStore.getState().quotations;
      expect(list).toHaveLength(1);
      expect(list[0].totalAmount).toBe(3000);
    });
  });

  describe('getQuotationsByInquiry', () => {
    it('按 inquiryId 过滤', () => {
      resetStore([
        makeQuotation({ id: 'q1', inquiryId: 'inq-a' }),
        makeQuotation({ id: 'q2', inquiryId: 'inq-b' }),
        makeQuotation({ id: 'q3', inquiryId: 'inq-a' }),
      ]);
      const list = useQuotationStore.getState().getQuotationsByInquiry('inq-a');
      expect(list).toHaveLength(2);
      expect(list.map((q) => q.id).sort()).toEqual(['q1', 'q3']);
    });
  });

  describe('getQuotationById', () => {
    it('按 id 查找', () => {
      resetStore([makeQuotation({ id: 'q-find' })]);
      expect(useQuotationStore.getState().getQuotationById('q-find')?.id).toBe('q-find');
    });

    it('未找到返回 undefined', () => {
      resetStore([]);
      expect(useQuotationStore.getState().getQuotationById('nope')).toBeUndefined();
    });
  });
});
