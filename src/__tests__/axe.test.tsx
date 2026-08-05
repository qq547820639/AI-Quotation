/**
 * Task 14.4：核心页面 axe 无障碍测试
 * 对登录、询价列表、询价详情、报价对比、工作台、审批等核心页面运行 axe，
 * 断言不存在 serious / critical 级违规（axe 的 impact 分级）。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { axe } from 'vitest-axe';
import i18n from '@/i18n';

// jsdom 无 canvas，mock echarts 以支持工作台图表渲染而不抛错
vi.mock('@/utils/echarts', () => {
  const mockChart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  const api = {
    init: () => mockChart,
    use: vi.fn(),
    graphic: { LinearGradient: class {} },
  };
  return { default: api, echarts: api };
});

import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import InquiryListPage from '@/pages/inquiry/list';
import InquiryDetailPage from '@/pages/inquiry/detail';
import QuotationComparePage from '@/pages/quotation/compare';
import ApprovalPage from '@/pages/approval';
import MaterialPage from '@/pages/material';
import SupplierPortalPage from '@/pages/supplier-portal';

// mock portal API（供应商门户页 axe 检查用）
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

import { portalApi } from '@/api/portal';
const mockedPortal = vi.mocked(portalApi);

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

// antd 组件在 jsdom 下需要 matchMedia / ResizeObserver
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

function renderWithProviders(ui: ReactElement, initialEntries: string[] = ['/']) {
  // 使用 createMemoryRouter（data router）以支持 useBlocker（报价对比页用）
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries });
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

/** 断言无 serious/critical 级 axe 违规 */
async function assertNoSeriousViolations(container: HTMLElement) {
  const results = await axe(container);
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

describe('核心页面 axe 无障碍（serious/critical）', () => {
  it('登录页无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<LoginPage />);
    await assertNoSeriousViolations(container);
  });

  it('工作台无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<DashboardPage />);
    await assertNoSeriousViolations(container);
  });

  it('询价列表无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<InquiryListPage />);
    await assertNoSeriousViolations(container);
  });

  it('询价详情无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<InquiryDetailPage />, ['/inquiry/detail/inq-1']);
    await assertNoSeriousViolations(container);
  });

  it('报价对比（列表视图）无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<QuotationComparePage />);
    await assertNoSeriousViolations(container);
  });

  it('审批页无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<ApprovalPage />);
    await assertNoSeriousViolations(container);
  });

  it('物料管理页无 serious/critical 违规', async () => {
    const { container } = renderWithProviders(<MaterialPage />);
    await assertNoSeriousViolations(container);
  });

  it('供应商门户页无 serious/critical 违规', async () => {
    mockedPortal.validateInvitation.mockResolvedValue({
      status: 'valid',
      invitationId: 'inv-1',
      inquiryId: 'inq-3',
      inquiryCode: 'INQ20260801003',
      supplierId: 'sup-2',
      supplierName: '华为技术有限公司',
      deadline: '2026-08-11 18:00:00',
      expiresAt: '2026-08-18 18:00:00',
    });
    mockedPortal.getPortalInquiry.mockResolvedValue({
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
    });
    mockedPortal.getCurrentQuotation.mockResolvedValue(null);
    // 供应商门户页依赖 useParams 读取邀请令牌，需用带命名参数的路由而非通配符 *
    const router = createMemoryRouter(
      [{ path: '/supplier-portal/:invitationToken', element: <SupplierPortalPage /> }],
      { initialEntries: ['/supplier-portal/inv-token-valid'] },
    );
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
    await screen.findByText('服务器设备采购询价');
    await assertNoSeriousViolations(container);
  });
});
