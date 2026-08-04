/**
 * 供应商门户 API 客户端测试
 * - validateInvitation 正确映射状态
 * - API 失败时 reject（不返回 mock / 本地数据）
 * - 请求头注入 X-Invitation-Token（不注入 Bearer）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

import { portalClient, portalApi } from '../portal';
import { ApiError, ERROR_CODES } from '../errors';

const originalAdapter = portalClient.defaults.adapter;

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  portalClient.defaults.adapter = originalAdapter;
});

/** 构造一个自定义 adapter：返回成功响应 */
function successAdapter(
  data: unknown,
  capture?: (config: InternalAxiosRequestConfig) => void,
): AxiosAdapter {
  return async (config) => {
    if (capture) capture(config);
    const response: AxiosResponse = {
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
    return response;
  };
}

/** 构造一个自定义 adapter：抛出指定状态码的错误（422 非重试，避免 axios-retry 拖慢测试） */
function errorAdapter(status: number, data: Record<string, unknown> = {}): AxiosAdapter {
  return async (config) => {
    throw Object.assign(new Error(`HTTP ${status}`), {
      response: { status, data, statusText: '', headers: {}, config },
    });
  };
}

const validInvitation = {
  status: 'valid' as const,
  invitationId: 'inv-1',
  inquiryId: 'inq-3',
  inquiryCode: 'INQ20260801003',
  supplierId: 'sup-2',
  supplierName: '华为技术有限公司',
  deadline: '2026-08-11 18:00:00',
  expiresAt: '2026-08-18 18:00:00',
};

describe('portalApi.validateInvitation', () => {
  it('正确映射 valid 状态并注入 X-Invitation-Token 头', async () => {
    let captured: InternalAxiosRequestConfig | undefined;
    portalClient.defaults.adapter = successAdapter(validInvitation, (c) => {
      captured = c;
    });
    const result = await portalApi.validateInvitation('token-abc');
    expect(result.status).toBe('valid');
    expect(result.inquiryId).toBe('inq-3');
    expect(result.supplierName).toBe('华为技术有限公司');
    // 注入邀请令牌，且不注入 Bearer
    expect(captured?.headers['X-Invitation-Token']).toBe('token-abc');
    expect(captured?.headers.Authorization).toBeUndefined();
  });

  it('正确映射 submitted / revoked / expired 状态', async () => {
    portalClient.defaults.adapter = successAdapter({ ...validInvitation, status: 'submitted' });
    expect((await portalApi.validateInvitation('t')).status).toBe('submitted');

    portalClient.defaults.adapter = successAdapter({ ...validInvitation, status: 'revoked' });
    expect((await portalApi.validateInvitation('t')).status).toBe('revoked');

    portalClient.defaults.adapter = successAdapter({ ...validInvitation, status: 'expired' });
    expect((await portalApi.validateInvitation('t')).status).toBe('expired');
  });

  it('API 失败时 reject（不返回 mock / 本地数据）', async () => {
    portalClient.defaults.adapter = errorAdapter(422, { message: '校验失败' });
    await expect(portalApi.validateInvitation('bad-token')).rejects.toBeInstanceOf(ApiError);
    await expect(portalApi.validateInvitation('bad-token')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION,
    });
  });
});

describe('portal 其他 API 失败时 reject', () => {
  it('getPortalInquiry 失败时 reject', async () => {
    portalClient.defaults.adapter = errorAdapter(422, { message: 'x' });
    await expect(portalApi.getPortalInquiry('t')).rejects.toBeInstanceOf(ApiError);
  });

  it('getCurrentQuotation 失败时 reject', async () => {
    portalClient.defaults.adapter = errorAdapter(422, { message: 'x' });
    await expect(portalApi.getCurrentQuotation('t')).rejects.toBeInstanceOf(ApiError);
  });

  it('submitQuotation 失败时 reject', async () => {
    portalClient.defaults.adapter = errorAdapter(422, { message: 'x' });
    await expect(portalApi.submitQuotation('t', { items: [], remark: '' })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
