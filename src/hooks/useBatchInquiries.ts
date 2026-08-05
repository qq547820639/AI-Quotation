/**
 * 询价批量操作 hook（Task 19）
 * - 批量发送 / 提醒 / 导出 / 负责人调整
 * - 执行前预览（逐条说明可执行/跳过原因）
 * - 返回逐条成功/失败结果，聚合统计
 * - 导出走后台队列（taskId + queued）
 * 权限：INQUIRY_SEND / INQUIRY_EDIT 由调用方（页面）通过 Permission 控制，
 * 本 hook 只负责调用 API 并聚合结果，不伪造成功。
 */
import { useCallback, useState } from 'react';
import { inquiryApi, type BatchOperationResult, type BatchItemResult } from '@/api';
import { loadJSON } from '@/utils/storage';
import { InquiryStatus, type Inquiry } from '@/types';

/** 批量操作类型 */
export type BatchActionKind = 'send' | 'remind' | 'export' | 'assign';

/** 执行前预览：每个目标的可执行性说明 */
export interface BatchPreviewItem {
  id: string;
  code: string;
  subject: string;
  /** 是否可执行 */
  executable: boolean;
  /** 跳过原因（i18n key） */
  reason?: string;
}

/** hook 返回值 */
export interface UseBatchInquiriesResult {
  running: boolean;
  /** 执行 API 返回的聚合结果（最近一次） */
  lastResult: BatchOperationResult | null;
  /** 执行前预览（基于传入的 inquiries 数据计算；缺省时回退到本地缓存） */
  preview: (ids: string[], kind: BatchActionKind, source?: Inquiry[]) => BatchPreviewItem[];
  /** 批量发送 */
  batchSend: (ids: string[]) => Promise<BatchOperationResult>;
  /** 批量提醒 */
  batchRemind: (ids: string[]) => Promise<BatchOperationResult>;
  /** 批量导出（后台队列） */
  batchExport: (ids: string[], format?: 'pdf' | 'xlsx') => Promise<BatchOperationResult>;
  /** 批量调整负责人 */
  batchAssign: (ids: string[], ownerId: string, ownerName: string) => Promise<BatchOperationResult>;
  reset: () => void;
}

/** 从本地缓存/存储读取询价列表（用于预览计算，不依赖服务端） */
function loadLocalInquiries(): Inquiry[] {
  return loadJSON<Inquiry[]>('inquiries', []);
}

/** 批量发送仅对 DRAFT/PENDING_SEND 可执行 */
function isSendable(status: InquiryStatus): boolean {
  return status === InquiryStatus.DRAFT || status === InquiryStatus.PENDING_SEND;
}

export function useBatchInquiries(): UseBatchInquiriesResult {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<BatchOperationResult | null>(null);

  const preview = useCallback(
    (ids: string[], kind: BatchActionKind, source?: Inquiry[]): BatchPreviewItem[] => {
      const inquiries = source ?? loadLocalInquiries();
      return ids.map((id) => {
        const inq = inquiries.find((i) => i.id === id);
        if (!inq) {
          return { id, code: id, subject: '', executable: false, reason: 'not_found' };
        }
        if (kind === 'send' && !isSendable(inq.status)) {
          return {
            id,
            code: inq.code,
            subject: inq.subject,
            executable: false,
            reason: 'status_not_sendable',
          };
        }
        return { id, code: inq.code, subject: inq.subject, executable: true };
      });
    },
    [],
  );

  const run = useCallback(async (fn: () => Promise<BatchOperationResult>) => {
    setRunning(true);
    try {
      const result = await fn();
      setLastResult(result);
      return result;
    } finally {
      setRunning(false);
    }
  }, []);

  const batchSend = useCallback((ids: string[]) => run(() => inquiryApi.batchSend(ids)), [run]);
  const batchRemind = useCallback((ids: string[]) => run(() => inquiryApi.batchRemind(ids)), [run]);
  const batchExport = useCallback(
    (ids: string[], format?: 'pdf' | 'xlsx') => run(() => inquiryApi.batchExport(ids, format)),
    [run],
  );
  const batchAssign = useCallback(
    (ids: string[], ownerId: string, ownerName: string) =>
      run(() => inquiryApi.batchAssign(ids, ownerId, ownerName)),
    [run],
  );

  const reset = useCallback(() => setLastResult(null), []);

  return {
    running,
    lastResult,
    preview,
    batchSend,
    batchRemind,
    batchExport,
    batchAssign,
    reset,
  };
}

/** 纯函数：把 BatchItemResult 数组聚合为统计（供测试复用） */
export function aggregateBatchResults(results: BatchItemResult[]): {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
} {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  results.forEach((r) => {
    if (r.success) succeeded++;
    else if (r.skipped) skipped++;
    else failed++;
  });
  return { total: results.length, succeeded, failed, skipped };
}
