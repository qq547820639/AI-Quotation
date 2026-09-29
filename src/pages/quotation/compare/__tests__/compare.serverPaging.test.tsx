/**
 * 报价对比页 R113 回归测试：服务端形态下这一页只发「可对比清单（分页筛子）+ 单条详情」两发有界查询，
 * 不再读两份无界数组（整份询价 + 整份报价）。
 *
 * 被守护的行为（src/pages/quotation/compare/index.tsx，`serverEnabled = !IS_DEMO_MODE` 两支）：
 *   1 直达 /quotation/compare/:id 恰好两发：listPage({page:1,pageSize:50,hasSubmittedQuotation:'1'})
 *     + get(id)；inquiryApi.list（无界全量那条）、useInquiryStore.loadFromApi、
 *     useQuotationStore.loadFromApi 三条一发都没有——每条缺席都配了自己的对照；
 *   2 行集来自 get 响应自带的 quotations：响应里有而 store 里没有的报价⇒出现，
 *     store 里有而响应里没有的报价⇒不出现（同一格先证明 store 那条真能被
 *     getQuotationsByInquiry 取到，缺席断言才不是恒真）；
 *   3 R30 三态（本族最重要的一条）：详情在飞时只画 Spin，既不画「该询价单暂无已提交报价」
 *     也不画「未找到该询价单」；真挂住 → 断缺席 → 放行 → 断表格；
 *     缺席窗口是否承重由 queryClient 的查询状态自证（清单已 success、详情仍 fetching）；
 *   4 详情 404 = 「未找到该询价单」+ 返回列表，且不是可恢复的 loadFailed Result
 *     （retry:false 的实效：404 只发一发，不把"未找到"延迟两次往返）；
 *   5 非 404（500）= loadFailed Result；点「重试」只重取本页那两发，绝不碰两份 store 的无界补拉；
 *   6 写动作**走 store 真动作**（本地数组留空）：评语保存与行内推荐定标都必须真发出
 *     PUT /api/inquiries/{id}，成功后按"补那一条 + 重取一次"计数，PUT 被拒时不再加；
 *     这一格同时钉 store 层的 `ensureLocalInquiry`——八道写入口都有 `getInquiryById` 守卫，
 *     页面比启动期无界 list() 先到货时不补就会静默不写（e2e 三格红 + 探针零请求）；
 *   7 演示支（IS_DEMO_MODE=true）：不发 listPage/get，可对比清单仍来自 store，
 *     且 useQuotationStore.loadFromApi 每次挂载恰好一次（R64/R67 不变量，
 *     useQuotationFreshness.ts:23 那句显式开关就是这条的落点）；
 *   8 头部「切换询价单」下拉与无 id 时的卡片列表都按服务端清单出：
 *     store 里那条可对比的单不得成为选项/卡片，响应里独有的那条必须成为。
 *
 * R113 期间这一格先红后绿，红因是真缺陷而不是夹具：COMPARE_QUERY 自身是数组，
 * 而两处 queryKey 写成 [COMPARE_QUERY, ...] ⇒ 真键是嵌套的 [['quotation-compare'],'picker']；
 * refreshCompare 里的 invalidateQueries({queryKey: COMPARE_QUERY}) 用的却是 ['quotation-compare']，
 * query-core 的前缀匹配逐元素比（node_modules/@tanstack/query-core/build/modern/utils.js:94-108：
 * 第 0 位 object vs string → typeof 不等即 return false）⇒ 两发查询都不会被失效。
 * 一手读数（query-core 5.101.4，node 直跑）：
 *   invalidateQueries({queryKey:['quotation-compare']}) 后
 *   [["quotation-compare"],"picker"]=false | [["quotation-compare"],"inquiry","inq-1"]=false
 *   | ["quotation-compare","picker"]=true（只有扁平键被失效）。
 * 修法照 approval/index.tsx 的既有手法：拼键处展开（[...COMPARE_QUERY, ...]）。
 * 本格的牙：把展开改回嵌套必须翻红（见登记册 R113 效力证据）。
 *
 * 供应商名在本页一字多处（比价表每个供应家一列，列头与各个指标行都写它，实测 6 处），
 * 所以"出现/不出现"一律走 findAllByText / queryAllByText：getByText 在多命中时会抛，
 * 那会被读成"页面坏了"而不是"这一格量得太粗"。
 *
 * 桩法照抄 src/pages/log/__tests__/log.serverPaging.test.tsx:42-64（可切换 IS_DEMO_MODE getter +
 * inquiryApi 桩）、:144-161（beforeEach 复位 installer，未预期入参一律抛错、不静默回落默认值）、
 * :331-357（matchMedia 强制桌面端 + store setState 复位 + 真实动作引用复位）、
 * :404-426 与 src/pages/approval/__tests__/approval.serverPaging.test.tsx:575-597
 * （每条缺席断言配一支"这个 spy 观测得到"的对照）；
 * auth/ui store 的 setState 夹具照抄 approval.serverPaging.test.tsx:331-359；
 * Inquiry/Quotation 夹具形状照抄本目录 quotationFreshness.test.tsx 与
 * CompareInquiryPicker.test.tsx:16-44（makeInquiry）及 src/mock/quotations.ts:23-46（报价明细形状）。
 *
 * 路由：本页用了 useBlocker（index.tsx:266）。react-router 7.18.2 的 useBlocker 第一件事就是
 * useDataRouterContext/useDataRouterState（node_modules/react-router/dist/development/chunk-HHGH3NKS.js:7697-7699），
 * 两者在 :7611-7620 都是 invariant(ctx, ...) ⇒ 挂在 MemoryRouter 下必抛
 * "useBlocker must be used within a data router."。所以这里用 createMemoryRouter + RouterProvider，
 * providers 必须在 RouterProvider 之外（页内 useQuery 要用同一个 QueryClient）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { inDays } from '@/test/temporalFixtures';
import { inquiryApi } from '@/api/inquiryApi';
import { ApiError, ERROR_CODES } from '@/api/errors';
import type {
  Inquiry,
  InquiryItem,
  InquiryListParams,
  PaginatedInquiries,
  Quotation,
  QuotationItem,
} from '@/types';
import { Currency, InquiryStatus, QuotationStatus, ROLE_PERMISSIONS, type User } from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import type { WriteResult } from '@/store/writeResult';

// 可切换的 IS_DEMO_MODE 伪造源：默认 false（非演示 ⇒ 服务端那两支是默认取数路径）
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

// 本页只该碰 listPage（可对比清单那一发）与 get（详情那一发）；
// list 是无界全量那条（第 1 格要钉它不被调），export 给 store 的真动作兜底用。
// update 也必须给真的桩：第 6/7 格让写动作**走 store 真路径**（不打桩 store 动作），
// 于是"本地数组里没这条 ⇒ 写动作连请求都不发"这类缺陷看得见（e2e 三格红的就是它）。
vi.mock('@/api/inquiryApi', () => ({
  inquiryApi: {
    listPage: vi.fn(),
    get: vi.fn(),
    list: vi.fn(async () => []),
    update: vi.fn(),
    export: vi.fn(async () => undefined),
  },
}));

import QuotationComparePage from '../index';

const listPageMock = vi.mocked(inquiryApi.listPage);
const getMock = vi.mocked(inquiryApi.get);
const listMock = vi.mocked(inquiryApi.list);
const updateMock = vi.mocked(inquiryApi.update);

/** store 真实动作引用：spy 装完后在 beforeEach 用它们复位，免得上一格的 spy 漏到下一格 */
const realInquiryLoadFromApi = useInquiryStore.getState().loadFromApi;
const realUpdateInquiry = useInquiryStore.getState().updateInquiry;
const realQuotationLoadFromApi = useQuotationStore.getState().loadFromApi;

/* ==================== 服务端入参字面量与哨兵（逐字写死，不 import 实现里的常量） ==================== */

/** index.tsx:135-139 那一发的入参；COMPARE_LIST_SIZE=50 写在 index.tsx:75 */
const PICKER_PARAMS: InquiryListParams = { page: 1, pageSize: 50, hasSubmittedQuotation: '1' };

/** 详情那一发的 id（路由参数与 get 入参同一个值） */
const DETAIL_ID = 'inq-srv-detail';

/**
 * 本页两发的 queryKey 真形状（扁平：实现处用 [...COMPARE_QUERY, ...] 展开）。
 * 第 3 格读查询状态自证缺席窗口承重用；第 6 格也用它反证"整族失效打得中"。
 * 写成嵌套的 [['quotation-compare'], ...] 会让 invalidateQueries 的
 * ['quotation-compare'] 前缀逐元素比到第 0 位就判负（见文件头注）。
 */
const PICKER_KEY = ['quotation-compare', 'picker'];
const DETAIL_KEY = ['quotation-compare', 'inquiry', DETAIL_ID];

/** 只存在于服务端响应里的行：演示支若误发请求，这两条一定看得见 */
const SRV_SUBJECT = 'SERVER-SUBJECT';
const SRV_SUPPLIER_NAME = 'SRV-SUPPLIER-ONLY';
const SRV_LIST_SUBJECT = 'SRV-LIST-ONLY';

/** 只存在于 store 里的行：服务端支若误读 store，这两条一定看得见 */
const STORE_SUBJECT = 'STORE-SUBJECT-MUST-NOT-APPEAR';
const STORE_SUPPLIER_NAME = 'STORE-SUPPLIER-ONLY';
const STORE_ONLY_ID = 'inq-store-only';
const STORE_ONLY_SUBJECT = 'STORE-ONLY-INQUIRY';

/** 本页四种"没有/失败"的呈现（第 3/4/5 格用正则式断言前先钉回 zh-CN 文案） */
const TXT_NO_SUBMITTED = '该询价单暂无已提交报价';
const TXT_NOT_FOUND = '未找到该询价单';
const TXT_LOAD_FAILED = '数据加载失败';
const TXT_RETRY = '重试';
const TXT_BACK = '返回列表';

/** 有 INQUIRY_CONFIRM 的角色（ROLE_PERMISSIONS 见 src/types/index.ts:255-264） */
const CONFIRMER: User = {
  id: 'u-confirmer',
  name: '定标采购',
  role: '采购主管',
  department: '采购部',
  organization: '总部采购中心',
};

/** 报价明细挂到这条询价明细上 */
const ITEM_ID = 'item-srv-1';

/* ==================== 夹具（形状照 CompareInquiryPicker.test.tsx:16-44 与 mock/quotations.ts） ==================== */

function makeInquiryItem(overrides: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    inquiryId: DETAIL_ID,
    name: '服务器',
    code: 'MAT-SRV-1',
    category: 'IT 设备',
    brand: '联想',
    spec: '2U / 64G',
    techParams: '国标',
    unit: '台',
    quantity: 10,
    attachments: [],
    ...overrides,
  };
}

function makeQuotationItem(overrides: Partial<QuotationItem> = {}): QuotationItem {
  return {
    id: `qitem-${Math.random().toString(36).slice(2, 8)}`,
    quotationId: 'q-1',
    inquiryItemId: ITEM_ID,
    unitPrice: 12000,
    taxRate: 0.13,
    taxIncludedTotal: 120000,
    moq: 1,
    deliveryDays: 20,
    deliveryDate: '2026-10-01',
    brand: '联想',
    warrantyMonths: 36,
    paymentTerms: '款到发货',
    validUntil: '2026-10-15',
    attachments: [],
    ...overrides,
  };
}

function makeQuotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    inquiryId: DETAIL_ID,
    supplierId: 'sup-srv',
    supplierName: SRV_SUPPLIER_NAME,
    status: QuotationStatus.SUBMITTED,
    submittedAt: '2026-09-02 10:00:00',
    items: [makeQuotationItem()],
    totalAmount: 120000,
    attachments: [],
    createdAt: '2026-09-01 10:00:00',
    updatedAt: '2026-09-01 10:00:00',
    ...overrides,
  };
}

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: DETAIL_ID,
    code: 'INQ-SRV-DETAIL',
    subject: SRV_SUBJECT,
    organization: '总部采购中心',
    ownerName: '李明辉',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: inDays(90),
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [makeInquiryItem({ id: ITEM_ID })],
    invitedSupplierIds: ['sup-srv'],
    quotations: [makeQuotation()],
    logs: [],
    status: InquiryStatus.ALL_QUOTED,
    createdById: 'u-1',
    createdByName: '李明辉',
    createdAt: '2026-09-01 10:00:00',
    updatedAt: '2026-09-01 10:00:00',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
    ...overrides,
  };
}

/** 只在服务端清单里出现的那条（既不是详情那条，也不在 store 里） */
function makeListOnlyInquiry(): Inquiry {
  return makeInquiry({
    id: 'inq-srv-list',
    code: 'INQ-SRV-LIST',
    subject: SRV_LIST_SUBJECT,
    quotations: [
      makeQuotation({ id: 'q-srv-list', supplierId: 'sup-srv', supplierName: SRV_LIST_SUBJECT }),
    ],
  });
}

/** store 独有、且"在 store 侧确实可对比"的那条（演示支一定会把它列出来） */
function storeOnlyComparable(): { inquiry: Inquiry; quotation: Quotation } {
  const quotation = makeQuotation({
    id: 'q-store-only',
    inquiryId: STORE_ONLY_ID,
    supplierId: 'sup-store',
    supplierName: STORE_SUPPLIER_NAME,
  });
  return {
    inquiry: makeInquiry({
      id: STORE_ONLY_ID,
      code: 'INQ-STORE-ONLY',
      subject: STORE_ONLY_SUBJECT,
      quotations: [quotation],
    }),
    quotation,
  };
}

/* ==================== 服务端桩的可配面 ==================== */

/**
 * 未预期的入参/ id 一律抛错，不给"没命中分支"留静默默认值
 * （照 log.serverPaging.test.tsx:144-161 的 installer 做法）。
 * 默认返回的行都是 store 里没有的：演示支若误发请求，屏幕上一定看得见。
 */
let listPageImpl: (params: InquiryListParams) => Promise<PaginatedInquiries> = async (params) => {
  if (params.page !== 1 || params.pageSize !== 50 || params.hasSubmittedQuotation !== '1') {
    throw new Error(
      `未预期的 listPage 入参（R113 只该发 ${JSON.stringify(PICKER_PARAMS)}）：${JSON.stringify(params)}`,
    );
  }
  return { items: [makeInquiry(), makeListOnlyInquiry()], total: 2, page: 1, pageSize: 50 };
};

let getImpl: (id: string) => Promise<Inquiry> = async (id) => {
  if (id !== DETAIL_ID) throw new Error(`未预期的 get 入参 id=${id}`);
  return makeInquiry();
};

/**
 * PUT 的桩：把 patch 合到详情实体上再交回去，形状与后端 `inquiry_to_schema` 一致
 * （store 的写动作会拿它覆盖本地副本，所以返回体必须带 id）。
 * 第 6/7 格会临时换成"拒绝一次"来验失败那一支。
 */
let updateImpl: (id: string, patch: Partial<Inquiry>) => Promise<Inquiry> = async (id, patch) => {
  if (id !== DETAIL_ID) throw new Error(`未预期的 update 入参 id=${id}`);
  return { ...makeInquiry(), ...patch };
};

function installApiStub(): void {
  listPageImpl = async (params) => {
    if (params.page !== 1 || params.pageSize !== 50 || params.hasSubmittedQuotation !== '1') {
      throw new Error(`未预期的 listPage 入参：${JSON.stringify(params)}`);
    }
    return { items: [makeInquiry(), makeListOnlyInquiry()], total: 2, page: 1, pageSize: 50 };
  };
  getImpl = async (id) => {
    if (id !== DETAIL_ID) throw new Error(`未预期的 get 入参 id=${id}`);
    return makeInquiry();
  };
  updateImpl = async (id, patch) => {
    if (id !== DETAIL_ID) throw new Error(`未预期的 update 入参 id=${id}`);
    return { ...makeInquiry(), ...patch };
  };
  listPageMock.mockReset();
  listPageMock.mockImplementation((params: InquiryListParams) => listPageImpl(params));
  getMock.mockReset();
  getMock.mockImplementation((id: string) => getImpl(id));
  listMock.mockReset();
  listMock.mockResolvedValue([]);
  updateMock.mockReset();
  updateMock.mockImplementation((id: string, patch: Partial<Inquiry>) => updateImpl(id, patch));
}

/* ==================== 渲染与读数 ==================== */

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

/**
 * 数据路由：useBlocker 只在 data router 下可用（见文件头注）。
 * 返回 queryClient 是给第 3 格读查询状态用的（缺席窗口是否承重必须能自证）。
 */
function renderPage(
  path: string,
  queryClient: QueryClient = makeQueryClient(),
): { queryClient: QueryClient; unmount: () => void } {
  const router = createMemoryRouter(
    [
      { path: '/quotation/compare', element: <QuotationComparePage /> },
      { path: '/quotation/compare/:inquiryId', element: <QuotationComparePage /> },
    ],
    { initialEntries: [path] },
  );
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  const { unmount } = render(ui);
  return { queryClient, unmount };
}

/** 表格里真实渲染的数据行数（不含 antd 的 measure/占位行） */
function tableRowCount(): number {
  return document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length;
}

/**
 * 出现断言。本页一个供应家名会同时画在列头与各个指标行（实测 6 处），
 * 所以按"至少一处"判存在，0 处才不成立；用 getByText 会在多命中时抛，
 * 把"这一格量得太粗"读成"页面坏了"。
 */
async function expectShown(text: string | RegExp): Promise<void> {
  const hits = await screen.findAllByText(text);
  expect(hits.length).toBeGreaterThan(0);
}

/** 缺席断言用子串口径（exact:false）：名字被包在更长的文案里也算看得见，比全等更严 */
function expectAbsent(text: string | RegExp): void {
  expect(screen.queryAllByText(text, { exact: false })).toHaveLength(0);
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

/**
 * 页面里有多个 Select（表头那个 + 每行「推荐定标」那个），
 * 只有头部「切换询价单」带 showSearch ⇒ 按 .ant-select-show-search 收窄，
 * 个数不为 1 当场抛错，免得定位到别处读出一个假绿（同 log.serverPaging.test.tsx:290-297）。
 */
function openSwitcherAndReadOptionLabels(): string[] {
  const sels = Array.from(document.querySelectorAll('.ant-select.ant-select-show-search'));
  if (sels.length !== 1)
    throw new Error(
      `「切换询价单」Select 定位失败，.ant-select-show-search 实得个数=${sels.length}`,
    );
  const selector = sels[0].querySelector('.ant-select-selector');
  if (!selector) throw new Error('「切换询价单」的 .ant-select-selector 没找到：locator 失效');
  fireEvent.mouseDown(selector);
  const options = Array.from(
    document.querySelectorAll(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content',
    ),
  );
  if (options.length === 0)
    throw new Error('「切换询价单」下拉没有渲染任何选项：读得太早或筛子失效');
  return options.map((el) => (el.textContent ?? '').trim());
}

/**
 * 行内「推荐定标」那一列的 Select：与头部切换器不同，它不带 showSearch，
 * 所以按"第一个数据行里的第一个 .ant-select-selector"定位；定位不到当场抛错，
 * 免得退化成"没点到任何东西"的假绿（选项里没有这个名字也抛）。
 */
function chooseRowSupplier(name: string): void {
  const row = document.querySelector('.ant-table-tbody tr.ant-table-row');
  if (!row) throw new Error('对比表没有数据行 ⇒ 行内 Select 无从定位');
  const selector = row.querySelector('.ant-select-selector');
  if (!selector)
    throw new Error('行内「推荐定标」Select 没渲染 .ant-select-selector：locator 失效');
  fireEvent.mouseDown(selector);
  const options = Array.from(
    document.querySelectorAll(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content',
    ),
  );
  const hit = options.find((el) => (el.textContent ?? '').includes(name));
  if (!hit)
    throw new Error(
      `行内下拉里没有「${name}」，实得=${JSON.stringify(options.map((o) => o.textContent))}`,
    );
  fireEvent.click(hit);
}

/** 本页只有一个评语输入框时才用它（多行报价会画出一个以上，当场抛错） */
function requireCommentTextArea(): HTMLTextAreaElement {
  const areas = screen.queryAllByPlaceholderText(i18n.t('quotation.compare.commentPlaceholder'));
  if (areas.length !== 1)
    throw new Error(`评语输入框应恰好 1 个，实得=${areas.length}（visibleRows 形状与夹具不符）`);
  return areas[0] as HTMLTextAreaElement;
}

/** 填评语并失焦：失焦会 flush 未保存内容（CommentEditor.tsx:144-150），不用等 800ms 防抖 */
function writeComment(value: string): void {
  const area = requireCommentTextArea();
  fireEvent.change(area, { target: { value } });
  fireEvent.blur(area);
}

/** 挂住一个 promise，让用例自己决定何时落地（第 3 格的"真挂住 → 真放行"） */
function makeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 夹具里的字面量先钉回 src/types 的枚举与 zh-CN 文案：
 * 枚举或文案一漂移，这些格子当场报错，而不是继续钉着过时的串判绿。
 */
function assertFixtureLiterals(): void {
  expect([QuotationStatus.SUBMITTED, InquiryStatus.ALL_QUOTED]).toEqual([
    'SUBMITTED',
    'ALL_QUOTED',
  ]);
  expect([TXT_NO_SUBMITTED, TXT_NOT_FOUND, TXT_LOAD_FAILED, TXT_RETRY, TXT_BACK]).toEqual([
    i18n.t('quotation.compare.noSubmitted'),
    i18n.t('quotation.compare.notFound'),
    i18n.t('common.loadFailed'),
    i18n.t('common.retry'),
    i18n.t('quotation.compare.backToList'),
  ]);
  expect(ROLE_PERMISSIONS[CONFIRMER.role]).toContain('INQUIRY_CONFIRM');
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
  useAuthStore.setState({ currentUser: CONFIRMER });
  // store 清空 + 动作复位：用例之间不得互相看得见，上一支 spy 也不得漏到下一格
  useInquiryStore.setState({
    inquiries: [],
    loading: false,
    loaded: false,
    loadError: false,
    loadFromApi: realInquiryLoadFromApi,
    updateInquiry: realUpdateInquiry,
  });
  useQuotationStore.setState({
    quotations: [],
    loading: false,
    loaded: false,
    loadError: false,
    loadFromApi: realQuotationLoadFromApi,
  });
  useSupplierStore.setState({ suppliers: [] });
  installApiStub();
});

describe('R113 直达详情只发清单与详情两发有界查询', () => {
  it('进 /quotation/compare/:id 恰好 listPage({page:1,pageSize:50,hasSubmittedQuotation:"1"}) + get(id)，无界那三条一发都没有', async () => {
    assertFixtureLiterals();
    // 穿透式 spy：只记账、行为不变（对照要靠真动作去真调，mock 成 no-op 就点不燃）
    const inqLoadSpy = vi
      .spyOn(useInquiryStore.getState(), 'loadFromApi')
      .mockImplementation((...args: Parameters<typeof realInquiryLoadFromApi>) =>
        realInquiryLoadFromApi(...args),
      );
    // 报价 store 这支只记账：真跑会打 /api/quotations（无界那条恰恰是 R113 要拆的），
    // 而它读的是同一个 state 属性 ⇒ 与 useQuotationFreshness 的调用通道（getState().loadFromApi）同形
    const quoLoadSpy = vi
      .spyOn(useQuotationStore.getState(), 'loadFromApi')
      .mockResolvedValue(undefined);

    renderPage(`/quotation/compare/${DETAIL_ID}`);
    await expectShown(SRV_SUPPLIER_NAME);

    // 正面主张：两发各自的入参与发数
    expect(listPageMock).toHaveBeenCalledTimes(1);
    expect(listPageMock).toHaveBeenCalledWith(PICKER_PARAMS);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith(DETAIL_ID);
    // 反面主张：无界全量（api 面）+ 两份 store 的补拉（动作面）一发都没有
    expect(listMock).not.toHaveBeenCalled();
    expect(inqLoadSpy).not.toHaveBeenCalled();
    expect(quoLoadSpy).not.toHaveBeenCalled();

    // 对照 1/2（这三句缺席断言的牙齿）：真去拉一次询价全量时，api 面与 store 动作面各记一笔
    await useInquiryStore.getState().loadFromApi();
    expect(inqLoadSpy).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledTimes(1);
    // 对照 3：报价 store 那条补拉走的是同一个属性，手动一发立刻记得到
    await useQuotationStore.getState().loadFromApi();
    expect(quoLoadSpy).toHaveBeenCalledTimes(1);
    // 无界那两路与本页的两发查询互不相干：补上它们，本页一发不多
    expect(listPageMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});

describe('R113 对比行来自 get 响应自带的 quotations 而不是 store', () => {
  it('响应里有而 store 没有的报价出现；store 里有而响应没有的报价不出现', async () => {
    assertFixtureLiterals();
    const storeOnly = storeOnlyComparable();
    // store 里塞一条"同 id、同 inquiryId、已提交、有金额"的报价：
    // 实现若回落到 getQuotationsByInquiry / getInquiryById，这一条一定画出列
    const storeQuotation = makeQuotation({
      id: 'q-store-row',
      supplierId: 'sup-store-row',
      supplierName: STORE_SUPPLIER_NAME,
      totalAmount: 99000,
    });
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({
          id: DETAIL_ID,
          code: 'INQ-STORE-ROW',
          subject: STORE_SUBJECT,
          quotations: [storeQuotation],
        }),
        storeOnly.inquiry,
      ],
      loaded: true,
    });
    useQuotationStore.setState({
      quotations: [storeQuotation, storeOnly.quotation],
      loaded: true,
      loading: false,
      loadError: false,
    });
    // 牙齿：store 侧这条路确实取得到这条已提交报价——没有这一句，下面的"不出现"是恒真
    expect(useQuotationStore.getState().getQuotationsByInquiry(DETAIL_ID)).toHaveLength(1);
    expect(useQuotationStore.getState().getQuotationsByInquiry(DETAIL_ID)[0]?.status).toBe(
      QuotationStatus.SUBMITTED,
    );

    renderPage(`/quotation/compare/${DETAIL_ID}`);

    // 响应独有的供应商列（suppliers store 是空的，列名只可能来自响应里那条报价的内联名）
    await expectShown(SRV_SUPPLIER_NAME);
    expectAbsent(STORE_SUPPLIER_NAME);
    // 表体行数 = 响应里的报价数（1），不是 store 里那条
    expect(tableRowCount()).toBe(1);
    // 头部描述行用的是 get 响应那条单子的主题/编号
    await expectShown(new RegExp(`${SRV_SUBJECT}（INQ-SRV-DETAIL）`));
    expectAbsent(STORE_SUBJECT);
  });
});

describe('R113 详情在飞时只有 Spin：不拿"还没到"说成"没有"（R30）', () => {
  it('清单已落地而详情仍挂住时，既无「暂无已提交报价」也无「未找到该询价单」；放行后表格出现', async () => {
    assertFixtureLiterals();
    const gate = makeDeferred<Inquiry>();
    getImpl = () => gate.promise;
    const { queryClient, unmount } = renderPage(`/quotation/compare/${DETAIL_ID}`);

    // 缺席窗口是否承重，先自证：清单那一发已 success，详情那一发仍 fetching（同一时刻的两个状态）
    await waitFor(() => expect(queryClient.getQueryState(PICKER_KEY)?.status).toBe('success'));
    expect(queryClient.getQueryState(DETAIL_KEY)?.fetchStatus).toBe('fetching');
    // 此刻页面只该有 Spin
    await waitFor(() => expect(document.querySelector('.ant-spin')).toBeTruthy());
    expectAbsent(TXT_NO_SUBMITTED);
    expectAbsent(TXT_NOT_FOUND);
    expect(document.querySelector('.ant-table')).toBeNull();
    expect(getMock).toHaveBeenCalledTimes(1);

    // 放行：表格与响应独有的供应商列出现，Spin 撤掉
    gate.resolve(makeInquiry());
    await expectShown(SRV_SUPPLIER_NAME);
    expect(tableRowCount()).toBe(1);
    expect(document.querySelector('.ant-spin')).toBeNull();
    expectAbsent(TXT_NO_SUBMITTED);

    // 对照（这两句缺席断言的牙齿）：把详情换成"一条真没有已提交报价的单子"再进一次，
    // 同一套夹具下这句文案必须画得出来——否则上面的"没画"是恒真而不是 R30 被守住
    unmount();
    getImpl = async (id) => makeInquiry({ id, quotations: [] });
    renderPage(`/quotation/compare/${DETAIL_ID}`);
    expect(await screen.findByText(TXT_NO_SUBMITTED)).toBeInTheDocument();
    expectAbsent(TXT_NOT_FOUND);
  });
});

describe('R113 详情 404 是「未找到该询价单」而不是同步失败', () => {
  it('get 抛 ApiError{status:404}：出未找到空态与返回列表按钮，且不出 loadFailed Result', async () => {
    assertFixtureLiterals();
    // 桩必须交实现真收到的那种错误：响应拦截器把 axios 错误统一换成 ApiError
    // （src/api/client.ts 的 response 拦截器 + src/api/errors.ts:147-154 的 404 分支），
    // 所以上面已经没有 `.response`。按 `{response:{status:404}}` 造桩会让这一格永远读成"加载失败"。
    getImpl = async () => {
      throw new ApiError({
        code: ERROR_CODES.NOT_FOUND,
        message: i18n.t('errors.notFound'),
        status: 404,
        retryable: false,
      });
    };
    const { queryClient } = renderPage(`/quotation/compare/${DETAIL_ID}`);

    await waitFor(() => expect(document.querySelector('.ant-result, .ant-empty')).toBeTruthy());
    // 前提自证：详情那一发确实以"带 404 的 ApiError"失败，而不是根本没发起或失败在别处
    const detailState = queryClient.getQueryState(DETAIL_KEY) as
      { status?: string; error?: { status?: number; code?: string } } | undefined;
    expect(detailState?.status).toBe('error');
    expect(detailState?.error?.status).toBe(404);
    expect(detailState?.error?.code).toBe(ERROR_CODES.NOT_FOUND);

    await expectShown(TXT_NOT_FOUND);
    expect(screen.getByRole('button', { name: TXT_BACK })).toBeInTheDocument();
    // 404 不得被说成"同步失败"（可恢复态）；那句文案在本文件第 5 格真画得出来，缺席才有牙
    expectAbsent(TXT_LOAD_FAILED);
    // retry:false 的实效：404 就是一条不存在的单子，不该再打第二次
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ant-table')).toBeNull();
  });
});

describe('R113 非 404 是可恢复的 loadFailed，重试只重取本页两发', () => {
  it('get 抛 500：出 loadFailed Result；点重试后清单与详情各 +1，两份 store 的无界补拉一发不加', async () => {
    assertFixtureLiterals();
    getImpl = async () => {
      throw new ApiError({
        code: ERROR_CODES.SERVER_UNAVAILABLE,
        message: i18n.t('errors.serviceUnavailable'),
        status: 500,
        retryable: true,
      });
    };
    const inqLoadSpy = vi
      .spyOn(useInquiryStore.getState(), 'loadFromApi')
      .mockResolvedValue(undefined);
    const quoLoadSpy = vi
      .spyOn(useQuotationStore.getState(), 'loadFromApi')
      .mockResolvedValue(undefined);

    renderPage(`/quotation/compare/${DETAIL_ID}`);
    await screen.findByText(new RegExp(i18n.t('common.loadFailedHint')));
    expect(screen.getByText(TXT_LOAD_FAILED)).toBeInTheDocument();
    // 500 不得被说成"这条单子不存在"
    expectAbsent(TXT_NOT_FOUND);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(listPageMock).toHaveBeenCalledTimes(1);

    clickButton(TXT_RETRY);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(listPageMock).toHaveBeenCalledTimes(2);
    // 反面主张：重试走的是那两个 refetch，不回落到启动期的无界拉取
    expect(inqLoadSpy).not.toHaveBeenCalled();
    expect(quoLoadSpy).not.toHaveBeenCalled();

    // 对照（上面两句缺席的牙齿）：同一个属性手动一发就记得到，记不到才是装置坏了
    await useInquiryStore.getState().loadFromApi();
    expect(inqLoadSpy).toHaveBeenCalledTimes(1);
    await useQuotationStore.getState().loadFromApi();
    expect(quoLoadSpy).toHaveBeenCalledTimes(1);
    // 补上无界那两发，本页两发一发不加
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(listPageMock).toHaveBeenCalledTimes(2);
  });
});

describe('R113 写动作走 store 真路径（不打桩 store 动作）', () => {
  /**
   * 这一格钉子的是"读与写对同一条实体的要求一致"。
   *
   * 换数据源之前本页必须等整份数组到货才渲染，所以 store 那八道写入口开头的
   * `if (!get().getInquiryById(id)) return notFound()` 恒成立；R113 之后本页只等自己那一发详情、
   * 比启动期无界 list() 先到货，"能点但本地没这条"就成了真状态 ⇒ 写动作连请求都不发，
   * 用户只看到一句「操作失败」。场地一手读数（e2e 探针）：进审批页后 localStorage 的 inquiries
   * 是空的，点「通过 → 确定」之后**零请求**——同一个形状在审批页也会犯，修法在 store 层
   * （`ensureLocalInquiry` 按 id 补那一条，判据沿用 R28 在 sendInquiry 里定的那条）。
   * 因此这里把 inquiries 留空、让真动作真跑：把 ensureLocalInquiry 退回旧守卫必红。
   */
  it('评语保存：本地数组为空仍发出 PUT，成功后详情与清单各按次数重取；PUT 被拒时不再加', async () => {
    assertFixtureLiterals();
    expect(useInquiryStore.getState().inquiries).toHaveLength(0);
    // 通知那条走的是另一个 api 模块（本文件没桩它），把它记账即可，别让它打真请求
    vi.spyOn(useNotificationStore.getState(), 'addNotification').mockResolvedValue({
      success: true,
    } as WriteResult);

    renderPage(`/quotation/compare/${DETAIL_ID}`);
    await expectShown(SRV_SUPPLIER_NAME);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(listPageMock).toHaveBeenCalledTimes(1);
    // 前提仍在：页面已经渲染得出来、可点，本地数组里却还没有这条
    expect(useInquiryStore.getState().inquiries).toHaveLength(0);

    // 写成功：真 updateInquiry 先按 id 补那一条（详情 +1），再 PUT，落地后整族失效（详情再 +1）
    writeComment('SERVER-COMMENT-OK');
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(DETAIL_ID, {
        purchaserComments: { 'sup-srv': 'SERVER-COMMENT-OK' },
      }),
    );
    await expectShown(i18n.t('quotation.compare.saveSaved'));
    // 3 = 进页那发 + 写前补那一条 + 落地后重取；清单只被重取那发带动
    expect(getMock.mock.calls.length).toBe(3);
    expect(listPageMock.mock.calls.length).toBe(2);

    // 写失败（PUT 被拒）：不得谎报已保存，也不得重取（此时数组里已有这条，补拉那发不再出现）
    updateImpl = async () => {
      throw new ApiError({
        code: ERROR_CODES.SERVER_UNAVAILABLE,
        message: i18n.t('errors.serviceUnavailable'),
        status: 500,
        retryable: true,
      });
    };
    writeComment('SERVER-COMMENT-FAIL');
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    await expectShown(i18n.t('quotation.compare.saveFailed'));
    expect(getMock).toHaveBeenCalledTimes(3);
    expect(listPageMock).toHaveBeenCalledTimes(2);
    // 无界那两条始终一发没发
    expect(listMock).not.toHaveBeenCalled();
  });

  it('推荐定标：行内 Select 选供应家 ⇒ store 真 selectSupplier 发 PUT，无界那两条不加', async () => {
    assertFixtureLiterals();
    expect(useInquiryStore.getState().inquiries).toHaveLength(0);
    const notifySpy = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockResolvedValue({ success: true } as WriteResult);

    renderPage(`/quotation/compare/${DETAIL_ID}`);
    await expectShown(SRV_SUPPLIER_NAME);

    chooseRowSupplier(SRV_SUPPLIER_NAME);
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(DETAIL_ID, {
        selectedSupplierMap: { [ITEM_ID]: 'sup-srv' },
      }),
    );
    await expectShown(i18n.t('quotation.compare.selectedSupplierSuccess'));
    // 这一格的牙齿：写走的是真动作（通知也真发了一条），且请求数就是"补一条 + 重取一次"
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledTimes(3);
    expect(listPageMock).toHaveBeenCalledTimes(2);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('R113 演示分支不发服务端两发且仍补拉一次报价', () => {
  it('IS_DEMO_MODE=true：不发 listPage/get，可对比清单来自 store，且 useQuotationStore.loadFromApi 恰好一次', async () => {
    assertFixtureLiterals();
    configMock.demoMode = true;
    const storeOnly = storeOnlyComparable();
    useInquiryStore.setState({
      inquiries: [
        storeOnly.inquiry,
        // 一条没有任何已提交报价的：不该出现在可对比清单里
        makeInquiry({
          id: 'inq-demo-noq',
          code: 'INQ-DEMO-NOQ',
          subject: 'DEMO-NO-QUOTATION',
          quotations: [],
        }),
      ],
      loaded: true,
      loading: false,
      loadError: false,
    });
    useQuotationStore.setState({
      quotations: [storeOnly.quotation],
      loaded: true,
      loading: false,
      loadError: false,
    });
    // R64/R67 的落点：演示支每次挂载补拉一次报价（只记账，真跑会打无界 /api/quotations）
    const quoLoadSpy = vi
      .spyOn(useQuotationStore.getState(), 'loadFromApi')
      .mockResolvedValue(undefined);

    renderPage('/quotation/compare');

    // 清单来自 store：store 里那条可对比的出现，没有报价的那条被筛掉
    expect(await screen.findByText(STORE_ONLY_SUBJECT)).toBeInTheDocument();
    expectAbsent('DEMO-NO-QUOTATION');
    // 服务端那一支的行即使被误调用也会交出来——它们不得出现（缺席的另一半牙齿：
    // 桩默认就是 store 里没有的行，误发一定看得见）
    expectAbsent(SRV_SUBJECT);
    expectAbsent(SRV_LIST_SUBJECT);
    expect(listPageMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();

    // 演示支的报价新鲜度必须还在：恰好一次，不是轮询
    await waitFor(() => expect(quoLoadSpy).toHaveBeenCalledTimes(1));
    expect(quoLoadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('R113 头部「切换询价单」下拉按服务端清单出选项', () => {
  it('选项只有响应里那两条：store 里那条可对比的单子不是选项', async () => {
    assertFixtureLiterals();
    const storeOnly = storeOnlyComparable();
    // store 里这条在演示支会被算成可对比（有已提交报价），服务端支不该看见它
    useInquiryStore.setState({ inquiries: [storeOnly.inquiry], loaded: true });
    useQuotationStore.setState({ quotations: [storeOnly.quotation], loaded: true });
    // 牙齿：这条单子按 store 的规则确实"可对比"——筛子真会把它收进来，下面的"不是选项"才不是恒真
    expect(
      useQuotationStore
        .getState()
        .getQuotationsByInquiry(STORE_ONLY_ID)
        .some((q) => q.status === QuotationStatus.SUBMITTED),
    ).toBe(true);

    renderPage(`/quotation/compare/${DETAIL_ID}`);
    await expectShown(SRV_SUPPLIER_NAME);

    const labels = openSwitcherAndReadOptionLabels();
    expect(labels).toEqual([
      i18n.t('quotation.compare.inquiryDesc', { subject: SRV_SUBJECT, code: 'INQ-SRV-DETAIL' }),
      i18n.t('quotation.compare.inquiryDesc', { subject: SRV_LIST_SUBJECT, code: 'INQ-SRV-LIST' }),
    ]);
    expect(labels.some((l) => l.includes(STORE_ONLY_SUBJECT))).toBe(false);
  });
});

describe('R113 无 id 的可对比卡片列表按服务端清单出', () => {
  it('卡片只有响应里那两条：store 里那条可对比的单子不是卡片', async () => {
    assertFixtureLiterals();
    const storeOnly = storeOnlyComparable();
    useInquiryStore.setState({ inquiries: [storeOnly.inquiry], loaded: true });
    useQuotationStore.setState({ quotations: [storeOnly.quotation], loaded: true });
    expect(
      useQuotationStore
        .getState()
        .getQuotationsByInquiry(STORE_ONLY_ID)
        .some((q) => q.status === QuotationStatus.SUBMITTED),
    ).toBe(true);

    renderPage('/quotation/compare');

    expect(await screen.findByText(SRV_SUBJECT)).toBeInTheDocument();
    expect(screen.getByText(SRV_LIST_SUBJECT)).toBeInTheDocument();
    expectAbsent(STORE_ONLY_SUBJECT);
    // 卡片列表这一支不发详情那一发（没有 id 就不该发 GET）
    expect(listPageMock).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalled();
  });
});
