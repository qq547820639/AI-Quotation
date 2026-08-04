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
}

/** 统一错误对象，供 Store / 页面 / 组件统一消费 */
export class ApiError extends Error {
  code: string;
  fieldErrors?: Record<string, string>;
  status?: number;
  retryable: boolean;

  constructor(info: ApiErrorInfo) {
    super(info.message);
    this.name = 'ApiError';
    this.code = info.code;
    this.fieldErrors = info.fieldErrors;
    this.status = info.status;
    this.retryable = info.retryable;
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
    response?: { status?: number; data?: unknown };
    request?: unknown;
    code?: string;
    message?: string;
  };

  // 有响应：按状态码分类
  if (e.response) {
    const status = e.response.status;
    const data = (e.response.data ?? {}) as Record<string, unknown>;
    const businessCode = typeof data.code === 'string' ? data.code : undefined;
    const fieldErrors = data.fieldErrors as Record<string, string> | undefined;
    const retryable = status !== undefined && status >= 500;

    // 业务错误码优先：具体业务错误映射到明确 i18n 文案
    if (businessCode && BUSINESS_CODE_I18N[businessCode]) {
      return new ApiError({ code: businessCode, message: i18n.t(BUSINESS_CODE_I18N[businessCode]), status, retryable: false });
    }

    switch (status) {
      case 401:
        return new ApiError({ code: ERROR_CODES.UNAUTHORIZED, message: i18n.t('errors.unauthorized'), status, retryable: false });
      case 403:
        return new ApiError({ code: ERROR_CODES.FORBIDDEN, message: i18n.t('errors.forbidden'), status, retryable: false });
      case 404:
        return new ApiError({ code: ERROR_CODES.NOT_FOUND, message: i18n.t('errors.notFound'), status, retryable: false });
      case 409:
        return new ApiError({ code: ERROR_CODES.CONFLICT, message: i18n.t('errors.conflict'), status, retryable: false });
      case 422:
        return new ApiError({ code: ERROR_CODES.VALIDATION, message: i18n.t('errors.validationFailed'), fieldErrors, status, retryable: false });
      case 503:
        return new ApiError({ code: ERROR_CODES.SERVER_UNAVAILABLE, message: i18n.t('errors.serviceUnavailable'), status, retryable: true });
      default: {
        // 业务错误：已有业务码映射的已在上方处理；此处尝试后端文案，其次通用提示
        const backendMsg = extractBackendMessage(data);
        return new ApiError({
          code: businessCode ?? ERROR_CODES.BUSINESS,
          message: backendMsg ?? i18n.t('errors.serverError', { status: (status ?? 0).toString() }),
          fieldErrors,
          status,
          retryable,
        });
      }
    }
  }

  // 无响应：区分请求超时 / 网络中断 / 服务不可达
  if (e.code === 'ECONNABORTED') {
    return new ApiError({ code: ERROR_CODES.TIMEOUT, message: i18n.t('errors.timeout'), retryable: true });
  }
  if (e.request) {
    return new ApiError({ code: ERROR_CODES.NETWORK, message: i18n.t('errors.networkError'), retryable: true });
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