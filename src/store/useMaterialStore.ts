/**
 * 物料库 store
 * - W7.4：初始化从 mock 加载，支持 loadFromApi 从 API 加载（失败降级）
 * - Task 4：写操作统一返回 WriteResult，乐观更新 + 成功后回滚 + 防重复提交
 */
import { create } from 'zustand';
import { materials as mockMaterials } from '@/mock/materials';
import type { Material } from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { materialApi } from '@/api';
import { useConnectivityStore } from './useConnectivityStore';
import { MOCK_FALLBACK_ENABLED } from '@/config';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
import { ok, fail, pending, notFound, type WriteResult } from './writeResult';

const STORAGE_KEY = 'materials';

/** 进行中的写操作（key: op:id），用于防重复提交 */
const pendingOps: Record<string, boolean> = {};

/** 写操作成功后同步 React Query 服务端缓存（P1-10 Task 15） */
function syncCache(materials: Material[]) {
  queryClient.setQueryData(QUERY_KEYS.materials, materials);
}

/** 合并 mock 与 localStorage（localStorage 覆盖同 id） */
function mergeMaterials(): Material[] {
  const saved = loadJSON<Material[]>(STORAGE_KEY, []);
  if (!saved.length) return mockMaterials;
  const map = new Map<string, Material>();
  mockMaterials.forEach((m) => map.set(m.id, m));
  saved.forEach((m) => map.set(m.id, m));
  return Array.from(map.values());
}

interface MaterialState {
  materials: Material[];
  /** W7.4：从 API 加载（失败时降级到 localStorage/mock） */
  loadFromApi: () => Promise<void>;
  getMaterialById: (id: string) => Material | undefined;
  getMaterialByCode: (code: string) => Material | undefined;
  addMaterial: (material: Material) => Promise<WriteResult>;
  updateMaterial: (id: string, patch: Partial<Material>) => Promise<WriteResult>;
  deleteMaterial: (id: string) => Promise<WriteResult>;
}

export const useMaterialStore = create<MaterialState>((set, get) => ({
  // P1-10 Task 15：生产模式不预置 mock 数据
  materials: MOCK_FALLBACK_ENABLED ? mergeMaterials() : [],

  // W7.4 + P1-10 Task 15：从 API 加载；生产模式失败不静默回退 mock
  loadFromApi: async () => {
    try {
      const data = await materialApi.list();
      set({ materials: data });
      saveJSON(STORAGE_KEY, data);
      queryClient.setQueryData(QUERY_KEYS.materials, data);
      useConnectivityStore.getState().markSynced();
    } catch {
      if (MOCK_FALLBACK_ENABLED) {
        set({ materials: mergeMaterials() });
      } else {
        useConnectivityStore.getState().markOffline();
      }
    }
  },

  getMaterialById: (id) => get().materials.find((m) => m.id === id),
  getMaterialByCode: (code) => get().materials.find((m) => m.code === code),

  // Task 4：乐观更新 + 服务端确认 + 失败回滚 + 防重复提交
  addMaterial: async (material) => {
    if (pendingOps[`add:${material.id}`]) return pending();
    const snapshot = get().materials;
    pendingOps[`add:${material.id}`] = true;
    try {
      set((state) => {
        const materials = [...state.materials, material];
        saveJSON(STORAGE_KEY, materials);
        return { materials };
      });
      await materialApi.create(material);
      syncCache(get().materials);
      return ok();
    } catch (e) {
      set({ materials: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`add:${material.id}`] = false;
    }
  },

  updateMaterial: async (id, patch) => {
    if (pendingOps[`update:${id}`]) return pending();
    if (!get().getMaterialById(id)) return notFound();
    const snapshot = get().materials;
    pendingOps[`update:${id}`] = true;
    try {
      set((state) => {
        const materials = state.materials.map((m) => (m.id === id ? { ...m, ...patch } : m));
        saveJSON(STORAGE_KEY, materials);
        return { materials };
      });
      await materialApi.update(id, patch);
      syncCache(get().materials);
      return ok();
    } catch (e) {
      set({ materials: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`update:${id}`] = false;
    }
  },

  deleteMaterial: async (id) => {
    if (pendingOps[`delete:${id}`]) return pending();
    if (!get().getMaterialById(id)) return notFound();
    const snapshot = get().materials;
    pendingOps[`delete:${id}`] = true;
    try {
      set((state) => {
        const materials = state.materials.filter((m) => m.id !== id);
        saveJSON(STORAGE_KEY, materials);
        return { materials };
      });
      await materialApi.delete(id);
      syncCache(get().materials);
      return ok();
    } catch (e) {
      set({ materials: snapshot });
      saveJSON(STORAGE_KEY, snapshot);
      return fail(e);
    } finally {
      pendingOps[`delete:${id}`] = false;
    }
  },
}));
