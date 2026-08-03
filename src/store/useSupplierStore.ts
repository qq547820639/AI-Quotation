/**
 * 供应商 store
 */
import { create } from 'zustand';
import { suppliers as mockSuppliers } from '@/mock/suppliers';
import { CooperationStatus, type Supplier } from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { supplierApi } from '@/api';

const STORAGE_KEY = 'suppliers';

/** 合并 mock 与 localStorage（localStorage 覆盖同 id） */
function mergeSuppliers(): Supplier[] {
  const saved = loadJSON<Supplier[]>(STORAGE_KEY, []);
  if (!saved.length) return mockSuppliers;
  const map = new Map<string, Supplier>();
  mockSuppliers.forEach((s) => map.set(s.id, s));
  saved.forEach((s) => map.set(s.id, s));
  return Array.from(map.values());
}

interface SupplierState {
  suppliers: Supplier[];
  /** W7.4：从 API 加载（失败时降级到 localStorage/mock） */
  loadFromApi: () => Promise<void>;
  getSupplierById: (id: string) => Supplier | undefined;
  toggleSupplierStatus: (id: string) => void;
  updateSupplier: (id: string, patch: Partial<Supplier>) => void;
}

export const useSupplierStore = create<SupplierState>((set, get) => ({
  suppliers: mergeSuppliers(),

  // W7.4：从 API 加载，失败时降级到 localStorage/mock
  loadFromApi: async () => {
    try {
      const data = await supplierApi.list();
      set({ suppliers: data });
      saveJSON(STORAGE_KEY, data);
    } catch {
      set({ suppliers: mergeSuppliers() });
    }
  },

  getSupplierById: (id) => get().suppliers.find((s) => s.id === id),

  toggleSupplierStatus: (id) => {
    // 先更新本地状态保证 UI 响应，再异步同步到 API（失败静默降级）
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
    supplierApi.update(id, {}).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  updateSupplier: (id, patch) => {
    set((state) => {
      const suppliers = state.suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s));
      saveJSON(STORAGE_KEY, suppliers);
      return { suppliers };
    });
    supplierApi.update(id, patch).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },
}));
