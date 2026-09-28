/**
 * Dashboard 页面测试（Task 17；R107 起行动工作台自己发聚合请求，桩法见下）
 * - 无数据时显示 Empty 而非 Skeleton
 * - 骨架屏确实由工作台贡献（上一条的配对反证，防 mock 洗出假绿）
 * - 有数据时显示最近询价单表格
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { inDays } from '@/test/temporalFixtures';

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

// R107：页面里的 ActionWorkbench 不再读全局 store 的全量数组，而是自己发一次
// GET /api/dashboard/workbench 聚合请求，拿到读数之前渲染 8 个 Skeleton 卡片
// （src/pages/dashboard/ActionWorkbench.tsx:243）。这里桩掉那次请求，让整页查询的
// 骨架屏来源收敛回"最近询价单"那张卡片（src/pages/dashboard/index.tsx:1077）。
// 桩法与同目录 ActionWorkbench.test.tsx:33 一致。
vi.mock('@/api/dashboardApi', () => ({
  dashboardApi: {
    workbench: vi.fn(),
  },
}));

import DashboardPage from '../index';
import { dashboardApi, type WorkbenchSummary } from '@/api/dashboardApi';
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
    deadline: inDays(90),
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

const workbenchMock = vi.mocked(dashboardApi.workbench);

/** 聚合端点的空读数夹具（与 backend DashboardWorkbenchSchema 对应）：八格全 0、total 0 */
function makeEmptySummary(): WorkbenchSummary {
  return {
    pendingSend: 0,
    deadlineApproaching: 0,
    unquotedSuppliers: 0,
    failedDeliveries: 0,
    abnormalQuotations: 0,
    pendingApproval: 0,
    approvalTimeout: 0,
    pendingConfirm: 0,
    owners: [],
    total: 0,
  };
}

/** 默认读数：请求立刻落地，工作台走 Empty 分支、不贡献骨架屏 */
function armResolvedWorkbench(): void {
  workbenchMock.mockResolvedValue(makeEmptySummary());
}

/**
 * 把工作台 `.then` → setState 的那两个微任务包进 act 收尾。
 * 只在断言全部跑完之后调用：不改变任何断言看到的 DOM，只是不让这次更新
 * 漏到 act 之外（React 警告，且会排队到下一条用例的 render 里）。
 */
async function flushWorkbenchUpdate(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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
  // 每条用例都从"聚合请求会落地"开始，个别用例（悬挂 promise）用完在 finally 里恢复
  workbenchMock.mockReset();
  armResolvedWorkbench();
});

describe('Dashboard 空状态', () => {
  it('无数据且未加载时显示 Empty 而非 Skeleton', async () => {
    useInquiryStore.setState({ inquiries: [], loading: false });
    renderWithProviders(<DashboardPage />);
    // 最近询价单卡片显示空状态
    expect(screen.getByText('暂无询价单')).toBeInTheDocument();
    // 先让工作台那次聚合请求落地（空读数 → 骨架屏换成 Empty）。这条 await 是必要的：
    // 同步 render 返回时 promise 的微任务还没跑，骨架屏仍在场上。
    // 落地后整页再无骨架屏，下面这条 toBeNull 由"最近询价单那张卡片没有骨架屏"承重；
    // "骨架屏确实会由工作台贡献"由下一条配对用例钉住，不是这里被 mock 洗出来的假绿。
    expect(await screen.findByText('当前没有需要处理的行动项')).toBeInTheDocument();
    // 不渲染 Skeleton
    expect(document.querySelector('.ant-skeleton')).toBeNull();
  });

  it('骨架屏确实来自工作台：聚合请求悬挂时整页有 Skeleton（上一条 toBeNull 的配对反证）', async () => {
    // 与上一条唯一差别：那次聚合请求永不落地（悬挂 promise）。
    // 若哪天工作台不再渲染加载骨架屏，这条当场变红，上一条的 toBeNull 也就无从承重。
    useInquiryStore.setState({ inquiries: [], loading: false });
    workbenchMock.mockReturnValue(new Promise<WorkbenchSummary>(() => undefined));
    try {
      renderWithProviders(<DashboardPage />);
      // 前提与上一条完全一致：最近询价单那张卡已确定处于空态（它自己不是骨架屏）
      expect(await screen.findByText('暂无询价单')).toBeInTheDocument();
      // 于是文档里的骨架屏只可能来自 ActionWorkbench 的 8 个加载卡片
      expect(document.querySelector('.ant-skeleton')).not.toBeNull();
      expect(document.querySelectorAll('.ant-skeleton')).toHaveLength(8);
    } finally {
      // 恢复默认：用完即还原，不泄漏给后续用例（beforeEach 也会再兜一次）
      armResolvedWorkbench();
    }
  });

  it('加载中时显示 Skeleton', async () => {
    useInquiryStore.setState({ inquiries: [], loading: true });
    renderWithProviders(<DashboardPage />);
    // 加载中显示 Skeleton 而非空状态
    expect(document.querySelector('.ant-skeleton')).not.toBeNull();
    expect(screen.queryByText('暂无询价单')).not.toBeInTheDocument();
    await flushWorkbenchUpdate();
  });
});

describe('Dashboard 有数据', () => {
  it('有数据时显示最近询价单表格（含主题）', async () => {
    useInquiryStore.setState({ inquiries: [makeInquiry()], loading: false });
    renderWithProviders(<DashboardPage />);
    // 表格中显示询价单主题
    expect(screen.getByText('测试询价单')).toBeInTheDocument();
    // 不再显示空状态
    expect(screen.queryByText('暂无询价单')).not.toBeInTheDocument();
    await flushWorkbenchUpdate();
  });
});
