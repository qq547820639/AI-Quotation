/**
 * 询价单 store（核心）
 * - 初始化从 mock 加载，并尝试与 localStorage 合并草稿
 * - 所有写操作同步到 localStorage（key: procurement_inquiries）
 */
import { create } from 'zustand';
import dayjs from 'dayjs';
import { inquiries as mockInquiries } from '@/mock/inquiries';
import { supervisorUser, users } from '@/mock/users';
import {
  ApprovalNodeStatus,
  InquiryStatus,
  LogType,
  NotificationType,
  type ApprovalNode,
  type Inquiry,
  type InquiryLog,
} from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { inquiryApi } from '@/api';
import { useNotificationStore } from './useNotificationStore';
import { useAuthStore } from './useAuthStore';
import { useSettingsStore } from './useSettingsStore';
import { useConnectivityStore } from './useConnectivityStore';
import { MOCK_FALLBACK_ENABLED } from '@/config';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
import { isCancelable } from '@/utils/inquiryStatus';
import i18n from '@/i18n';
import {
  ok,
  fail,
  pending,
  notFound,
  type WriteResult,
  type BatchResult,
  type BatchItemResult,
} from './writeResult';

const STORAGE_KEY = 'inquiries';

/** 进行中的写操作（key: op:id），用于防重复提交 */
const pendingOps: Record<string, boolean> = {};

/** 将服务端返回的询价合并进本地状态（Task 6/7：同步 version 与服务端生成的 code） */
function applyServerInquiry(server: Inquiry) {
  if (!server || !server.id) return;
  useInquiryStore.setState((state) => {
    // 缓存里没有这条时（"创建→立刻发送"之间被一次并发 loadFromApi 挤掉）以服务端返回为准补回，
    // 否则这条记录在本地视图里彻底消失，而服务器上它已经改好状态了。见 R28。
    const exists = state.inquiries.some((i) => i.id === server.id);
    const inquiries = exists
      ? state.inquiries.map((i) => (i.id === server.id ? { ...i, ...server } : i))
      : [server, ...state.inquiries];
    saveJSON(STORAGE_KEY, inquiries);
    // P1-10 Task 15：同步 React Query 服务端缓存为服务端返回对象
    queryClient.setQueryData(QUERY_KEYS.inquiries, inquiries);
    return { inquiries };
  });
}

/**
 * 写入口的"本地没这条就按 id 补一条"（R113）。
 *
 * 判据沿用 R28 在 sendInquiry 里定下的那条（见本文件 :390 附近的注释）：
 * 一条单子存在与否由服务端判定，本地缓存不再是发请求的前提。R113 之前各页必须等整份数组
 * 到货才渲染，所以那八道 `getInquiryById(...) return notFound()` 事实上恒过；页面换成有界读之后
 * "渲染得了、数组里没有"成了真状态（e2e 一手读数：进审批页后 localStorage 的 inquiries 是空的，
 * 点「通过 → 确定」零请求零提示），写动作就在这里静默不发。
 * 补一条是"按 id 拿那一条"，不是补拉整份数组——无界那条本来就是本轮要拆的东西。
 * 两个调用纪律（都是本轮改的时候踩过的）：
 * ① 调用点的 `pendingOps` 锁必须占在任何 await 之前——先 await 再上锁等于把重复提交的窗口重新打开
 *   （常驻用例 useInquiryStore.test.ts 的去重格钉这条）；
 * ② 命中本地时不要 await 本函数，写成 `get().getInquiryById(id) ?? (await ensureLocalInquiry(id))`
 *   或 `!get().getInquiryById(id) && !(await ensureLocalInquiry(id))`：
 *   无条件 await 会把乐观更新推到下一个微任务，那五格「调用后立刻读 store」的用例当场红，
 *   用户侧也丢了「点了就变」的即时反馈。
 */
async function ensureLocalInquiry(id: string): Promise<Inquiry | undefined> {
  const local = useInquiryStore.getState().getInquiryById(id);
  if (local) return local;
  try {
    applyServerInquiry(await inquiryApi.get(id));
  } catch {
    // 拿不到就是拿不到：交回 undefined，由调用点按 not_found 报出去（fail-closed，不猜状态）
    return undefined;
  }
  return useInquiryStore.getState().getInquiryById(id);
}

/**
 * 整份清单落回本地时的合并（R113）：本地那条的版本比快照里的新 ⇒ 保留本地那条。
 *
 * 原来这里是 `set({ inquiries: data })` 整体替换。各页换成有界读之后，"本页已经能写"
 * 与"启动期那发 `list()` 还在飞"第一次成了并存状态：清单发出 → 服务端应答之间完成的那次写
 * 已经把版本进位，回来的一份**更早的快照**又把本地覆盖回旧版本号，下一次写就带着旧版本发出，
 * 服务端按乐观锁判 409（金链路 e2e 的评语保存实测红在这个位置）。
 * 删除的判定不变：快照里没有就等于没了——不为了这一条把本地独有的行留下，那会留幽灵行。
 * `version` 缺省（老数据/未带该列的响应）按 0 处理，即服务端说了算，与改前行为一致。
 */
function mergeIncomingList(local: Inquiry[], incoming: Inquiry[]): Inquiry[] {
  const byId = new Map(local.map((i) => [i.id, i]));
  return incoming.map((r) => {
    const l = byId.get(r.id);
    return l && (l.version ?? 0) > (r.version ?? 0) ? l : r;
  });
}

/** 生成日志条目（W4：操作人取自 useAuthStore） */
function createLog(
  inquiryId: string,
  type: LogType,
  content: string,
  result?: string,
  operator?: string,
  operatorRole?: string,
): InquiryLog {
  const user = useAuthStore.getState().currentUser;
  return {
    id: `log-${inquiryId}-${dayjs().valueOf()}`,
    inquiryId,
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    operator: operator ?? user.name,
    operatorRole: operatorRole ?? user.role,
    type,
    content,
    result,
  };
}

/** 聚合批量结果（Task 4） */
function aggregateBatch(
  ids: string[],
  settled: PromiseSettledResult<BatchItemResult>[],
): BatchResult {
  const results: BatchItemResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  settled.forEach((r, i) => {
    let item: BatchItemResult;
    if (r.status === 'fulfilled') {
      item = r.value;
    } else {
      item = { id: ids[i], success: false, reason: i18n.t('common.operateFailed') };
    }
    results.push(item);
    if (item.success) succeeded++;
    else if (item.skipped) skipped++;
    else failed++;
  });
  return { total: results.length, succeeded, failed, skipped, results };
}

/** 合并 mock 与 localStorage（localStorage 覆盖同 id，保留 mock 新增项） */
function mergeInquiries(): Inquiry[] {
  const saved = loadJSON<Inquiry[]>(STORAGE_KEY, []);
  if (!saved.length) return mockInquiries;
  const map = new Map<string, Inquiry>();
  mockInquiries.forEach((i) => map.set(i.id, i));
  saved.forEach((i) => map.set(i.id, i));
  return Array.from(map.values());
}

interface InquiryState {
  inquiries: Inquiry[];
  /**
   * 本次会话是否已完成过一次列表加载（成功或失败都算完成）。
   * 与 loading 一起区分「还没有数据」和「确实没有数据」：只看在飞会漏掉
   * 从未发起加载的首帧，只看 loading 会在加载结束后误钉骨架屏（R30）。
   */
  loaded: boolean;
  loading: boolean;
  /** 最近一次列表加载是否失败（失败时手里的数据不代表服务端真相，见 R33） */
  loadError: boolean;
  loadInquiries: () => void;
  /** W7.4：从 API 加载数据（失败时降级到 localStorage/mock） */
  loadFromApi: () => Promise<void>;
  getInquiryById: (id: string) => Inquiry | undefined;
  /** 按采购组织过滤可见询价单（W4 管理员 __ALL__ 不过滤） */
  getVisibleInquiries: (organization: string) => Inquiry[];
  addInquiry: (inquiry: Inquiry) => Promise<WriteResult>;
  updateInquiry: (id: string, patch: Partial<Inquiry>) => Promise<WriteResult>;
  deleteInquiry: (id: string) => Promise<WriteResult>;
  copyInquiry: (id: string) => Inquiry | undefined;
  cancelInquiry: (id: string) => Promise<WriteResult>;
  /** Task 4：批量取消（仅对可取消项执行，其余按状态跳过） */
  batchCancelInquiries: (ids: string[]) => Promise<BatchResult>;
  /** 批量发送询价（向全部受邀供应商发送）：更新状态为询价中并记录日志 */
  sendInquiry: (id: string) => Promise<WriteResult>;
  selectSupplier: (inquiryId: string, itemId: string, supplierId: string) => Promise<WriteResult>;
  confirmInquiry: (inquiryId: string) => Promise<WriteResult>;
  /** W5：提交审批（选定供应商后，总金额超阈值时触发） */
  submitForApproval: (inquiryId: string) => Promise<WriteResult>;
  /** W5：审批通过 */
  approveInquiry: (inquiryId: string, comment: string) => Promise<WriteResult>;
  /** W5：审批驳回 */
  rejectInquiry: (inquiryId: string, comment: string) => Promise<WriteResult>;
  addLog: (inquiryId: string, type: LogType, content: string, result?: string) => void;
}

/** 组织可见性过滤（纯函数）：store 选择器与页面派生 hook 共用，避免两处规则漂移 */
export function filterVisibleInquiries(inquiries: Inquiry[], organization: string): Inquiry[] {
  return organization === '__ALL__'
    ? inquiries
    : inquiries.filter((i) => i.organization === organization);
}

export const useInquiryStore = create<InquiryState>((set, get) => ({
  // P1-10 Task 15：生产模式不预置 mock 数据，仅演示模式允许（真实数据与 mock 隔离）
  inquiries: MOCK_FALLBACK_ENABLED ? mergeInquiries() : [],
  // 初值必须是"还没加载过"：把它当"已加载"的页面会在首屏把空数组读成"确实没有数据"（R30）。
  loaded: false,
  loading: false,
  loadError: false,

  loadInquiries: () => set({ inquiries: mergeInquiries(), loaded: true }),

  // W7.4 + P1-10 Task 15：从 API 加载；生产模式失败不静默回退 mock，标记离线/缓存过期
  loadFromApi: async () => {
    set({ loading: true });
    try {
      const data = await inquiryApi.list();
      // 本地状态要在**应答落地那一刻**才取：参数求值是从左到右的，
      // 把 get() 写在 await 之前会拿到请求发出时的旧数组，合并就白做了
      const merged = mergeIncomingList(get().inquiries, data);
      set({ inquiries: merged, loaded: true, loading: false, loadError: false });
      saveJSON(STORAGE_KEY, merged);
      queryClient.setQueryData(QUERY_KEYS.inquiries, merged);
      useConnectivityStore.getState().markSynced();
    } catch {
      // 仅演示模式允许降级到 mock/localStorage；生产模式禁止无提示回退
      if (MOCK_FALLBACK_ENABLED) {
        set({ inquiries: mergeInquiries(), loaded: true, loading: false, loadError: true });
      } else {
        // 失败同样算「这次加载结束了」：不置 loaded 会把依赖它的页面永久钉在骨架屏上，
        // 那比误报空态更糟（与 useQuotationStore.loadFromApi 同判据）；
        // 同时立起 loadError，让页面能说「没拿到」而不是「没有」（R33）。
        set({ loading: false, loaded: true, loadError: true });
        useConnectivityStore.getState().markOffline();
      }
    }
  },

  getInquiryById: (id) => get().inquiries.find((i) => i.id === id),

  getVisibleInquiries: (organization) => filterVisibleInquiries(get().inquiries, organization),

  addInquiry: async (inquiry) => {
    if (pendingOps[`add:${inquiry.id}`]) return pending();
    const snapshot = get().inquiries;
    pendingOps[`add:${inquiry.id}`] = true;
    try {
      set((state) => {
        const inquiries = [inquiry, ...state.inquiries];
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      const created = await inquiryApi.create(inquiry);
      // Task 7：编号由服务端生成，创建成功后用服务端 code 覆盖本地占位
      if (created && created.id) {
        applyServerInquiry(created);
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`add:${inquiry.id}`] = false;
    }
  },

  updateInquiry: async (id, patch) => {
    if (pendingOps[`update:${id}`]) return pending();
    pendingOps[`update:${id}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    const current = get().getInquiryById(id) ?? (await ensureLocalInquiry(id));
    if (!current) {
      pendingOps[`update:${id}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const inquiries = state.inquiries.map((i) =>
          i.id === id ? { ...i, ...patch, updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') } : i,
        );
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      // 写成功后一律以服务端返回实体（含权威 version）覆盖本地；
      // 原先本地 +1 猜测会在其他写入口（选定供应商/状态动作）递增后失配 → 下次写 409
      applyServerInquiry(await inquiryApi.update(id, { ...patch, version: current?.version }));
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`update:${id}`] = false;
    }
  },

  deleteInquiry: async (id) => {
    if (pendingOps[`delete:${id}`]) return pending();
    pendingOps[`delete:${id}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(id) && !(await ensureLocalInquiry(id))) {
      pendingOps[`delete:${id}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const inquiries = state.inquiries.filter((i) => i.id !== id);
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      await inquiryApi.delete(id);
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`delete:${id}`] = false;
    }
  },

  copyInquiry: (id) => {
    const source = get().getInquiryById(id);
    if (!source) return undefined;
    if (pendingOps[`copy:${id}`]) return undefined;
    const newId = `inq-${dayjs().valueOf()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    // 占位编号：真实编号由服务端生成，创建成功后用 applyServerInquiry 覆盖（Task 7）
    const placeholderCode = `INQ${dayjs().format('YYYYMMDD')}${String(dayjs().valueOf()).slice(-3)}`;
    const copy: Inquiry = {
      ...source,
      id: newId,
      code: placeholderCode,
      subject: `${source.subject}（副本）`,
      status: InquiryStatus.DRAFT,
      quotations: [],
      selectedSupplierMap: {},
      purchaserComments: {},
      logs: [createLog(newId, LogType.CREATE, `复制自询价单 ${source.code}`)],
      createdAt: nowStr,
      updatedAt: nowStr,
    };
    const snapshot = get().inquiries;
    pendingOps[`copy:${id}`] = true;
    set((state) => {
      const inquiries = [copy, ...state.inquiries];
      saveJSON(STORAGE_KEY, inquiries);
      return { inquiries };
    });
    inquiryApi
      .create(copy)
      .then((created) => {
        // Task 7：用服务端生成的编号覆盖本地占位
        if (created && created.id) applyServerInquiry(created);
      })
      .catch(() => {
        set({ inquiries: snapshot });
        saveJSON(STORAGE_KEY, snapshot);
      })
      .finally(() => {
        pendingOps[`copy:${id}`] = false;
      });
    return copy;
  },

  cancelInquiry: async (id) => {
    if (pendingOps[`cancel:${id}`]) return pending();
    pendingOps[`cancel:${id}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(id) && !(await ensureLocalInquiry(id))) {
      pendingOps[`cancel:${id}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== id) return i;
          return {
            ...i,
            status: InquiryStatus.CANCELLED,
            updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            logs: [...i.logs, createLog(id, LogType.CANCEL, '取消询价单', '已取消')],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      applyServerInquiry(await inquiryApi.cancel(id));
      // R53：服务端接受了这次取消才铸通知。改之前它在乐观 set() 体内先铸，
      // 而 catch 只回滚 inquiries ⇒ 被拒的取消会在通知中心留下永久的"已取消"记录（且无删除通知的 API 可撤）。
      const inq = get().getInquiryById(id);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId: id,
          type: NotificationType.SYSTEM,
          title: `询价单 ${inq.code} 已取消`,
          content: inq.subject,
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`cancel:${id}`] = false;
    }
  },

  batchCancelInquiries: async (ids) => {
    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const inquiry = get().getInquiryById(id);
        // 仅对可取消项执行；不可取消项跳过
        if (!inquiry || !isCancelable(inquiry.status)) {
          return {
            id,
            success: false,
            skipped: true,
            reason: i18n.t('inquiry.list.batchCancelSkippedReason'),
          };
        }
        const result = await get().cancelInquiry(id);
        if (result.success) return { id, success: true };
        return {
          id,
          success: false,
          reason: result.error?.message ?? i18n.t('common.operateFailed'),
        };
      }),
    );
    return aggregateBatch(ids, settled);
  },

  sendInquiry: async (id) => {
    if (pendingOps[`send:${id}`]) return pending();
    // 这里原先有一道 `if (!get().getInquiryById(id)) return notFound()` 的前置检查，
    // 而向导走的是"创建 → 立刻发送"：两次 await 之间只要落一次并发 loadFromApi
    // （SSE 重连补拉、列表页刷新都会触发），刚建的单就被整体替换掉的缓存挤掉，
    // 于是这里静默 return，onOk 的 `if (!sent.success) return;` 又什么都不提示 ——
    // 用户点了"发送"却什么都没发生（R28，E2E 里表现为等满 60s 且后端没有 /send 记录）。
    // 这条记录存在与否由服务端判定，本地缓存不再是发请求的前提。
    const snapshot = get().inquiries;
    pendingOps[`send:${id}`] = true;
    try {
      set((state) => {
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== id) return i;
          const count = i.invitedSupplierIds.length;
          return {
            ...i,
            status: InquiryStatus.INQUIRING,
            updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            logs: [
              ...i.logs,
              createLog(id, LogType.SEND_INQUIRY, `向 ${count} 家供应商发送询价`, '询价中'),
            ],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      applyServerInquiry(await inquiryApi.send(id));
      const inq = get().getInquiryById(id);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId: id,
          type: NotificationType.INQUIRY_SENT,
          title: `询价单 ${inq.code} 已发送`,
          content: `已向 ${inq.invitedSupplierIds.length} 家供应商发送询价`,
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`send:${id}`] = false;
    }
  },

  selectSupplier: async (inquiryId, itemId, supplierId) => {
    if (pendingOps[`select:${inquiryId}`]) return pending();
    pendingOps[`select:${inquiryId}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(inquiryId) && !(await ensureLocalInquiry(inquiryId))) {
      pendingOps[`select:${inquiryId}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== inquiryId) return i;
          const selectedSupplierMap = { ...i.selectedSupplierMap, [itemId]: supplierId };
          return {
            ...i,
            selectedSupplierMap,
            status:
              i.status === InquiryStatus.ALL_QUOTED ? InquiryStatus.PENDING_CONFIRM : i.status,
            updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            logs: [
              ...i.logs,
              createLog(
                inquiryId,
                LogType.SELECT_SUPPLIER,
                `为明细 ${itemId} 选择供应商 ${supplierId}`,
              ),
            ],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      const updated = get().inquiries.find((i) => i.id === inquiryId);
      if (updated) {
        applyServerInquiry(
          await inquiryApi.update(inquiryId, { selectedSupplierMap: updated.selectedSupplierMap }),
        );
      }
      const inq = get().getInquiryById(inquiryId);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId,
          type: NotificationType.SYSTEM,
          title: `询价单 ${inq.code} 已选定供应商`,
          content: `明细 ${itemId} 已选定供应商 ${supplierId}`,
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`select:${inquiryId}`] = false;
    }
  },

  confirmInquiry: async (inquiryId) => {
    if (pendingOps[`confirm:${inquiryId}`]) return pending();
    pendingOps[`confirm:${inquiryId}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(inquiryId) && !(await ensureLocalInquiry(inquiryId))) {
      pendingOps[`confirm:${inquiryId}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== inquiryId) return i;
          return {
            ...i,
            status: InquiryStatus.COMPLETED,
            updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            logs: [
              ...i.logs,
              createLog(inquiryId, LogType.CONFIRM_RESULT, '确认定标结果', '已完成'),
            ],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      applyServerInquiry(await inquiryApi.confirm(inquiryId));
      const inq = get().getInquiryById(inquiryId);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId,
          type: NotificationType.SYSTEM,
          title: `询价单 ${inq.code} 已确认定标`,
          content: '定标结果已确认，询价流程完成',
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`confirm:${inquiryId}`] = false;
    }
  },

  submitForApproval: async (inquiryId) => {
    if (pendingOps[`submitApproval:${inquiryId}`]) return pending();
    pendingOps[`submitApproval:${inquiryId}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(inquiryId) && !(await ensureLocalInquiry(inquiryId))) {
      pendingOps[`submitApproval:${inquiryId}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const { approval } = useSettingsStore.getState();
        const approver = users.find((u) => u.id === approval.approverId) ?? supervisorUser;
        const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== inquiryId) return i;
          const node: ApprovalNode = {
            id: `apv-${inquiryId}-${dayjs().valueOf()}`,
            inquiryId,
            nodeOrder: 1,
            approverId: approver.id,
            approverName: approver.name,
            approverRole: approver.role,
            status: ApprovalNodeStatus.PENDING,
          };
          return {
            ...i,
            status: InquiryStatus.PENDING_APPROVAL,
            approvalNodes: [...i.approvalNodes, node],
            updatedAt: nowStr,
            logs: [
              ...i.logs,
              createLog(inquiryId, LogType.SUBMIT_APPROVAL, `提交审批，审批人：${approver.name}`),
            ],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      applyServerInquiry(await inquiryApi.submitApproval(inquiryId));
      // 审批人按与乐观写同一套规则取（settings 里的审批人，缺省回退主管），
      // 原来这行是在 set() 体内算的，挪出来必须自带，否则读不到作用域里的 approver
      const approver =
        users.find((u) => u.id === useSettingsStore.getState().approval.approverId) ??
        supervisorUser;
      const inq = get().getInquiryById(inquiryId);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId,
          type: NotificationType.APPROVAL,
          title: `询价单 ${inq.code} 待审批`,
          content: `${inq.subject}（审批人：${approver.name}）`,
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`submitApproval:${inquiryId}`] = false;
    }
  },

  approveInquiry: async (inquiryId, comment) => {
    if (pendingOps[`approve:${inquiryId}`]) return pending();
    pendingOps[`approve:${inquiryId}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(inquiryId) && !(await ensureLocalInquiry(inquiryId))) {
      pendingOps[`approve:${inquiryId}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== inquiryId) return i;
          return {
            ...i,
            status: InquiryStatus.PENDING_CONFIRM,
            approvalNodes: i.approvalNodes.map((n) =>
              n.status === ApprovalNodeStatus.PENDING
                ? { ...n, status: ApprovalNodeStatus.APPROVED, comment, time: nowStr }
                : n,
            ),
            updatedAt: nowStr,
            logs: [
              ...i.logs,
              createLog(
                inquiryId,
                LogType.APPROVE,
                `审批通过${comment ? `：${comment}` : ''}`,
                '已通过',
              ),
            ],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      applyServerInquiry(await inquiryApi.approve(inquiryId, comment));
      const inq = get().getInquiryById(inquiryId);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId,
          type: NotificationType.APPROVAL,
          title: `询价单 ${inq.code} 审批通过`,
          content: '审批已通过，可进行定标确认',
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`approve:${inquiryId}`] = false;
    }
  },

  rejectInquiry: async (inquiryId, comment) => {
    if (pendingOps[`reject:${inquiryId}`]) return pending();
    pendingOps[`reject:${inquiryId}`] = true;
    // 本地有这条就直接往下（乐观更新要在同一轮同步里生效，见 useInquiryStore.test.ts 那五格）；
    // 只有缺这一条才 await 按 id 补那一条
    if (!get().getInquiryById(inquiryId) && !(await ensureLocalInquiry(inquiryId))) {
      pendingOps[`reject:${inquiryId}`] = false;
      return notFound();
    }
    const snapshot = get().inquiries;
    try {
      set((state) => {
        const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
        const inquiries = state.inquiries.map((i) => {
          if (i.id !== inquiryId) return i;
          return {
            ...i,
            status: InquiryStatus.RETURNED,
            approvalNodes: i.approvalNodes.map((n) =>
              n.status === ApprovalNodeStatus.PENDING
                ? { ...n, status: ApprovalNodeStatus.REJECTED, comment, time: nowStr }
                : n,
            ),
            updatedAt: nowStr,
            logs: [
              ...i.logs,
              createLog(
                inquiryId,
                LogType.REJECT,
                `审批驳回${comment ? `：${comment}` : ''}`,
                '已驳回',
              ),
            ],
          };
        });
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      applyServerInquiry(await inquiryApi.reject(inquiryId, comment));
      const inq = get().getInquiryById(inquiryId);
      if (inq) {
        void useNotificationStore.getState().addNotification({
          inquiryId,
          type: NotificationType.APPROVAL,
          title: `询价单 ${inq.code} 审批驳回`,
          content: comment || '审批已驳回，请重新评估',
        });
      }
      return ok();
    } catch (e) {
      set({ inquiries: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`reject:${inquiryId}`] = false;
    }
  },

  addLog: (inquiryId, type, content, result) =>
    set((state) => {
      const inquiries = state.inquiries.map((i) =>
        i.id === inquiryId
          ? { ...i, logs: [...i.logs, createLog(inquiryId, type, content, result)] }
          : i,
      );
      saveJSON(STORAGE_KEY, inquiries);
      return { inquiries };
    }),
}));
