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

// mock API 层，避免真实网络请求（store 内写操作为 await 调用）
vi.mock('@/api', () => ({
  inquiryApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue({}),
    send: vi.fn().mockResolvedValue({}),
    confirm: vi.fn().mockResolvedValue({}),
    submitApproval: vi.fn().mockResolvedValue({}),
    approve: vi.fn().mockResolvedValue({}),
    reject: vi.fn().mockResolvedValue({}),
  },
}));

import { inquiryApi } from '@/api';
import { ApiError } from '@/api/errors';

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
  vi.clearAllMocks();
  // mock 通知 store，避免污染
  vi.spyOn(useNotificationStore.getState(), 'addNotification').mockResolvedValue({ success: true });
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
    it('状态转 RETURNED + 节点转 REJECTED + 追加 REJECT 日志', () => {
      const inq = makeInquiry({ id: 'inq-no', status: InquiryStatus.PENDING_APPROVAL });
      resetStore([inq]);
      useInquiryStore.getState().submitForApproval('inq-no');
      useInquiryStore.getState().rejectInquiry('inq-no', '价格过高');
      const updated = useInquiryStore.getState().getInquiryById('inq-no');
      expect(updated?.status).toBe(InquiryStatus.RETURNED);
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

  describe('batchCancelInquiries', () => {
    it('对不可取消项跳过，仅取消可取消项', async () => {
      resetStore([
        makeInquiry({ id: 'a', status: InquiryStatus.INQUIRING }),
        makeInquiry({ id: 'b', status: InquiryStatus.DRAFT }),
      ]);
      const res = await useInquiryStore.getState().batchCancelInquiries(['a', 'b']);
      expect(res.total).toBe(2);
      expect(res.succeeded).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(0);
      expect(useInquiryStore.getState().getInquiryById('a')?.status).toBe(InquiryStatus.CANCELLED);
      // 不可取消项保持原状态
      expect(useInquiryStore.getState().getInquiryById('b')?.status).toBe(InquiryStatus.DRAFT);
      const skipped = res.results.find((r) => r.id === 'b');
      expect(skipped?.skipped).toBe(true);
      expect(skipped?.reason).toBeTruthy();
    });

    it('聚合成功/失败计数正确', async () => {
      resetStore([
        makeInquiry({ id: 'a', status: InquiryStatus.INQUIRING }),
        makeInquiry({ id: 'b', status: InquiryStatus.INQUIRING }),
      ]);
      vi.mocked(inquiryApi.cancel).mockRejectedValueOnce(new Error('boom'));
      const res = await useInquiryStore.getState().batchCancelInquiries(['a', 'b']);
      expect(res.total).toBe(2);
      expect(res.succeeded).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.skipped).toBe(0);
      const failed = res.results.find((r) => r.id === 'a');
      expect(failed?.success).toBe(false);
      expect(failed?.reason).toBeTruthy();
    });
  });

  describe('写操作异常处理（Task 2）', () => {
    it('updateInquiry 成功时返回 { success:true }', async () => {
      resetStore([makeInquiry()]);
      const res = await useInquiryStore.getState().updateInquiry('inq-test-1', { subject: 'ok' });
      expect(res.success).toBe(true);
    });

    it('updateInquiry API 失败时回滚本地状态并返回 { success:false, reason:error }', async () => {
      const inq = makeInquiry({ subject: '原主题' });
      resetStore([inq]);
      vi.mocked(inquiryApi.update).mockRejectedValueOnce(new Error('boom'));
      const res = await useInquiryStore
        .getState()
        .updateInquiry('inq-test-1', { subject: '新主题' });
      expect(res).toEqual(expect.objectContaining({ success: false, reason: 'error' }));
      expect(res.error).toBeInstanceOf(ApiError);
      // 本地状态回滚到操作前
      expect(useInquiryStore.getState().getInquiryById('inq-test-1')?.subject).toBe('原主题');
    });

    it('deleteInquiry API 失败时回滚，不产生永久删除状态', async () => {
      resetStore([makeInquiry({ id: 'a' }), makeInquiry({ id: 'b' })]);
      vi.mocked(inquiryApi.delete).mockRejectedValueOnce(new Error('boom'));
      const res = await useInquiryStore.getState().deleteInquiry('a');
      expect(res).toEqual(expect.objectContaining({ success: false, reason: 'error' }));
      const list = useInquiryStore.getState().inquiries.map((i) => i.id);
      expect(list).toContain('a');
      expect(list).toHaveLength(2);
    });

    it('重复提交：同一实体 pending 期间再次调用返回 pending 且不重复调 API', async () => {
      resetStore([makeInquiry()]);
      let resolveFn: (v: unknown) => void = () => {};
      const gate = new Promise((resolve) => {
        resolveFn = resolve;
      });
      vi.mocked(inquiryApi.update).mockImplementationOnce(() => gate as Promise<never>);
      const first = useInquiryStore.getState().updateInquiry('inq-test-1', { subject: 'x' });
      const second = useInquiryStore.getState().updateInquiry('inq-test-1', { subject: 'y' });
      expect(await second).toEqual({ success: false, reason: 'pending' });
      expect(inquiryApi.update).toHaveBeenCalledTimes(1);
      resolveFn({});
      await first;
    });

    it('notFound：目标不存在时返回 { success:false, reason:not_found } 且不调 API', async () => {
      resetStore([]);
      const res = await useInquiryStore.getState().updateInquiry('missing', { subject: 'x' });
      expect(res).toEqual({ success: false, reason: 'not_found' });
      expect(inquiryApi.update).not.toHaveBeenCalled();
    });
  });

  describe('并发与多物料供应商定标（Task 17）', () => {
    it('并发更新不同实体互不覆盖', async () => {
      resetStore([makeInquiry({ id: 'a', subject: 'A' }), makeInquiry({ id: 'b', subject: 'B' })]);
      const [ra, rb] = await Promise.all([
        useInquiryStore.getState().updateInquiry('a', { subject: 'A-new' }),
        useInquiryStore.getState().updateInquiry('b', { subject: 'B-new' }),
      ]);
      expect(ra.success).toBe(true);
      expect(rb.success).toBe(true);
      // 两个实体各自的修改都保留，互不覆盖
      expect(useInquiryStore.getState().getInquiryById('a')?.subject).toBe('A-new');
      expect(useInquiryStore.getState().getInquiryById('b')?.subject).toBe('B-new');
    });

    it('更新一个物料的供应商选择不覆盖其他物料的选择（完整映射）', async () => {
      const inq = makeInquiry({
        id: 'inq-multi',
        status: InquiryStatus.ALL_QUOTED,
        selectedSupplierMap: { 'item-1': 'sup-1' },
      });
      resetStore([inq]);
      await useInquiryStore.getState().selectSupplier('inq-multi', 'item-2', 'sup-2');
      const updated = useInquiryStore.getState().getInquiryById('inq-multi');
      // 原有 item-1 的选择保留，item-2 的选择被追加
      expect(updated?.selectedSupplierMap).toEqual({
        'item-1': 'sup-1',
        'item-2': 'sup-2',
      });
    });

    it('重复修改同一物料选择会更新为新值（不残留旧值）', async () => {
      const inq = makeInquiry({ id: 'inq-multi2', status: InquiryStatus.ALL_QUOTED });
      resetStore([inq]);
      await useInquiryStore.getState().selectSupplier('inq-multi2', 'item-1', 'sup-1');
      await useInquiryStore.getState().selectSupplier('inq-multi2', 'item-1', 'sup-2');
      const updated = useInquiryStore.getState().getInquiryById('inq-multi2');
      expect(updated?.selectedSupplierMap).toEqual({ 'item-1': 'sup-2' });
    });

    it('重复修改同一物料会调用 API 更新最新完整映射', async () => {
      const inq = makeInquiry({
        id: 'inq-multi3',
        status: InquiryStatus.ALL_QUOTED,
        selectedSupplierMap: { 'item-1': 'sup-1' },
      });
      resetStore([inq]);
      await useInquiryStore.getState().selectSupplier('inq-multi3', 'item-2', 'sup-2');
      expect(inquiryApi.update).toHaveBeenCalledWith(
        'inq-multi3',
        expect.objectContaining({
          selectedSupplierMap: { 'item-1': 'sup-1', 'item-2': 'sup-2' },
        }),
      );
    });
  });
});

/**
 * 乐观锁版本回同步（回归：写操作丢弃服务端返回体、本地按 +1 猜测 version）
 * 服务端对每次写都 version += 1；若本地不采纳服务端返回值，
 * 下一次 updateInquiry 带着过期 version 提交 → 后端 409 → 界面「保存失败重试」。
 */
describe('写操作后回同步服务端 version', () => {
  it('选定供应商后的下一次写入携带服务端最新 version', async () => {
    let serverVersion = 5;
    const inq = makeInquiry({ id: 'inq-ver-1', version: 5 });
    useInquiryStore.setState({ inquiries: [inq], loaded: true });
    vi.mocked(inquiryApi.update).mockImplementation(async (id, data) => {
      serverVersion += 1;
      return { id, ...data, version: serverVersion } as unknown as Inquiry;
    });

    await useInquiryStore.getState().selectSupplier('inq-ver-1', 'item-1', 'sup-1');
    expect(useInquiryStore.getState().getInquiryById('inq-ver-1')?.version).toBe(6);

    await useInquiryStore
      .getState()
      .updateInquiry('inq-ver-1', { purchaserComments: { 'sup-1': '价格合理' } });
    expect(inquiryApi.update).toHaveBeenLastCalledWith(
      'inq-ver-1',
      expect.objectContaining({ version: 6, purchaserComments: { 'sup-1': '价格合理' } }),
    );
    expect(useInquiryStore.getState().getInquiryById('inq-ver-1')?.version).toBe(7);
  });

  it('状态动作（发送）同样采纳服务端返回的 version', async () => {
    const inq = makeInquiry({ id: 'inq-ver-2', version: 2, status: InquiryStatus.DRAFT });
    useInquiryStore.setState({ inquiries: [inq], loaded: true });
    vi.mocked(inquiryApi.send).mockResolvedValue({
      id: 'inq-ver-2',
      status: InquiryStatus.INQUIRING,
      version: 9,
    } as unknown as Inquiry);

    await useInquiryStore.getState().sendInquiry('inq-ver-2');
    const after = useInquiryStore.getState().getInquiryById('inq-ver-2');
    expect(after?.version).toBe(9);
  });
});

/**
 * R28：向导「创建 → 立即发送」两步之间落地的并发刷新，会把刚建的单从缓存里挤掉。
 * 现场证据：E2E 一次全量跑里 core-flow「审批驳回后不可定标」的首跑，后端日志有
 * POST /api/inquiries(200) 却没有随后的 /send，页面停在第 4 步、无报错提示、
 * 直到 60s 测试预算耗尽 —— 与 sendInquiry 的 `if (!getInquiryById) return notFound()`
 * 静默短路完全一致（onOk 里 `if (!sent.success) return;` 连提示都没有）。
 */
describe('并发刷新与刚创建实体之间的竞态（R28）', () => {
  it('loadFromApi 覆盖缓存后，sendInquiry 仍要发出请求，并让该单带着服务端状态回到列表', async () => {
    const draft = makeInquiry({ id: 'inq-race-1', status: InquiryStatus.DRAFT, version: 1 });
    resetStore([]);
    vi.mocked(inquiryApi.create).mockResolvedValue(draft);
    // 读写不原子：list 在 create 之后发出，但返回的是不含这一单的快照
    vi.mocked(inquiryApi.list).mockResolvedValue([makeInquiry({ id: 'inq-other' })]);
    vi.mocked(inquiryApi.send).mockResolvedValue({
      ...draft,
      status: InquiryStatus.INQUIRING,
      version: 2,
    });

    await useInquiryStore.getState().addInquiry(draft);
    await useInquiryStore.getState().loadFromApi();
    // 前提：缓存里确实已经没有这一单（否则下面断言的是恒真）
    expect(useInquiryStore.getState().getInquiryById('inq-race-1')).toBeUndefined();

    const sent = await useInquiryStore.getState().sendInquiry('inq-race-1');
    expect(sent.success).toBe(true);
    expect(inquiryApi.send).toHaveBeenCalledWith('inq-race-1');
    // 服务端返回的实体要能把被挤掉的单放回列表
    const after = useInquiryStore.getState().getInquiryById('inq-race-1');
    expect(after?.status).toBe(InquiryStatus.INQUIRING);
    expect(after?.version).toBe(2);
  });
});

/**
 * R30 残留：`loaded` 此前初值就是 true 且全仓零读者，等于一个没人核对过的假承诺。
 * 现在它有了读者（报价对比页用它区分「还没拿到列表」和「确实没有这张单」），
 * 语义必须和 useQuotationStore 的同名标记一致，否则直达/刷新比价页会闪一句
 * 「未找到该询价单」。
 */
describe('询价单列表加载状态（R30 残留）', () => {
  it('初值是「还没加载过」，不是「已加载且为空」', () => {
    const initial = useInquiryStore.getInitialState();
    expect(initial.loaded).toBe(false);
    expect(initial.loading).toBe(false);
  });

  it('请求在飞时 loading=true 且 loaded=false；落地后 loading=false、loaded=true', async () => {
    useInquiryStore.setState({ inquiries: [], loading: false, loaded: false });
    let release: (v: Inquiry[]) => void = () => {};
    const gate = new Promise<Inquiry[]>((r) => {
      release = r;
    });
    vi.mocked(inquiryApi.list).mockReturnValueOnce(gate);

    const done = useInquiryStore.getState().loadFromApi();
    const mid = useInquiryStore.getState();
    expect(mid.loading).toBe(true);
    expect(mid.loaded).toBe(false);

    release([makeInquiry({ id: 'inq-load-1' })]);
    await done;
    const after = useInquiryStore.getState();
    expect(after.loading).toBe(false);
    expect(after.loaded).toBe(true);
    expect(after.getInquiryById('inq-load-1')).toBeDefined();
  });

  it('加载失败也要把 loaded 置真，否则页面会被永久钉在骨架屏上', async () => {
    useInquiryStore.setState({ inquiries: [], loading: false, loaded: false });
    vi.mocked(inquiryApi.list).mockRejectedValueOnce(new Error('network down'));
    await useInquiryStore.getState().loadFromApi();
    const s = useInquiryStore.getState();
    expect(s.loading).toBe(false);
    expect(s.loaded).toBe(true);
  });
});

/** R33：与报价 store 同判据——加载结束 ≠ 数据可信 */
describe('询价单清单 loadError（R33）', () => {
  it('初值为 false；加载成功后清掉上一次的失败', () => {
    expect(useInquiryStore.getInitialState().loadError).toBe(false);
  });

  it('加载成功 → loadError=false；加载失败 → loaded=true 且 loadError=true', async () => {
    useInquiryStore.setState({ inquiries: [], loading: false, loaded: false, loadError: true });
    vi.mocked(inquiryApi.list).mockResolvedValueOnce([]);
    await useInquiryStore.getState().loadFromApi();
    expect(useInquiryStore.getState().loadError).toBe(false);

    useInquiryStore.setState({ loaded: false, loadError: false });
    vi.mocked(inquiryApi.list).mockRejectedValueOnce(new Error('boom'));
    await useInquiryStore.getState().loadFromApi();
    const s = useInquiryStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.loadError).toBe(true);
  });
});
