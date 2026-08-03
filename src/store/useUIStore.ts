/**
 * UI 状态：侧边栏折叠、当前采购组织
 */
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/utils/storage';

interface UIState {
  /** 侧边栏是否折叠 */
  collapsed: boolean;
  /** 当前采购组织 */
  currentOrganization: string;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setCurrentOrganization: (org: string) => void;
}

const UI_KEY = 'ui';

const initial = loadJSON<{ collapsed?: boolean; currentOrganization?: string }>(UI_KEY, {
  collapsed: false,
  currentOrganization: '总部采购中心',
});

export const useUIStore = create<UIState>((set) => ({
  collapsed: initial.collapsed ?? false,
  currentOrganization: initial.currentOrganization ?? '总部采购中心',
  toggleCollapsed: () =>
    set((state) => {
      const collapsed = !state.collapsed;
      saveJSON(UI_KEY, { ...state, collapsed });
      return { collapsed };
    }),
  setCollapsed: (collapsed) => set(() => ({ collapsed })),
  setCurrentOrganization: (currentOrganization) =>
    set((state) => {
      saveJSON(UI_KEY, { ...state, currentOrganization });
      return { currentOrganization };
    }),
}));
