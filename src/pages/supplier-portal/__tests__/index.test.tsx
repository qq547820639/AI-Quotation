/**
 * 供应商门户页面测试（邀请令牌模式）
 * - 各状态渲染：valid / revoked / expired / submitted / terminal / error
 * - 提交调用 API 并展示回执；提交失败展示错误
 * - 安全：403/410/401 令牌渲染对应结果页而非表单
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ApiError } from '@/api/errors';

// mock portal API 模块，避免真实网络请求
vi.mock('@/api/portal', () => ({
  portalApi: {
    validateInvitation: vi.fn(),
    getPortalInquiry: vi.fn(),
    getCurrentQuotation: vi.fn(),
    saveQuotationDraft: vi.fn(),
    submitQuotation: vi.fn(),
    reviseQuotation: vi.fn(),
    getReceipt: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}));

// mock confirm/utils，避免 antd Modal.confirm 真实渲染
vi.mock('@/utils/confirm', () => ({
  confirmAction: vi.fn((opts: { onOk?: () => void | Promise<void> }) => {
    opts.onOk?.();
  }),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

import { portalApi } from '@/api/portal';
import { notifyError } from '@/utils/confirm';
import SupplierPortalPage from '../index';

const TOKEN = 'inv-token-valid';
const mockedPortal = vi.mocked(portalApi);

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

const inquiry = {
  id: 'inq-3',
  code: 'INQ20260801003',
  subject: '服务器设备采购询价',
  organization: '总部数据中心',
  currency: 'CNY',
  deadline: '2026-08-11 18:00:00',
  expectedDeliveryDate: '2026-09-01',
  deliveryAddress: '上海市浦东新区',
  contact: '张经理',
  paymentTerms: '货到验收后 30 天付款',
  invoiceRequirement: '增值税专用发票',
  description: '数据中心扩容',
  status: 'INQUIRING',
  items: [
    {
      id: 'item-1',
      inquiryItemId: 'item-1',
      name: '机架式服务器',
      code: 'SRV-001',
      category: '服务器',
      brand: '',
      spec: '2U',
      techParams: '128GB',
      unit: '台',
      quantity: 8,
      attachments: [],
    },
  ],
  attachments: [],
};

/** 预填好单价与交货天数的草稿，使表单校验通过 */
const prefilledDraft = {
  id: 'quo-1',
  inquiryId: 'inq-3',
  supplierId: 'sup-2',
  supplierName: '华为技术有限公司',
  status: 'DRAFT' as const,
  totalAmount: 0,
  remark: '',
  items: [
    {
      id: 'qi-1',
      quotationId: 'quo-1',
      inquiryItemId: 'item-1',
      unitPrice: 100,
      taxRate: 0.13,
      taxIncludedTotal: 800,
      moq: null,
      deliveryDays: 7,
      deliveryDate: null,
      brand: '',
      warrantyMonths: null,
      paymentTerms: '',
      validUntil: null,
      techDeviation: '',
      commercialDeviation: '',
      remark: '',
      attachments: [],
    },
  ],
  attachments: [],
  createdAt: '2026-08-01 10:00:00',
  updatedAt: '2026-08-01 10:00:00',
};

const receipt = {
  quotationId: 'quo-1',
  inquiryId: 'inq-3',
  supplierId: 'sup-2',
  supplierName: '华为技术有限公司',
  submittedAt: '2026-08-04 12:00:00',
  totalAmount: 800,
  receiptCode: 'RCP-INQ20260801003-sup-2',
  status: 'SUBMITTED' as const,
};

function renderWithProviders(ui: ReactElement) {
  const router = createMemoryRouter(
    [
      {
        path: '/supplier-portal/:invitationToken',
        element: ui,
      },
    ],
    { initialEntries: [`/supplier-portal/${TOKEN}`] },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe('供应商门户页面状态', () => {
  it('valid：渲染报价表单（询价主题 + 供应商名）', async () => {
    mockedPortal.validateInvitation.mockResolvedValue(validInvitation);
    mockedPortal.getPortalInquiry.mockResolvedValue(inquiry);
    mockedPortal.getCurrentQuotation.mockResolvedValue(null);
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('服务器设备采购询价')).toBeInTheDocument();
    expect(screen.getByText('华为技术有限公司')).toBeInTheDocument();
    expect(screen.getByText('正式提交')).toBeInTheDocument();
  });

  it('valid：草稿回填后显示表单', async () => {
    mockedPortal.validateInvitation.mockResolvedValue(validInvitation);
    mockedPortal.getPortalInquiry.mockResolvedValue(inquiry);
    mockedPortal.getCurrentQuotation.mockResolvedValue(prefilledDraft);
    renderWithProviders(<SupplierPortalPage />);
    // 物料出现在只读明细表与报价填写表中
    expect((await screen.findAllByText('机架式服务器')).length).toBeGreaterThan(0);
    expect(screen.getByText('正式提交')).toBeInTheDocument();
  });

  it('revoked：渲染邀请已撤销页', async () => {
    mockedPortal.validateInvitation.mockResolvedValue({ ...validInvitation, status: 'revoked' });
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('邀请已撤销')).toBeInTheDocument();
    expect(screen.queryByText('正式提交')).not.toBeInTheDocument();
  });

  it('expired：渲染邀请已过期页', async () => {
    mockedPortal.validateInvitation.mockResolvedValue({ ...validInvitation, status: 'expired' });
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('邀请已过期')).toBeInTheDocument();
  });

  it('submitted：渲染已提交回执页并调用 getReceipt', async () => {
    mockedPortal.validateInvitation.mockResolvedValue({ ...validInvitation, status: 'submitted' });
    mockedPortal.getReceipt.mockResolvedValue(receipt);
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('报价提交成功')).toBeInTheDocument();
    expect(await screen.findByText('RCP-INQ20260801003-sup-2')).toBeInTheDocument();
    expect(mockedPortal.getReceipt).toHaveBeenCalledWith(TOKEN);
  });

  it('terminal：询价状态为 COMPLETED 时渲染截止页', async () => {
    mockedPortal.validateInvitation.mockResolvedValue(validInvitation);
    mockedPortal.getPortalInquiry.mockResolvedValue({ ...inquiry, status: 'COMPLETED' });
    mockedPortal.getCurrentQuotation.mockResolvedValue(null);
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('询价已截止')).toBeInTheDocument();
    expect(screen.queryByText('正式提交')).not.toBeInTheDocument();
  });

  it('error：API 失败时渲染错误页而非 mock 数据', async () => {
    mockedPortal.validateInvitation.mockRejectedValue(
      new ApiError({
        code: 'NETWORK_ERROR',
        message: '网络异常',
        status: undefined,
        retryable: true,
      }),
    );
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('加载失败')).toBeInTheDocument();
    expect(screen.queryByText('服务器设备采购询价')).not.toBeInTheDocument();
  });
});

describe('供应商门户提交', () => {
  it('提交前预览：点正式提交打开预览，展示逐项报价与总额，确认后调用 API 并展示回执', async () => {
    mockedPortal.validateInvitation.mockResolvedValue(validInvitation);
    mockedPortal.getPortalInquiry.mockResolvedValue(inquiry);
    mockedPortal.getCurrentQuotation.mockResolvedValue(prefilledDraft);
    mockedPortal.submitQuotation.mockResolvedValue(receipt);
    renderWithProviders(<SupplierPortalPage />);
    await screen.findByText('服务器设备采购询价');
    // 点击「正式提交」→ 打开提交前预览 Modal
    fireEvent.click(screen.getByText('正式提交').closest('button')!);
    expect(await screen.findByText('提交前预览')).toBeInTheDocument();
    // 预览展示含税总额（formatCurrency 带 ¥ 符号；行小计与总额均含 800.00）
    expect(screen.getAllByText(/800\.00/).length).toBeGreaterThan(0);
    // 确认提交 → 调用 submitQuotation
    fireEvent.click(screen.getByText('确认提交').closest('button')!);
    await waitFor(() => {
      expect(mockedPortal.submitQuotation).toHaveBeenCalledWith(
        TOKEN,
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ inquiryItemId: 'item-1', unitPrice: 100, deliveryDays: 7 }),
          ]),
          idempotencyKey: expect.any(String),
        }),
      );
    });
    expect(await screen.findByText('报价提交成功')).toBeInTheDocument();
  });

  it('提交失败时展示错误并停留在表单', async () => {
    mockedPortal.validateInvitation.mockResolvedValue(validInvitation);
    mockedPortal.getPortalInquiry.mockResolvedValue(inquiry);
    mockedPortal.getCurrentQuotation.mockResolvedValue(prefilledDraft);
    mockedPortal.submitQuotation.mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        message: '数据冲突',
        status: 409,
        retryable: false,
      }),
    );
    renderWithProviders(<SupplierPortalPage />);
    await screen.findByText('服务器设备采购询价');
    fireEvent.click(screen.getByText('正式提交').closest('button')!);
    await screen.findByText('提交前预览');
    fireEvent.click(screen.getByText('确认提交').closest('button')!);
    await waitFor(() => {
      expect(notifyError).toHaveBeenCalled();
    });
    // 未切到回执页，仍显示表单
    expect(screen.queryByText('报价提交成功')).not.toBeInTheDocument();
    expect(screen.getByText('正式提交')).toBeInTheDocument();
  });

  it('提交前预览：不完整报价提示缺失项', async () => {
    mockedPortal.validateInvitation.mockResolvedValue(validInvitation);
    mockedPortal.getPortalInquiry.mockResolvedValue(inquiry);
    // 草稿缺单价与交货天数 → 校验失败，不打开预览
    mockedPortal.getCurrentQuotation.mockResolvedValue(null);
    renderWithProviders(<SupplierPortalPage />);
    await screen.findByText('服务器设备采购询价');
    fireEvent.click(screen.getByText('正式提交').closest('button')!);
    // 校验失败：不打开预览，提示请补全
    expect(
      await screen.findByText('请补全所有物料的单价（>0）与交货周期（>0）后再提交'),
    ).toBeInTheDocument();
    expect(screen.queryByText('提交前预览')).not.toBeInTheDocument();
  });
});

describe('供应商门户安全（令牌异常）', () => {
  it('403 → 渲染邀请已撤销页，而非表单', async () => {
    mockedPortal.validateInvitation.mockRejectedValue(
      new ApiError({
        code: 'FORBIDDEN',
        message: '禁止访问',
        status: 403,
        retryable: false,
      }),
    );
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('邀请已撤销')).toBeInTheDocument();
    expect(screen.queryByText('正式提交')).not.toBeInTheDocument();
  });

  it('410 → 渲染已提交回执页，而非表单', async () => {
    mockedPortal.validateInvitation.mockRejectedValue(
      new ApiError({
        code: 'BUSINESS',
        message: '已提交',
        status: 410,
        retryable: false,
      }),
    );
    mockedPortal.getReceipt.mockResolvedValue(receipt);
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('报价提交成功')).toBeInTheDocument();
    expect(screen.queryByText('正式提交')).not.toBeInTheDocument();
  });

  it('401 → 渲染邀请已过期页，而非表单', async () => {
    mockedPortal.validateInvitation.mockRejectedValue(
      new ApiError({
        code: 'UNAUTHORIZED',
        message: '未授权',
        status: 401,
        retryable: false,
      }),
    );
    renderWithProviders(<SupplierPortalPage />);
    expect(await screen.findByText('邀请已过期')).toBeInTheDocument();
    expect(screen.queryByText('正式提交')).not.toBeInTheDocument();
  });
});
