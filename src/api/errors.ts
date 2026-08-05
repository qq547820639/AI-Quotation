/**
 * 统一前端错误对象（可靠性深化）
 * - 解析后端 detail / message / 字段校验错误 / 业务错误码
 * - 提供 code / message / fieldErrors / status / retryable
 * - 所有文案经 i18n 国际化，不散落硬编码中文
 */
import i18n from '@/i18n';

export interface ApiErrorInfo {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  status?: number;
  retryable: boolean;
  /** 后端 request_id（Task 24），用于前后端关联定位 */
  requestId?: string;
  /** 409 冲突详情（Task 24），便于展示可恢复冲突信息 */
  conflict?: unknown;
}

/** 统一错误对象，供 Store / 页面 / 组件统一消费 */
export class ApiError extends Error {
  code: string;
  fieldErrors?: Record<string, string>;
  status?: number;
  retryable: boolean;
  requestId?: string;
  conflict?: unknown;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = 'ApiError';
    this.code = info.code;
    this.fieldErrors = info.fieldErrors;
    this.status = info.status;
    this.retryable = info.retryable;
    this.requestId = info.requestId;
    this.conflict = info.conflict;
  }
}

export const ERROR_CODES = {
  NETWORK: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  SERVER_UNAVAILABLE: 'SERVER_UNAVAILABLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  VALIDATION: 'VALIDATION',
  BUSINESS: 'BUSINESS',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN: 'UNKNOWN',
} as const;

/** 业务错误码 → i18n key 映射（后端以 code 返回时，前端据此映射语言文案） */
const BUSINESS_CODE_I18N: Record<string, string> = {
  duplicate_code: 'errors.duplicateCode',
  resource_in_use: 'errors.inUse',
  not_found: 'errors.notFound',
};

/** 从后端响应 data 中提取字符串文案（兼容 detail / message / detail.msg） */
function extractBackendMessage(data: Record<string, unknown>): string | undefined {
  const detail = data.detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null) {
    const msg = (detail as { msg?: unknown }).msg;
    if (typeof msg === 'string') return msg;
  }
  if (typeof data.message === 'string') return data.message;
  return undefined;
}

/** 解析任意异常为统一 ApiError */
export function parseApiError(error: unknown): ApiError {
  const e = (error ?? {}) as {
    response?: { status?: number; data?: unknown; headers?: unknown };
    request?: unknown;
    code?: string;
    message?: string;
  };

  // 有响应：按状态码分类
  if (e.response) {
    const status = e.response.status;
    const data = (e.response.data ?? {}) as Record<string, unknown>;
    const headers = (e.response.headers ?? {}) as Record<string, unknown>;
    // Task 24：优先消费后端结构化错误字段（code / message / retryable / fieldErrors / request_id / conflict）
    const backendCode = typeof data.code === 'string' ? data.code : undefined;
    const backendMessage = typeof data.message === 'string' ? data.message : undefined;
    const backendRetryable = typeof data.retryable === 'boolean' ? data.retryable : undefined;
    const fieldErrors = data.fieldErrors as Record<string, string> | undefined;
    const requestId =
      (typeof data.request_id === 'string' && data.request_id) ||
      (typeof (headers as { 'x-request-id'?: unknown })['x-request-id'] === 'string'
        ? (headers as { 'x-request-id': string })['x-request-id']
        : undefined);
    const conflict = data.conflict;
    // retryable：后端显式给出则以其为准，否则按状态码推断（>=500 可重试）
    const retryable = backendRetryable ?? (status !== undefined && status >= 500);

    // 业务错误码优先：具体业务错误映射到明确 i18n 文案
    if (backendCode && BUSINESS_CODE_I18N[backendCode]) {
      return new ApiError({
        code: backendCode,
        message: i18n.t(BUSINESS_CODE_I18N[backendCode]),
        status,
        retryable: false,
        requestId,
        conflict,
      });
    }

    switch (status) {
      case 401:
        return new ApiError({
          code: ERROR_CODES.UNAUTHORIZED,
          message: i18n.t('errors.unauthorized'),
          status,
          retryable: false,
          requestId,
        });
      case 403:
        return new ApiError({
          code: ERROR_CODES.FORBIDDEN,
          message: i18n.t('errors.forbidden'),
          status,
          retryable: false,
          requestId,
        });
      case 404:
        return new ApiError({
          code: ERROR_CODES.NOT_FOUND,
          message: i18n.t('errors.notFound'),
          status,
          retryable: false,
          requestId,
        });
      case 409:
        return new ApiError({
          code: ERROR_CODES.CONFLICT,
          message: backendMessage ?? i18n.t('errors.conflict'),
          status,
          retryable: false,
          requestId,
          conflict,
        });
      case 422:
        return new ApiError({
          code: ERROR_CODES.VALIDATION,
          message: backendMessage ?? i18n.t('errors.validationFailed'),
          fieldErrors,
          status,
          retryable,
          requestId,
        });
      case 503:
        return new ApiError({
          code: ERROR_CODES.SERVER_UNAVAILABLE,
          message: backendMessage ?? i18n.t('errors.serviceUnavailable'),
          status,
          retryable: true,
          requestId,
        });
      default: {
        // 业务错误：已有业务码映射的已在上方处理；此处尝试后端文案，其次通用提示
        const backendMsg = backendMessage ?? extractBackendMessage(data);
        return new ApiError({
          code: backendCode ?? ERROR_CODES.BUSINESS,
          message: backendMsg ?? i18n.t('errors.serverError', { status: (status ?? 0).toString() }),
          fieldErrors,
          status,
          retryable,
          requestId,
          conflict,
        });
      }
    }
  }

  // 无响应：区分请求超时 / 网络中断 / 服务不可达
  if (e.code === 'ECONNABORTED') {
    return new ApiError({
      code: ERROR_CODES.TIMEOUT,
      message: i18n.t('errors.timeout'),
      retryable: true,
    });
  }
  if (e.request) {
    return new ApiError({
      code: ERROR_CODES.NETWORK,
      message: i18n.t('errors.networkError'),
      retryable: true,
    });
  }
  return new ApiError({
    code: ERROR_CODES.UNKNOWN,
    message: e.message ?? i18n.t('errors.unknown'),
    retryable: false,
  });
}

/** 判断是否为 ApiError */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
