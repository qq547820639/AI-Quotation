/**
 * 询价草稿与自动保存 hook（Task 15）
 * - 管理草稿保存状态：idle / saving / saved / failed / offline
 * - 基于 storage 事件检测多标签页并发编辑冲突，提供 reload / overwrite
 * - 询价模板的保存 / 加载 / 清除
 *
 * 持久化采用 localStorage（后端未提供草稿端点），登录过期后未提交内容仍保留在本地。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadJSON, saveJSON, removeKey } from '@/utils/storage';
import { useConnectivityStore } from '@/store/useConnectivityStore';
import {
  DRAFT_CONFLICT_MIN_AGE_MS,
  DRAFT_STORAGE_KEY,
  INQUIRY_TEMPLATE_KEY,
  buildDraftMeta,
  generateDraftClientId,
  isDraftConflict,
  isValidTemplate,
  nextSaveStatus,
  type DraftMeta,
  type DraftSaveStatus,
  type InquiryTemplate,
} from '@/pages/inquiry/create/draft';

/** 草稿持久化结构：元信息 + 业务快照 */
export interface PersistedDraft<T = unknown> extends DraftMeta {
  payload: T;
}

/** hook 返回值 */
export interface UseInquiryDraftResult {
  status: DraftSaveStatus;
  savedAt: string | null;
  conflict: boolean;
  lastError: string | null;
  /** 立即保存（由调用方传入已封装的快照） */
  saveNow: (snapshot: unknown, editingId?: string) => boolean;
  /** 冲突时重新加载本地最新草稿（清冲突标记） */
  reload: () => void;
  /** 冲突时用本地覆盖（清冲突标记并重新保存） */
  overwrite: (snapshot: unknown, editingId?: string) => void;
  clearConflict: () => void;
  /** 保存为询价模板 */
  saveAsTemplate: (name: string, template: InquiryTemplate) => boolean;
  /** 加载最近一个询价模板，返回 null 表示无模板或非法 */
  loadTemplate: () => InquiryTemplate | null;
  clearTemplate: () => void;
}

export function useInquiryDraft(): UseInquiryDraftResult {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const [status, setStatus] = useState<DraftSaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // 标签页唯一标识：跨渲染稳定，用于并发冲突判断
  const clientIdRef = useRef<string>(generateDraftClientId());

  /** 多标签页并发冲突检测：其他标签页写入同一草稿时触发 */
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== `procurement_${DRAFT_STORAGE_KEY}` || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as { data?: PersistedDraft } | null;
        const remote = parsed?.data;
        if (!remote) return;
        const mine = buildDraftMeta(clientIdRef.current);
        setConflict(isDraftConflict(remote, mine, DRAFT_CONFLICT_MIN_AGE_MS));
      } catch {
        /* 忽略解析失败 */
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  /** 底层持久化：写 localStorage，返回是否成功（用于区分 saved / failed） */
  const persist = useCallback((snapshot: unknown, editingId?: string): boolean => {
    const draft: PersistedDraft = {
      ...buildDraftMeta(clientIdRef.current, editingId),
      payload: snapshot,
    };
    try {
      saveJSON(DRAFT_STORAGE_KEY, draft);
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  /** 立即保存：内部完成 状态机 流转 */
  const saveNow = useCallback(
    (snapshot: unknown, editingId?: string): boolean => {
      setStatus('saving');
      const ok = persist(snapshot, editingId);
      const next = nextSaveStatus({ online: isOnline, persistOk: ok, prev: status });
      setStatus(next);
      if (ok) setSavedAt(buildDraftMeta(clientIdRef.current, editingId).savedAt);
      return ok;
    },
    [isOnline, persist, status],
  );

  const reload = useCallback(() => {
    setConflict(false);
    setStatus('saved');
  }, []);

  const overwrite = useCallback(
    (snapshot: unknown, editingId?: string) => {
      setConflict(false);
      saveNow(snapshot, editingId);
    },
    [saveNow],
  );

  const clearConflict = useCallback(() => setConflict(false), []);

  const saveAsTemplate = useCallback((name: string, template: InquiryTemplate): boolean => {
    try {
      saveJSON(INQUIRY_TEMPLATE_KEY, template);
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const loadTemplate = useCallback((): InquiryTemplate | null => {
    const value = loadJSON<unknown | null>(INQUIRY_TEMPLATE_KEY, null);
    return isValidTemplate(value) ? value : null;
  }, []);

  const clearTemplate = useCallback(() => {
    removeKey(INQUIRY_TEMPLATE_KEY);
  }, []);

  return {
    status,
    savedAt,
    conflict,
    lastError,
    saveNow,
    reload,
    overwrite,
    clearConflict,
    saveAsTemplate,
    loadTemplate,
    clearTemplate,
  };
}
