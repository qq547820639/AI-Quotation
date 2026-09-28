/**
 * 询价列表页 R108 回归测试：非演示模式默认走服务端分页
 *
 * 被守护的行为（src/pages/inquiry/list/index.tsx）：
 *   1 首屏即发 listPage({page:1,pageSize:10,sort:'createdAt:desc'})，表格行来自
 *     listPage 返回值而不是全局 store 的无界全量数组（store 里的行不得出现）；
 *   2 「编号」与「主题」两个筛子各自直传（原实现挤成一个 keyword，两填即丢后一个）；
 *   3 「创建人」「品类」两筛子直传 creator / category；
 *   4 点「物料数量」列头 → sort=itemsCount:*（全集排序），且页码回到 1；
 *   5 URL 往返：?code&subject&creator&category&page&sort 挂载即恢复并带进请求；
 *     旧链接 ?keyword=K 按 code 恢复、subject 不带；
 *   6 演示模式（IS_DEMO_MODE=true）仍走客户端全量，listPage 一次都不发；
 *   7 竞态：page=1 迟到响应不得覆盖已落地的 page=2 行集（本格实跑为红，
 *     红因与归因写在用例内注释，页面缺陷不在本文件修复范围内）。
 *
 * 桩法：vi.mock('@/config') 用 getter 伪造成可切换的 IS_DEMO_MODE（默认 false＝走
 * 服务端分页那一支）；vi.mock('@/api/inquiryApi') 桩掉 listPage；服务端模式下
 * useTablePreferences(serverSync=!IS_DEMO_MODE) 会打 usersApi，一并桩掉。
 * auth/ui store 登录态与 matchMedia（强制桌面端表格）照 dashboard 测试的桩法。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { inDays } from '@/test/temporalFixtures';
import { inquiryApi } from '@/api/inquiryApi';
import type { InquiryListParams, PaginatedInquiries } from '@/types';
import { Currency, InquiryStatus, type Inquiry } from '@/types';

// 可切换的 IS_DEMO_MODE 伪造源：默认 false（非演示 ⇒ 服务端分页是默认取数路径）
const { configMock } = vi.hoisted(() => ({ configMock: { demoMode: false } }));
vi.mock('@/config', () => ({
  get IS_DEMO_MODE() {
    return configMock.demoMode;
  },
  get IS_PRODUCTION() {
    return !configMock.demoMode;
  },
  get MOCK_FALLBACK_ENABLED() {
    return configMock.demoMode;
  },
}));

// 列表页唯一的取数入口；其余方法给空壳，挂载路径不会碰到它们
vi.mock('@/api/inquiryApi', () => ({
  inquiryApi: {
    listPage: vi.fn(),
    list: vi.fn(async () => []),
    export: vi.fn(async () => undefined),
    batchSend: vi.fn(),
    batchRemind: vi.fn(),
    batchExport: vi.fn(),
    batchAssign: vi.fn(),
  },
}));

// 服务端模式下 useTablePreferences 会同步表偏好（getTablePreference/saveTablePreference），
// 与本页被测行为无关，桩掉避免真实 axios 请求
vi.mock('@/api/usersApi', () => ({
  usersApi: {
    getTablePreference: vi.fn(async () => null),
    saveTablePreference: vi.fn(async () => undefined),
  },
}));

import InquiryListPage from '../index';
import { useAuthStore } from '@/store/useAuthStore';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import type { User } from '@/types';

const listPageMock = vi.mocked(inquiryApi.listPage);

const ADMIN_USER: User = {
  id: 'u-admin',
  name: '管理员',
  role: '管理员',
  department: '采购部',
  organization: '总部采购中心',
};

/** 完整询价行夹具（表格渲染会取 items/invitedSupplierIds/status/deadline 等字段） */
function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: `inq-${Math.random().toString(36).slice(2, 8)}`,
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

/** 服务端分页响应夹具 */
function makePage(items: Inquiry[], total = items.length): PaginatedInquiries {
  return { items, total, page: 1, pageSize: 10 };
}

function renderPage(initialEntries: string[] = ['/inquiry/list']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={initialEntries}>
          <InquiryListPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** 第 n 次（1 基）listPage 调用的入参；调用不存在则直接抛错而不是拿 undefined 继续断言 */
function callArgs(n: number): InquiryListParams {
  const call = listPageMock.mock.calls[n - 1];
  if (!call)
    throw new Error(`listPage 第 ${n} 次调用不存在（实际共 ${listPageMock.mock.calls.length} 次）`);
  return call[0];
}

/** 最近一次 listPage 调用的入参 */
function lastCallArgs(): InquiryListParams {
  const calls = listPageMock.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('listPage 一次都没被调用');
  return call[0];
}

/**
 * 筛选表单里某个筛子的容器列（label div + 控件同在 .ant-col）。
 * 限定在 Collapse 展开区内查，避开同文案的表头列（如「创建人」「询价单编号」）。
 */
function filterCol(labelText: string): HTMLElement {
  const area = document.querySelector('.ant-collapse-content');
  if (!area) throw new Error('筛选 Collapse 未渲染：locator 失效，不能拿"没报错"当通过');
  const label = within(area as HTMLElement).getByText(labelText);
  const col = label.closest('.ant-col');
  if (!col) throw new Error(`筛子「${labelText}」的 .ant-col 容器没找到`);
  return col as HTMLElement;
}

/** 按列头文案找 th（排除 TableSettings 面板等隐藏副本） */
function headerCell(title: string): HTMLElement {
  const th = screen
    .getAllByText(title)
    .map((el) => el.closest('th'))
    .find((el): el is HTMLTableCellElement => el !== null);
  if (!th) throw new Error(`表头「${title}」没渲染，无法点击排序`);
  return th;
}

interface Deferred {
  promise: Promise<PaginatedInquiries>;
  resolve: (value: PaginatedInquiries) => void;
}

/** 悬挂的响应：拿到 resolve 前不落地，用来构造"旧请求迟到"的时序 */
function deferred(): Deferred {
  let resolve: (value: PaginatedInquiries) => void = () => undefined;
  const promise = new Promise<PaginatedInquiries>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 让悬挂响应落地，并把 promise → react-query setState → React 渲染一并 flush */
async function settle(resolve: (value: PaginatedInquiries) => void, value: PaginatedInquiries) {
  await act(async () => {
    resolve(value);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 等第 n 次调用发生（>=n，防服务端恢复筛子时连发多次把"恰好 n 次"的等待打穿）并返回其入参 */
async function waitCall(n: number): Promise<InquiryListParams> {
  await waitFor(() => expect(listPageMock.mock.calls.length).toBeGreaterThanOrEqual(n));
  return callArgs(n);
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

beforeEach(() => {
  configMock.demoMode = false;
  // antd Grid.useBreakpoint 依赖 matchMedia：让所有 min-width 查询命中 ⇒ 桌面端（表格分支）
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  // 页面会在挂载时恢复 sessionStorage 的筛选快照与 localStorage 的列偏好/视图，
  // 用例之间必须互相看不见
  sessionStorage.clear();
  localStorage.clear();
  useUIStore.setState({ currentOrganization: '__ALL__' });
  useInquiryStore.setState({ inquiries: [], loading: false });
  useQuotationStore.setState({ quotations: [] });
  useAuthStore.setState({ currentUser: ADMIN_USER });
  listPageMock.mockReset();
  listPageMock.mockResolvedValue(makePage([]));
});

describe('R108 首屏默认走服务端分页', () => {
  it('首帧即发 listPage({page:1,pageSize:10,sort:"createdAt:desc"})，行集来自返回值而非 store 全量', async () => {
    // store 里放一条"只有读全量才会出现"的行；服务端返回另一条"只有走分页才会出现"的行
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'store-1', code: 'INQ-STORE-ONLY', subject: '全量数组行' })],
      loading: false,
    });
    listPageMock.mockResolvedValue(
      makePage([makeInquiry({ id: 'srv-1', code: 'INQ-SRV-ONLY', subject: '服务端分页行' })], 42),
    );
    renderPage();

    // 钉入参：首屏就是服务端分页请求，默认 createdAt:desc、pageSize 10、无任何筛子
    const first = await waitCall(1);
    expect(first).toEqual({
      page: 1,
      pageSize: 10,
      code: undefined,
      subject: undefined,
      creator: undefined,
      category: undefined,
      status: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      sort: 'createdAt:desc',
    });
    expect(listPageMock).toHaveBeenCalledTimes(1);

    // 钉行集来源：表格里出现的是 listPage 返回的行，store 里那条不得出现
    expect(await screen.findByText('INQ-SRV-ONLY')).toBeInTheDocument();
    expect(screen.queryByText('INQ-STORE-ONLY')).not.toBeInTheDocument();
  });
});

describe('R108 四个筛子各自直传', () => {
  /** 往某个筛子输入框打字 */
  async function typeFilter(labelText: string, value: string): Promise<void> {
    const input = within(filterCol(labelText)).getByRole('textbox');
    fireEvent.change(input, { target: { value } });
  }

  /** 点筛选区里的「查询」提交输入态 */
  async function clickQuery(): Promise<void> {
    const area = document.querySelector('.ant-collapse-content') as HTMLElement;
    // antd 对两个汉字的按钮文案会自动插空格（"查 询"），用 \s* 容忍
    fireEvent.click(within(area).getByRole('button', { name: /查\s*询/ }));
  }

  it('同时填「编号」与「主题」：listPage 入参 code 与 subject 各自带上（不再挤成 keyword）', async () => {
    renderPage();
    await waitCall(1);

    await typeFilter('询价单编号', 'AB123');
    await typeFilter('询价主题', 'XYZ主题串');
    await clickQuery();

    const args = await waitCall(2);
    expect(args.code).toBe('AB123');
    expect(args.subject).toBe('XYZ主题串');
    // 丢失点的反面证据：入参对象里根本没有 keyword 这个键
    expect('keyword' in args).toBe(false);
  });

  it('填「创建人」并选「品类」：listPage 入参分别带 creator 与 category', async () => {
    renderPage();
    await waitCall(1);

    await typeFilter('创建人', '张三丰');
    // 品类是 Select：mouseDown 打开下拉，选「五金件」（value 与 label 同文案）
    const select = filterCol('物料品类').querySelector('.ant-select-selector');
    if (!select) throw new Error('物料品类的 Select 没渲染：locator 失效');
    fireEvent.mouseDown(select);
    const option = await screen.findByText('五金件', {
      selector: '.ant-select-item-option-content',
    });
    fireEvent.click(option);
    await clickQuery();

    const args = await waitCall(2);
    expect(args.creator).toBe('张三丰');
    expect(args.category).toBe('五金件');
    expect('keyword' in args).toBe(false);
  });
});

describe('R108 表头排序走服务端', () => {
  it('在第 2 页点「物料数量」列头：sort 变为 itemsCount:asc 且 page 回到 1', async () => {
    // 从 ?page=2 挂载 ⇒ 第 1 次调用带 page:2，点列头后必须回到 page:1
    renderPage(['/inquiry/list?page=2']);
    const first = await waitCall(1);
    expect(first.page).toBe(2);

    fireEvent.click(headerCell('物料数量'));

    // antd 对未排序列的首次点击实测给 ascend（本用例即以该实测方向断言；
    // 若哪天变序，这一格当场红）
    const second = await waitCall(2);
    expect(second.sort).toBe('itemsCount:asc');
    expect(second.page).toBe(1);
  });
});

describe('R108 URL 往返', () => {
  it('?code&subject&creator&category&page&sort 挂载：URL 值恢复进 listPage 入参', async () => {
    renderPage(['/inquiry/list?code=A&subject=B&creator=C&category=D&page=2&sort=deadline:asc']);

    // page/sort 直接来自 URL（挂载即生效）；四个筛子由挂载 effect 恢复 applied 后带上，
    // 即"恢复完成后的最终请求"必须六项齐全——首帧那次调用已带 page:2 与 sort，筛子随后补上
    const first = await waitCall(1);
    expect(first.page).toBe(2);
    expect(first.sort).toBe('deadline:asc');

    await waitFor(() => {
      expect(lastCallArgs()).toEqual({
        page: 2,
        pageSize: 10,
        code: 'A',
        subject: 'B',
        creator: 'C',
        category: 'D',
        status: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        sort: 'deadline:asc',
      });
    });
  });

  it('旧链接只带 ?keyword=K：按 code 恢复，subject 不带', async () => {
    renderPage(['/inquiry/list?keyword=K']);

    const first = await waitCall(1);
    await waitFor(() => {
      expect(lastCallArgs().code).toBe('K');
    });
    const args = lastCallArgs();
    expect(args.subject).toBeUndefined();
    expect(args.creator).toBeUndefined();
    expect(args.category).toBeUndefined();
    // 兼容支只恢复成 code，不会把 K 再塞回一个叫 keyword 的入参
    expect('keyword' in args).toBe(false);
    expect(first.page).toBe(1);
  });
});

describe('R108 演示模式那一支', () => {
  it('IS_DEMO_MODE=true 时不发 listPage，表格行来自 store 全量', async () => {
    configMock.demoMode = true;
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'store-9', code: 'INQ-DEMO-ROW', subject: '演示模式行' })],
      loading: false,
    });
    // 就算被误调用也会给一条 store 里没有的行——断言它不出现，防"mock 恰好没数据"的假绿
    listPageMock.mockResolvedValue(
      makePage([makeInquiry({ id: 'srv-x', code: 'INQ-SRV-MUST-NOT-APPEAR' })]),
    );
    renderPage();

    expect(await screen.findByText('INQ-DEMO-ROW')).toBeInTheDocument();
    expect(screen.queryByText('INQ-SRV-MUST-NOT-APPEAR')).not.toBeInTheDocument();
    expect(listPageMock).not.toHaveBeenCalled();
  });
});

describe('R108 分页竞态', () => {
  it('page=1 迟到响应不得覆盖已落地的 page=2 行集', async () => {
    // 服务端模式下行集只来自 listPage；store 塞 25 条只为撑起 total 回退，
    // 让分页器在 page=1 请求还挂着时就画得出「第 2 页」按钮
    useInquiryStore.setState({
      inquiries: Array.from({ length: 25 }, (_, i) =>
        makeInquiry({ id: `seed-${i}`, code: `INQ-SEED-${i}` }),
      ),
      loading: false,
    });
    const p1 = deferred();
    const p2 = deferred();
    listPageMock.mockImplementation((params: InquiryListParams) =>
      params.page === 1 ? p1.promise : p2.promise,
    );
    renderPage();

    expect(listPageMock).toHaveBeenCalledTimes(1);
    expect(callArgs(1).page).toBe(1);

    // 点分页器第 2 页 ⇒ URL 写 page=2 ⇒ 发第 2 次请求
    // （已知红点：实测停在"expected 1 to be greater than or equal to 2"。归因：翻页点击
    // 同时触发 Table 级 onChange，handleTableChange 不看 onChange 第 4 参 extra.action，
    // 把 paginate 当成排序变化走 syncUrl(applied, 1, …)，用同一渲染快照的旧 searchParams
    // 重写 URL，把刚写入的 page=2 抹掉 ⇒ 第 2 次请求从未发出。诊断对照：同表去掉
    // Table 级 onChange 后点击可把 URL 写成 page=2。）
    const item2 = document.querySelector('.ant-pagination-item-2');
    if (!item2) throw new Error('分页器第 2 页按钮没渲染：locator 失效');
    fireEvent.click(item2);
    const second = await waitCall(2);
    expect(second.page).toBe(2);

    // page=2 先落地：表格显示第 2 页的行
    await settle(p2.resolve, makePage([makeInquiry({ id: 'p2-1', code: 'INQ-PAGE2-ROW' })], 25));
    expect(await screen.findByText('INQ-PAGE2-ROW')).toBeInTheDocument();

    // page=1 的响应迟到：不得把表格覆盖回第 1 页的行
    await settle(
      p1.resolve,
      makePage([makeInquiry({ id: 'p1-late', code: 'INQ-PAGE1-LATE' })], 25),
    );
    expect(screen.queryByText('INQ-PAGE1-LATE')).not.toBeInTheDocument();
    expect(screen.getByText('INQ-PAGE2-ROW')).toBeInTheDocument();
    expect(listPageMock).toHaveBeenCalledTimes(2);
  });
});
