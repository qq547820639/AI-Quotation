/**
 * 物料库 store
 * - W7.4：初始化从 mock 加载，支持 loadFromApi 从 API 加载（失败降级）
 * - 写操作同步 localStorage，并异步同步到 API（失败静默降级）
 */
import { create } from 'zustand';
import { materials as mockMaterials } from '@/mock/materials';
import type { Material } from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { materialApi } from '@/api';

const STORAGE_KEY = 'materials';

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
  addMaterial: (material: Material) => void;
  updateMaterial: (id: string, patch: Partial<Material>) => void;
  deleteMaterial: (id: string) => void;
}

export const useMaterialStore = create<MaterialState>((set, get) => ({
  materials: mergeMaterials(),

  // W7.4：从 API 加载，失败时降级到 localStorage/mock
  loadFromApi: async () => {
    try {
      const data = await materialApi.list();
      set({ materials: data });
      saveJSON(STORAGE_KEY, data);
    } catch {
      set({ materials: mergeMaterials() });
    }
  },

  getMaterialById: (id) => get().materials.find((m) => m.id === id),
  getMaterialByCode: (code) => get().materials.find((m) => m.code === code),

  addMaterial: (material) => {
    set((state) => {
      const materials = [...state.materials, material];
      saveJSON(STORAGE_KEY, materials);
      return { materials };
    });
    materialApi.create(material).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  updateMaterial: (id, patch) => {
    set((state) => {
      const materials = state.materials.map((m) => (m.id === id ? { ...m, ...patch } : m));
      saveJSON(STORAGE_KEY, materials);
      return { materials };
    });
    materialApi.update(id, patch).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },

  deleteMaterial: (id) => {
    set((state) => {
      const materials = state.materials.filter((m) => m.id !== id);
      saveJSON(STORAGE_KEY, materials);
      return { materials };
    });
    materialApi.delete(id).catch(() => {
      /* API 不可用时降级到本地，已在上面持久化 */
    });
  },
}));
