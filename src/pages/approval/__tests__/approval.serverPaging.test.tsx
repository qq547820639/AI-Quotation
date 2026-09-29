/**
 * 审批页 R110 回归测试：非演示模式默认走服务端分页，进页不再拉全量询价数组
 *
 * 被守护的行为（src/pages/approval/index.tsx）：
 *   1 首屏 pending 页签即发 listPage({page:1,pageSize:10,status:'PENDING_APPROVAL'})，
 *     表格行来自 listPage 返回值而不是全局 store 的无界询价数组（store 里那条不得出现）；
 *   2 切「审批历史」页签 → 下一次列表入参 nodeStatus='APPROVED,REJECTED'（ApprovalNodeStatus 两值逗号串），
 *     且页码回到 1（已翻到第 2 页时切页签不得停在 page:2 读空白页）；
 *   3 三张统计卡 + 两个页签计数读的是服务端计数返回值的四个 label，
 *     既不是当前页 items 的条数、也不是列表响应自带的 total（这一格把 items 与计数做成不一致：
 *     列表 items 只给 1 条、列表 total 也只 1，而计数给 7/5/3/2）；
 *     R111 起四档计数合成一发 `POST /api/inquiries/counts`，同一格钉"只有这一发、
 *     且再没有任何 pageSize=1 的分页请求"——否则改动没落地也测不出来；
 *   4 点分页第 2 页真的换页：入参 page:2 且表格换成第 2 页的行；
 *   5 审批动作成功后重取本页数据（列表与计数各再来一次），
 *     且不再回落到 store 的 loadFromApi；
 *   6 非演示模式进页不再调 inquiryApi.list（无参全量那条）——R110 的正面主张；
 *     同一格里带一支"这个 spy 确实观测得到全量拉取"的对照，缺席断言才不是恒真；
 *   7 演示模式（IS_DEMO_MODE=true）不发 listPage，行与计数仍来自 store，
 *     且进页仍恰好调一次 store 的 loadFromApi（R69 那一半在演示模式下必须还在）。
 *
 * 桩法照抄 src/pages/quotation/pending/__tests__/quotationPending.serverPaging.test.tsx：
 * vi.mock('@/config') 用 getter 伪造成可切换的 IS_DEMO_MODE（默认 false＝服务端分页那一支）；
 * vi.mock('@/api/inquiryApi') 桩掉 listPage/counts/list；matchMedia 强制桌面端（Table 分支）；
 * auth/ui/inquiry store 用 setState 造登录态与行集，store 动作按用例装 spy 并在 beforeEach 复位。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { inDays } from '@/test/temporalFixtures';
import { inquiryApi } from '@/api/inquiryApi';
import type {
  InquiryCountSpec,
  InquiryFilterSet,
  InquiryListParams,
  PaginatedInquiries,
} from '@/types';
import {
  ApprovalNodeStatus,
  Currency,
  InquiryStatus,
  type ApprovalNode,
  type Inquiry,
  type User,
} from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useAuthStore } from '@/store/useAuthStore';
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

// 本页的取数入口：listPage 是列表那一发，counts 是 R111 的合成计数那一发，
// list 是「进页拉全量」那条（R110 要钉它非演示模式不再被调用），三条都桩掉
vi.mock('@/api/inquiryApi', () => ({
  inquiryApi: {
    listPage: vi.fn(),
    counts: vi.fn(),
    list: vi.fn(async () => []),
    export: vi.fn(async () => undefined),
    get: vi.fn(),
  },
}));

import ApprovalPage from '../index';

const listPageMock = vi.mocked(inquiryApi.listPage);
const countsApiMock = vi.mocked(inquiryApi.counts);
const listMock = vi.mocked(inquiryApi.list);

/* ==================== 服务端入参字面量 ==================== */

/**
 * 下发给服务端的字符串逐字写死（不 import 实现里的拼接），并在用例里用一支前提断言
 * 把它们钉回 src/types 的枚举（ApprovalNodeStatus 见 types/index.ts:569-576），
 * 枚举一旦漂移，夹具当场报错而不是静默改语义。
 */
const PENDING_STATUS = 'PENDING_APPROVAL';
const NODE_CSV = 'APPROVED,REJECTED';
const NODE_APPROVED = 'APPROVED';
const NODE_REJECTED = 'REJECTED';

const APPROVER: User = {
  id: 'u-approver',
  name: '审批主管',
  role: '采购主管', // ROLE_PERMISSIONS['采购主管'] 含 INQUIRY_APPROVE
  department: '采购部',
  organization: '总部采购中心',
};

/** store 真实动作引用：spy 装完后在 beforeEach 用它们复位，避免串到别的用例 */
const realLoadFromApi = useInquiryStore.getState().loadFromApi;
const realApproveInquiry = useInquiryStore.getState().approveInquiry;
const realRejectInquiry = useInquiryStore.getState().rejectInquiry;

/* ==================== 夹具 ==================== */

function makeNode(overrides: Partial<ApprovalNode> = {}): ApprovalNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    inquiryId: 'inq-1',
    nodeOrder: 1,
    approverId: APPROVER.id,
    approverName: APPROVER.name,
    approverRole: APPROVER.role,
    status: ApprovalNodeStatus.PENDING,
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
    status: InquiryStatus.PENDING_APPROVAL,
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

function makePage(params: InquiryListParams, items: Inquiry[], total: number): PaginatedInquiries {
  return { items, total, page: params.page ?? 1, pageSize: params.pageSize ?? 10 };
}

/* ==================== 服务端桩的可配面 ==================== */

/**
 * 一次挂载共 2 发：1 发列表（pageSize=10）+ 1 发计数（POST /api/inquiries/counts，四档 label）。
 * R110 时这里是 5 发（列表 + 4 发 pageSize=1），R111 把四档合成一发。
 * 桩按各档 filters 认领哪一张卡的数，未预期的筛子直接抛错——
 * 不让"没命中分支"静默回落到某个默认 total；而对 listPage 的 pageSize=1 一律抛错，
 * 这样"改动没落地、还是四发分页"会被当场看见，而不是两种形状都能跑绿。
 */
const DEFAULT_COUNTS = { pending: 7, history: 5, approved: 3, rejected: 2 };
const counts = { ...DEFAULT_COUNTS };

/** 列表调用（pageSize>1）的行集与 total，由用例覆写 */
let listResolver: (params: InquiryListParams) => { items: Inquiry[]; total: number } = () => ({
  items: [],
  total: 0,
});

/** 计数的一档：按筛子认领哪一张卡的数 */
function countTotalFor(f: InquiryFilterSet): number {
  if (f.status === PENDING_STATUS && f.nodeStatus === undefined) return counts.pending;
  if (f.nodeStatus === NODE_CSV) return counts.history;
  if (f.nodeStatus === NODE_APPROVED) return counts.approved;
  if (f.nodeStatus === NODE_REJECTED) return counts.rejected;
  throw new Error(`未预期的计数档筛子：${JSON.stringify(f)}`);
}

function installApiStub(): void {
  Object.assign(counts, DEFAULT_COUNTS);
  listResolver = () => ({ items: [], total: counts.pending });
  listPageMock.mockReset();
  listPageMock.mockImplementation(async (params: InquiryListParams) => {
    if (params.pageSize === 1) {
      throw new Error(`R111 后不该再有 pageSize=1 的计数分页：${JSON.stringify(params)}`);
    }
    const { items, total } = listResolver(params);
    return makePage(params, items, total);
  });
  countsApiMock.mockReset();
  countsApiMock.mockImplementation(async (items: InquiryCountSpec[]) => {
    const out: Record<string, number> = {};
    for (const it of items) out[it.label] = countTotalFor(it.filters ?? {});
    return out;
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
        <MemoryRouter initialEntries={['/approval']}>
          <ApprovalPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** 入参命中 subset（逐键全等）的全部 listPage 调用 */
function callsMatching(subset: Partial<InquiryListParams>): InquiryListParams[] {
  return listPageMock.mock.calls
    .map((c) => c[0])
    .filter((p) =>
      Object.entries(subset).every(([k, v]) => (p as Record<string, unknown>)[k] === v),
    );
}

/** 等一发命中 subset 的调用发生，返回其完整入参（拿不到就抛错，不拿 undefined 继续断言） */
async function waitCall(subset: Partial<InquiryListParams>): Promise<InquiryListParams> {
  await waitFor(() => expect(callsMatching(subset).length).toBeGreaterThan(0));
  const hit = callsMatching(subset)[0];
  if (!hit) throw new Error(`命中的调用读不到：${JSON.stringify(subset)}`);
  return hit;
}

/** 等第 n 发聚合计数请求发生，返回那一发的档位数组（读不到就抛错） */
async function waitCountsCall(n = 1): Promise<InquiryCountSpec[]> {
  await waitFor(() => expect(countsApiMock.mock.calls.length).toBeGreaterThanOrEqual(n));
  const hit = countsApiMock.mock.calls[n - 1]?.[0];
  if (!hit) throw new Error(`第 ${n} 发计数调用读不到`);
  return hit;
}

/** 统计卡读数：按卡标题定位 .ant-statistic，读它自己的值节点（不是"页面出现过这个数字"） */
function statValue(title: string): string {
  const cards = Array.from(document.querySelectorAll('.ant-statistic'));
  const titleOf = (c: Element) =>
    (c.querySelector('.ant-statistic-title')?.textContent ?? '').trim();
  const hit = cards.find((c) => titleOf(c) === title);
  if (!hit)
    throw new Error(
      `统计卡「${title}」没渲染（实得标题=${JSON.stringify(cards.map(titleOf))}）：locator 失效`,
    );
  const value = hit.querySelector('.ant-statistic-content-value');
  if (!value) throw new Error(`统计卡「${title}」没有 .ant-statistic-content-value 节点`);
  return (value.textContent ?? '').trim();
}

async function waitStat(title: string, expected: string): Promise<void> {
  await waitFor(() => expect(statValue(title)).toBe(expected));
}

/** 表格里真实渲染的数据行数（不含展开行/占位行） */
function tableRowCount(): number {
  return document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length;
}

/** 点 Segmented 页签（按页签上的完整文案，含计数） */
async function pickTab(label: string): Promise<void> {
  const text = await screen.findByText(label);
  const item = text.closest('.ant-segmented-item');
  if (!item) throw new Error(`页签「${label}」的 .ant-segmented-item 没找到：locator 失效`);
  fireEvent.click(item);
}

/** 点分页器第 n 页 */
function clickPageItem(n: number): void {
  const item = document.querySelector(`.ant-pagination-item-${n}`);
  if (!item) throw new Error(`分页器第 ${n} 页按钮没渲染：locator 失效`);
  fireEvent.click(item);
}

/** 往审批意见输入框填值（通过弹窗里的那条占位文案定位） */
function typeComment(value: string): void {
  const input = screen.getByPlaceholderText('可填写审批意见（选填）');
  fireEvent.change(input, { target: { value } });
}

/** 点审批 Modal 底部的「确定」（antd 会给两字中文按钮插空格，故去空白后比对） */
async function clickModalOk(): Promise<void> {
  await waitFor(() => expect(document.querySelector('.ant-modal-footer')).toBeTruthy());
  const footer = document.querySelector('.ant-modal-footer');
  if (!footer) throw new Error('审批 Modal 的 footer 没渲染：locator 失效');
  const buttons = Array.from(footer.querySelectorAll('button'));
  const ok = buttons.find((b) => (b.textContent ?? '').replace(/\s+/g, '') === '确定');
  if (!ok)
    throw new Error(
      `footer 里没有「确定」按钮，实得=${JSON.stringify(buttons.map((b) => b.textContent))}`,
    );
  fireEvent.click(ok);
}

/** 行内「通过」按钮 */
async function clickRowApprove(code: string): Promise<void> {
  const codeNode = await screen.findByText(code);
  const tr = codeNode.closest('tr');
  if (!tr) throw new Error(`行「${code}」不在 tr 里：locator 失效`);
  const btn = Array.from(tr.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').replace(/\s+/g, '') === '通过',
  );
  if (!btn)
    throw new Error(
      `行「${code}」没有「通过」按钮（审批人/节点状态/权限三者之一没凑齐），实得=${JSON.stringify(
        Array.from(tr.querySelectorAll('button')).map((b) => b.textContent),
      )}`,
    );
  fireEvent.click(btn);
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
  useAuthStore.setState({ currentUser: APPROVER });
  // store 清空 + 动作复位：用例之间不得互相看得见，上一支 spy 也不得漏到下一格
  useInquiryStore.setState({
    inquiries: [],
    loading: false,
    loaded: false,
    loadError: false,
    loadFromApi: realLoadFromApi,
    approveInquiry: realApproveInquiry,
    rejectInquiry: realRejectInquiry,
  });
  installApiStub();
});

describe('R110 首屏 pending 页签默认走服务端分页', () => {
  it('首帧即发 listPage({page:1,pageSize:10,status:"PENDING_APPROVAL"})，行集来自返回值而非 store 全量', async () => {
    // 夹具里的服务端字面量必须先钉回 src/types 的枚举，否则下面所有入参断言都可能钉着过时的串
    expect([PENDING_STATUS, NODE_CSV, NODE_APPROVED, NODE_REJECTED]).toEqual([
      InquiryStatus.PENDING_APPROVAL,
      `${ApprovalNodeStatus.APPROVED},${ApprovalNodeStatus.REJECTED}`,
      ApprovalNodeStatus.APPROVED,
      ApprovalNodeStatus.REJECTED,
    ]);

    // store 里放一条"只有读全局无界询价数组才会出现"的待审批行
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({
          id: 'store-1',
          code: 'INQ-STORE-ONLY',
          subject: '全量数组行',
          status: InquiryStatus.PENDING_APPROVAL,
        }),
      ],
      loaded: true,
    });
    listResolver = () => ({
      items: [makeInquiry({ id: 'srv-1', code: 'INQ-SRV-ONLY', subject: '服务端分页行' })],
      total: 1,
    });
    renderPage();

    // 钉入参：首屏就是服务端分页请求，且除 page/pageSize/status 外不带任何筛子
    const first = await waitCall({ status: PENDING_STATUS, pageSize: 10 });
    expect(first).toEqual({ page: 1, pageSize: 10, status: PENDING_STATUS });

    // 钉行集来源：表格里是 listPage 返回的那条（store 里没有），store 那条不得出现
    expect(await screen.findByText('INQ-SRV-ONLY')).toBeInTheDocument();
    expect(screen.queryByText('INQ-STORE-ONLY')).not.toBeInTheDocument();
    expect(tableRowCount()).toBe(1);
  });
});

describe('R110 切「审批历史」页签按节点状态筛并回到第 1 页', () => {
  it('已翻到第 2 页后切历史：下一次列表入参 nodeStatus="APPROVED,REJECTED" 且 page:1', async () => {
    counts.pending = 25; // 让 pending 页签画得出第 2 页（分页 total 取的是计数卡的数）
    listResolver = (params) =>
      params.nodeStatus === NODE_CSV
        ? {
            items: [
              makeInquiry({
                id: 'hist-1',
                code: 'INQ-HISTORY-ROW',
                status: InquiryStatus.PENDING_CONFIRM,
                approvalNodes: [makeNode({ status: ApprovalNodeStatus.APPROVED })],
              }),
            ],
            total: counts.history,
          }
        : {
            items: [
              makeInquiry({
                id: `pend-${params.page ?? 1}`,
                code: params.page === 2 ? 'INQ-PENDING-P2' : 'INQ-PENDING-P1',
              }),
            ],
            total: counts.pending,
          };
    renderPage();

    await waitCall({ status: PENDING_STATUS, pageSize: 10 });
    await screen.findByText('待审批（25）');
    clickPageItem(2);
    const second = await waitCall({ status: PENDING_STATUS, page: 2 });
    expect(second).toEqual({ page: 2, pageSize: 10, status: PENDING_STATUS });
    await screen.findByText('INQ-PENDING-P2');

    await pickTab('审批历史（5）');

    const history = await waitCall({ nodeStatus: NODE_CSV, pageSize: 10 });
    expect(history).toEqual({ page: 1, pageSize: 10, nodeStatus: NODE_CSV });
    // 页码真的回到了 1：不存在任何一发 page:2 的节点状态查询
    expect(callsMatching({ nodeStatus: NODE_CSV, page: 2 })).toHaveLength(0);
    expect(await screen.findByText('INQ-HISTORY-ROW')).toBeInTheDocument();
    expect(screen.queryByText('INQ-PENDING-P2')).not.toBeInTheDocument();
  });
});

describe('R110 统计卡与页签计数读服务端 total（R111 起四档合成一发）', () => {
  it('一发 counts 的四档读数 7/5/3/2 ⇒ 卡上 7/3/2、页签 7 与 5；而列表只给了 1 行、total 也只有 1', async () => {
    // 列表响应刻意做成与计数不一致：items 1 条、自带 total 也 1。
    // 若实现是「数行」或「读列表响应 total」，三张卡都会是 1，而不是 7/3/2。
    listResolver = () => ({
      items: [makeInquiry({ id: 'srv-1', code: 'INQ-ROWS-ONE' })],
      total: 1,
    });
    renderPage();

    // 四档计数逐字钉筛子（谁对应哪张卡），且整份挂载只发这一发
    const specs = await waitCountsCall(1);
    expect(specs).toEqual([
      { label: 'pending', filters: { status: PENDING_STATUS } },
      { label: 'history', filters: { nodeStatus: NODE_CSV } },
      { label: 'approved', filters: { nodeStatus: NODE_APPROVED } },
      { label: 'rejected', filters: { nodeStatus: NODE_REJECTED } },
    ]);
    // 上界 2 而不是恰好 1：挂载后的 useEnterRefresh 会 invalidate 一次 APPROVAL_QUERY，
    // 那一发重取与本发同形，计入两次仍是"四档一发"；真正要钉死的是它不是四发。
    expect(countsApiMock.mock.calls.length).toBeLessThanOrEqual(2);
    // 反向极性：R110 那四发 pageSize=1 的分页请求已经不存在（桩对 pageSize=1 会抛错，
    // 这一句再把"一次都没发生"钉成读数，免得实现退回旧形状还全绿）
    expect(listPageMock.mock.calls.filter((c) => c[0].pageSize === 1)).toHaveLength(0);

    await waitStat('待审批', '7');
    expect(statValue('已通过')).toBe('3');
    expect(statValue('已驳回')).toBe('2');
    expect(screen.getByText('待审批（7）')).toBeInTheDocument();
    expect(screen.getByText('审批历史（5）')).toBeInTheDocument();

    // 反证这 7/3/2 不是数出来的：表格里此刻只有 1 行
    await screen.findByText('INQ-ROWS-ONE');
    expect(tableRowCount()).toBe(1);
    // 页签上的 5 也不可能是 pending 页的行数
    expect(screen.queryByText('待审批（1）')).not.toBeInTheDocument();
    expect(screen.queryByText('审批历史（1）')).not.toBeInTheDocument();
  });
});

describe('R110 翻页真的换页', () => {
  it('点第 2 页：入参 page:2 且表格换成第 2 页的行', async () => {
    counts.pending = 25;
    listResolver = (params) => ({
      items: [
        makeInquiry({
          id: `p-${params.page ?? 1}`,
          code: params.page === 2 ? 'INQ-APPROVAL-P2' : 'INQ-APPROVAL-P1',
        }),
      ],
      total: counts.pending,
    });
    renderPage();

    const first = await waitCall({ status: PENDING_STATUS, page: 1 });
    expect(first.pageSize).toBe(10);
    await screen.findByText('INQ-APPROVAL-P1');
    // 先把挂载期那批发数抄下来（useEnterRefresh 的 invalidate 可能让它变成 2 发），
    // 再断翻页一发都不加——用相对量而不是绝对量，免得把"恰好 1 发"写成随实现时序漂移的断言
    const countsBeforeClick = countsApiMock.mock.calls.length;

    clickPageItem(2);

    const second = await waitCall({ status: PENDING_STATUS, page: 2 });
    expect(second).toEqual({ page: 2, pageSize: 10, status: PENDING_STATUS });
    expect(await screen.findByText('INQ-APPROVAL-P2')).toBeInTheDocument();
    expect(screen.queryByText('INQ-APPROVAL-P1')).not.toBeInTheDocument();
    // 翻页只换列表那一发：计数查询的 key 里不含 page，不得被顺手重发
    expect(countsApiMock.mock.calls.length).toBe(countsBeforeClick);
  });
});

describe('R110 审批动作成功后重取本页数据', () => {
  it('UI 通过后 listPage 列表与计数都重发，且不碰 store 的 loadFromApi', async () => {
    // 桩 store 的写动作：服务端行不在 store 里，真实 approveInquiry 会直接 not_found，
    // 这一发必须走桩返回值才能把"动作成功→重取"这条链跑到底。
    const approveSpy = vi
      .spyOn(useInquiryStore.getState(), 'approveInquiry')
      .mockResolvedValue({ success: true });
    const loadSpy = vi
      .spyOn(useInquiryStore.getState(), 'loadFromApi')
      .mockResolvedValue(undefined);
    listResolver = () => ({
      items: [
        // 行内「通过/驳回」只在"末节点 PENDING + 审批人就是我 + 有 INQUIRY_APPROVE"时才出现，
        // 少一个条件这一格就退化成只读 Tag，动作链根本到不了 store。
        makeInquiry({
          id: 'inq-approve-1',
          code: 'INQ-APPROVE-1',
          status: InquiryStatus.PENDING_APPROVAL,
          approvalNodes: [
            makeNode({
              inquiryId: 'inq-approve-1',
              approverId: APPROVER.id,
              status: ApprovalNodeStatus.PENDING,
            }),
          ],
        }),
      ],
      total: counts.pending,
    });
    renderPage();

    await screen.findByText('INQ-APPROVE-1');
    await waitStat('待审批', '7'); // 两批查询都落地后再比次数，免得把首屏在飞的那发算成重取
    const before = listPageMock.mock.calls.length;
    const beforeCounts = countsApiMock.mock.calls.length;

    await clickRowApprove('INQ-APPROVE-1');
    typeComment('  同意采购  ');
    await clickModalOk();

    // 动作本身打到 store：id 是这一行的 id，意见按实现做了 trim
    await waitFor(() => expect(approveSpy).toHaveBeenCalledWith('inq-approve-1', '同意采购'));

    // 重取：列表 1 发 + 计数 1 发（R111 前计数是 4 发）⇒ invalidateQueries 命中 APPROVAL_QUERY 前缀
    await waitFor(() => expect(listPageMock.mock.calls.length).toBeGreaterThanOrEqual(before + 1));
    await waitFor(() =>
      expect(countsApiMock.mock.calls.length).toBeGreaterThanOrEqual(beforeCounts + 1),
    );
    expect(callsMatching({ status: PENDING_STATUS, pageSize: 10 }).length).toBeGreaterThanOrEqual(
      2,
    );

    // 关键反面主张：重取走的是服务端，不再回落到 store 的无界全量拉取
    expect(loadSpy).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('R110 进页不再拉全量询价数组', () => {
  it('非演示模式挂载后 inquiryApi.list 一次都没被调用，而 listPage 被调用', async () => {
    renderPage();

    await waitCall({ status: PENDING_STATUS, pageSize: 10 });
    await waitStat('待审批', '7');
    // 正面主张：整份挂载只有列表与聚合计数两路（R110 是 1+4 路），无参全量那条一发都没有。
    // 上界取 2 是给 useEnterRefresh 挂载后那次 invalidate 留的，不是给四发计数留的。
    expect(listMock).not.toHaveBeenCalled();
    expect(listPageMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(countsApiMock.mock.calls.length).toBeLessThanOrEqual(2);
    const totalCalls = listPageMock.mock.calls.length + countsApiMock.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(2);
    expect(useInquiryStore.getState().inquiries).toHaveLength(0);

    // 对照（缺席断言的牙齿）：同一个 mock 面在 store 真去拉全量时确实记录得到——
    // 手动调一次 loadFromApi，list 立刻被记上一笔；没有这支对照，上面那句"没被调用"是恒真。
    await useInquiryStore.getState().loadFromApi();
    expect(listMock).toHaveBeenCalledTimes(1);
    // 全量那条与本页的两路查询互不相干：它补上时那两路一发不多
    expect(listPageMock.mock.calls.length + countsApiMock.mock.calls.length).toBe(totalCalls);
  });
});

describe('R110 演示模式那一支', () => {
  it('IS_DEMO_MODE=true：不发 listPage，行与计数仍来自 store，且进页恰好调一次 loadFromApi', async () => {
    configMock.demoMode = true;
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({
          id: 'demo-1',
          code: 'INQ-DEMO-PENDING',
          status: InquiryStatus.PENDING_APPROVAL,
          approvalNodes: [makeNode({ status: ApprovalNodeStatus.PENDING })],
        }),
        makeInquiry({
          id: 'demo-2',
          code: 'INQ-DEMO-HISTORY',
          status: InquiryStatus.PENDING_CONFIRM,
          approvalNodes: [makeNode({ status: ApprovalNodeStatus.APPROVED })],
        }),
      ],
      loaded: true,
    });
    // spy 只记账不真的拉：真实 loadFromApi 会把 store 行覆盖成桩返回的 []，
    // 那等于把"行来自 store"这半格自己拆掉。
    // 这一格同时是「vi.spyOn(getState(),'loadFromApi') 这装置开得了火」的正例——
    // 它在演示模式下必须响一次；审批重取那一格用同一装置断它不响，两极才都算钉住。
    const loadSpy = vi
      .spyOn(useInquiryStore.getState(), 'loadFromApi')
      .mockResolvedValue(undefined);
    // 就算被误调用也会给一条 store 里没有的行——断言它不出现，防"mock 恰好没数据"的假绿
    listResolver = () => ({
      items: [makeInquiry({ id: 'srv-x', code: 'INQ-SRV-MUST-NOT-APPEAR' })],
      total: 7,
    });
    renderPage();

    // 行来自 store 的 pendingList：待审批那条出现，历史那条被页签筛掉，服务端桩那条不得出现
    expect(await screen.findByText('INQ-DEMO-PENDING')).toBeInTheDocument();
    expect(screen.queryByText('INQ-DEMO-HISTORY')).not.toBeInTheDocument();
    expect(screen.queryByText('INQ-SRV-MUST-NOT-APPEAR')).not.toBeInTheDocument();
    // 计数是 store 数出来的 1/1/0，不是桩里的 7/3/2 ⇒ 服务端那批查询确实没参与
    expect(statValue('待审批')).toBe('1');
    expect(statValue('已通过')).toBe('1');
    expect(statValue('已驳回')).toBe('0');
    expect(screen.getByText('待审批（1）')).toBeInTheDocument();
    expect(screen.getByText('审批历史（1）')).toBeInTheDocument();
    expect(listPageMock).not.toHaveBeenCalled();
    expect(countsApiMock).not.toHaveBeenCalled();

    // R69 那一半在演示模式下必须还在：每次挂载恰好补拉一次 store
    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
  });
});
