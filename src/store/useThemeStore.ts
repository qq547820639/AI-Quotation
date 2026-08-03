/**
 * 主题切换 store（B3）
 * - mode: 'light' | 'dark'
 * - persist 到 localStorage `theme`
 * - toggle 方法切换明暗
 * - document.documentElement.dataset.theme 同步给 CSS 变量
 */
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'theme';

function detectInitialMode(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  // 跟随系统偏好
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
}

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

const initialMode = detectInitialMode();
applyMode(initialMode);

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  toggle: () => {
    const next = get().mode === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyMode(next);
    set({ mode: next });
  },
  setMode: (mode) => {
    localStorage.setItem(THEME_KEY, mode);
    applyMode(mode);
    set({ mode });
  },
}));
