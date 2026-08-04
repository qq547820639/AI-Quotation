/**
 * 供应商 store
 */
import { create } from 'zustand';
import { suppliers as mockSuppliers } from '@/mock/suppliers';
import { CooperationStatus, type Supplier } from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { supplierApi } from '@/api';
import { useConnectivityStore } from './useConnectivityStore';
import { MOCK_FALLBACK_ENABLED } from '@/config';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
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

const STORAGE_KEY = 'suppliers';

/** 进行中的写操作（key: op:id），用于防重复提交 */
const pendingOps: Record<string, boolean> = {};

/** 写操作成功后同步 React Query 服务端缓存（P1-10 Task 15） */
function syncCache(suppliers: Supplier[]) {
  queryClient.setQueryData(QUERY_KEYS.suppliers, suppliers);
}

/** 合并 mock 与 localStorage（localStorage 覆盖同 id） */
function mergeSuppliers(): Supplier[] {
  const saved = loadJSON<Supplier[]>(STORAGE_KEY, []);
  if (!saved.length) return mockSuppliers;
  const map = new Map<string, Supplier>();
  mockSuppliers.forEach((s) => map.set(s.id, s));
  saved.forEach((s) => map.set(s.id, s));
  return Array.from(map.values());
}

/** 把单个 toggle 的结果归一化为 BatchItemResult（Task 4） */
async function runSupplierToggle(
  id: string,
  resultPromise: Promise<WriteResult>,
): Promise<BatchItemResult> {
  const result = await resultPromise;
  if (result.success) return { id, success: true };
  return {
    id,
    success: false,
    reason: result.error?.message ?? i18n.t('common.operateFailed'),
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

interface SupplierState {
  suppliers: Supplier[];
  loading: boolean;
  /** W7.4：从 API 加载（失败时降级到 localStorage/mock） */
  loadFromApi: () => Promise<void>;
  getSupplierById: (id: string) => Supplier | undefined;
  toggleSupplierStatus: (id: string) => Promise<WriteResult>;
  updateSupplier: (id: string, patch: Partial<Supplier>) => Promise<WriteResult>;
  /** Task 4：批量启用（仅对 DISABLED 项执行，其余跳过，不反向停用） */
  batchEnableSuppliers: (ids: string[]) => Promise<BatchResult>;
  /** Task 4：批量停用（仅对非 DISABLED 项执行，其余跳过，不反向启用） */
  batchDisableSuppliers: (ids: string[]) => Promise<BatchResult>;
}

export const useSupplierStore = create<SupplierState>((set, get) => ({
  // P1-10 Task 15：生产模式不预置 mock 数据
  suppliers: MOCK_FALLBACK_ENABLED ? mergeSuppliers() : [],
  loading: false,

  // W7.4 + P1-10 Task 15：从 API 加载；生产模式失败不静默回退 mock
  loadFromApi: async () => {
    set({ loading: true });
    try {
      const data = await supplierApi.list();
      set({ suppliers: data, loading: false });
      saveJSON(STORAGE_KEY, data);
      queryClient.setQueryData(QUERY_KEYS.suppliers, data);
      useConnectivityStore.getState().markSynced();
    } catch {
      if (MOCK_FALLBACK_ENABLED) {
        set({ suppliers: mergeSuppliers(), loading: false });
      } else {
        set({ loading: false });
        useConnectivityStore.getState().markOffline();
      }
    }
  },

  getSupplierById: (id) => get().suppliers.find((s) => s.id === id),

  toggleSupplierStatus: async (id) => {
    if (pendingOps[`toggle:${id}`]) return pending();
    if (!get().getSupplierById(id)) return notFound();
    const snapshot = get().suppliers;
    pendingOps[`toggle:${id}`] = true;
    try {
      // 乐观更新本地状态（保持同步），API 失败时回滚
      set((state) => {
        const suppliers = state.suppliers.map((s) => {
          if (s.id !== id) return s;
          const next =
            s.cooperationStatus === CooperationStatus.DISABLED
              ? CooperationStatus.COOPERATING
              : CooperationStatus.DISABLED;
          return { ...s, cooperationStatus: next };
        });
        saveJSON(STORAGE_KEY, suppliers);
        return { suppliers };
      });
      await supplierApi.update(id, {});
      syncCache(get().suppliers);
      return ok();
    } catch (e) {
      set({ suppliers: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`toggle:${id}`] = false;
    }
  },

  updateSupplier: async (id, patch) => {
    if (pendingOps[`update:${id}`]) return pending();
    if (!get().getSupplierById(id)) return notFound();
    const snapshot = get().suppliers;
    pendingOps[`update:${id}`] = true;
    try {
      set((state) => {
        const suppliers = state.suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s));
        saveJSON(STORAGE_KEY, suppliers);
        return { suppliers };
      });
      await supplierApi.update(id, patch);
      syncCache(get().suppliers);
      return ok();
    } catch (e) {
      set({ suppliers: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`update:${id}`] = false;
    }
  },

  batchEnableSuppliers: async (ids) => {
    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const supplier = get().getSupplierById(id);
        // 仅对 DISABLED 项执行启用；其余已启用/其他状态均跳过，避免反向操作
        if (!supplier || supplier.cooperationStatus !== CooperationStatus.DISABLED) {
          return {
            id,
            success: false,
            skipped: true,
            reason: i18n.t('supplier.list.alreadyEnabled'),
          };
        }
        return runSupplierToggle(id, get().toggleSupplierStatus(id));
      }),
    );
    return aggregateBatch(ids, settled);
  },

  batchDisableSuppliers: async (ids) => {
    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const supplier = get().getSupplierById(id);
        // 仅对非 DISABLED 项执行停用；已停用项跳过，避免反向启用
        if (!supplier || supplier.cooperationStatus === CooperationStatus.DISABLED) {
          return {
            id,
            success: false,
            skipped: true,
            reason: i18n.t('supplier.list.alreadyDisabled'),
          };
        }
        return runSupplierToggle(id, get().toggleSupplierStatus(id));
      }),
    );
    return aggregateBatch(ids, settled);
  },
}));
