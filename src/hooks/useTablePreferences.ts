/**
 * 表格列偏好 hook（Task 7）
 * - 本地持久化列可见性 / 顺序 / 固定 / 密度到 localStorage（key 形如 `tablePref:<pageKey>`）
 * - 返回的结构可序列化，便于未来扩展为服务端保存（将 flush 换成服务端接口即可）
 */
import { useEffect, useState } from 'react';
import { loadJSON, saveJSON } from '@/utils/storage';

/** 表格密度：紧凑 / 默认 / 宽松 */
export type TableDensity = 'compact' | 'default' | 'comfortable';

/** 单列偏好 */
export interface TableColumnPref {
  key: string;
  /** 列标题（用于设置面板展示，仅展示用，不影响序列化结构） */
  title: string;
  visible: boolean;
  /** 固定方向：left/right，不固定则省略 */
  fixed?: 'left' | 'right';
  /** 顺序（0 为最左） */
  order: number;
}

/** 页面表格偏好（可序列化，可扩展为服务端保存） */
export interface TablePreferences {
  columns: TableColumnPref[];
  density: TableDensity;
}

export interface TablePreferencesResult {
  prefs: TablePreferences;
  setColumnVisible: (key: string, visible: boolean) => void;
  setColumnOrder: (key: string, direction: 'up' | 'down') => void;
  setColumnFixed: (key: string, fixed: 'left' | 'right' | undefined) => void;
  setDensity: (density: TableDensity) => void;
  reset: () => void;
}

/** 密度 → antd Table size 映射 */
export const DENSITY_TO_SIZE: Record<TableDensity, 'small' | 'middle' | 'large'> = {
  compact: 'small',
  default: 'middle',
  comfortable: 'large',
};

const STORAGE_PREFIX = 'tablePref:';

/**
 * 读取并合并保存的偏好。若用户已有保存则复用，否则用 initial。
 * @param pageKey 页面唯一 key，用于隔离不同页面的列偏好
 * @param initial 默认列配置（含 key/title/visible/fixed/order 与 density）
 */
export function useTablePreferences(
  pageKey: string,
  initial: TablePreferences,
): TablePreferencesResult {
  const storageKey = `${STORAGE_PREFIX}${pageKey}`;

  const [prefs, setPrefs] = useState<TablePreferences>(() => {
    const saved = loadJSON<TablePreferences | null>(storageKey, null);
    if (saved && Array.isArray(saved.columns) && saved.columns.length > 0) {
      // 以保存的列配置为准，仅对缺失 field 回退到 initial，避免旧数据缺字段
      return {
        columns: saved.columns.map((col) => {
          const base = initial.columns.find((c) => c.key === col.key);
          return {
            key: col.key,
            title: base?.title ?? col.title,
            visible: col.visible ?? true,
            fixed: col.fixed,
            order: col.order ?? initial.columns.length,
          };
        }),
        density: saved.density ?? initial.density,
      };
    }
    return initial;
  });

  // 持久化到 localStorage（自动保存）
  useEffect(() => {
    saveJSON(storageKey, prefs);
  }, [storageKey, prefs]);

  const setColumnVisible = (key: string, visible: boolean) => {
    setPrefs((p) => ({
      ...p,
      columns: p.columns.map((c) => (c.key === key ? { ...c, visible } : c)),
    }));
  };

  const setColumnOrder = (key: string, direction: 'up' | 'down') => {
    setPrefs((p) => {
      const cols = [...p.columns];
      const idx = cols.findIndex((c) => c.key === key);
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= cols.length) return p;
      const [item] = cols.splice(idx, 1);
      cols.splice(target, 0, item);
      return { ...p, columns: cols.map((c, i) => ({ ...c, order: i })) };
    });
  };

  const setColumnFixed = (key: string, fixed: 'left' | 'right' | undefined) => {
    setPrefs((p) => ({
      ...p,
      columns: p.columns.map((c) => (c.key === key ? { ...c, fixed } : c)),
    }));
  };

  const setDensity = (density: TableDensity) => {
    setPrefs((p) => ({ ...p, density }));
  };

  const reset = () => {
    setPrefs(initial);
  };

  return { prefs, setColumnVisible, setColumnOrder, setColumnFixed, setDensity, reset };
}