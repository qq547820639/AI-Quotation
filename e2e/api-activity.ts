import type { Page } from '@playwright/test';

/**
 * 页面侧 /api 响应的活动账本：把两类"红了却说不出当时发生了什么"的失败变成可归因的读数。
 *
 * 动机（登记册 R92）：runner 上反复出现两种红——
 * ① `openSupplierPageAndToggle` 里那次 `waitForResponse(GET /api/suppliers)` 等满 20 s；
 * ② `getInvitationToken` 报 `procurement_token not found in localStorage`，
 *    而 `login()` 自己已经断言过 2xx 与落到 /dashboard（`e2e/helpers.ts:100-111`）。
 * 两种红原先都只有一句话，读不出"当时是不是已经被 401 踢回登录页"与"那次 GET 到底发没发"。
 * 这里不改任何超时预算（放宽是掩盖），只在失败时把现场并进错误文本。
 */

type ApiRow = { status: number; method: string; path: string };

const rowsByPage = new WeakMap<Page, ApiRow[]>();
const armed = new WeakSet<Page>();

/** 最多留多少条：常驻套件单页最多几百条 /api 响应，留上限防内存无上限增长。 */
const MAX_ROWS = 400;

/** 给一个页面装上市面账本；重复调用是幂等的（多个辅助函数都可能会调）。 */
export function watchApi(page: Page): void {
  if (armed.has(page)) return;
  armed.add(page);
  const rows: ApiRow[] = [];
  rowsByPage.set(page, rows);
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    let path = url;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch {
      /* 保留原始 url */
    }
    rows.push({ status: res.status(), method: res.request().method(), path });
    if (rows.length > MAX_ROWS) rows.shift();
  });
}

/**
 * 一行摘要：当前 URL、/api 响应条数、其中非 2xx 条数与最近的几条；
 * 传 `only` 时额外报"匹配这个模式的那次读到底有没有响应过"——这正是分辨
 * "请求没发出去"与"发出去了但慢/失败"的那一条。
 */
export function apiActivity(page: Page, only?: RegExp): string {
  const rows = rowsByPage.get(page) ?? [];
  const bad = rows.filter((r) => r.status >= 400);
  const tail = bad
    .slice(-6)
    .map((r) => `${r.status} ${r.method} ${r.path}`)
    .join(' ; ');
  const parts = [
    `URL=${page.url()}`,
    `/api 响应 ${rows.length} 条（非 2xx ${bad.length} 条）`,
    tail ? `最近的非 2xx: ${tail}` : '没有非 2xx',
  ];
  if (only) {
    const hit = rows.filter((r) => only.test(r.path));
    parts.push(
      `匹配 ${only} 的响应 ${hit.length} 条：${
        hit
          .slice(-3)
          .map((r) => `${r.status} ${r.method}`)
          .join(', ') || '一条都没有（那次读要么没发出、要么没回）'
      }`,
    );
  }
  return parts.join('｜');
}
