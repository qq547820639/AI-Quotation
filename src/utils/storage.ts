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
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.v !== SCHEMA_VERSION
    ) {
      console.warn(`[storage] ${key} 版本不匹配，丢弃旧数据`);
      return fallback;
    }
    return parsed.data;
  } catch (err) {
    console.warn(`[storage] 读取 ${key} 失败：`, err);
    return fallback;
  }
}

/** 保存 JSON 数据（携带版本号） */
export function saveJSON<T>(key: string, value: T): void {
  try {
    const wrapped: VersionedData<T> = { v: SCHEMA_VERSION, data: value };
    localStorage.setItem(PREFIX + key, JSON.stringify(wrapped));
  } catch (err) {
    console.warn(`[storage] 保存 ${key} 失败：`, err);
  }
}

/** 移除指定 key */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (err) {
    console.warn(`[storage] 移除 ${key} 失败：`, err);
  }
}

/** 清除所有 procurement_ 前缀的 key（用于数据重置） */
export function clearAll(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[storage] 清除全部数据失败：', err);
  }
}
