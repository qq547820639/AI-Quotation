/**
 * 供应商门户独立 API 客户端（邀请令牌认证，不共享主客户端的 Bearer token）
 * 不自动处理 401 跳转，由页面根据状态渲染不同结果
 */
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { parseApiError } from './errors';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

/** 独立的 axios 实例，不注入 Bearer token，使用邀请令牌认证 */
export const portalClient = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** 判断请求是否幂等（可安全自动重试） */
function isIdempotentMethod(method: string | undefined): boolean {
  const m = (method || 'get').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/** 判断请求是否携带幂等键（写请求的幂等保护） */
function hasIdempotencyKey(config: unknown): boolean {
  const headers = (config as { headers?: unknown })?.headers;
  if (!headers) return false;
  const h = headers as Record<string, unknown> & { get?: (k: string) => unknown };
  const key =
    h['Idempotency-Key'] ??
    h['idempotency-key'] ??
    (typeof h.get === 'function'
      ? (h.get('Idempotency-Key') ?? h.get('idempotency-key'))
      : undefined);
  return typeof key === 'string' && key.length > 0;
}

// 自动重试：仅幂等请求（GET/HEAD）或带幂等键的写请求，对网络错误与 5xx 重试最多 2 次
axiosRetry(portalClient, {
  retries: 2,
  retryCondition: (error) => {
    const safeToRetry = isIdempotentMethod(error.config?.method) || hasIdempotencyKey(error.config);
    if (!safeToRetry) return false;
    if (axiosRetry.isNetworkError(error)) return true;
    const status = error.response?.status;
    return status !== undefined && status >= 500;
  },
  retryDelay: axiosRetry.exponentialDelay,
  shouldResetTimeout: true,
});

// 请求拦截器：注入邀请令牌
portalClient.interceptors.request.use(
  (config) => {
    // 优先从 config.headers.X-Invitation-Token 取，否则从 sessionStorage 取
    let token = config.headers['X-Invitation-Token'] as string | undefined;
    if (!token) {
      token = sessionStorage.getItem('invitation_token') || undefined;
    }
    if (token) {
      config.headers['X-Invitation-Token'] = token;
    }
    // 不注入 Bearer token
    delete config.headers.Authorization;
    return config;
  },
  (error) => Promise.reject(error),
);

// 响应拦截器：统一解析错误但不自动跳转登录（交给页面处理）
portalClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const apiError = parseApiError(error);
    return Promise.reject(apiError);
  },
);

/* ==================== 类型定义（基于后端契约）==================== */

export interface InvitationValidationResult {
  status: 'valid' | 'submitted' | 'revoked' | 'expired';
  invitationId: string;
  inquiryId: string;
  inquiryCode: string;
  supplierId: string;
  supplierName: string;
  deadline: string;
  expiresAt: string;
}

export interface PortalInquiryItem {
  id: string;
  inquiryItemId: string;
  name: string;
  code: string;
  category: string;
  brand: string;
  spec: string;
  techParams: string;
  unit: string;
  quantity: number;
  expectedDeliveryDate?: string;
  remark?: string;
  attachments: Array<{
    id: string;
    name: string;
    url: string;
    size: number;
    uploadTime: string;
  }>;
}

export interface PortalInquiry {
  id: string;
  code: string;
  subject: string;
  organization: string;
  currency: string;
  deadline: string;
  expectedDeliveryDate?: string;
  deliveryAddress: string;
  contact: string;
  paymentTerms: string;
  invoiceRequirement?: string;
  description?: string;
  status: string;
  items: PortalInquiryItem[];
  attachments: Array<{
    id: string;
    name: string;
    url: string;
    size: number;
    uploadTime: string;
  }>;
}

export interface PortalQuotationItem {
  id: string;
  quotationId: string;
  inquiryItemId: string;
  unitPrice: number;
  taxRate: number;
  taxIncludedTotal: number;
  moq: number | null;
  deliveryDays: number;
  deliveryDate: string | null;
  brand: string;
  warrantyMonths: number | null;
  paymentTerms: string;
  validUntil: string | null;
  techDeviation: string;
  commercialDeviation: string;
  remark: string;
  attachments: Array<{
    id: string;
    name: string;
    url: string;
    size: number;
    uploadTime: string;
  }>;
}

export interface PortalQuotation {
  id: string;
  inquiryId: string;
  supplierId: string;
  supplierName: string;
  status: 'DRAFT' | 'SUBMITTED';
  submittedAt?: string;
  totalAmount: number;
  remark?: string;
  items: PortalQuotationItem[];
  attachments: Array<{
    id: string;
    name: string;
    url: string;
    size: number;
    uploadTime: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationSubmitReceipt {
  quotationId: string;
  inquiryId: string;
  supplierId: string;
  supplierName: string;
  submittedAt: string;
  totalAmount: number;
  receiptCode: string;
  status: 'SUBMITTED';
}

export interface PortalAttachment {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadTime: string;
}

export interface SaveQuotationDraftPayload {
  items: Array<{
    inquiryItemId: string;
    unitPrice: number;
    taxRate: number;
    moq: number | null;
    deliveryDays: number;
    deliveryDate: string | null;
    brand: string;
    warrantyMonths: number | null;
    paymentTerms: string;
    validUntil: string | null;
    techDeviation: string;
    commercialDeviation: string;
    remark: string;
  }>;
  remark: string;
}

export interface SubmitQuotationPayload extends SaveQuotationDraftPayload {
  idempotencyKey?: string;
}

/* ==================== API 导出 ===================== */

export const portalApi = {
  /** 验证邀请令牌 */
  validateInvitation: (token: string) =>
    portalClient
      .get<InvitationValidationResult>('/portal/invitations/validate', {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),

  /** 获取供应商可见的询价信息（不包含目标价等敏感信息） */
  getPortalInquiry: (token: string) =>
    portalClient
      .get<PortalInquiry>('/portal/inquiries', {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),

  /** 获取当前草稿报价（没有则返回 null） */
  getCurrentQuotation: (token: string) =>
    portalClient
      .get<PortalQuotation | null>('/portal/quotations/current', {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),

  /** 保存报价草稿 */
  saveQuotationDraft: (token: string, payload: SaveQuotationDraftPayload) =>
    portalClient
      .put<PortalQuotation>('/portal/quotations/draft', payload, {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),

  /** 提交报价 */
  submitQuotation: (token: string, payload: SubmitQuotationPayload) =>
    portalClient
      .post<QuotationSubmitReceipt>('/portal/quotations/submit', payload, {
        headers: {
          'X-Invitation-Token': token,
          ...(payload.idempotencyKey ? { 'Idempotency-Key': payload.idempotencyKey } : {}),
        },
      })
      .then((r) => r.data),

  /** 撤销已提交报价（返回草稿状态），仅在允许修改时成功 */
  reviseQuotation: (token: string) =>
    portalClient
      .post<PortalQuotation>('/portal/quotations/revise', undefined, {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),

  /** 获取提交后的回执 */
  getReceipt: (token: string) =>
    portalClient
      .get<QuotationSubmitReceipt>('/portal/quotations/receipt', {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),

  /** 上传附件（支持进度回调） */
  uploadAttachment: (
    token: string,
    ownerType: string,
    ownerId: string,
    file: File,
    onProgress?: (percent: number) => void,
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    return portalClient
      .post<PortalAttachment>(
        `/portal/attachments?owner_type=${encodeURIComponent(ownerType)}&owner_id=${encodeURIComponent(ownerId)}`,
        formData,
        {
          headers: {
            'X-Invitation-Token': token,
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (e) => {
            if (onProgress && e.total) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        },
      )
      .then((r) => r.data);
  },

  /** 删除附件 */
  deleteAttachment: (token: string, attachmentId: string) =>
    portalClient
      .delete<{ success: boolean; id: string }>(`/portal/attachments/${attachmentId}`, {
        headers: { 'X-Invitation-Token': token },
      })
      .then((r) => r.data),
};
