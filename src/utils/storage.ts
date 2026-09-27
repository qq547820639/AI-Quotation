/**
 * localStorage 封装：统一前缀 procurement_，带异常保护与版本号机制
 */
const PREFIX = 'procurement_';

/** 当前数据 schema 版本号，升级后旧数据会被丢弃并回退到 fallback */
export const SCHEMA_VERSION = 2;

interface VersionedData<T> {
  v: number;
  data: T;
}

/** 读取 JSON 数据，失败或版本不匹配返回 fallback（不抛错） */
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as VersionedData<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.v !== SCHEMA_VERSION) {
      console.warn(`[storage] ${key} 版本不匹配，丢弃旧数据`);
      return fallback;
    }
    return parsed.data;
  } catch (err) {
    console.warn(`[storage] 读取 ${key} 失败：`, err);
    return fallback;
  }
}

/**
 * 写操作回执（R50）。
 * 存在理由：这三个写函数过去把 QuotaExceededError / SecurityError 就地吞掉并返回 void，
 * 调用方于是**没有任何凭据**却能弹"已保存/已清空"——登记册 R48 的普查就是被这个根因喂出来的。
 * `error` 只供 console 排查，**不得直接进 UI 文案**（本仓要求所有文案走 i18n）。
 */
export interface WriteReceipt {
  success: boolean;
  /** 被写的 key（不含 procurement_ 前缀）；clearAll 用 '*' */
  key: string;
  error?: unknown;
}

function writeFailed(key: string, err: unknown): WriteReceipt {
  console.warn(`[storage] 写入 ${key} 失败：`, err);
  return { success: false, key, error: err };
}

/** 保存 JSON 数据（携带版本号），返回写入回执 */
export function saveJSON<T>(key: string, value: T): WriteReceipt {
  try {
    const wrapped: VersionedData<T> = { v: SCHEMA_VERSION, data: value };
    localStorage.setItem(PREFIX + key, JSON.stringify(wrapped));
    return { success: true, key };
  } catch (err) {
    return writeFailed(key, err);
  }
}

/** 移除指定 key，返回写入回执（removeItem 在隐私模式等场景同样会抛） */
export function removeKey(key: string): WriteReceipt {
  try {
    localStorage.removeItem(PREFIX + key);
    return { success: true, key };
  } catch (err) {
    return writeFailed(key, err);
  }
}

/**
 * 清除所有 procurement_ 前缀的 key（用于数据重置），返回写入回执。
 * `removed` 是本次真正移除的条数：调用方要区分"清空成功"与"本来就没有"，
 * 只有这一个数是能拿到的凭据，别再让 UI 猜。
 */
export function clearAll(): WriteReceipt & { removed: number } {
  const keysToRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    return { success: true, key: '*', removed: keysToRemove.length };
  } catch (err) {
    const r = writeFailed('*', err);
    return { ...r, removed: 0 };
  }
}
