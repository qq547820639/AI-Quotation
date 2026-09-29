/**
 * R113 常驻门：八个写动作在「本地数组没有这一条」时，必须先按 id 补那一条、再发自己那一发写请求。
 *
 * 现场证据（登记册 R113）：审批页与报价对比页换成有界读之后，「页面渲染得了、store 数组还是空的」
 * 成了真状态。改前这八处各有一道 `if (!get().getInquiryById(id)) return notFound()`，于是写动作
 * 在这里静默短路：一手读数是进审批页点「通过 → 确定」之后零条 /api 请求、localStorage 的
 * `procurement_inquiries` 根本不存在。现在八处都改成走 `ensureLocalInquiry`（与 sendInquiry 在
 * R28 里定下的那条判据同形：这条记录存在与否由服务端判定，本地缓存不再是发请求的前提）。
 *
 * 四组格子，缺一组就是假绿：
 *  - A 组：数组为空 + `inquiryApi.get` 成功 ⇒ 该动作发出自己的写请求（恰好一次）且 success=true。
 *          把 ensureLocalInquiry 退回旧的本地判别（`return getInquiryById(id)`）→ A 组全红。
 *  - B 组：数组为空 + `inquiryApi.get` 抛错 ⇒ reason=not_found，写请求一次都不发（fail-closed），
 *          并且不往 localStorage 落任何数组（补不到就不写，连回滚痕迹都不留）。
 *  - C 组：数组里已经有这条 ⇒ 不得再补发那一发按 id 的读（get 调用数为 0）。
 *          缺了这组，「每次都重新 GET 一遍」的实现也能全绿。
 *  - D 组：补那一条只许是按 id 的单条读——无参全量读 list/listPage 在整个 suite 里一次都不许出现；
 *          写请求在飞时同 id 再点一次只发一发；以及「数组里没这条」这个前提本身可判别（正向对照）。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { inDays } from '@/test/temporalFixtures';
import {
  ApprovalNodeStatus,
  Currency,
  InquiryStatus,
  LogType,
  type ApprovalNode,
  type Inquiry,
  type InquiryItem,
} from '@/types';
import type { WriteResult } from '@/store/writeResult';
import { useInquiryStore } from '../useInquiryStore';
import { useNotificationStore } from '../useNotificationStore';

/**
 * 桩掉整个 inquiry API 模块：store 里 `import { inquiryApi } from '@/api'` 拿到的就是这份对象。
 * 每个方法默认都是「开火即失败」的哨兵（见 resetApis），谁在多补不该补的请求，
 * 就会把所属动作推进 catch 分支、变成 success=false 而让本格发红，而不是静默通过。
 */
const api = vi.hoisted(() => ({
  list: vi.fn(),
  listPage: vi.fn(),
  counts: vi.fn(),
  logs: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  cancel: vi.fn(),
  send: vi.fn(),
  confirm: vi.fn(),
  submitApproval: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('@/api/inquiryApi', () => ({ inquiryApi: api }));

/** 夹具：乐观锁版本。updateInquiry 的写请求必须带上它，且它只能来自补回来的那一条 */
const VERSION = 7;
/** 夹具里已有的那条选定供应商映射：selectSupplier 的写请求要原样带上它，证明读回的是服务端那条 */
const PRESELECTED_ITEM = 'item-1';
const PRESELECTED_SUPPLIER = 'sup-1';
const NEW_ITEM = 'item-9';
const NEW_SUPPLIER = 'sup-9';
const SUBJECT_AFTER = 'R113 补拉后的主题';
const APPROVAL_COMMENT = '同意';
const REJECT_COMMENT = '价格过高';

function makeItem(overrides: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: PRESELECTED_ITEM,
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

function makeNode(inquiryId: string): ApprovalNode {
  return {
    id: `apv-${inquiryId}-1`,
    inquiryId,
    nodeOrder: 1,
    approverId: 'u-supervisor',
    approverName: '主管',
    approverRole: 'supervisor',
    status: ApprovalNodeStatus.PENDING,
  };
}

/** 构造满足真实 Inquiry 类型的夹具（形状沿用 useInquiryStore.test.ts 的 makeInquiry） */
function makeFixture(id: string, status: InquiryStatus): Inquiry {
  return {
    id,
    code: 'INQ20260801001',
    subject: '测试询价单',
    organization: '总部采购中心',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: Currency.CNY,
    // 截止用相对当前时刻生成：绝对日期会在真实时间越过后把这条单变成过期单，
    // 从而静默改写被测代码走的分支。
    deadline: inDays(30),
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [makeItem({ inquiryId: id, id: `${id}-item-1` })],
    invitedSupplierIds: ['sup-1', 'sup-2'],
    quotations: [],
    logs: [],
    status,
    createdById: 'u-1',
    createdByName: '采购员',
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    selectedSupplierMap: { [PRESELECTED_ITEM]: PRESELECTED_SUPPLIER },
    purchaserComments: {},
    approvalNodes: status === InquiryStatus.PENDING_APPROVAL ? [makeNode(id)] : [],
    version: VERSION,
  };
}

const read = (id: string) => useInquiryStore.getState().getInquiryById(id);
const hasLog = (id: string, type: LogType) => read(id)?.logs.some((l) => l.type === type) ?? false;
const nodeStatus = (id: string) => read(id)?.approvalNodes[0]?.status;

/** 写请求发出的那一刻能看到的现场 */
interface AtWrite {
  /** 那一刻本地数组里的这一条（补拉没落地就是 undefined） */
  inquiry: Inquiry | undefined;
  /** 那一刻已经发出的「按 id 的单条读」条数，用来证明补拉排在写请求之前 */
  boundedReads: number;
}

/** 通用期望：写请求发出时，按 id 补的那一条已经在数组里 */
function expectLandedAtWrite(id: string, snap: AtWrite) {
  expect(snap.boundedReads).toBe(1);
  expect(snap.inquiry?.id).toBe(id);
  expect(snap.inquiry?.version).toBe(VERSION);
}

/** 一格：一个写动作 + 它必须发出的那一发写请求 + 补回来的那条读成什么样才算落地 */
interface Cell {
  name: string;
  /** 每格专用 id：不同格子不复用，免得 pendingOps 与数组残留串格 */
  id: string;
  /** 夹具状态：按各动作自身的语义取它 happy path 上那一个（八个动作都没有状态前置门槛） */
  status: InquiryStatus;
  /** 该动作必须发出的那一发写请求 */
  write: Mock;
  /** 调用该动作 */
  action: (id: string) => Promise<WriteResult>;
  /** 那一发写请求的参数期望 */
  writeArgs: (id: string) => unknown[];
  /** 写请求发出那一刻的现场期望；省略即 expectLandedAtWrite（补拉已落地） */
  atWrite?: (id: string, snap: AtWrite) => void;
  /** 写完之后本地回读：补拉与乐观写都落地了长什么样 */
  readBack: (id: string) => void;
}

const CELLS: Cell[] = [
  {
    name: 'updateInquiry',
    id: 'inq-r113-update',
    status: InquiryStatus.DRAFT,
    write: api.update,
    action: (id) => useInquiryStore.getState().updateInquiry(id, { subject: SUBJECT_AFTER }),
    // version 只能来自补回来的那一条：本地数组改前是空的，凭空猜不出来
    writeArgs: (id) => [id, expect.objectContaining({ subject: SUBJECT_AFTER, version: VERSION })],
    readBack: (id) => expect(read(id)?.subject).toBe(SUBJECT_AFTER),
  },
  {
    name: 'deleteInquiry',
    id: 'inq-r113-delete',
    status: InquiryStatus.DRAFT,
    write: api.delete,
    action: (id) => useInquiryStore.getState().deleteInquiry(id),
    writeArgs: (id) => [id],
    // 删除的乐观写先把这条从数组里摘掉、再发 DELETE，所以「发出的那一刻」它必然不在数组里；
    // 它的顺序证据是那一刻补拉那发按 id 的读已经发出去了（=1）。
    atWrite: (_id, snap) => {
      expect(snap.boundedReads).toBe(1);
      expect(snap.inquiry).toBeUndefined();
    },
    // 删除是唯一「写完就不该再有这条」的动作：它的落地面是数组被清空
    readBack: (id) => expect(read(id)).toBeUndefined(),
  },
  {
    name: 'cancelInquiry',
    id: 'inq-r113-cancel',
    status: InquiryStatus.INQUIRING,
    write: api.cancel,
    action: (id) => useInquiryStore.getState().cancelInquiry(id),
    writeArgs: (id) => [id],
    readBack: (id) => {
      expect(read(id)?.status).toBe(InquiryStatus.CANCELLED);
      expect(hasLog(id, LogType.CANCEL)).toBe(true);
    },
  },
  {
    name: 'selectSupplier',
    id: 'inq-r113-select',
    status: InquiryStatus.ALL_QUOTED,
    write: api.update,
    action: (id) => useInquiryStore.getState().selectSupplier(id, NEW_ITEM, NEW_SUPPLIER),
    // 完整映射：item-1 那条只存在于补回来的服务端实体里，漏读它这里就对不上
    writeArgs: (id) => [
      id,
      {
        selectedSupplierMap: {
          [PRESELECTED_ITEM]: PRESELECTED_SUPPLIER,
          [NEW_ITEM]: NEW_SUPPLIER,
        },
      },
    ],
    readBack: (id) => {
      expect(read(id)?.selectedSupplierMap).toEqual({
        [PRESELECTED_ITEM]: PRESELECTED_SUPPLIER,
        [NEW_ITEM]: NEW_SUPPLIER,
      });
      expect(read(id)?.status).toBe(InquiryStatus.PENDING_CONFIRM);
      expect(hasLog(id, LogType.SELECT_SUPPLIER)).toBe(true);
    },
  },
  {
    name: 'confirmInquiry',
    id: 'inq-r113-confirm',
    status: InquiryStatus.PENDING_CONFIRM,
    write: api.confirm,
    action: (id) => useInquiryStore.getState().confirmInquiry(id),
    writeArgs: (id) => [id],
    readBack: (id) => {
      expect(read(id)?.status).toBe(InquiryStatus.COMPLETED);
      expect(hasLog(id, LogType.CONFIRM_RESULT)).toBe(true);
    },
  },
  {
    name: 'submitForApproval',
    id: 'inq-r113-submit',
    status: InquiryStatus.PENDING_CONFIRM,
    write: api.submitApproval,
    action: (id) => useInquiryStore.getState().submitForApproval(id),
    writeArgs: (id) => [id],
    readBack: (id) => {
      expect(read(id)?.status).toBe(InquiryStatus.PENDING_APPROVAL);
      expect(read(id)?.approvalNodes).toHaveLength(1);
      expect(nodeStatus(id)).toBe(ApprovalNodeStatus.PENDING);
      expect(hasLog(id, LogType.SUBMIT_APPROVAL)).toBe(true);
    },
  },
  {
    name: 'approveInquiry',
    id: 'inq-r113-approve',
    status: InquiryStatus.PENDING_APPROVAL,
    write: api.approve,
    action: (id) => useInquiryStore.getState().approveInquiry(id, APPROVAL_COMMENT),
    writeArgs: (id) => [id, APPROVAL_COMMENT],
    readBack: (id) => {
      expect(read(id)?.status).toBe(InquiryStatus.PENDING_CONFIRM);
      expect(nodeStatus(id)).toBe(ApprovalNodeStatus.APPROVED);
      expect(hasLog(id, LogType.APPROVE)).toBe(true);
    },
  },
  {
    name: 'rejectInquiry',
    id: 'inq-r113-reject',
    status: InquiryStatus.PENDING_APPROVAL,
    write: api.reject,
    action: (id) => useInquiryStore.getState().rejectInquiry(id, REJECT_COMMENT),
    writeArgs: (id) => [id, REJECT_COMMENT],
    readBack: (id) => {
      expect(read(id)?.status).toBe(InquiryStatus.RETURNED);
      expect(nodeStatus(id)).toBe(ApprovalNodeStatus.REJECTED);
      expect(hasLog(id, LogType.REJECT)).toBe(true);
    },
  },
];

const INQUIRY_STORAGE_KEY = 'procurement_inquiries';

/** 无参全量读的累计计数：beforeEach 累加后清零，D 组拿它对整个 suite 求和 */
const unboundedReads = { list: 0, listPage: 0 };

/** 把 api 上所有 vi.fn() 复位成「开火即失败」的哨兵默认值 */
function resetApis() {
  Object.values(api).forEach((mock) => mock.mockReset());
  const unbounded = () =>
    new Error('补那一条必须是按 id 的单条读：这里出现了无参全量读（list/listPage）');
  api.list.mockRejectedValue(unbounded());
  api.listPage.mockRejectedValue(unbounded());
  api.counts.mockRejectedValue(new Error('本格不该发 counts 请求'));
  api.logs.mockRejectedValue(new Error('本格不该发 logs 请求'));
  api.create.mockRejectedValue(new Error('写动作不该走 create'));
  api.send.mockRejectedValue(new Error('本格不该发 send 请求'));
  // 按 id 的单条读默认不开火：只有 A/D 组明确备料，C 组靠它证明「命中本地快路就没读」
  api.get.mockRejectedValue(new Error('本格没有为按 id 的单条读备料'));
  // 八个写请求同样默认不开火，本格用 armWrite 只装它自己那一发
  api.update.mockRejectedValue(new Error('本格没有为 update 备料'));
  api.delete.mockRejectedValue(new Error('本格没有为 delete 备料'));
  api.cancel.mockRejectedValue(new Error('本格没有为 cancel 备料'));
  api.confirm.mockRejectedValue(new Error('本格没有为 confirm 备料'));
  api.submitApproval.mockRejectedValue(new Error('本格没有为 submitApproval 备料'));
  api.approve.mockRejectedValue(new Error('本格没有为 approve 备料'));
  api.reject.mockRejectedValue(new Error('本格没有为 reject 备料'));
}

function resetState() {
  useInquiryStore.setState({ inquiries: [], loaded: true, loading: false, loadError: false });
}

/** A 组备料：服务端有这一条，按 id 的单条读取得到它（id 不匹配就当取不到） */
function armFetchById(cell: Cell) {
  api.get.mockImplementation(async (id: string) => {
    if (id !== cell.id) throw new Error(`补拉读错了 id：期望 ${cell.id}，实际 ${id}`);
    return makeFixture(cell.id, cell.status);
  });
}

/** B 组备料：按 id 也补不到这一条 */
function armFetchFails(cell: Cell) {
  api.get.mockRejectedValue(new Error(`服务端没有这一条：${cell.id}`));
}

/** 装本格的写请求：默认直接返回服务端空实体（applyServerInquiry 见无 id 即不改本地） */
function armWrite(cell: Cell) {
  cell.write.mockResolvedValue({});
}

/**
 * 装本格的写请求，并在「请求发出的那一刻」拍下本地现场。
 * 这是补拉落地最硬的一处证据：要看到的是写请求发出时的状态，而不是动作跑完后的状态
 * （deleteInquiry 跑完时这条按设计已经不在数组里了，跑完后回读分不开「没补到」和「补到又删掉」）。
 */
function armWriteCapturing(cell: Cell, capture: (snap: AtWrite) => void) {
  cell.write.mockImplementation(async () => {
    capture({ inquiry: read(cell.id), boundedReads: api.get.mock.calls.length });
    return {};
  });
}

/** 让出宏任务直到那一发写请求真的发出（在飞窗口打开）；始终不发出即本格判红 */
async function untilWriteFired(mock: Mock) {
  for (let i = 0; i < 100; i++) {
    if (mock.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('写请求始终没发出：在飞窗口没打开，本格无从判定');
}

beforeEach(() => {
  unboundedReads.list += api.list.mock.calls.length;
  unboundedReads.listPage += api.listPage.mock.calls.length;
  resetApis();
  resetState();
  // selectSupplier/cancel/confirm/... 会铸通知；桩掉它，避免真发通知侧请求
  vi.spyOn(useNotificationStore.getState(), 'addNotification').mockResolvedValue({
    success: true,
  } as WriteResult);
  // 清掉上一格落的数组，B 组才有「一次都没写」这个可判别的分母
  localStorage.removeItem(INQUIRY_STORAGE_KEY);
});

describe('R113 写入口按 id 补一条（useInquiryStore）', () => {
  describe('A 组：数组为空 + 按 id 补拉成功 ⇒ 发出自己的写请求', () => {
    it.each(CELLS)('$name：补得到就必须发写请求', async (cell) => {
      armFetchById(cell);
      let snap: AtWrite | undefined;
      armWriteCapturing(cell, (at) => {
        snap = at;
      });

      // 前提（正向对照的可判别面）：写动作之前本地数组里没有这一条
      expect(read(cell.id)).toBeUndefined();

      const result = await cell.action(cell.id);

      expect(result.success).toBe(true);
      // 补拉是「按 id 的单条读」且只有一发
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledWith(cell.id);
      // 无参全量读一次都没发
      expect(api.list).not.toHaveBeenCalled();
      expect(api.listPage).not.toHaveBeenCalled();
      // 该动作自己那一发写请求：恰好一次、参数按实现形状
      expect(cell.write).toHaveBeenCalledTimes(1);
      expect(cell.write).toHaveBeenCalledWith(...cell.writeArgs(cell.id));
      // 补拉真的落地了：写请求发出的那一刻的现场（D 组第 3 格另给一份前后对照）
      expect(snap).toBeDefined();
      (cell.atWrite ?? expectLandedAtWrite)(cell.id, snap as AtWrite);
      cell.readBack(cell.id);
    });
  });

  describe('B 组：数组为空 + 按 id 补不到 ⇒ not_found 且一发写请求都不发', () => {
    it.each(CELLS)('$name：补不到就不写（fail-closed）', async (cell) => {
      armFetchFails(cell);
      armWrite(cell);
      expect(read(cell.id)).toBeUndefined();

      const result = await cell.action(cell.id);

      // 一份聚合计费单：写请求没发、按 id 读了 1 发、无参全量读 0 发、回执是 not_found，
      // 四样在同一条断言里同时判，谁失配都在 diff 上点名（免得先红的那条把后面的挡成乘客）。
      expect({
        success: result.success,
        reason: result.reason,
        writeCalls: cell.write.mock.calls.length,
        boundedReadCalls: api.get.mock.calls.length,
        unboundedReadCalls: api.list.mock.calls.length + api.listPage.mock.calls.length,
        persisted: localStorage.getItem(INQUIRY_STORAGE_KEY),
        inquiries: useInquiryStore.getState().inquiries,
      }).toEqual({
        success: false,
        // 写动作的前置门槛被摘掉时这里是 undefined，等于「补不到也照样写」
        reason: 'not_found',
        // fail-closed 的那一半：补不到就一发写请求都不许发
        writeCalls: 0,
        boundedReadCalls: 1,
        unboundedReadCalls: 0,
        // 连回滚用的数组都没往 localStorage 落：失败面也不留痕
        persisted: null,
        inquiries: [],
      });
    });
  });

  describe('C 组：数组里已经有这条 ⇒ 不得再补发那一发按 id 的读（本地快路）', () => {
    it.each(CELLS)('$name：命中本地就不重新 GET', async (cell) => {
      resetState();
      useInquiryStore.setState({ inquiries: [makeFixture(cell.id, cell.status)] });
      armWrite(cell);
      // api.get 这里是「开火即抛错」的哨兵默认值：真按每次都重新 GET 写的实现，
      // 在这组里会同时丢两样东西——success 与 get 调用数为 0。

      expect(read(cell.id)).toBeDefined();

      const result = await cell.action(cell.id);

      expect(result.success).toBe(true);
      expect(api.get).not.toHaveBeenCalled();
      expect(cell.write).toHaveBeenCalledTimes(1);
      expect(cell.write).toHaveBeenCalledWith(...cell.writeArgs(cell.id));
      cell.readBack(cell.id);
    });
  });

  describe('D 组：补的是有界的那一条，不是整份数组', () => {
    it('八个动作全程只按 id 单条读：无参全量读在整个 suite 里累计为 0', async () => {
      // 本格自己再跑一遍八个动作，然后对「历史累计 + 本格」求和
      api.get.mockImplementation(async (id: string) => {
        const cell = CELLS.find((c) => c.id === id);
        if (!cell) throw new Error(`补拉读了没备料的 id：${id}`);
        return makeFixture(cell.id, cell.status);
      });
      CELLS.forEach((cell) => armWrite(cell));

      const results = await Promise.all(CELLS.map((cell) => cell.action(cell.id)));

      results.forEach((result) => expect(result.success).toBe(true));
      // 每个动作一发按 id 的读，不多不少
      expect(api.get).toHaveBeenCalledTimes(CELLS.length);
      CELLS.forEach((cell) => expect(api.get).toHaveBeenCalledWith(cell.id));
      expect(unboundedReads.list + api.list.mock.calls.length).toBe(0);
      expect(unboundedReads.listPage + api.listPage.mock.calls.length).toBe(0);
    });

    it('写请求在飞时同一条再点一次，只发一发写请求（补拉没有多出第二发读）', async () => {
      const cell = CELLS[0];
      armFetchById(cell);
      let release: (value: unknown) => void = () => {};
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      cell.write.mockImplementation(async () => gate);

      const first = cell.action(cell.id);
      await untilWriteFired(cell.write);
      const second = await cell.action(cell.id);
      release({});
      const result = await first;

      expect(result.success).toBe(true);
      expect(second).toEqual({ success: false, reason: 'pending' });
      expect(cell.write).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it('前提可判别：同一个 id 在数组里外两种状态下，读到的东西不一样', async () => {
      const cell = CELLS[6];
      armFetchById(cell);
      armWrite(cell);
      expect(useInquiryStore.getState().getInquiryById(cell.id)).toBeUndefined();

      await cell.action(cell.id);

      // 补拉把这一条放回数组——否则上面那句 toBeUndefined 与下面这句就是同一件事的两次重复
      expect(useInquiryStore.getState().getInquiryById(cell.id)).toBeDefined();
      expect(unboundedReads.list + api.list.mock.calls.length).toBe(0);
    });
  });
});
