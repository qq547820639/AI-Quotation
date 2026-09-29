/**
 * 保存筛选视图 + 默认视图 hook（Task 19）
 * - 将当前筛选条件保存为命名视图（服务端可同步，本地为唯一事实来源）
 * - 可设置某个视图为「默认视图」，进入列表页时自动应用
 * - 本地持久化到 localStorage。**这里的本地写就是唯一权威**：没有服务端副本可退，
 *   所以三个变更方法把写回执传给调用方，由调用方决定能不能报"已保存/已设为默认/已删除"（R51-A）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadJSON, saveJSON, removeKey, type WriteReceipt } from '@/utils/storage';

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
  /** 保存当前条件为新视图；同名则覆盖。回执只说明这次本机写落没落地 */
  saveView: (name: string, filter: T) => WriteReceipt;
  /** 设为默认视图（取消其它默认） */
  setDefaultView: (id: string) => WriteReceipt;
  /** 删除视图 */
  removeView: (id: string) => WriteReceipt;
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

  // effect 仍是**兜底镜像**：它保证"任何一条改 views 的路径最终都会落盘"。
  // 因此 commit 里那次同步写即使与 React 最终提交值有偏差（同一 tick 连点两次），也会在这里被纠正回来。
  const viewsRef = useRef<SavedFilterView<T>[]>(views);
  useEffect(() => {
    viewsRef.current = views;
    saveJSON(STORAGE_KEY, views);
  }, [views]);

  /**
   * 先按"最近一次已知的完整值"算出下一份、同步落盘拿回执，再交给 React 提交。
   * `transition` 必须是确定性的（随机 id / 时间戳这类外部值要在调 commit 之前就铸好），
   * 否则这里算出的 next 与 React 用 prev 算出的结果会分叉，镜像与状态就不一致了。
   */
  const commit = useCallback(
    (transition: (prev: SavedFilterView<T>[]) => SavedFilterView<T>[]): WriteReceipt => {
      const next = transition(viewsRef.current);
      const receipt = saveJSON(STORAGE_KEY, next);
      viewsRef.current = next;
      setViews(transition);
      return receipt;
    },
    [],
  );

  const saveView = useCallback(
    (name: string, filter: T): WriteReceipt => {
      const normalized = normalizeViewName(name);
      // 在 transition 之外铸造，保证 commit 与 React 两侧算出的是同一个 id
      const id = generateViewId();
      const createdAt = new Date().toISOString();
      return commit((prev) => {
        const existing = prev.find((v) => v.name === normalized);
        if (existing) {
          return prev.map((v) =>
            v.id === existing.id
              ? { ...v, name: normalized, filter, createdAt, isDefault: v.isDefault }
              : v,
          );
        }
        const next: SavedFilterView<T> = {
          id,
          name: normalized,
          filter,
          createdAt,
          isDefault: prev.length === 0, // 第一个视图自动设为默认
        };
        return [...prev, next].slice(-maxViews);
      });
    },
    [commit, maxViews],
  );

  const setDefaultView = useCallback(
    (id: string): WriteReceipt =>
      commit((prev) => prev.map((v) => ({ ...v, isDefault: v.id === id }))),
    [commit],
  );

  const removeView = useCallback(
    (id: string): WriteReceipt => commit((prev) => prev.filter((v) => v.id !== id)),
    [commit],
  );

  const getView = useCallback((id: string) => views.find((v) => v.id === id), [views]);

  const getDefaultView = useCallback(() => views.find((v) => v.isDefault), [views]);

  const resetViews = useCallback(() => {
    removeKey(STORAGE_KEY);
    setViews([]);
  }, []);

  return { views, saveView, setDefaultView, removeView, getView, getDefaultView, resetViews };
}
