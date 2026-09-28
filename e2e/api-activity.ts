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
 * R99 补的正是"发没发"这一半：`response` 事件只覆盖"回了"那支——**网络层断掉的请求不发 response**，
 * 只发 `requestfailed`。少了它就有人把"发了但连接被掐"读成"根本没发出"，而那两档处置完全不同。
 * 所以三条事件都听：`request`（在飞）→ `response`／`requestfailed`（终态）。
 * 这里不改任何超时预算（放宽是掩盖），只在失败时把现场并进错误文本。
 */

type ApiRow = {
  method: string;
  path: string;
  /** -1＝还在飞（没等到任何终态）；0＝网络层失败；其余＝HTTP 状态码 */
  status: number;
  failed?: string;
};

/** 账本按页存；Map 的插入序即时序，键用 Request 对象本身，终态事件才找得回那一行。 */
const ledger = new WeakMap<Page, Map<Request, ApiRow>>();
/** 被上限挤掉的条数：没有这个数，"总条数"在超限时就安静地变成一个假的下界。 */
const droppedByPage = new WeakMap<Page, number>();
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

/** 新请求入册；超限时挤掉**最早**的一条，并把"挤掉了"记进计数器。 */
function push(page: Page, rows: Map<Request, ApiRow>, req: Request): void {
  rows.set(req, { method: req.method(), path: pathOf(req.url()), status: -1 });
  if (rows.size > MAX_ROWS) {
    const oldest = rows.keys().next().value;
    if (oldest !== undefined) {
      rows.delete(oldest);
      droppedByPage.set(page, (droppedByPage.get(page) ?? 0) + 1);
    }
  }
}

/** 给一个页面装上市面账本；重复调用是幂等的（多个辅助函数都可能会调）。 */
export function watchApi(page: Page): void {
  if (armed.has(page)) return;
  armed.add(page);
  const rows = new Map<Request, ApiRow>();
  ledger.set(page, rows);
  droppedByPage.set(page, 0);
  page.on('request', (req) => {
    if (isApi(req.url())) push(page, rows, req);
  });
  page.on('response', (res) => {
    const row = rows.get(res.request());
    if (row) row.status = res.status();
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
  return `${r.status} ${r.method} ${r.path}`;
}

/**
 * 一行摘要：当前 URL、账本总数与三种终态各几条、其中非 2xx 与网络层失败的最近几条；
 * 传 `only` 时把"那次读"单独算一遍——在飞／网络层失败／回了，三种情况各有各的句子。
 */
export function apiActivity(page: Page, only?: RegExp): string {
  const rows = [...(ledger.get(page)?.values() ?? [])];
  const dropped = droppedByPage.get(page) ?? 0;
  const inflight = rows.filter((r) => r.status === -1);
  const netFailed = rows.filter((r) => r.status === 0);
  const answered = rows.filter((r) => r.status > 0);
  const bad = answered.filter((r) => r.status >= 400);
  const shown = [...netFailed, ...bad].slice(-6).map(describeRow).join(' ; ');
  // 超限后计数只是下界，就把"是下界"写进文本，别让上限冒充总数。
  const capNote = dropped ? `（账本已满，挤掉最早 ${dropped} 条 ⇒ 以下为下界）` : '';
  const parts = [
    `URL=${page.url()}`,
    `/api 响应 ${dropped ? '≥' : ''}${answered.length + dropped} 条${capNote}` +
      `（非 2xx ${dropped ? '≥' : ''}${bad.length} 条｜网络层失败 ${netFailed.length} 条｜在飞 ${inflight.length} 条）`,
    shown ? `保留窗口内的非 2xx 与失败: ${shown}` : '保留窗口内没有非 2xx、也没有网络层失败',
  ];
  if (only) {
    const hit = rows.filter((r) => only.test(r.path));
    const hitAnswered = hit.filter((r) => r.status > 0);
    const hitFailed = hit.filter((r) => r.status === 0);
    const hitInflight = hit.filter((r) => r.status === -1);
    const verdict =
      hit.length === 0
        ? '一条都没有：既没回、也没报网络层失败、也没有在飞 ⇒ 那次读根本没发（或被页面级 route 直接 fulfill 掉）'
        : [
            hitAnswered.length ? `回了 ${hitAnswered.map((r) => r.status).join(',')}` : '',
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
