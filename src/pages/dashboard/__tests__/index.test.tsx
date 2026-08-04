/**
 * Dashboard 页面测试（Task 17）
 * - 无数据时显示 Empty 而非 Skeleton
 * - 有数据时显示最近询价单表格
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

// mock echarts，避免真实 canvas 渲染
vi.mock('@/utils/echarts', () => ({
  default: {
    init: vi.fn(() => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
    graphic: { LinearGradient: class LinearGradient {} },
  },
  echarts: {},
}));

import DashboardPage from '../index';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useUIStore } from '@/store/useUIStore';
import { Currency, InquiryStatus, type Inquiry } from '@/types';

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ20260801001',
    subject: '测试询价单',
    organization: '总部采购中心',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: '2026-12-31 18:00:00',
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [],
    invitedSupplierIds: [],
    quotations: [],
    logs: [],
    status: InquiryStatus.DRAFT,
    createdById: 'u-1',
    createdByName: '采购员',
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
    ...overrides,
  };
}

function renderWithProviders(ui: ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

beforeEach(() => {
  // antd 响应式组件（Row/Grid）依赖 matchMedia
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
  // 重置 store 状态
  useUIStore.setState({ currentOrganization: '__ALL__' });
  useInquiryStore.setState({ inquiries: [], loading: false });
  useQuotationStore.setState({ quotations: [] });
  useSupplierStore.setState({ suppliers: [] });
});

describe('Dashboard 空状态', () => {
  it('无数据且未加载时显示 Empty 而非 Skeleton', () => {
    useInquiryStore.setState({ inquiries: [], loading: false });
    renderWithProviders(<DashboardPage />);
    // 最近询价单卡片显示空状态
    expect(screen.getByText('暂无询价单')).toBeInTheDocument();
    // 不渲染 Skeleton
    expect(document.querySelector('.ant-skeleton')).toBeNull();
  });

  it('加载中时显示 Skeleton', () => {
    useInquiryStore.setState({ inquiries: [], loading: true });
    renderWithProviders(<DashboardPage />);
    // 加载中显示 Skeleton 而非空状态
    expect(document.querySelector('.ant-skeleton')).not.toBeNull();
    expect(screen.queryByText('暂无询价单')).not.toBeInTheDocument();
  });
});

describe('Dashboard 有数据', () => {
  it('有数据时显示最近询价单表格（含主题）', () => {
    useInquiryStore.setState({ inquiries: [makeInquiry()], loading: false });
    renderWithProviders(<DashboardPage />);
    // 表格中显示询价单主题
    expect(screen.getByText('测试询价单')).toBeInTheDocument();
    // 不再显示空状态
    expect(screen.queryByText('暂无询价单')).not.toBeInTheDocument();
  });
});