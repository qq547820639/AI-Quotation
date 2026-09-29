/**
 * ActionWorkbench 组件测试（P2 Task 14；R107 起数据来源改为服务端聚合端点）
 *
 * R107 的数据来源改动对测试的含义：卡片计数不再由前端在两份全量数组上算，
 * 而是 `GET /api/dashboard/workbench` 一次回 8 个整数 + 负责人选项 + total。
 * 因此桩法整体换成 `vi.mock('@/api/dashboardApi')`：
 * - 不再往 useInquiryStore / useQuotationStore / useConnectivityStore 塞夹具
 *   （组件已不 import 它们，错误态现在由那一次聚合请求自己失败触发）；
 * - organization 查询参数仍由 useUIStore.currentOrganization 提供；
 * - 审批两张卡片的可见性仍由 useAuthStore.hasPermission 决定。
 *
 * 覆盖的每一格（都断言到具体读数，不写"渲染成功"式空断言）：
 *   1 加载态骨架屏（且此时无错误态文案） 2 有读数（3 与 0 + aria-disabled）
 *   3 空态 Empty + 新建询价 4 错误态 + 重试真的重发请求 5 点击卡片跳转
 *   6 负责人筛选的入参 + 筛选空态出 Alert 不出 Empty 7 旧响应不得覆盖新响应
 *   8 无审批权限时审批卡片不渲染
 * 等待异步落地一律 web-first（findBy / waitFor）或微任务 flush，不用固定 sleep。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// R107：这一条聚合请求是本组件唯一的数据源，桩掉它即可完全控制读数/加载/错误三态
vi.mock('@/api/dashboardApi', () => ({
  dashboardApi: {
    workbench: vi.fn(),
  },
}));

import ActionWorkbench from '../ActionWorkbench';
import { dashboardApi, type WorkbenchSummary } from '@/api/dashboardApi';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { User } from '@/types';

const workbenchMock = vi.mocked(dashboardApi.workbench);

const CURRENT_ORG = '总部采购中心';

/** 管理员：含 INQUIRY_APPROVE，8 张卡片全渲染 */
const ADMIN_USER: User = {
  id: 'u-admin',
  name: '管理员',
  role: '管理员',
  department: '采购部',
  organization: CURRENT_ORG,
};
/** 采购人员：ROLE_PERMISSIONS 里没有 INQUIRY_APPROVE（src/types/index.ts:254），审批两卡应被过滤 */
const BUYER_USER: User = {
  id: 'u-buyer',
  name: '采购员甲',
  role: '采购人员',
  department: '采购部',
  organization: CURRENT_ORG,
};

/** 聚合端点的读数夹具：默认八格全 0、total 0（即空态） */
function makeSummary(overrides: Partial<WorkbenchSummary> = {}): WorkbenchSummary {
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

/** 卡片根节点（`[role="button"][aria-label]`），aria-label 见 locales 的 openCard 模板 */
function cardByTitle(title: string): HTMLElement {
  return screen.getByLabelText(`打开「${title}」`);
}

/** 卡片上那格服务端计数（卡片内唯一的纯数字文本节点）；卡片不在则返回 null */
function countOf(title: string): string | null {
  const el = within(cardByTitle(title)).queryByText(/^\d+$/);
  return el ? (el.textContent ?? null) : null;
}

/** 已渲染卡片的 aria-label 清单，用于"某张卡不渲染"与卡片张数 */
function cardLabels(): string[] {
  return Array.from(document.querySelectorAll('[role="button"][aria-label^="打开「"]')).map(
    (el) => el.getAttribute('aria-label') ?? '',
  );
}

interface Deferred {
  promise: Promise<WorkbenchSummary>;
  resolve: (value: WorkbenchSummary) => void;
}

/** 悬挂的响应：拿到 resolve 后才能让它落地，用来构造"旧响应迟到"的时序 */
function deferred(): Deferred {
  let resolve: (value: WorkbenchSummary) => void = () => undefined;
  const promise = new Promise<WorkbenchSummary>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * 让悬挂响应落地，并把组件里 `.then` → setState 的微任务连同 React 渲染一并 flush。
 * 两次 `await Promise.resolve()`：第一次放组件的 then 回调执行，第二次让状态更新入队；
 * 之后由 act 收尾 flush。刻意不用 setTimeout(N) 当同步点（见任务 C 条）。
 */
async function settle(resolve: (value: WorkbenchSummary) => void, value: WorkbenchSummary) {
  await act(async () => {
    resolve(value);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 打开负责人下拉并选中某个名字，顺带钉住"这次改动确实重新取数了" */
async function chooseOwner(name: string, expectedCalls: number): Promise<void> {
  const selector = document.querySelector('.ant-select-selector') as HTMLElement | null;
  if (!selector) {
    throw new Error('筛选栏的负责人 Select 没渲染：locator 失效，不能拿"没报错"当通过');
  }
  fireEvent.mouseDown(selector);
  // 只认下拉里的选项文本，避免和选中后回显在选择框里的同名文本撞上
  const option = await screen.findByText(name, { selector: '.ant-select-item-option-content' });
  fireEvent.click(option);
  await waitFor(() => expect(workbenchMock).toHaveBeenCalledTimes(expectedCalls));
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
  workbenchMock.mockReset();
  mockNavigate.mockClear();
  useUIStore.setState({ currentOrganization: CURRENT_ORG });
  useAuthStore.setState({ currentUser: ADMIN_USER });
});

describe('ActionWorkbench 加载/空态/错误态（数据源 = /api/dashboard/workbench）', () => {
  it('聚合请求未落地时渲染 8 个骨架卡片，且不出现错误态文案', () => {
    // 永不落地的 promise：停在加载态
    workbenchMock.mockImplementation(() => new Promise<WorkbenchSummary>(() => undefined));
    renderWithProviders(<ActionWorkbench />);

    expect(workbenchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.ant-skeleton')).toHaveLength(8);
    // 加载态不是错误态：两者不得同时出现
    expect(screen.queryByText('数据加载失败')).not.toBeInTheDocument();
    expect(screen.queryByText('无法获取工作台数据，请检查网络后重试')).not.toBeInTheDocument();
    // 加载态也没有任何真卡片
    expect(cardLabels()).toHaveLength(0);
  });

  it('首次取数带上当前组织与空的筛选参数', () => {
    // 这条只钉入参，读数不落地（用悬挂 promise，避免测试结束后 setState 落在 act 之外）
    workbenchMock.mockImplementation(() => new Promise<WorkbenchSummary>(() => undefined));
    renderWithProviders(<ActionWorkbench />);

    expect(workbenchMock).toHaveBeenCalledWith({
      owner: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      organization: CURRENT_ORG,
    });
  });

  it('total=0 且八格计数全 0 且未筛选时显示空态与新建询价入口', async () => {
    workbenchMock.mockResolvedValue(makeSummary());
    renderWithProviders(<ActionWorkbench />);

    expect(await screen.findByText('当前没有需要处理的行动项')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建询价/ })).toBeInTheDocument();
    expect(cardLabels()).toHaveLength(0);
    expect(screen.queryByText('当前筛选条件下没有匹配的询价单')).not.toBeInTheDocument();
  });

  it('聚合请求失败显示错误态；点重试重新取数并渲染读数（共调用两次）', async () => {
    workbenchMock.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<ActionWorkbench />);

    expect(await screen.findByText('数据加载失败')).toBeInTheDocument();
    expect(screen.getByText('无法获取工作台数据，请检查网络后重试')).toBeInTheDocument();
    expect(cardLabels()).toHaveLength(0);
    expect(workbenchMock).toHaveBeenCalledTimes(1);

    const retry = screen.getByRole('button', { name: /重试/ });
    workbenchMock.mockResolvedValueOnce(
      makeSummary({ pendingApproval: 2, approvalTimeout: 1, total: 4 }),
    );
    fireEvent.click(retry);

    // 重试确实重发了请求，而不是只把错误态本地关掉
    await waitFor(() => expect(workbenchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('打开「待审批事项」')).toBeInTheDocument();
    expect(countOf('待审批事项')).toBe('2');
    expect(countOf('即将超时审批')).toBe('1');
    expect(screen.queryByText('数据加载失败')).not.toBeInTheDocument();
  });
});

describe('ActionWorkbench 有读数', () => {
  it('卡片显示服务端计数，计数为 0 的卡片 aria-disabled', async () => {
    workbenchMock.mockResolvedValue(
      makeSummary({
        pendingSend: 3,
        pendingConfirm: 0,
        abnormalQuotations: 5,
        owners: ['张三', '李四'],
        total: 7,
      }),
    );
    renderWithProviders(<ActionWorkbench />);

    const pending = await screen.findByLabelText('打开「待发送询价」');
    expect(countOf('待发送询价')).toBe('3');
    expect(pending.getAttribute('aria-disabled')).toBe('false');

    const abnormal = cardByTitle('异常报价');
    expect(countOf('异常报价')).toBe('5');
    expect(abnormal.getAttribute('aria-disabled')).toBe('false');

    expect(countOf('待确认定标')).toBe('0');
    expect(cardByTitle('待确认定标').getAttribute('aria-disabled')).toBe('true');

    // 管理员有审批权限：8 张卡片全在
    expect(cardLabels()).toHaveLength(8);
    expect(screen.getByText('按负责人筛选')).toBeInTheDocument();
  });

  it('点击计数大于 0 的卡片跳转到该卡片的 jumpPath', async () => {
    workbenchMock.mockResolvedValue(makeSummary({ pendingSend: 3, failedDeliveries: 1, total: 4 }));
    renderWithProviders(<ActionWorkbench />);

    fireEvent.click(await screen.findByLabelText('打开「待发送询价」'));
    expect(mockNavigate).toHaveBeenCalledWith('/inquiry/list?status=PENDING_SEND');

    fireEvent.click(cardByTitle('发送失败邀请'));
    expect(mockNavigate).toHaveBeenLastCalledWith('/inquiry/list');
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it('键盘 Enter 触发跳转', async () => {
    workbenchMock.mockResolvedValue(makeSummary({ pendingSend: 3, total: 3 }));
    renderWithProviders(<ActionWorkbench />);

    const pending = await screen.findByLabelText('打开「待发送询价」');
    fireEvent.keyDown(pending, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/inquiry/list?status=PENDING_SEND');
  });

  it('计数为 0 的卡片点击不跳转', async () => {
    workbenchMock.mockResolvedValue(makeSummary({ pendingSend: 3, total: 3 }));
    renderWithProviders(<ActionWorkbench />);

    const confirm = await screen.findByLabelText('打开「待确认定标」');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirm);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('紧急卡片在计数大于 0 时带「紧急」标记', async () => {
    workbenchMock.mockResolvedValue(
      makeSummary({ deadlineApproaching: 2, failedDeliveries: 0, total: 2 }),
    );
    renderWithProviders(<ActionWorkbench />);

    const urgent = await screen.findByLabelText('打开「即将截止询价」');
    expect(within(urgent).getByText('紧急')).toBeInTheDocument();
    expect(within(cardByTitle('发送失败邀请')).queryByText('紧急')).not.toBeInTheDocument();
  });
});

describe('ActionWorkbench 负责人筛选', () => {
  it('owner 变化以新的 query 重新取数；筛选后无匹配出 Alert 而非 Empty', async () => {
    workbenchMock
      .mockResolvedValueOnce(makeSummary({ owners: ['张三', '李四'], pendingSend: 2, total: 5 }))
      .mockResolvedValueOnce(makeSummary({ owners: ['张三', '李四'] }));
    renderWithProviders(<ActionWorkbench />);

    expect(await screen.findByText('按负责人筛选')).toBeInTheDocument();
    await chooseOwner('张三', 2);

    expect(workbenchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        owner: '张三',
        organization: useUIStore.getState().currentOrganization,
      }),
    );

    // 筛选后 total=0 且计数全 0：给"没有匹配"的 Alert，不给"新建询价"的空态
    expect(await screen.findByText('当前筛选条件下没有匹配的询价单')).toBeInTheDocument();
    expect(screen.queryByText('当前没有需要处理的行动项')).not.toBeInTheDocument();
    expect(countOf('待发送询价')).toBe('0');
    expect(cardLabels()).toHaveLength(8);
  });

  it('清除筛选后回到未筛选的 query 并恢复空态判定', async () => {
    workbenchMock
      .mockResolvedValueOnce(makeSummary({ owners: ['张三', '李四'], pendingSend: 2, total: 5 }))
      .mockResolvedValueOnce(makeSummary({ owners: ['张三', '李四'] }))
      .mockResolvedValueOnce(makeSummary());
    renderWithProviders(<ActionWorkbench />);

    await screen.findByText('按负责人筛选');
    await chooseOwner('张三', 2);
    fireEvent.click(screen.getByRole('button', { name: /重置/ }));

    await waitFor(() => expect(workbenchMock).toHaveBeenCalledTimes(3));
    expect(workbenchMock).toHaveBeenLastCalledWith({
      owner: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      organization: CURRENT_ORG,
    });
    expect(await screen.findByText('当前没有需要处理的行动项')).toBeInTheDocument();
  });
});

describe('ActionWorkbench 并发与权限', () => {
  it('旧筛选的迟到响应不得覆盖新筛选的读数（seq 守卫）', async () => {
    const first = deferred(); // 基线：让筛选栏渲染出来（骨架态没有 Select，够不到 owner）
    const stale = deferred(); // owner=张三 的响应，故意迟到
    const fresh = deferred(); // owner=李四 的响应，先落地
    workbenchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    renderWithProviders(<ActionWorkbench />);

    await settle(first.resolve, makeSummary({ owners: ['张三', '李四'], total: 5 }));
    expect(countOf('待发送询价')).toBe('0');

    await chooseOwner('张三', 2);
    await chooseOwner('李四', 3);

    // 新筛选先落地：读数应为 1
    await settle(
      fresh.resolve,
      makeSummary({ owners: ['张三', '李四'], pendingSend: 1, total: 1 }),
    );
    expect(await screen.findByLabelText('打开「待发送询价」')).toBeInTheDocument();
    expect(countOf('待发送询价')).toBe('1');

    // 旧筛选（owner=张三）的响应迟到 9：不得覆盖成 9
    await settle(
      stale.resolve,
      makeSummary({ owners: ['张三', '李四'], pendingSend: 9, total: 9 }),
    );
    expect(countOf('待发送询价')).toBe('1');
    expect(within(cardByTitle('待发送询价')).queryByText('9')).not.toBeInTheDocument();
    expect(workbenchMock).toHaveBeenCalledTimes(3);
  });

  it('无 INQUIRY_APPROVE 权限时审批两张卡片不渲染', async () => {
    useAuthStore.setState({ currentUser: BUYER_USER });
    workbenchMock.mockResolvedValue(
      makeSummary({ pendingSend: 1, pendingApproval: 4, approvalTimeout: 2, total: 7 }),
    );
    renderWithProviders(<ActionWorkbench />);

    expect(await screen.findByLabelText('打开「待发送询价」')).toBeInTheDocument();
    expect(countOf('待发送询价')).toBe('1');
    expect(screen.queryByLabelText('打开「待审批事项」')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('打开「即将超时审批」')).not.toBeInTheDocument();
    expect(cardLabels()).toHaveLength(6);
    expect(cardLabels()).not.toContain('打开「待审批事项」');
  });
});
