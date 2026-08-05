/**
 * 询价草稿与自动保存：纯逻辑模块（Task 15）
 * - 保存状态机：idle → saving → saved / failed / offline
 * - 自动保存防抖时长
 * - 并发编辑冲突检测（多标签页基于 storage 事件 + clientId）
 * - 询价模板的序列化 / 反序列化
 *
 * 纯函数，便于单元测试；副作用（localStorage 读写）由 useInquiryDraft hook 承担。
 */
import type { InquiryItem } from '@/types';

/** 草稿保存状态：正在保存 / 已保存 / 保存失败 / 离线 / 空闲 */
export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'offline';

/** 自动保存防抖时长（毫秒） */
export const DRAFT_AUTO_SAVE_DEBOUNCE_MS = 2000;

/** 视为"正在并发编辑"的时间窗口（毫秒）：另一标签页在此窗口内写过同一草稿才告警 */
export const DRAFT_CONFLICT_MIN_AGE_MS = 5000;

/** 草稿在 localStorage 的 key（带前缀后为 procurement_inquiry_draft） */
export const DRAFT_STORAGE_KEY = 'inquiry_draft';

/** 询价模板在 localStorage 的 key（带前缀后为 procurement_inquiry_template） */
export const INQUIRY_TEMPLATE_KEY = 'inquiry_template';

/** 草稿元信息：用于并发冲突判断 */
export interface DraftMeta {
  /** 写入方标签页标识 */
  clientId: string;
  /** 人类可读保存时间 */
  savedAt: string;
  /** 写入时间戳（epoch ms） */
  updatedAt: number;
  /** 关联的询价单 id（编辑模式） */
  editingId?: string;
}

/** 询价模板（保存为模板时仅保留可复用的业务字段） */
export interface InquiryTemplate {
  name: string;
  subject?: string;
  items: InquiryItem[];
  selectedSupplierIds?: string[];
  createdAt: string;
}

/** 生成唯一的标签页标识（用于并发冲突判断） */
export function generateDraftClientId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 构造草稿元信息 */
export function buildDraftMeta(clientId: string, editingId?: string, savedAt?: string): DraftMeta {
  return {
    clientId,
    savedAt: savedAt ?? new Date().toISOString(),
    updatedAt: Date.now(),
    editingId,
  };
}

/**
 * 根据在线状态与持久化结果计算"保存动作结束后"的下一个状态。
 * - 离线 → offline（即使本地暂存成功也标记离线，表示暂未同步到服务端）
 * - 在线但持久化失败 → failed
 * - 在线且持久化成功 → saved
 */
export function nextSaveStatus(input: {
  online: boolean;
  persistOk: boolean;
  prev: DraftSaveStatus;
}): DraftSaveStatus {
  if (!input.online) return 'offline';
  if (!input.persistOk) return 'failed';
  return 'saved';
}

/**
 * 是否存在并发编辑冲突。
 * 规则：另一标签页（clientId 不同）在最近 `minAgeMs` 时间内更新过同一草稿才视为"正在并发编辑"。
 * 自己写入、过旧写入、缺元信息均不构成冲突。
 */
export function isDraftConflict(
  existing: Partial<DraftMeta> | null | undefined,
  incoming: DraftMeta,
  minAgeMs: number = DRAFT_CONFLICT_MIN_AGE_MS,
): boolean {
  if (!existing?.clientId || !existing.clientId) return false;
  if (existing.clientId === incoming.clientId) return false;
  if (typeof existing.updatedAt !== 'number' || Number.isNaN(existing.updatedAt)) return false;
  const age = Date.now() - existing.updatedAt;
  return age >= 0 && age <= minAgeMs;
}

/** 从询价单明细构造模板（不包含 id / inquiryId 等派生字段） */
export function buildTemplate(
  name: string,
  subject: string,
  items: InquiryItem[],
  selectedSupplierIds: string[],
): InquiryTemplate {
  return {
    name: name.trim() || '未命名模板',
    subject,
    items: items.map((it) => ({
      ...it,
      id: '',
      inquiryId: '',
      attachments: it.attachments ? it.attachments.map((a) => ({ ...a })) : [],
    })),
    selectedSupplierIds,
    createdAt: new Date().toISOString(),
  };
}

/** 校验模板对象是否合法（避免反序列化脏数据） */
export function isValidTemplate(value: unknown): value is InquiryTemplate {
  if (!value || typeof value !== 'object') return false;
  const v = value as InquiryTemplate;
  return (
    typeof v.name === 'string' &&
    Array.isArray(v.items) &&
    v.items.every((it) => it && typeof it.name === 'string' && typeof it.quantity === 'number')
  );
}
