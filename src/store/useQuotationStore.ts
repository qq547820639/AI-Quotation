/**
 * 报价 store
 * - 初始化从 mock 加载，写操作同步 localStorage
 * - 提交报价时同步记录到对应询价单的 logs
 */
import { create } from 'zustand';
import dayjs from 'dayjs';
import { quotations as mockQuotations } from '@/mock/quotations';
import { LogType, NotificationType, QuotationStatus, type Quotation } from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { quotationApi } from '@/api';
import { useInquiryStore } from './useInquiryStore';
import { useNotificationStore } from './useNotificationStore';
import { ok, fail, pending, notFound, type WriteResult } from './writeResult';

const STORAGE_KEY = 'quotations';

/** 进行中的写操作（key: op:id），用于防重复提交 */
const pendingOps: Record<string, boolean> = {};

/** 合并 mock 与 localStorage */
function mergeQuotations(): Quotation[] {
  const saved = loadJSON<Quotation[]>(STORAGE_KEY, []);
  if (!saved.length) return mockQuotations;
  const map = new Map<string, Quotation>();
  mockQuotations.forEach((q) => map.set(q.id, q));
  saved.forEach((q) => map.set(q.id, q));
  return Array.from(map.values());
}

interface QuotationState {
  quotations: Quotation[];
  /** W7.4：从 API 加载（失败时降级到 localStorage/mock） */
  loadFromApi: () => Promise<void>;
  getQuotationsByInquiry: (inquiryId: string) => Quotation[];
  getQuotationById: (id: string) => Quotation | undefined;
  /** 暂存报价 */
  saveQuotationDraft: (quotation: Quotation) => Promise<WriteResult>;
  /** 供应商提交报价：更新状态为 SUBMITTED，并记录到询价日志 */
  submitQuotation: (quotationId: string) => Promise<WriteResult>;
  upsertQuotation: (quotation: Quotation) => Promise<WriteResult>;
}

export const useQuotationStore = create<QuotationState>((set, get) => ({
  quotations: mergeQuotations(),

  // W7.4：从 API 加载，失败时降级到 localStorage/mock
  loadFromApi: async () => {
    try {
      const data = await quotationApi.list();
      set({ quotations: data });
      saveJSON(STORAGE_KEY, data);
    } catch {
      set({ quotations: mergeQuotations() });
    }
  },

  getQuotationsByInquiry: (inquiryId) =>
    get().quotations.filter((q) => q.inquiryId === inquiryId),

  getQuotationById: (id) => get().quotations.find((q) => q.id === id),

  saveQuotationDraft: async (quotation) => {
    if (pendingOps[`draft:${quotation.id}`]) return pending();
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const exists = get().quotations.some((q) => q.id === quotation.id);
    const next: Quotation = {
      ...quotation,
      status: QuotationStatus.DRAFT,
      updatedAt: nowStr,
      createdAt: quotation.createdAt || nowStr,
    };
    const snapshot = get().quotations;
    pendingOps[`draft:${quotation.id}`] = true;
    try {
      set((state) => {
        const quotations = exists
          ? state.quotations.map((q) => (q.id === quotation.id ? next : q))
          : [...state.quotations, next];
        saveJSON(STORAGE_KEY, quotations);
        return { quotations };
      });
      // 同步记录暂存日志
      useInquiryStore
        .getState()
        .addLog(quotation.inquiryId, LogType.SAVE_QUOTATION_DRAFT, `${quotation.supplierName} 暂存报价`);
      await quotationApi.saveDraft(quotation.id, next);
      return ok();
    } catch (e) {
      set({ quotations: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`draft:${quotation.id}`] = false;
    }
  },

  submitQuotation: async (quotationId) => {
    if (pendingOps[`submit:${quotationId}`]) return pending();
    if (!get().getQuotationById(quotationId)) return notFound();
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    let target: Quotation | undefined;
    const snapshot = get().quotations;
    pendingOps[`submit:${quotationId}`] = true;
    try {
      set((state) => {
        const quotations = state.quotations.map((q) => {
          if (q.id !== quotationId) return q;
          target = {
            ...q,
            status: QuotationStatus.SUBMITTED,
            submittedAt: nowStr,
            updatedAt: nowStr,
          };
          return target;
        });
        saveJSON(STORAGE_KEY, quotations);
        return { quotations };
      });
      if (target) {
        useInquiryStore
          .getState()
          .addLog(target.inquiryId, LogType.SUBMIT_QUOTATION, `${target.supplierName} 提交报价`);
        useNotificationStore.getState().addNotification({
          inquiryId: target.inquiryId,
          type: NotificationType.QUOTATION_SUBMITTED,
          title: `${target.supplierName} 提交了报价`,
          content: `报价金额：${target.totalAmount.toFixed(2)}`,
        });
        await quotationApi.submit(quotationId);
      }
      return ok();
    } catch (e) {
      set({ quotations: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`submit:${quotationId}`] = false;
    }
  },

  upsertQuotation: async (quotation) => {
    if (pendingOps[`upsert:${quotation.id}`]) return pending();
    const exists = get().quotations.some((q) => q.id === quotation.id);
    const snapshot = get().quotations;
    pendingOps[`upsert:${quotation.id}`] = true;
    try {
      set((state) => {
        const quotations = exists
          ? state.quotations.map((q) => (q.id === quotation.id ? quotation : q))
          : [...state.quotations, quotation];
        saveJSON(STORAGE_KEY, quotations);
        return { quotations };
      });
      if (exists) {
        await quotationApi.saveDraft(quotation.id, quotation);
      } else {
        await quotationApi.create(quotation);
      }
      return ok();
    } catch (e) {
      set({ quotations: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`upsert:${quotation.id}`] = false;
    }
  },
}));
