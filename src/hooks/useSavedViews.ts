/**
 * 保存筛选视图 + 默认视图 hook（Task 19）
 * - 将当前筛选条件保存为命名视图（服务端可同步，本地为唯一事实来源）
 * - 可设置某个视图为「默认视图」，进入列表页时自动应用
 * - 本地持久化到 localStorage，失败不影响使用
 */
import { useCallback, useEffect, useState } from 'react';
import { loadJSON, saveJSON, removeKey } from '@/utils/storage';

/** 一个筛选视图：名称 + 当前筛选条件快照 */
export interface SavedFilterView<T> {
  id: string;
  name: string;
  /** 是否为默认视图（进入列表页自动应用） */
  isDefault: boolean;
  /** 筛选条件快照（由调用方定义结构，可序列化） */
  filter: T;
  createdAt: string;
}

/** hook 返回值 */
export interface UseSavedViewsResult<T> {
  views: SavedFilterView<T>[];
  /** 保存当前条件为新视图；同名则覆盖 */
  saveView: (name: string, filter: T) => void;
  /** 设为默认视图（取消其它默认） */
  setDefaultView: (id: string) => void;
  /** 删除视图 */
  removeView: (id: string) => void;
  /** 通过 id 获取视图 */
  getView: (id: string) => SavedFilterView<T> | undefined;
  /** 获取默认视图（无则 undefined） */
  getDefaultView: () => SavedFilterView<T> | undefined;
  /** 清空所有视图 */
  resetViews: () => void;
}

const STORAGE_KEY = 'savedViews';

/** 生成唯一视图 id */
export function generateViewId(): string {
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 视图名规范化：trim 后非空，空名回退为「未命名视图」 */
export function normalizeViewName(name: string): string {
  return name.trim() || '未命名视图';
}

export function useSavedViews<T>(maxViews = 20): UseSavedViewsResult<T> {
  const [views, setViews] = useState<SavedFilterView<T>[]>(() => {
    const saved = loadJSON<Array<Omit<SavedFilterView<T>, 'filter'> & { filter: T }>>(
      STORAGE_KEY,
      [],
    );
    return Array.isArray(saved) ? saved : [];
  });

  // 持久化到 localStorage
  useEffect(() => {
    saveJSON(STORAGE_KEY, views);
  }, [views]);

  const saveView = useCallback(
    (name: string, filter: T) => {
      const normalized = normalizeViewName(name);
      setViews((prev) => {
        const existing = prev.find((v) => v.name === normalized);
        const base = {
          name: normalized,
          filter,
          createdAt: new Date().toISOString(),
        };
        if (existing) {
          return prev.map((v) =>
            v.id === existing.id ? { ...v, ...base, isDefault: v.isDefault } : v,
          );
        }
        const next: SavedFilterView<T> = {
          id: generateViewId(),
          ...base,
          isDefault: prev.length === 0, // 第一个视图自动设为默认
        };
        return [...prev, next].slice(-maxViews);
      });
    },
    [maxViews],
  );

  const setDefaultView = useCallback((id: string) => {
    setViews((prev) => prev.map((v) => ({ ...v, isDefault: v.id === id })));
  }, []);

  const removeView = useCallback((id: string) => {
    setViews((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const getView = useCallback((id: string) => views.find((v) => v.id === id), [views]);

  const getDefaultView = useCallback(() => views.find((v) => v.isDefault), [views]);

  const resetViews = useCallback(() => {
    removeKey(STORAGE_KEY);
    setViews([]);
  }, []);

  return { views, saveView, setDefaultView, removeView, getView, getDefaultView, resetViews };
}
