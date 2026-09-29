/**
 * 待报价页 R109 回归测试：非演示模式默认走服务端分页，行内统计只用「随行返回」的报价
 *
 * 被守护的行为（src/pages/quotation/pending/index.tsx）：
 *   1 首屏即发 listPage({page:1,pageSize:10,status:'INQUIRING,PARTIAL_QUOTED,ALL_QUOTED,TIMEOUT'})，
 *     表格行来自 listPage 返回值而不是全局 store 的无界询价数组；
 *   2 行内「邀请/已报价/暂存/未报价/超时」只按该行自带的 inquiry.quotations 算，
 *     报价 store 里同一询价单的另一份数据不得参与（这一格钉住"不再读全量报价数组"）；
 *   3 状态筛子单选后 status 就是那一个状态，不再是四个可见状态的串；
 *   4 截止日 RangePicker 选一段 → deadlineFrom/deadlineTo 以 YYYY-MM-DD 下推；
 *   5 点分页第 2 页真的换页：第二次入参 page:2 且表格换成第 2 页的行
 *     （R108 在同形状改动上栽过：Table 级 onChange 不看 extra.action 会把 page 抹回 1）；
 *   6 已翻到第 2 页后改筛子必须回到第 1 页（否则"第 4 页 + 新筛子"读到空白页）；
 *   7 空态两种文案：total=0 且无筛子 → quotation.pending.empty；total=0 但设了筛子 → noMatch；
 *   8 演示模式（IS_DEMO_MODE=true）不发 listPage，行与行内统计仍来自 store。
 *
 * 桩法照抄 src/pages/inquiry/list/__tests__/inquiryList.serverPaging.test.tsx：
 * vi.mock('@/config') 用 getter 伪造成可切换的 IS_DEMO_MODE（默认 false＝走服务端分页那一支）；
 * vi.mock('@/api/inquiryApi') 桩掉 listPage。matchMedia 强制桌面端（Table 分支）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import { inDays } from '@/test/temporalFixtures';
import { inquiryApi } from '@/api/inquiryApi';
import type { InquiryListParams, PaginatedInquiries } from '@/types';
import { Currency, InquiryStatus, QuotationStatus, type Inquiry, type Quotation } from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';

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

// 本页唯一的取数入口；其余方法给空壳，挂载路径不会碰到它们
vi.mock('@/api/inquiryApi', () => ({
  inquiryApi: {
    listPage: vi.fn(),
    list: vi.fn(async () => []),
    export: vi.fn(async () => undefined),
    get: vi.fn(),
  },
}));

import QuotationPendingPage from '../index';

const listPageMock = vi.mocked(inquiryApi.listPage);

/** 页面 VISIBLE_STATUSES 的逗号串（逐字写死，不 import 实现里的常量） */
const VISIBLE_CSV = 'INQUIRING,PARTIAL_QUOTED,ALL_QUOTED,TIMEOUT';

/** 完整询价行夹具 */
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
    status: InquiryStatus.INQUIRING,
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

/** 报价夹具（只填页面统计会用到的字段，其余给齐类型） */
function makeQuotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: `quo-${Math.random().toString(36).slice(2, 8)}`,
    inquiryId: 'inq-1',
    supplierId: 's1',
    supplierName: '供应商',
    status: QuotationStatus.SUBMITTED,
    items: [],
    totalAmount: 0,
    attachments: [],
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    ...overrides,
  };
}

/** 服务端分页响应夹具 */
function makePage(items: Inquiry[], total = items.length): PaginatedInquiries {
  return { items, total, page: 1, pageSize: 10 };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/quotation/pending']}>
          <QuotationPendingPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** 第 n 次（1 基）listPage 调用的入参；调用不存在则抛错而不是拿 undefined 继续断言 */
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

/** 等第 n 次调用发生（>=n）并返回其入参 */
async function waitCall(n: number): Promise<InquiryListParams> {
  await waitFor(() => expect(listPageMock.mock.calls.length).toBeGreaterThanOrEqual(n));
  return callArgs(n);
}

/**
 * 按「列头文案 → 该列在本行的单元格文本」读数。
 * 表头与单元格同索引（antd v5 单表渲染，fixed 列只加 sticky 类不改列序），
 * 这样断言落在具体某一格，而不是"页面上出现过这个数字"。
 */
function cellText(inquiryCode: string, headerTitle: string): string {
  const codeNode = screen.queryByText(inquiryCode);
  if (!codeNode) throw new Error(`行「${inquiryCode}」没渲染：locator 失效`);
  const tr = codeNode.closest('tr');
  if (!tr) throw new Error(`行「${inquiryCode}」不在 tr 里：locator 失效`);
  const table = tr.closest('table');
  if (!table) throw new Error(`行「${inquiryCode}」不在 table 里：locator 失效`);
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
    (th.textContent ?? '').trim(),
  );
  const idx = headers.indexOf(headerTitle);
  if (idx < 0) throw new Error(`列头「${headerTitle}」没找到，实得列头=${JSON.stringify(headers)}`);
  const cell = tr.children[idx];
  if (!cell) throw new Error(`行「${inquiryCode}」第 ${idx} 格不存在`);
  return (cell.textContent ?? '').trim();
}

/** 打开状态筛子下拉并选一项（按选项文案） */
async function pickStatus(optionLabel: string): Promise<void> {
  // 未打开时「全部状态」只在选中项里出现一次；打开后下拉里还有一份，故先取容器
  const selected = screen.getByText('全部状态');
  const select = selected.closest('.ant-select');
  if (!select) throw new Error('状态筛子的 Select 容器没找到：locator 失效');
  const selector = select.querySelector('.ant-select-selector');
  if (!selector) throw new Error('状态筛子的 .ant-select-selector 没找到：locator 失效');
  fireEvent.mouseDown(selector);
  const option = await screen.findByText(optionLabel, {
    selector: '.ant-select-item-option-content',
  });
  fireEvent.click(option);
}

/** 打开截止日 RangePicker 面板（面板未打开/没日期格即抛错，不拿"没报错"当通过） */
async function openDeadlinePanel(): Promise<void> {
  const startInput = screen.getByPlaceholderText('截止开始');
  const picker = startInput.closest('.ant-picker');
  if (!picker) throw new Error('截止日 RangePicker 的 .ant-picker 没找到：locator 失效');
  // 必须是 click：rc-picker 的 onSelectorFocus 用 triggerOpen(true,{inherit:true})，
  // 当前是关的时候 setOpen 会被 `!config.inherit || rafOpen` 短路掉 ⇒ 单靠 focus 打不开面板；
  // 只有 RangeSelector 外层 div 的 onClick（onSelectorClick → triggerOpen(true)）才真的置 open。
  fireEvent.mouseDown(startInput);
  fireEvent.click(startInput);
  await waitFor(() => {
    const open = document.querySelector(
      '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-cell',
    );
    if (!open)
      throw new Error(
        `截止日 RangePicker 面板没有打开（可见日期格 0 个；dropdown=${JSON.stringify(
          Array.from(document.querySelectorAll('.ant-picker-dropdown')).map((el) => el.className),
        )}）`,
      );
  });
}

/** 点面板里 title 为该日期的格子 */
function clickDateCell(day: string): void {
  const cell = document.querySelector(
    `.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) td.ant-picker-cell[title="${day}"] .ant-picker-cell-inner`,
  );
  if (!cell) throw new Error(`日期格 ${day} 没渲染在可见面板里：locator 失效`);
  fireEvent.click(cell);
}

/** 往关键词输入框填值 */
function typeKeyword(value: string): void {
  const input = screen.getByPlaceholderText('搜索编号 / 主题');
  fireEvent.change(input, { target: { value } });
}

/** 点分页器第 n 页 */
function clickPageItem(n: number): void {
  const item = document.querySelector(`.ant-pagination-item-${n}`);
  if (!item) throw new Error(`分页器第 ${n} 页按钮没渲染：locator 失效`);
  fireEvent.click(item);
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
  useUIStore.setState({ currentOrganization: '__ALL__' });
  useInquiryStore.setState({ inquiries: [], loading: false });
  useQuotationStore.setState({ quotations: [] });
  listPageMock.mockReset();
  listPageMock.mockResolvedValue(makePage([]));
});

describe('R109 首屏默认走服务端分页', () => {
  it('首帧即发 listPage({page:1,pageSize:10,status:四个可见状态串})，行集来自返回值而非 store 全量', async () => {
    // store 里放一条"只有读全量询价数组才会出现"的行（状态可见，客户端过滤挡不住它）
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'store-1', code: 'INQ-STORE-ONLY', subject: '全量数组行' })],
      loading: false,
    });
    listPageMock.mockResolvedValue(
      makePage([makeInquiry({ id: 'srv-1', code: 'INQ-SRV-ONLY', subject: '服务端分页行' })], 42),
    );
    renderPage();

    // 钉入参：首屏就是服务端分页请求，pageSize 10、status 为四个可见状态的逗号串、无其它筛子
    const first = await waitCall(1);
    expect(first).toEqual({
      page: 1,
      pageSize: 10,
      status: VISIBLE_CSV,
      keyword: undefined,
      deadlineFrom: undefined,
      deadlineTo: undefined,
    });
    expect(listPageMock).toHaveBeenCalledTimes(1);

    // 钉行集来源：表格里是 listPage 返回的行，store 里那条不得出现
    expect(await screen.findByText('INQ-SRV-ONLY')).toBeInTheDocument();
    expect(screen.queryByText('INQ-STORE-ONLY')).not.toBeInTheDocument();
    // 总数用服务端给的筛选后全集条数（42），不是当页条数（1）。
    // 只钉分页器那一格：筛选区也渲染同一句文案，getByText 会撞成多处命中。
    const totalText = document.querySelector('.ant-pagination-total-text');
    expect(totalText?.textContent).toBe('共 42 条');
  });
});

describe('R109 行内统计只用随行返回的报价', () => {
  it('随行 1 条 SUBMITTED vs 报价 store 同单 2 条 SUBMITTED：页面显示 1/2（store 那份不参与）', async () => {
    // 同一询价单 id，两份互相矛盾的数据：
    //   随行 quotations = [s1 SUBMITTED]                 → 已报价 1、未报价 2
    //   报价 store      = [s2 SUBMITTED, s3 SUBMITTED]   → 已报价 2、未报价 1
    // 显示哪个数，就读得出这页到底还依不依赖全量报价数组。
    const inquiry = makeInquiry({
      id: 'inq-rowstats',
      code: 'INQ-ROW-STATS',
      status: InquiryStatus.PARTIAL_QUOTED,
      deadline: inDays(10), // 未过期：超时数不该被"过期即全算超时"分支抬高
      invitedSupplierIds: ['s1', 's2', 's3'],
      quotations: [makeQuotation({ id: 'q-row-s1', inquiryId: 'inq-rowstats', supplierId: 's1' })],
    });
    useQuotationStore.setState({
      quotations: [
        makeQuotation({ id: 'q-store-s2', inquiryId: 'inq-rowstats', supplierId: 's2' }),
        makeQuotation({ id: 'q-store-s3', inquiryId: 'inq-rowstats', supplierId: 's3' }),
      ],
    });
    listPageMock.mockResolvedValue(makePage([inquiry], 1));
    renderPage();

    await screen.findByText('INQ-ROW-STATS');
    expect(cellText('INQ-ROW-STATS', '邀请供应商数')).toBe('3');
    expect(cellText('INQ-ROW-STATS', '已报价数')).toBe('1');
    expect(cellText('INQ-ROW-STATS', '暂存数')).toBe('0');
    expect(cellText('INQ-ROW-STATS', '未报价数')).toBe('2');
    expect(cellText('INQ-ROW-STATS', '超时数')).toBe('0');
    // 回收进度按随行数据算：1/3 ≈ 33%，不是 store 那份的 2/3 ≈ 67%
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.queryByText('2/3')).not.toBeInTheDocument();
  });
});

describe('R109 状态筛子下推', () => {
  it('选「已超时」后下一次 listPage 的 status 就是 TIMEOUT（不再是四个的串）', async () => {
    listPageMock.mockResolvedValue(
      makePage(
        [makeInquiry({ id: 'srv-to', code: 'INQ-TIMEOUT-ROW', status: InquiryStatus.TIMEOUT })],
        1,
      ),
    );
    renderPage();
    const first = await waitCall(1);
    expect(first.status).toBe(VISIBLE_CSV);

    await pickStatus('已超时');

    const second = await waitCall(2);
    expect(second.status).toBe('TIMEOUT');
    // 单选之后没有"再来一发把 status 改回四串"的请求
    expect(lastCallArgs().status).toBe('TIMEOUT');
    // 单选一个状态是"收窄"，其余默认参数不动
    expect(second.page).toBe(1);
    expect(second.pageSize).toBe(10);
    expect(await screen.findByText('INQ-TIMEOUT-ROW')).toBeInTheDocument();
  });
});

describe('R109 截止日区间下推', () => {
  it('RangePicker 选一段日期：listPage 入参带 deadlineFrom/deadlineTo 且格式为 YYYY-MM-DD', async () => {
    // 取当前月的 5 日与 12 日：5 日带前导零，"零填充"这条才算真钉住
    const from = dayjs().startOf('month').date(5);
    const to = dayjs().startOf('month').date(12);
    const fromStr = from.format('YYYY-MM-DD');
    const toStr = to.format('YYYY-MM-DD');
    listPageMock.mockResolvedValue(
      makePage([makeInquiry({ id: 'srv-d1', code: 'INQ-DEADLINE-ROW' })], 1),
    );
    renderPage();
    await waitCall(1);

    await openDeadlinePanel();
    clickDateCell(fromStr);
    clickDateCell(toStr);

    const second = await waitCall(2);
    expect(second.deadlineFrom).toBe(fromStr);
    expect(second.deadlineTo).toBe(toStr);
    expect(second.deadlineFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(second.deadlineTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 区间筛子不该顺手把状态串丢掉
    expect(second.status).toBe(VISIBLE_CSV);
    // 输入框里回填的是同一份日期
    expect(screen.getByPlaceholderText('截止开始')).toHaveValue(fromStr);
    expect(screen.getByPlaceholderText('截止结束')).toHaveValue(toStr);
  });
});

describe('R109 翻页真的换页', () => {
  /** 两页给不同行的服务端 */
  function mockTwoPages(): void {
    listPageMock.mockImplementation((params: InquiryListParams) =>
      Promise.resolve(
        params.page === 2
          ? makePage([makeInquiry({ id: 'p2-1', code: 'INQ-PAGE2-ROW' })], 25)
          : makePage([makeInquiry({ id: 'p1-1', code: 'INQ-PAGE1-ROW' })], 25),
      ),
    );
  }

  it('点第 2 页：第二次入参 page:2，表格显示第 2 页那行且第 1 页那行消失', async () => {
    mockTwoPages();
    renderPage();
    const first = await waitCall(1);
    expect(first.page).toBe(1);
    // 等第 1 页落地，分页器才画得出第 2 页（total 来自服务端）
    await screen.findByText('INQ-PAGE1-ROW');

    clickPageItem(2);

    const second = await waitCall(2);
    expect(second.page).toBe(2);
    expect(second.pageSize).toBe(10);
    expect(await screen.findByText('INQ-PAGE2-ROW')).toBeInTheDocument();
    expect(screen.queryByText('INQ-PAGE1-ROW')).not.toBeInTheDocument();
    expect(listPageMock).toHaveBeenCalledTimes(2);
  });
});

describe('R109 筛子变化回到第 1 页', () => {
  it('先翻到第 2 页再改关键词：下一次入参 page:1 且带新的 keyword', async () => {
    listPageMock.mockImplementation((params: InquiryListParams) =>
      Promise.resolve(
        params.page === 2
          ? makePage([makeInquiry({ id: 'p2-1', code: 'INQ-PAGE2-ROW' })], 25)
          : makePage(
              [
                makeInquiry({
                  id: 'p1-1',
                  code: params.keyword === 'ABC' ? 'INQ-P1-KEYWORD-ABC' : 'INQ-PAGE1-ROW',
                }),
              ],
              25,
            ),
      ),
    );
    renderPage();
    await waitCall(1);
    await screen.findByText('INQ-PAGE1-ROW');
    clickPageItem(2);
    await waitCall(2);
    await screen.findByText('INQ-PAGE2-ROW');

    typeKeyword('ABC');

    const third = await waitCall(3);
    expect(third.page).toBe(1);
    expect(third.keyword).toBe('ABC');
    expect(await screen.findByText('INQ-P1-KEYWORD-ABC')).toBeInTheDocument();
    expect(screen.queryByText('INQ-PAGE2-ROW')).not.toBeInTheDocument();
  });
});

describe('R109 空态两种文案', () => {
  it('total=0 且没设任何筛子：显示 quotation.pending.empty 文案', async () => {
    listPageMock.mockResolvedValue(makePage([], 0));
    renderPage();
    await waitCall(1);

    expect(await screen.findByText('暂无待处理报价')).toBeInTheDocument();
    expect(screen.queryByText('未找到匹配的询价单')).not.toBeInTheDocument();
    expect(listPageMock).toHaveBeenCalledTimes(1);
  });

  it('total=0 但设了状态筛子：显示 quotation.pending.noMatch 文案', async () => {
    listPageMock.mockResolvedValue(makePage([], 0));
    renderPage();
    await waitCall(1);

    await pickStatus('已超时');
    const second = await waitCall(2);
    expect(second.status).toBe('TIMEOUT');

    expect(await screen.findByText('未找到匹配的询价单')).toBeInTheDocument();
    expect(screen.queryByText('暂无待处理报价')).not.toBeInTheDocument();
  });
});

describe('R109 演示模式那一支', () => {
  it('IS_DEMO_MODE=true：不发 listPage，行与行内统计仍来自 store', async () => {
    configMock.demoMode = true;
    // store 里的可见状态行：invited [s1,s2]，报价 store 给 s1 一条 SUBMITTED
    // ⇒ 行来自 store、统计也按 store 算（已报价 1、未报价 1）；
    //   随行 quotations 故意留空，走服务端那一支会算成 0，故这两个数不是恒真。
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({
          id: 'demo-1',
          code: 'INQ-DEMO-ROW',
          status: InquiryStatus.INQUIRING,
          deadline: inDays(10),
          invitedSupplierIds: ['s1', 's2'],
          quotations: [],
        }),
      ],
      loading: false,
    });
    useQuotationStore.setState({
      quotations: [makeQuotation({ id: 'q-demo-s1', inquiryId: 'demo-1', supplierId: 's1' })],
    });
    // 就算被误调用也会给一条 store 里没有的行——断言它不出现，防"mock 恰好没数据"的假绿
    listPageMock.mockResolvedValue(
      makePage([makeInquiry({ id: 'srv-x', code: 'INQ-SRV-MUST-NOT-APPEAR' })], 1),
    );
    renderPage();

    expect(await screen.findByText('INQ-DEMO-ROW')).toBeInTheDocument();
    expect(screen.queryByText('INQ-SRV-MUST-NOT-APPEAR')).not.toBeInTheDocument();
    expect(cellText('INQ-DEMO-ROW', '已报价数')).toBe('1');
    expect(cellText('INQ-DEMO-ROW', '未报价数')).toBe('1');
    expect(listPageMock).not.toHaveBeenCalled();
  });
});
