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
    const inquiries = state.inquiries.map((i) => (i.id === server.id ? { ...i, ...server } : i));
    saveJSON(STORAGE_KEY, inquiries);
    // P1-10 Task 15：同步 React Query 服务端缓存为服务端返回对象
    queryClient.setQueryData(QUERY_KEYS.inquiries, inquiries);
    return { inquiries };
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
  loaded: boolean;
  loading: boolean;
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

export const useInquiryStore = create<InquiryState>((set, get) => ({
  // P1-10 Task 15：生产模式不预置 mock 数据，仅演示模式允许（真实数据与 mock 隔离）
  inquiries: MOCK_FALLBACK_ENABLED ? mergeInquiries() : [],
  loaded: true,
  loading: false,

  loadInquiries: () => set({ inquiries: mergeInquiries(), loaded: true }),

  // W7.4 + P1-10 Task 15：从 API 加载；生产模式失败不静默回退 mock，标记离线/缓存过期
  loadFromApi: async () => {
    set({ loading: true });
    try {
      const data = await inquiryApi.list();
      set({ inquiries: data, loaded: true, loading: false });
      saveJSON(STORAGE_KEY, data);
      queryClient.setQueryData(QUERY_KEYS.inquiries, data);
      useConnectivityStore.getState().markSynced();
    } catch {
      // 仅演示模式允许降级到 mock/localStorage；生产模式禁止无提示回退
      if (MOCK_FALLBACK_ENABLED) {
        set({ inquiries: mergeInquiries(), loaded: true, loading: false });
      } else {
        set({ loading: false });
        useConnectivityStore.getState().markOffline();
      }
    }
  },

  getInquiryById: (id) => get().inquiries.find((i) => i.id === id),

  getVisibleInquiries: (organization) =>
    get().inquiries.filter((i) =>
      organization === '__ALL__' ? true : i.organization === organization,
    ),

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
    const current = get().getInquiryById(id);
    if (!current) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`update:${id}`] = true;
    try {
      set((state) => {
        const inquiries = state.inquiries.map((i) =>
          i.id === id ? { ...i, ...patch, updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') } : i,
        );
        saveJSON(STORAGE_KEY, inquiries);
        return { inquiries };
      });
      await inquiryApi.update(id, { ...patch, version: current?.version });
      const updated = get().getInquiryById(id);
      if (updated) {
        applyServerInquiry({ ...updated, version: (updated.version ?? 0) + 1 });
      }
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
    if (!get().getInquiryById(id)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`delete:${id}`] = true;
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
    if (!get().getInquiryById(id)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`cancel:${id}`] = true;
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
        const inq = inquiries.find((i) => i.id === id);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId: id,
            type: NotificationType.SYSTEM,
            title: `询价单 ${inq.code} 已取消`,
            content: inq.subject,
          });
        }
        return { inquiries };
      });
      await inquiryApi.cancel(id);
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
    if (!get().getInquiryById(id)) return notFound();
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
        const inq = inquiries.find((i) => i.id === id);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId: id,
            type: NotificationType.INQUIRY_SENT,
            title: `询价单 ${inq.code} 已发送`,
            content: `已向 ${inq.invitedSupplierIds.length} 家供应商发送询价`,
          });
        }
        return { inquiries };
      });
      await inquiryApi.send(id);
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
    if (!get().getInquiryById(inquiryId)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`select:${inquiryId}`] = true;
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
        const inq = inquiries.find((i) => i.id === inquiryId);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId,
            type: NotificationType.SYSTEM,
            title: `询价单 ${inq.code} 已选定供应商`,
            content: `明细 ${itemId} 已选定供应商 ${supplierId}`,
          });
        }
        return { inquiries };
      });
      const updated = get().inquiries.find((i) => i.id === inquiryId);
      if (updated) {
        await inquiryApi.update(inquiryId, { selectedSupplierMap: updated.selectedSupplierMap });
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
    if (!get().getInquiryById(inquiryId)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`confirm:${inquiryId}`] = true;
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
        const inq = inquiries.find((i) => i.id === inquiryId);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId,
            type: NotificationType.SYSTEM,
            title: `询价单 ${inq.code} 已确认定标`,
            content: '定标结果已确认，询价流程完成',
          });
        }
        return { inquiries };
      });
      await inquiryApi.confirm(inquiryId);
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
    if (!get().getInquiryById(inquiryId)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`submitApproval:${inquiryId}`] = true;
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
        const inq = inquiries.find((i) => i.id === inquiryId);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId,
            type: NotificationType.APPROVAL,
            title: `询价单 ${inq.code} 待审批`,
            content: `${inq.subject}（审批人：${approver.name}）`,
          });
        }
        return { inquiries };
      });
      await inquiryApi.submitApproval(inquiryId);
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
    if (!get().getInquiryById(inquiryId)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`approve:${inquiryId}`] = true;
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
        const inq = inquiries.find((i) => i.id === inquiryId);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId,
            type: NotificationType.APPROVAL,
            title: `询价单 ${inq.code} 审批通过`,
            content: '审批已通过，可进行定标确认',
          });
        }
        return { inquiries };
      });
      await inquiryApi.approve(inquiryId, comment);
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
    if (!get().getInquiryById(inquiryId)) return notFound();
    const snapshot = get().inquiries;
    pendingOps[`reject:${inquiryId}`] = true;
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
        const inq = inquiries.find((i) => i.id === inquiryId);
        if (inq) {
          useNotificationStore.getState().addNotification({
            inquiryId,
            type: NotificationType.APPROVAL,
            title: `询价单 ${inq.code} 审批驳回`,
            content: comment || '审批已驳回，请重新评估',
          });
        }
        return { inquiries };
      });
      await inquiryApi.reject(inquiryId, comment);
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
