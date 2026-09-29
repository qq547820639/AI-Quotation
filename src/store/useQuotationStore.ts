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
import { useConnectivityStore } from './useConnectivityStore';
import { MOCK_FALLBACK_ENABLED } from '@/config';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
import { ok, fail, pending, notFound, type WriteResult } from './writeResult';

const STORAGE_KEY = 'quotations';

/** 进行中的写操作（key: op:id），用于防重复提交 */
const pendingOps: Record<string, boolean> = {};

/** 写操作成功后同步 React Query 服务端缓存（P1-10 Task 15） */
function syncCache(quotations: Quotation[]) {
  queryClient.setQueryData(QUERY_KEYS.quotations, quotations);
}

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
  /**
   * 首帧与在飞标记：页面需要区分"报价列表还没到"与"到了、确实没有已提交报价"。
   * 没有这两个标记时，直达/刷新比价页会在请求在飞期间渲染成空态
   * （"该询价单暂无已提交报价"），而报价其实已经提交（见风险文档 R30）。
   */
  loading: boolean;
  loaded: boolean;
  /**
   * 最近一次列表加载是否失败（失败=手里的数据不代表服务端的真相）。
   * 页面据此区分「确实没有」与「没拿到」：只判 loaded 会把同步失败说成业务事实（R33）。
   */
  loadError: boolean;
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

/** R64-c：`loadFromApi` 的发起序号；只有最新一次发起的响应/失败才允许写 store */
let loadSeq = 0;

export const useQuotationStore = create<QuotationState>((set, get) => ({
  // P1-10 Task 15：生产模式不预置 mock 数据
  quotations: MOCK_FALLBACK_ENABLED ? mergeQuotations() : [],
  loading: false,
  loaded: false,
  loadError: false,

  // W7.4 + P1-10 Task 15：从 API 加载；生产模式失败不静默回退 mock
  loadFromApi: async () => {
    // R64-c：本页每周期会轮询 /api/quotations 约 9 次（后端访问日志实测 20 submit : 96 list），
    // 多个请求可以同时在飞，而响应落地顺序不保证等于发起顺序。
    // 没有这层序号，一个在写入之前发出的请求只要返回得晚，就会把已经含新数据的 store 覆盖回旧快照——
    // 此时 loaded=true、loadError=false，R30/R33 的守卫全部放行，页面于是诚实渲染"暂无已提交报价"。
    const mine = ++loadSeq;
    set({ loading: true });
    try {
      const data = await quotationApi.list();
      if (mine !== loadSeq) return; // 已有更晚发起的请求在飞/已落地，旧响应一律丢弃
      set({ quotations: data, loading: false, loaded: true, loadError: false });
      saveJSON(STORAGE_KEY, data);
      queryClient.setQueryData(QUERY_KEYS.quotations, data);
      useConnectivityStore.getState().markSynced();
    } catch {
      if (mine !== loadSeq) return; // 旧请求的失败同样不该覆盖新请求的结果（包括新请求已成功）
      // 无论成功失败，"这一次加载已经结束"，loaded 都要置真：
      // 否则加载失败会把页面永久钉在骨架屏上，比误报空态更糟。
      // 但 loaded 只回答"加载结束了"，不回答"数据可信"——后者由 loadError 表达（R33）。
      if (MOCK_FALLBACK_ENABLED) {
        set({ quotations: mergeQuotations(), loading: false, loaded: true, loadError: true });
      } else {
        set({ loading: false, loaded: true, loadError: true });
        useConnectivityStore.getState().markOffline();
      }
    }
  },

  getQuotationsByInquiry: (inquiryId) => get().quotations.filter((q) => q.inquiryId === inquiryId),

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
        .addLog(
          quotation.inquiryId,
          LogType.SAVE_QUOTATION_DRAFT,
          `${quotation.supplierName} 暂存报价`,
        );
      await quotationApi.saveDraft(quotation.id, next);
      syncCache(get().quotations);
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
        await quotationApi.submit(quotationId);
      }
      // R53：日志行与"提交了报价"这条通知都是"提交已发生"的主张，
      // 改前铸在 await quotationApi.submit 之前，而被 catch 回滚时两者都不撤 ⇒ 被拒的提交留下永久旁证。
      if (target) {
        useInquiryStore
          .getState()
          .addLog(target.inquiryId, LogType.SUBMIT_QUOTATION, `${target.supplierName} 提交报价`);
        void useNotificationStore.getState().addNotification({
          inquiryId: target.inquiryId,
          type: NotificationType.QUOTATION_SUBMITTED,
          title: `${target.supplierName} 提交了报价`,
          content: `报价金额：${target.totalAmount.toFixed(2)}`,
        });
      }
      syncCache(get().quotations);
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
      syncCache(get().quotations);
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
