/**
 * 统一写操作结果类型与辅助函数（Task 2）
 * - 所有 store 写操作返回 WriteResult，把任意异常归一为 ApiError
 * - reason 语义：pending=重复提交被拦截；not_found=目标不存在；error=失败
 */
import { ApiError, parseApiError } from '@/api/errors';

export interface WriteResult<T = void> {
  success: boolean;
  data?: T;
  error?: ApiError;
  /** pending=重复提交被拦截；not_found=目标不存在；error=失败 */
  reason?: 'pending' | 'not_found' | 'error';
}

export function ok<T>(data?: T): WriteResult<T> {
  return { success: true, data };
}

export function fail(error: unknown): WriteResult {
  return {
    success: false,
    error: error instanceof ApiError ? error : parseApiError(error),
    reason: 'error',
  };
}

export function pending(): WriteResult {
  return { success: false, reason: 'pending' };
}

export function notFound(): WriteResult {
  return { success: false, reason: 'not_found' };
}

/** 批量操作中单个目标的执行结果（Task 4） */
export interface BatchItemResult {
  id: string;
  success: boolean;
  /** 是否为跳过（非失败，如已停用/状态不允许取消） */
  skipped?: boolean;
  /** 失败或跳过原因（i18n 文案，如 '已停用'、'状态不允许取消'） */
  reason?: string;
}

/** 批量操作聚合结果（Task 4） */
export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: BatchItemResult[];
}