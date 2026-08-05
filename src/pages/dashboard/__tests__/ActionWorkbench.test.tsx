/**
 * ActionWorkbench 组件测试（P2 Task 14）
 * - 加载态骨架屏
 * - 空态显示下一步操作
 * - 错误态提供重试
 * - 有数据时渲染卡片、数量为 0 不可点击、可点击跳转
 * - 负责人筛选
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import ActionWorkbench from '../ActionWorkbench';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useConnectivityStore } from '@/store/useConnectivityStore';
import { Currency, InquiryStatus, type Inquiry } from '@/types';

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ001',
    subject: '测试询价',
    organization: '总部采购中心',
    ownerName: '采购员甲',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: '2099-12-31 18:00:00',
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
    createdByName: '采购员甲',
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
  useUIStore.setState({ currentOrganization: '__ALL__' });
  useInquiryStore.setState({ inquiries: [], loading: false });
  useQuotationStore.setState({ quotations: [] });
  useConnectivityStore.setState({ isOnline: true });
  useAuthStore.setState({
    currentUser: {
      id: 'u-admin',
      name: '管理员',
      role: '管理员',
      department: '采购部',
      organization: '总部采购中心',
    },
  });
  mockNavigate.mockClear();
});

describe('ActionWorkbench 加载/空态/错误态', () => {
  it('加载中且无数据时显示骨架屏', () => {
    useInquiryStore.setState({ inquiries: [], loading: true });
    renderWithProviders(<ActionWorkbench />);
    expect(document.querySelector('.ant-skeleton')).not.toBeNull();
  });

  it('空态显示下一步操作（新建询价）', () => {
    useInquiryStore.setState({ inquiries: [], loading: false });
    renderWithProviders(<ActionWorkbench />);
    expect(screen.getByText('当前没有需要处理的行动项')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建询价/ })).toBeInTheDocument();
  });

  it('离线且无数据时显示错误态与重试按钮', () => {
    useInquiryStore.setState({ inquiries: [], loading: false });
    useConnectivityStore.setState({ isOnline: false });
    renderWithProviders(<ActionWorkbench />);
    expect(screen.getByText('数据加载失败')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /重试/ });
    expect(retry).toBeInTheDocument();
    const loadSpy = vi.spyOn(useInquiryStore.getState(), 'loadFromApi').mockResolvedValue();
    fireEvent.click(retry);
    expect(loadSpy).toHaveBeenCalled();
  });
});

describe('ActionWorkbench 有数据', () => {
  it('渲染各卡片，数量为 0 的卡片不可点击', () => {
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'i1', status: InquiryStatus.PENDING_SEND })],
      loading: false,
    });
    renderWithProviders(<ActionWorkbench />);
    const pendingCard = screen.getByLabelText('打开「待发送询价」');
    expect(pendingCard).toBeInTheDocument();
    expect(pendingCard.getAttribute('aria-disabled')).toBe('false');

    const confirmCard = screen.getByLabelText('打开「待确认定标」');
    expect(confirmCard.getAttribute('aria-disabled')).toBe('true');
  });

  it('点击可点击卡片跳转到对应筛选结果', () => {
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'i1', status: InquiryStatus.PENDING_SEND })],
      loading: false,
    });
    renderWithProviders(<ActionWorkbench />);
    const pendingCard = screen.getByLabelText('打开「待发送询价」');
    fireEvent.click(pendingCard);
    expect(mockNavigate).toHaveBeenCalledWith('/inquiry/list?status=PENDING_SEND');
  });

  it('键盘 Enter 触发跳转', () => {
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'i1', status: InquiryStatus.PENDING_SEND })],
      loading: false,
    });
    renderWithProviders(<ActionWorkbench />);
    const pendingCard = screen.getByLabelText('打开「待发送询价」');
    fireEvent.keyDown(pendingCard, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/inquiry/list?status=PENDING_SEND');
  });

  it('按负责人筛选的下拉存在', () => {
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({ id: 'i1', status: InquiryStatus.PENDING_SEND, ownerName: '采购员甲' }),
        makeInquiry({ id: 'i2', status: InquiryStatus.PENDING_SEND, ownerName: '采购员乙' }),
      ],
      loading: false,
    });
    renderWithProviders(<ActionWorkbench />);
    expect(screen.getByText('按负责人筛选')).toBeInTheDocument();
  });
});
