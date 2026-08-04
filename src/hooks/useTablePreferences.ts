/**
 * 表格列偏好 hook（Task 7 + P2-12 Task 17）
 * - 本地持久化列可见性 / 顺序 / 固定 / 密度到 localStorage（key 形如 `tablePref:<pageKey>`）
 * - P2-12 Task 17：可选服务端同步（usersApi.table-preferences），登录用户偏好跨设备生效
 * - 本地为唯一事实来源，服务端仅作备份/跨设备同步；同步失败不影响本地使用
 */
import { useEffect, useState } from 'react';
import { loadJSON, saveJSON } from '@/utils/storage';
import { usersApi } from '@/api';

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

/** 序列化偏好为可存储/可上传的纯数据结构（去掉 title 展示字段） */
function serialize(prefs: TablePreferences): Record<string, unknown> {
  return {
    density: prefs.density,
    columns: prefs.columns.map((c) => ({
      key: c.key,
      visible: c.visible,
      fixed: c.fixed,
      order: c.order,
    })),
  };
}

/**
 * 读取并合并保存的偏好。若用户已有保存则复用，否则用 initial。
 * @param pageKey 页面唯一 key，用于隔离不同页面的列偏好
 * @param initial 默认列配置（含 key/title/visible/fixed/order 与 density）
 * @param serverSync 设为 true 时：初始加载会尝试从服务端拉取偏好，
 *   本地变更后自动上传到服务端（失败静默，不影响本地）。默认 false 保持向后兼容。
 */
export function useTablePreferences(
  pageKey: string,
  initial: TablePreferences,
  serverSync = false,
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

  // P2-12 Task 17：服务端同步
  useEffect(() => {
    if (!serverSync) return;
    let cancelled = false;
    // 初始加载：若本地无保存，尝试从服务端拉取（跨设备恢复）
    const localSaved = loadJSON<TablePreferences | null>(storageKey, null);
    if (!localSaved) {
      usersApi
        .getTablePreference(pageKey)
        .then((res) => {
          if (cancelled || !res?.data) return;
          const serverData = res.data as { columns?: TableColumnPref[]; density?: TableDensity };
          if (Array.isArray(serverData.columns) && serverData.columns.length > 0) {
            const merged: TablePreferences = {
              columns: serverData.columns.map((col) => {
                const base = initial.columns.find((c) => c.key === col.key);
                return {
                  key: col.key,
                  title: base?.title ?? col.title ?? '',
                  visible: col.visible ?? true,
                  fixed: col.fixed,
                  order: col.order ?? initial.columns.length,
                };
              }),
              density: serverData.density ?? initial.density,
            };
            setPrefs(merged);
          }
        })
        .catch(() => {
          /* 服务端不可用则保持本地偏好 */
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSync, pageKey]);

  // P2-12 Task 17：本地变更后上传到服务端（防抖避免高频请求）
  useEffect(() => {
    if (!serverSync) return;
    const timer = setTimeout(() => {
      usersApi.saveTablePreference(pageKey, serialize(prefs)).catch(() => {
        /* 静默失败：本地已持久化 */
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [serverSync, pageKey, prefs]);

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
