/**
 * useInquiryStore 状态机测试（阶段 1.1）
 * 保护 11 个写操作在 W7 迁移前后行为一致
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useInquiryStore } from '../useInquiryStore';
import { useNotificationStore } from '../useNotificationStore';
import { useAuthStore } from '../useAuthStore';
import {
  ApprovalNodeStatus,
  Currency,
  InquiryStatus,
  LogType,
  NotificationType,
  type Inquiry,
  type InquiryItem,
} from '@/types';

/** 构造测试用 Inquiry */
function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-test-1',
    code: 'INQ20260801001',
    subject: '测试询价单',
    organization: '总部采购中心',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: '2026-12-31 18:00:00',
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [makeItem()],
    invitedSupplierIds: ['sup-1', 'sup-2'],
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

function makeItem(overrides: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: 'item-1',
    inquiryId: 'inq-test-1',
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

/** 重置 store 状态 + mock 通知 */
function resetStore(inquiries: Inquiry[] = []) {
  useInquiryStore.setState({ inquiries, loaded: true });
}

beforeEach(() => {
  resetStore([]);
  // mock 通知 store，避免污染
  vi.spyOn(useNotificationStore.getState(), 'addNotification').mockImplementation(() => {});
});

describe('useInquiryStore', () => {
  describe('addInquiry', () => {
    it('新增到列表头部', () => {
      const existing = makeInquiry({ id: 'inq-old' });
      resetStore([existing]);
      const fresh = makeInquiry({ id: 'inq-new' });
      useInquiryStore.getState().addInquiry(fresh);
      const list = useInquiryStore.getState().inquiries;
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('inq-new');
      expect(list[1].id).toBe('inq-old');
    });
  });

  describe('updateInquiry', () => {
    it('更新指定 id 的字段并刷新 updatedAt', () => {
      const inq = makeInquiry();
      resetStore([inq]);
      useInquiryStore.getState().updateInquiry('inq-test-1', { subject: '新主题' });
      const updated = useInquiryStore.getState().getInquiryById('inq-test-1');
      expect(updated?.subject).toBe('新主题');
      expect(updated?.updatedAt).not.toBe('2026-08-01 10:00:00');
    });
  });

  describe('deleteInquiry', () => {
    it('从列表移除', () => {
      resetStore([makeInquiry({ id: 'a' }), makeInquiry({ id: 'b' })]);
      useInquiryStore.getState().deleteInquiry('a');
      const list = useInquiryStore.getState().inquiries;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('b');
    });
  });

  describe('copyInquiry', () => {
    it('创建副本：新 id + DRAFT 状态 + 主题加（副本）+ 含复制日志', () => {
      const inq = makeInquiry({ id: 'inq-src', status: InquiryStatus.COMPLETED });
      resetStore([inq]);
      const copy = useInquiryStore.getState().copyInquiry('inq-src');
      expect(copy).toBeDefined();
      expect(copy!.id).not.toBe('inq-src');
      expect(copy!.status).toBe(InquiryStatus.DRAFT);
      expect(copy!.subject).toContain('（副本）');
      expect(copy!.quotations).toEqual([]);
      expect(copy!.selectedSupplierMap).toEqual({});
      expect(copy!.logs.some((l) => l.type === LogType.CREATE)).toBe(true);
      // 源单不受影响
      expect(useInquiryStore.getState().getInquiryById('inq-src')?.status).toBe(
        InquiryStatus.COMPLETED,
      );
    });

    it('源单不存在返回 undefined', () => {
      expect(useInquiryStore.getState().copyInquiry('not-exist')).toBeUndefined();
    });
  });

  describe('cancelInquiry', () => {
    it('状态转 CANCELLED + 追加 CANCEL 日志 + 发送 SYSTEM 通知', () => {
      const inq = makeInquiry({ id: 'inq-cancel', status: InquiryStatus.INQUIRING });
      resetStore([inq]);
      const addNotification = vi.spyOn(useNotificationStore.getState(), 'addNotification');
      useInquiryStore.getState().cancelInquiry('inq-cancel');
      const updated = useInquiryStore.getState().getInquiryById('inq-cancel');
      expect(updated?.status).toBe(InquiryStatus.CANCELLED);
      expect(updated?.logs.some((l) => l.type === LogType.CANCEL)).toBe(true);
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.SYSTEM }),
      );
    });
  });

  describe('sendInquiry', () => {
    it('状态转 INQUIRING + 追加 SEND_INQUIRY 日志 + 发送 INQUIRY_SENT 通知', () => {
      const inq = makeInquiry({
        id: 'inq-send',
        status: InquiryStatus.PENDING_SEND,
        invitedSupplierIds: ['sup-1', 'sup-2', 'sup-3'],
      });
      resetStore([inq]);
      const addNotification = vi.spyOn(useNotificationStore.getState(), 'addNotification');
      useInquiryStore.getState().sendInquiry('inq-send');
      const updated = useInquiryStore.getState().getInquiryById('inq-send');
      expect(updated?.status).toBe(InquiryStatus.INQUIRING);
      expect(updated?.logs.some((l) => l.type === LogType.SEND_INQUIRY)).toBe(true);
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.INQUIRY_SENT,
          content: expect.stringContaining('3'),
        }),
      );
    });
  });

  describe('selectSupplier', () => {
    it('更新 selectedSupplierMap + 状态从 ALL_QUOTED 转 PENDING_CONFIRM', () => {
      const inq = makeInquiry({
        id: 'inq-sel',
        status: InquiryStatus.ALL_QUOTED,
      });
      resetStore([inq]);
      useInquiryStore.getState().selectSupplier('inq-sel', 'item-1', 'sup-1');
      const updated = useInquiryStore.getState().getInquiryById('inq-sel');
      expect(updated?.selectedSupplierMap['item-1']).toBe('sup-1');
      expect(updated?.status).toBe(InquiryStatus.PENDING_CONFIRM);
    });

    it('非 ALL_QUOTED 状态不转换状态', () => {
      const inq = makeInquiry({
        id: 'inq-sel2',
        status: InquiryStatus.PARTIAL_QUOTED,
      });
      resetStore([inq]);
      useInquiryStore.getState().selectSupplier('inq-sel2', 'item-1', 'sup-2');
      const updated = useInquiryStore.getState().getInquiryById('inq-sel2');
      expect(updated?.status).toBe(InquiryStatus.PARTIAL_QUOTED);
    });
  });

  describe('confirmInquiry', () => {
    it('状态转 COMPLETED + 追加 CONFIRM_RESULT 日志 + 通知', () => {
      const inq = makeInquiry({ id: 'inq-conf', status: InquiryStatus.PENDING_CONFIRM });
      resetStore([inq]);
      const addNotification = vi.spyOn(useNotificationStore.getState(), 'addNotification');
      useInquiryStore.getState().confirmInquiry('inq-conf');
      const updated = useInquiryStore.getState().getInquiryById('inq-conf');
      expect(updated?.status).toBe(InquiryStatus.COMPLETED);
      expect(updated?.logs.some((l) => l.type === LogType.CONFIRM_RESULT)).toBe(true);
      expect(addNotification).toHaveBeenCalled();
    });
  });

  describe('submitForApproval', () => {
    it('状态转 PENDING_APPROVAL + 新增 PENDING 审批节点 + APPROVAL 通知', () => {
      const inq = makeInquiry({ id: 'inq-apv', status: InquiryStatus.PENDING_CONFIRM });
      resetStore([inq]);
      const addNotification = vi.spyOn(useNotificationStore.getState(), 'addNotification');
      useInquiryStore.getState().submitForApproval('inq-apv');
      const updated = useInquiryStore.getState().getInquiryById('inq-apv');
      expect(updated?.status).toBe(InquiryStatus.PENDING_APPROVAL);
      expect(updated?.approvalNodes).toHaveLength(1);
      expect(updated?.approvalNodes[0].status).toBe(ApprovalNodeStatus.PENDING);
      expect(updated?.logs.some((l) => l.type === LogType.SUBMIT_APPROVAL)).toBe(true);
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.APPROVAL }),
      );
    });
  });

  describe('approveInquiry', () => {
    it('状态转 PENDING_CONFIRM + 节点转 APPROVED + 追加 APPROVE 日志', () => {
      const inq = makeInquiry({ id: 'inq-ok', status: InquiryStatus.PENDING_APPROVAL });
      resetStore([inq]);
      // 先提交审批生成节点
      useInquiryStore.getState().submitForApproval('inq-ok');
      useInquiryStore.getState().approveInquiry('inq-ok', '同意');
      const updated = useInquiryStore.getState().getInquiryById('inq-ok');
      expect(updated?.status).toBe(InquiryStatus.PENDING_CONFIRM);
      expect(updated?.approvalNodes.some((n) => n.status === ApprovalNodeStatus.APPROVED)).toBe(
        true,
      );
      expect(updated?.logs.some((l) => l.type === LogType.APPROVE)).toBe(true);
    });
  });

  describe('rejectInquiry', () => {
    it('状态转 PENDING_CONFIRM + 节点转 REJECTED + 追加 REJECT 日志', () => {
      const inq = makeInquiry({ id: 'inq-no', status: InquiryStatus.PENDING_APPROVAL });
      resetStore([inq]);
      useInquiryStore.getState().submitForApproval('inq-no');
      useInquiryStore.getState().rejectInquiry('inq-no', '价格过高');
      const updated = useInquiryStore.getState().getInquiryById('inq-no');
      expect(updated?.status).toBe(InquiryStatus.PENDING_CONFIRM);
      expect(updated?.approvalNodes.some((n) => n.status === ApprovalNodeStatus.REJECTED)).toBe(
        true,
      );
      expect(updated?.logs.some((l) => l.type === LogType.REJECT)).toBe(true);
    });
  });

  describe('addLog', () => {
    it('追加日志到指定询价单', () => {
      const inq = makeInquiry({ id: 'inq-log' });
      resetStore([inq]);
      useInquiryStore.getState().addLog('inq-log', LogType.UPDATE, '手动追加日志');
      const updated = useInquiryStore.getState().getInquiryById('inq-log');
      expect(updated?.logs.some((l) => l.content === '手动追加日志')).toBe(true);
    });
  });

  describe('getVisibleInquiries', () => {
    it('非管理员只看本组织', () => {
      resetStore([
        makeInquiry({ id: 'a', organization: '总部' }),
        makeInquiry({ id: 'b', organization: '分部' }),
      ]);
      const visible = useInquiryStore.getState().getVisibleInquiries('总部');
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('a');
    });

    it('管理员 __ALL__ 看全部', () => {
      resetStore([
        makeInquiry({ id: 'a', organization: '总部' }),
        makeInquiry({ id: 'b', organization: '分部' }),
      ]);
      const visible = useInquiryStore.getState().getVisibleInquiries('__ALL__');
      expect(visible).toHaveLength(2);
    });
  });

  describe('createLog 操作人取自 useAuthStore', () => {
    it('日志 operator 来自当前登录用户', () => {
      const inq = makeInquiry({ id: 'inq-op' });
      resetStore([inq]);
      useInquiryStore.getState().addLog('inq-op', LogType.UPDATE, '测试操作人');
      const log = useInquiryStore
        .getState()
        .getInquiryById('inq-op')!
        .logs.find((l) => l.content === '测试操作人');
      expect(log?.operator).toBe(useAuthStore.getState().currentUser.name);
    });
  });
});
