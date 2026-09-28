import type { Page, Request } from '@playwright/test';

/**
 * 页面侧 /api 请求的活动账本：把两类"红了却说不出当时发生了什么"的失败变成可归因的读数。
 *
 * 动机（登记册 R92 / R95 / R99）：runner 上反复出现两种红——
 * ① `openSupplierPageAndToggle` 里那次 `waitForResponse(GET /api/suppliers)` 等满 20 s；
 * ② `getInvitationToken` 报 `procurement_token not found in localStorage`，
 *    而 `login()` 自己已经断言过 2xx 与落到 /dashboard（`e2e/helpers.ts:100-111`）。
 * 两种红原先都只有一句话，读不出"当时是不是已经被 401 踢回登录页"与"那次 GET 到底发没发"。
 *
 * R99 补的是"发没发"这一半：`response` 只覆盖"回了"那支——网络层断掉的请求只发 `requestfailed`。
 * 所以三条事件都听：`request`（在飞）→ `response`／`requestfailed`（终态）。
 *
 * R101 补的是另外两个会让本账本说谎的形状（读数见登记册，Playwright 1.62.1／chromium 实测）：
 * ① 超限挤掉的是**最早**那一行，而最早那行可以还在飞——旧文本把每一次挤掉都记进"响应 N 条"，
 *    于是"在飞 0 条"与"那次读根本没发"两句能同时被账本自己的上限造出来。现在按终态分类记账，
 *    每一类只在**自己**被挤掉时才标下界。
 * ② 套件自己下了 14 处 `route.fulfill` 与 3 处 `route.abort` 桩（`e2e/exception-scenarios.spec.ts`
 *    等），而 fulfill 一样发 `request`+`response`：桩的 201 与后端的 201 在账本里同形。
 *    区分点实测是 `request.timing().requestStart`——真请求 >0，桩为 0。读不到时留空，不猜成真请求。
 * 这里不改任何超时预算（放宽是掩盖），只在失败时把现场并进错误文本。
 */

type ApiRow = {
  method: string;
  path: string;
  /** -1＝还在飞（没等到任何终态）；0＝网络层失败；其余＝HTTP 状态码 */
  status: number;
  failed?: string;
  /** true＝有网络层 request 阶段；false＝没有（页面级 route 桩，或缓存直接给的响应）；undefined＝解不开 */
  net?: boolean;
};

/** 被上限挤掉的条数按终态分开记：混成一个数，"响应 N 条"就会把在飞与失败的行也算成回了。 */
type DropKind = 'answered' | 'failed' | 'inflight';
type Drops = Record<DropKind, number>;

/** 账本按页存；Map 的插入序即时序，键用 Request 对象本身，终态事件才找得回那一行。 */
const ledger = new WeakMap<Page, Map<Request, ApiRow>>();
const droppedByPage = new WeakMap<Page, Drops>();
const armed = new WeakSet<Page>();

/** 最多留多少条：常驻套件单页最多几百条 /api 请求，留上限防内存无上限增长。 */
export const MAX_ROWS = 400;

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

const isApi = (url: string) => url.includes('/api/');

/**
 * 有没有真的走网络。实测：`route.fulfill` 的响应 timing 各键都在但 `requestStart` 为 0，
 * 真请求（同机 http）`requestStart` > 0。`timing()` 抛或给空 ⇒ undefined，不折成任何一种。
 * 导出给写回执守卫用（`e2e/helpers.ts` 的 `expectWriteLanded`），同一把尺子不抄第二份。
 */
export function networkPhase(req: Request): boolean | undefined {
  try {
    const t = req.timing();
    if (!t) return undefined;
    return Number(t.requestStart) > 0;
  } catch {
    return undefined;
  }
}

const dropKind = (r: ApiRow): DropKind =>
  r.status === -1 ? 'inflight' : r.status === 0 ? 'failed' : 'answered';

/** 新请求入册；超限时挤掉**最早**的一条，并按它当时的终态归类记账。 */
function push(page: Page, rows: Map<Request, ApiRow>, req: Request): void {
  rows.set(req, { method: req.method(), path: pathOf(req.url()), status: -1 });
  if (rows.size > MAX_ROWS) {
    const oldest = rows.keys().next().value;
    if (oldest !== undefined) {
      const evicted = rows.get(oldest);
      rows.delete(oldest);
      const d = droppedByPage.get(page);
      if (d && evicted) d[dropKind(evicted)] += 1;
    }
  }
}

/** 给一个页面装上市面账本；重复调用是幂等的（多个辅助函数都可能会调）。 */
export function watchApi(page: Page): void {
  if (armed.has(page)) return;
  armed.add(page);
  const rows = new Map<Request, ApiRow>();
  ledger.set(page, rows);
  droppedByPage.set(page, { answered: 0, failed: 0, inflight: 0 });
  page.on('request', (req) => {
    if (isApi(req.url())) push(page, rows, req);
  });
  page.on('response', (res) => {
    const row = rows.get(res.request());
    if (row) {
      row.status = res.status();
      row.net = networkPhase(res.request());
    }
  });
  page.on('requestfailed', (req) => {
    const row = rows.get(req);
    if (row) {
      row.status = 0;
      row.failed = req.failure()?.errorText ?? '(无 failure 文本)';
    }
  });
}

function describeRow(r: ApiRow): string {
  if (r.status === -1) return `在飞 ${r.method} ${r.path}`;
  if (r.status === 0) return `网络层失败 ${r.method} ${r.path}（${r.failed}）`;
  return `${r.status} ${r.method} ${r.path}${r.net === false ? '(无网络往返)' : ''}`;
}

/**
 * 一行摘要：当前 URL、账本总数与三种终态各几条（各自按下界报）、其中非 2xx 与网络层失败的最近几条；
 * 传 `only` 时把"那次读"单独算一遍——在飞／网络层失败／回了／账本里根本没有，各有各的句子，
 * 而"根本没有"在有挤掉时绝不写成"没发"。
 */
export function apiActivity(page: Page, only?: RegExp): string {
  const rows = [...(ledger.get(page)?.values() ?? [])];
  const d = droppedByPage.get(page) ?? { answered: 0, failed: 0, inflight: 0 };
  const dropTotal = d.answered + d.failed + d.inflight;
  const inflight = rows.filter((r) => r.status === -1);
  const netFailed = rows.filter((r) => r.status === 0);
  const answered = rows.filter((r) => r.status > 0);
  const bad = answered.filter((r) => r.status >= 400);
  const stubbed = answered.filter((r) => r.net === false).length;
  // 两类各留最近 3 条：先拼再截的话，6 个连续 4xx 就能把"网络层失败"整档从窗口里挤没——
  // 与上限挤掉在飞行是同一类盲区，只是发生在展示侧。
  const clipped = netFailed.length > 3 || bad.length > 3;
  const shown = [...netFailed.slice(-3), ...bad.slice(-3)].map(describeRow).join(' ; ');
  // 每一类只在自己被挤掉时才是下界——旧写法把任何一次挤掉都算进"响应"，于是上限能造出假句子。
  const capNote = dropTotal
    ? `（账本已满，挤掉最早 ${dropTotal} 条：已回 ${d.answered}／网络层失败 ${d.failed}／当时在飞 ${d.inflight}` +
      ' ⇒ 各类皆按下界算，被挤掉时仍在飞的那几条之后再回不再记账）'
    : '';
  const stubNote = stubbed
    ? `｜回了的里面有 ${stubbed} 条没有网络层 request 阶段（页面级 route 桩或缓存，不等于后端真回过）`
    : '';
  const parts = [
    `URL=${page.url()}`,
    `/api 响应 ${d.answered ? '≥' : ''}${answered.length + d.answered} 条${capNote}` +
      `（非 2xx ${d.answered ? '≥' : ''}${bad.length} 条｜网络层失败 ${d.failed ? '≥' : ''}${netFailed.length + d.failed} 条` +
      `｜在飞 ${d.inflight ? '≥' : ''}${inflight.length + d.inflight} 条）${stubNote}`,
    shown
      ? `保留窗口内的非 2xx 与失败: ${shown}${clipped ? '（两类各只留最近 3 条）' : ''}`
      : '保留窗口内没有非 2xx、也没有网络层失败',
  ];
  if (only) {
    const hit = rows.filter((r) => only.test(r.path));
    const hitAnswered = hit.filter((r) => r.status > 0);
    const hitFailed = hit.filter((r) => r.status === 0);
    const hitInflight = hit.filter((r) => r.status === -1);
    const verdict =
      hit.length === 0
        ? dropTotal
          ? `一条都没有，但账本已满（挤掉 ${dropTotal} 条）⇒ 不能断定那次读没发，它可能只是被挤出了窗口`
          : '一条都没有：既没回、也没报网络层失败、也没有在飞 ⇒ 那次读没发出，或发出时监听器还没装（watchApi 之前那一段）'
        : [
            hitAnswered.length
              ? `回了 ${hitAnswered.map((r) => r.status).join(',')}${
                  hitAnswered.some((r) => r.net === false) ? '（含无网络往返的桩／缓存）' : ''
                }`
              : '',
            hitFailed.length ? `网络层失败 ${hitFailed.map((r) => r.failed).join(',')}` : '',
            hitInflight.length ? `发出后仍有 ${hitInflight.length} 条在飞没回` : '',
          ]
            .filter(Boolean)
            .join('｜');
    parts.push(
      `匹配 ${only} 的响应 ${hitAnswered.length} 条：${
        hit.length === 0 ? verdict : `账本共 ${hit.length} 条 ⇒ ${verdict}`
      }`,
    );
  }
  return parts.join('｜');
}
