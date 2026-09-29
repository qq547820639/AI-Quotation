/**
 * 日志页 R112 回归测试：非演示模式默认按「日志行」分页，进页不再拉整份询价数组
 *
 * 被守护的行为（src/pages/log/index.tsx，`serverEnabled = !IS_DEMO_MODE` 两支）：
 *   1 首帧恰好一发 inquiryApi.logs({page:1,pageSize:10})（不带任何筛子），
 *     表格行来自响应 items 而不是 store 聚合数组（store 里的日志行不得出现，
 *     响应里的行 store 没有 ⇒ 只可能来自服务端）；
 *   2 非演示模式挂载既不碰 inquiryApi.list（无界全量那条），也不碰 store 的 loadFromApi；
 *     同一格自带对照：真去拉一次全量时这两个 spy 必须记得到——没有对照，缺席断言恒真；
 *   3 点「查询」把操作人/类型/关键字/时间区间四样一次性下推（operator/type/keyword/
 *     timeFrom/timeTo，日期为 YYYY-MM-DD），且已停在第 3 页时也必须回到第 1 页；
 *   4 点第 2 页真的换页：入参 page:2、表格换成第 2 页的 items、分页器高亮跟着走；
 *     showTotal 读的是服务端 total（25）而不是当页渲染行数（1）；
 *   5 点「重置」清掉四个筛子并回到裸的 {page:1,pageSize:10}（连页码一起回 1）；
 *   6 空态极性一对：total=0 + 有筛子 → log.noSearchResult；
 *     total=0 + 无筛子 → log.empty（旧代码按 allLogs.length 判，服务端那一支永远填不上 allLogs）；
 *   7 演示模式（IS_DEMO_MODE=true）不发 logs，行、顺序与分页仍来自 store 聚合，
 *     且必须按 time 倒序（store 播种顺序故意与倒序不同 ⇒ 这一格不是恒真）。
 *
 * 桩法照抄 src/pages/approval/__tests__/approval.serverPaging.test.tsx:54-78 / 331-359
 * （可切换的 IS_DEMO_MODE getter、inquiryApi 桩、matchMedia 强制桌面端、
 *   QueryClientProvider + I18nextProvider + MemoryRouter、installApiStub 在 beforeEach 复位、
 *   未预期入参一律抛错而不是静默回落默认值；第 2 格的"缺席断言 + 对照"同该文件 575-597）；
 * 「改了筛子要回第 1 页」的读法照抄 src/pages/quotation/pending/__tests__/quotationPending.serverPaging.test.tsx:420-452
 * 与其中 RangePicker 的面板开法/日期格点法（同文件 196-226）。
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
import type { InquiryLog, LogListParams, PaginatedLogs } from '@/types';
import { Currency, InquiryStatus, LogType, type Inquiry } from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
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

// 本页的取数入口是 logs（按日志行分页那一发）；list 是无界全量那条（第 2 格要钉它不被调）
vi.mock('@/api/inquiryApi', () => ({
  inquiryApi: {
    logs: vi.fn(),
    list: vi.fn(async () => []),
    export: vi.fn(async () => undefined),
    get: vi.fn(),
  },
}));

import LogPage from '../index';

const logsMock = vi.mocked(inquiryApi.logs);
const listMock = vi.mocked(inquiryApi.list);

/** store 真实动作引用：spy 装完后在 beforeEach 用它复位，免得上一格的 spy 漏到下一格 */
const realLoadFromApi = useInquiryStore.getState().loadFromApi;

/* ==================== 服务端入参字面量（逐字写死，不 import 实现里的常量） ==================== */

/**
 * 下发给服务端的类型值，用例开头先钉回 src/types 的枚举，枚举一漂移夹具当场报错。
 * 取第 4 个而不是最后一个：Select 下拉是虚拟列表（16 个 LogType 只画得出开头约 10 个），
 * 排在尾部的 APPROVE 在 jsdom 里根本没有对应 DOM 节点，点不到。
 */
const TYPE_ADD_SUPPLIER = 'ADD_SUPPLIER';
const TYPE_LABEL_ADD_SUPPLIER = '添加供应商';

/** 服务端那一发独有的行内容：演示模式那一支若误发请求，这条就会出现 */
const SENTINEL_CONTENT = 'SRV-ONLY-MUST-NOT-APPEAR-IN-DEMO';

/* ==================== 夹具 ==================== */

function makeLog(overrides: Partial<InquiryLog> = {}): InquiryLog {
  return {
    id: `log-${Math.random().toString(36).slice(2, 8)}`,
    inquiryId: 'inq-1',
    time: '2026-08-01 10:00:00',
    operator: '采购员',
    operatorRole: '采购员',
    type: LogType.CREATE,
    content: '测试日志内容',
    ...overrides,
  };
}

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

/* ==================== 服务端桩的可配面 ==================== */

/**
 * 桩按当前 resolver 认领行集与 total；未预期的入参由 resolver 自己抛错
 * （照 approval.serverPaging.test.tsx:162-206 的做法：不给"没命中分支"留静默默认值）。
 * 默认值刻意给一条 store 里不存在的行 + total 25 ⇒ 演示模式误发请求一定看得见。
 */
let logsResolver: (params: LogListParams) => { items: InquiryLog[]; total: number } = () => ({
  items: [makeLog({ id: 'srv-sentinel', content: SENTINEL_CONTENT })],
  total: 25,
});

function installApiStub(): void {
  logsResolver = () => ({
    items: [makeLog({ id: 'srv-sentinel', content: SENTINEL_CONTENT })],
    total: 25,
  });
  logsMock.mockReset();
  logsMock.mockImplementation(async (params: LogListParams) => {
    // R112 的正面主张就是"这一页按日志行分页"：少了 page/pageSize 就不算分页请求
    if (!params.page || !params.pageSize) {
      throw new Error(`logs 少了分页入参（R112 前这里是无参全量）：${JSON.stringify(params)}`);
    }
    const { items, total } = logsResolver(params);
    const page: PaginatedLogs = { items, total, page: params.page, pageSize: params.pageSize };
    return page;
  });
  listMock.mockReset();
  listMock.mockResolvedValue([]);
}

/* ==================== 渲染与读数 ==================== */

function renderPage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/log']}>
          <LogPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** 入参命中 subset（逐键全等，含显式 undefined）的全部 logs 调用 */
function callsMatching(subset: Partial<LogListParams>): LogListParams[] {
  return logsMock.mock.calls
    .map((c) => c[0])
    .filter((p) =>
      Object.entries(subset).every(([k, v]) => (p as Record<string, unknown>)[k] === v),
    );
}

/** 等一发命中 subset 的调用发生，返回其完整入参（读不到就抛错，不拿 undefined 继续断言） */
async function waitCall(subset: Partial<LogListParams>): Promise<LogListParams> {
  await waitFor(() => expect(callsMatching(subset).length).toBeGreaterThan(0));
  const hit = callsMatching(subset)[0];
  if (!hit) throw new Error(`命中的 logs 调用读不到：${JSON.stringify(subset)}`);
  return hit;
}

/** 等总调用数 >=n（重置这类"回到裸入参"的场合，subset 与既有调用同形，只能按发数等） */
async function waitForCallCount(n: number): Promise<void> {
  await waitFor(() => expect(logsMock.mock.calls.length).toBeGreaterThanOrEqual(n));
}

function lastCallArgs(): LogListParams {
  const calls = logsMock.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('logs 一次都没被调用');
  return call[0];
}

/** 表格里真实渲染的数据行数（不含 antd 的 measure/占位行） */
function tableRowCount(): number {
  return document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length;
}

/** 按「列头文案 → 该列在本行的单元格文本」读数，落在具体某一格而不是"页面出现过这个词" */
function columnTexts(columnTitle: string): string[] {
  const table = document.querySelector('.ant-table');
  if (!table) throw new Error('表格没渲染：locator 失效');
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
    (th.textContent ?? '').trim(),
  );
  const idx = headers.indexOf(columnTitle);
  if (idx < 0) throw new Error(`列头「${columnTitle}」没找到，实得列头=${JSON.stringify(headers)}`);
  return Array.from(table.querySelectorAll('.ant-table-tbody tr.ant-table-row')).map((tr) =>
    (tr.children[idx]?.textContent ?? '').trim(),
  );
}

/** 分页器里 showTotal 那一格（筛选区不渲染这句，但仍按节点取，不靠"页面出现过"） */
function totalText(): string {
  const node = document.querySelector('.ant-pagination-total-text');
  if (!node) throw new Error('分页器 .ant-pagination-total-text 没渲染：locator 失效');
  return (node.textContent ?? '').trim();
}

/** 点分页器第 n 页 */
function clickPageItem(n: number): void {
  const item = document.querySelector(`.ant-pagination-item-${n}`);
  if (!item) throw new Error(`分页器第 ${n} 页按钮没渲染：locator 失效`);
  fireEvent.click(item);
}

/** 当前高亮的页码（读取时机：新数据落地之后——total 短暂回到 0 的那一帧画不出页码格） */
function activePage(): string {
  const item = document.querySelector('.ant-pagination-item-active');
  if (!item)
    throw new Error(
      `分页器没有高亮当前页（实得分页项=${JSON.stringify(
        Array.from(document.querySelectorAll('.ant-pagination-item')).map((el) => el.className),
      )}）：locator 失效或读得太早`,
    );
  return (item.textContent ?? '').trim();
}

/** 点带中文文案的按钮（antd 会给两字按钮插空格，故去空白后比对） */
function clickButton(label: string): void {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find((b) => (b.textContent ?? '').replace(/\s+/g, '') === label);
  if (!btn)
    throw new Error(
      `没有「${label}」按钮，实得=${JSON.stringify(buttons.map((b) => b.textContent))}`,
    );
  fireEvent.click(btn);
}

/** 往输入框填值（按页面 placeholder 定位） */
function typeInto(placeholder: string, value: string): void {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

/** 打开「操作类型」Select 并按选项文案选一项 */
async function pickLogType(optionLabel: string): Promise<void> {
  const placeholder = screen.getByText('请选择操作类型');
  const select = placeholder.closest('.ant-select');
  if (!select) throw new Error('操作类型筛子的 Select 容器没找到：locator 失效');
  const selector = select.querySelector('.ant-select-selector');
  if (!selector) throw new Error('操作类型筛子的 .ant-select-selector 没找到：locator 失效');
  fireEvent.mouseDown(selector);
  const option = await screen.findByText(optionLabel, {
    selector: '.ant-select-item-option-content',
  });
  fireEvent.click(option);
}

/**
 * 本页只有一个 RangePicker（操作时间），且它没有自定义 placeholder
 * （antd 默认 locale 是 en_US，测试树外层没有 ConfigProvider，所以不能按 placeholder 定位）⇒
 * 按容器定位，个数不为 1 当场抛错，免得定位到别的控件上读出一个假绿。
 */
function requireTimePickerInput(): HTMLInputElement {
  const pickers = document.querySelectorAll('.ant-picker');
  if (pickers.length !== 1)
    throw new Error(`操作时间 RangePicker 定位失败，实得 .ant-picker 个数=${pickers.length}`);
  const input = pickers[0].querySelector('input');
  if (!input) throw new Error('操作时间 RangePicker 里没有 input：locator 失效');
  return input as HTMLInputElement;
}

/** 打开 RangePicker 面板（面板没打开/没日期格即抛错，不拿"没报错"当通过） */
async function openTimeRangePanel(): Promise<void> {
  const input = requireTimePickerInput();
  // 必须是 click：rc-picker 的 onSelectorFocus 用 triggerOpen(true,{inherit:true})，
  // 关着的时候会被短路掉 ⇒ 单靠 focus 打不开面板（见 quotationPending.serverPaging.test.tsx:196-217）
  fireEvent.mouseDown(input);
  fireEvent.click(input);
  await waitFor(() => {
    const cell = document.querySelector(
      '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-cell',
    );
    if (!cell)
      throw new Error(
        `操作时间 RangePicker 面板没有打开（可见日期格 0 个；dropdown=${JSON.stringify(
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
  sessionStorage.clear();
  localStorage.clear();
  useUIStore.setState({ currentOrganization: '__ALL__' });
  // store 清空 + 动作复位：用例之间不得互相看得见，上一支 spy 也不得漏到下一格
  useInquiryStore.setState({
    inquiries: [],
    loading: false,
    loaded: false,
    loadError: false,
    loadFromApi: realLoadFromApi,
  });
  installApiStub();
});

describe('R112 日志页首屏默认走服务端按行分页', () => {
  it('首帧恰好一发 logs({page:1,pageSize:10})，行集来自响应 items 而不是 store 聚合数组', async () => {
    // 桩里下发的字符串必须先钉回 src/types 的枚举与 zh-CN 文案，否则第 3 格的入参断言可能钉着过时串
    expect([TYPE_ADD_SUPPLIER, TYPE_LABEL_ADD_SUPPLIER]).toEqual([
      LogType.ADD_SUPPLIER,
      i18n.t(`enum.logType.${LogType.ADD_SUPPLIER}`),
    ]);

    // store 里放一条"只有读全量询价数组再 flatMap 才会出现"的日志行
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({
          id: 'inq-store',
          logs: [makeLog({ id: 'log-store', content: 'STORE-ONLY-LOG' })],
        }),
      ],
      loaded: true,
    });
    // 响应里给一条 store 没有的行 ⇒ 表格出现它，就只可能来自服务端
    logsResolver = () => ({
      items: [makeLog({ id: 'log-srv', content: 'SERVER-ONLY-LOG' })],
      total: 1,
    });
    renderPage();

    const first = await waitCall({ page: 1, pageSize: 10 });
    expect(first).toEqual({
      page: 1,
      pageSize: 10,
      operator: undefined,
      type: undefined,
      keyword: undefined,
      timeFrom: undefined,
      timeTo: undefined,
    });
    // 首屏只有一发：挂载期不重复打点
    expect(logsMock).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('SERVER-ONLY-LOG')).toBeInTheDocument();
    expect(screen.queryByText('STORE-ONLY-LOG')).not.toBeInTheDocument();
    expect(tableRowCount()).toBe(1);
  });
});

describe('R112 日志页不再读无界询价数组', () => {
  it('非演示模式挂载既不调 inquiryApi.list 也不调 store.loadFromApi，且带一支"spy 观测得到"的对照', async () => {
    // 穿透式 spy：只记账、行为不变（对照要靠真动作去真调 list，mock 成 no-op 就点不燃）
    const loadSpy = vi
      .spyOn(useInquiryStore.getState(), 'loadFromApi')
      .mockImplementation((...args: Parameters<typeof realLoadFromApi>) =>
        realLoadFromApi(...args),
      );
    renderPage();

    await waitCall({ page: 1, pageSize: 10 });
    // 正面主张：本页只走 logs 那一发，无界全量那条（api 面与 store 动作面各一根）一发都没有
    expect(listMock).not.toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(logsMock).toHaveBeenCalledTimes(1);

    // 对照（缺席断言的牙齿）：真去拉一次全量时，这两根 spy 立刻各记一笔
    // ——没有这一支，上面两句"没被调用"是恒真（同 approval.serverPaging.test.tsx:590-595）
    await useInquiryStore.getState().loadFromApi();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledTimes(1);
    // 无界那条与本页的分页查询互不相干：补上它，logs 一发不多
    expect(logsMock).toHaveBeenCalledTimes(1);
  });
});

describe('R112 查询把四个筛子一次性下推并回到第 1 页', () => {
  it('停在第 3 页时点查询：入参带 operator/type/keyword/timeFrom/timeTo 且 page:1', async () => {
    // 本格下发的类型字面量同样先钉回枚举与 zh-CN 文案，单独跑这一格也不失去这层保护
    expect([TYPE_ADD_SUPPLIER, TYPE_LABEL_ADD_SUPPLIER]).toEqual([
      LogType.ADD_SUPPLIER,
      i18n.t(`enum.logType.${LogType.ADD_SUPPLIER}`),
    ]);
    logsResolver = (params) => {
      if (params.operator)
        return { items: [makeLog({ id: 'f', content: 'LOG-FILTERED' })], total: 3 };
      if (params.page === 1 || params.page === 3)
        return {
          items: [makeLog({ id: `p${params.page}`, content: `LOG-P${params.page}` })],
          total: 25,
        };
      throw new Error(`本格只备了第 1 与第 3 页的夹具：${JSON.stringify(params)}`);
    };
    renderPage();
    await waitCall({ page: 1 });
    await screen.findByText('LOG-P1');

    clickPageItem(3);
    const third = await waitCall({ page: 3 });
    expect(third).toEqual({
      page: 3,
      pageSize: 10,
      operator: undefined,
      type: undefined,
      keyword: undefined,
      timeFrom: undefined,
      timeTo: undefined,
    });
    await screen.findByText('LOG-P3');

    // 四个筛子都填：操作人带首尾空格（实现做了 trim），类型走 Select，日期走 RangePicker
    typeInto('请输入操作人', '  张三  ');
    await pickLogType(TYPE_LABEL_ADD_SUPPLIER);
    typeInto('搜索操作内容', '紧急');
    const from = dayjs().startOf('month').date(5);
    const to = dayjs().startOf('month').date(12);
    const fromStr = from.format('YYYY-MM-DD');
    const toStr = to.format('YYYY-MM-DD');
    await openTimeRangePanel();
    clickDateCell(fromStr);
    clickDateCell(toStr);

    clickButton('查询');

    const filtered = await waitCall({ operator: '张三' });
    expect(filtered).toEqual({
      page: 1,
      pageSize: 10,
      operator: '张三',
      type: TYPE_ADD_SUPPLIER,
      keyword: '紧急',
      timeFrom: fromStr,
      timeTo: toStr,
    });
    // 日期是日粒度 YYYY-MM-DD（不是 ISO 时间戳，也不是 endOf('day')）
    expect(filtered.timeFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filtered.timeTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 页码真的回到 1：不存在任何一发"新筛子 + 第 3 页"
    expect(callsMatching({ operator: '张三', page: 3 })).toHaveLength(0);

    expect(await screen.findByText('LOG-FILTERED')).toBeInTheDocument();
    expect(screen.queryByText('LOG-P3')).not.toBeInTheDocument();
    // 分页器高亮跟着 controlled current（等新行落地后再读：total 落回 0 的那一帧画不出页码格）
    expect(activePage()).toBe('1');
  });
});

describe('R112 翻页真的换页且计数用服务端 total', () => {
  it('点第 2 页：入参 page:2、表格换成第 2 页的行，showTotal 读服务端 total（25）而不是渲染行数（1）', async () => {
    logsResolver = (params) => {
      if (params.page === 1)
        return { items: [makeLog({ id: 'r1', content: 'LOG-SERVER-P1' })], total: 25 };
      if (params.page === 2)
        return { items: [makeLog({ id: 'r2', content: 'LOG-SERVER-P2' })], total: 25 };
      throw new Error(`本格只备了前两页的夹具：${JSON.stringify(params)}`);
    };
    renderPage();
    await waitCall({ page: 1 });
    await screen.findByText('LOG-SERVER-P1');
    // 反证计数不是数出来的：total 25、当页只渲染 1 行，两个数必须不相等
    expect(tableRowCount()).toBe(1);
    expect(totalText()).toBe('共 25 条记录');

    clickPageItem(2);
    const second = await waitCall({ page: 2 });
    expect(second).toEqual({
      page: 2,
      pageSize: 10,
      operator: undefined,
      type: undefined,
      keyword: undefined,
      timeFrom: undefined,
      timeTo: undefined,
    });
    expect(await screen.findByText('LOG-SERVER-P2')).toBeInTheDocument();
    expect(screen.queryByText('LOG-SERVER-P1')).not.toBeInTheDocument();
    expect(activePage()).toBe('2');
    expect(tableRowCount()).toBe(1);
    expect(totalText()).toBe('共 25 条记录');
    // 翻页只多发那一发分页请求
    expect(logsMock).toHaveBeenCalledTimes(2);
  });
});

describe('R112 重置清筛子并回到裸入参', () => {
  it('查询后再翻到第 2 页，点重置：下一发是裸的 {page:1,pageSize:10} 且四个筛子都不带', async () => {
    logsResolver = (params) => {
      if (params.operator)
        return {
          items: [
            makeLog({
              id: `f${params.page}`,
              content: params.page === 2 ? 'LOG-FILTERED-P2' : 'LOG-FILTERED-P1',
            }),
          ],
          total: 25,
        };
      return { items: [makeLog({ id: 'bare', content: 'LOG-BARE' })], total: 3 };
    };
    renderPage();
    await waitCall({ page: 1 });
    await screen.findByText('LOG-BARE');

    typeInto('请输入操作人', '张三');
    clickButton('查询');
    await waitCall({ operator: '张三' });
    await screen.findByText('LOG-FILTERED-P1');
    clickPageItem(2);
    await waitCall({ operator: '张三', page: 2 });
    await screen.findByText('LOG-FILTERED-P2');

    clickButton('重置');
    // 重置后的入参与首屏同形，按 subset 等会命中旧调用 ⇒ 按发数等最后一发
    await waitForCallCount(4);
    expect(lastCallArgs()).toEqual({
      page: 1,
      pageSize: 10,
      operator: undefined,
      type: undefined,
      keyword: undefined,
      timeFrom: undefined,
      timeTo: undefined,
    });
    // 表单侧四个筛子也真的清空了（不只是查询参数）
    expect(screen.getByPlaceholderText('请输入操作人')).toHaveValue('');
    expect(screen.getByPlaceholderText('搜索操作内容')).toHaveValue('');
    expect(requireTimePickerInput()).toHaveValue('');
    expect(screen.getByText('请选择操作类型')).toBeInTheDocument();
    expect(await screen.findByText('LOG-BARE')).toBeInTheDocument();
    expect(activePage()).toBe('1');
    expect(screen.queryByText('LOG-FILTERED-P2')).not.toBeInTheDocument();
  });
});

describe('R112 空态极性一对', () => {
  it('服务端 total=0 且带筛子：显示 log.noSearchResult 文案而不是 log.empty', async () => {
    logsResolver = () => ({ items: [], total: 0 });
    renderPage();
    await waitCall({ page: 1 });
    // 无筛子时先是 log.empty；设了筛子之后必须翻成 log.noSearchResult
    expect(await screen.findByText('暂无操作日志')).toBeInTheDocument();

    typeInto('搜索操作内容', '不存在的关键字');
    clickButton('查询');
    await waitCall({ keyword: '不存在的关键字' });

    expect(await screen.findByText('搜索无结果')).toBeInTheDocument();
    expect(screen.queryByText('暂无操作日志')).not.toBeInTheDocument();
  });

  it('服务端 total=0 且没有任何筛子：显示 log.empty 文案', async () => {
    logsResolver = () => ({ items: [], total: 0 });
    renderPage();
    await waitCall({ page: 1 });

    expect(await screen.findByText('暂无操作日志')).toBeInTheDocument();
    expect(screen.queryByText('搜索无结果')).not.toBeInTheDocument();
    expect(tableRowCount()).toBe(0);
    expect(logsMock).toHaveBeenCalledTimes(1);
  });
});

describe('R112 演示模式那一支', () => {
  it('IS_DEMO_MODE=true：不发 logs，行与分页仍来自 store 聚合，且按 time 倒序', async () => {
    configMock.demoMode = true;
    // 播种顺序 [早, 晚, 中] 与倒序 [晚, 中, 早] 故意不同，且跨两条询价单
    // ⇒ flatMap 的原样顺序会渲染成 [早, 晚, 中]，只有真按 time 倒序才得到期望值
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({
          id: 'inq-demo-a',
          logs: [makeLog({ id: 'log-early', time: '2026-08-01 09:00:00', content: 'DEMO-EARLY' })],
        }),
        makeInquiry({
          id: 'inq-demo-b',
          logs: [
            makeLog({ id: 'log-late', time: '2026-09-20 18:30:00', content: 'DEMO-LATE' }),
            makeLog({ id: 'log-mid', time: '2026-09-10 12:00:00', content: 'DEMO-MID' }),
          ],
        }),
      ],
      loaded: true,
    });
    renderPage();

    expect(await screen.findByText('DEMO-LATE')).toBeInTheDocument();
    // 顺序是一格真断言：三行的「操作内容」列按倒序排
    expect(columnTexts('操作内容')).toEqual(['DEMO-LATE', 'DEMO-MID', 'DEMO-EARLY']);
    expect(tableRowCount()).toBe(3);
    // 分页也来自 store：total 是 store 聚合出来的 3，不是桩里的 25
    expect(totalText()).toBe('共 3 条记录');
    // 服务端那一发就算被误调用也会交出 sentinel 行——它不得出现，logs 一次都不许被调
    expect(screen.queryByText(SENTINEL_CONTENT)).not.toBeInTheDocument();
    expect(logsMock).not.toHaveBeenCalled();
  });
});
