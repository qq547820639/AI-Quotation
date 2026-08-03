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

const STORAGE_KEY = 'inquiries';

/** 生成询价单编号：INQYYYYMMDD + 3 位序号 */
function generateCode(): string {
  const date = dayjs().format('YYYYMMDD');
  const seq = String(dayjs().valueOf()).slice(-3);
  return `INQ${date}${seq}`;
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
  loadInquiries: () => void;
  /** W7.4：从 API 加载数据（失败时降级到 localStorage/mock） */
  loadFromApi: () => Promise<void>;
  getInquiryById: (id: string) => Inquiry | undefined;
  /** 按采购组织过滤可见询价单（W4 管理员 __ALL__ 不过滤） */
  getVisibleInquiries: (organization: string) => Inquiry[];
  addInquiry: (inquiry: Inquiry) => void;
  updateInquiry: (id: string, patch: Partial<Inquiry>) => void;
  deleteInquiry: (id: string) => void;
  copyInquiry: (id: string) => Inquiry | undefined;
  cancelInquiry: (id: string) => void;
  /** 批量发送询价（向全部受邀供应商发送）：更新状态为询价中并记录日志 */
  sendInquiry: (id: string) => void;
  selectSupplier: (inquiryId: string, itemId: string, supplierId: string) => void;
  confirmInquiry: (inquiryId: string) => void;
  /** W5：提交审批（选定供应商后，总金额超阈值时触发） */
  submitForApproval: (inquiryId: string) => void;
  /** W5：审批通过 */
  approveInquiry: (inquiryId: string, comment: string) => void;
  /** W5：审批驳回 */
  rejectInquiry: (inquiryId: string, comment: string) => void;
  addLog: (
    inquiryId: string,
    type: LogType,
    content: string,
    result?: string,
  ) => void;
}

export const useInquiryStore = create<InquiryState>((set, get) => ({
  inquiries: mergeInquiries(),
  loaded: true,

  loadInquiries: () => set({ inquiries: mergeInquiries(), loaded: true }),

  // W7.4：从 API 加载，失败时降级到 localStorage
  loadFromApi: async () => {
    try {
      const data = await inquiryApi.list();
      set({ inquiries: data, loaded: true });
      saveJSON(STORAGE_KEY, data);
    } catch {
      // API 不可用时降级到 localStorage/mock
      set({ inquiries: mergeInquiries(), loaded: true });
    }
  },

  getInquiryById: (id) => get().inquiries.find((i) => i.id === id),

  getVisibleInquiries: (organization) =>
    get().inquiries.filter((i) => (organization === '__ALL__' ? true : i.organization === organization)),

  addInquiry: (inquiry) => {
    set((state) => {
      const inquiries = [inquiry, ...state.inquiries];
      saveJSON(STORAGE_KEY, inquiries);
      return { inquiries };
    });
    inquiryApi.create(inquiry).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  updateInquiry: (id, patch) => {
    set((state) => {
      const inquiries = state.inquiries.map((i) =>
        i.id === id
          ? { ...i, ...patch, updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss') }
          : i,
      );
      saveJSON(STORAGE_KEY, inquiries);
      return { inquiries };
    });
    inquiryApi.update(id, patch).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  deleteInquiry: (id) => {
    set((state) => {
      const inquiries = state.inquiries.filter((i) => i.id !== id);
      saveJSON(STORAGE_KEY, inquiries);
      return { inquiries };
    });
    inquiryApi.delete(id).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  copyInquiry: (id) => {
    const source = get().getInquiryById(id);
    if (!source) return undefined;
    const newId = `inq-${dayjs().valueOf()}`;
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const copy: Inquiry = {
      ...source,
      id: newId,
      code: generateCode(),
      subject: `${source.subject}（副本）`,
      status: InquiryStatus.DRAFT,
      quotations: [],
      selectedSupplierMap: {},
      purchaserComments: {},
      logs: [createLog(newId, LogType.CREATE, `复制自询价单 ${source.code}`)],
      createdAt: nowStr,
      updatedAt: nowStr,
    };
    set((state) => {
      const inquiries = [copy, ...state.inquiries];
      saveJSON(STORAGE_KEY, inquiries);
      return { inquiries };
    });
    inquiryApi.create(copy).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
    return copy;
  },

  cancelInquiry: (id) => {
    set((state) => {
      const inquiries = state.inquiries.map((i) => {
        if (i.id !== id) return i;
        return {
          ...i,
          status: InquiryStatus.CANCELLED,
          updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          logs: [
            ...i.logs,
            createLog(id, LogType.CANCEL, '取消询价单', '已取消'),
          ],
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
    inquiryApi.cancel(id).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  sendInquiry: (id) => {
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
    inquiryApi.send(id).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  selectSupplier: (inquiryId, itemId, supplierId) => {
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
            createLog(inquiryId, LogType.SELECT_SUPPLIER, `为明细 ${itemId} 选择供应商 ${supplierId}`),
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
    inquiryApi.update(inquiryId, { selectedSupplierMap: { [itemId]: supplierId } }).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  confirmInquiry: (inquiryId) => {
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
    inquiryApi.confirm(inquiryId).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  submitForApproval: (inquiryId) => {
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
    inquiryApi.submitApproval(inquiryId).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  approveInquiry: (inquiryId, comment) => {
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
            createLog(inquiryId, LogType.APPROVE, `审批通过${comment ? `：${comment}` : ''}`, '已通过'),
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
    inquiryApi.approve(inquiryId, comment).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  rejectInquiry: (inquiryId, comment) => {
    set((state) => {
      const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
      const inquiries = state.inquiries.map((i) => {
        if (i.id !== inquiryId) return i;
        return {
          ...i,
          status: InquiryStatus.PENDING_CONFIRM,
          approvalNodes: i.approvalNodes.map((n) =>
            n.status === ApprovalNodeStatus.PENDING
              ? { ...n, status: ApprovalNodeStatus.REJECTED, comment, time: nowStr }
              : n,
          ),
          updatedAt: nowStr,
          logs: [
            ...i.logs,
            createLog(inquiryId, LogType.REJECT, `审批驳回${comment ? `：${comment}` : ''}`, '已驳回'),
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
    inquiryApi.reject(inquiryId, comment).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
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
