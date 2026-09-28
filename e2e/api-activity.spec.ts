import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiActivity, MAX_ROWS, watchApi } from './api-activity';
import { getInvitationToken } from './helpers';

/**
 * 归因量具自己的常驻用例（R95）。
 *
 * 为什么常驻：整套"runner 上的红怎么归因"现在压在 `apiActivity` 这一行摘要上——
 * 登记册 R92 那两格（GET `/api/suppliers` 等满 20 s、以及 `procurement_token` 不见了）
 * 靠的都是"把现场并进错误文本"。只被自己用过一次的量具不可信，所以钉成常驻断言。
 *
 * 为什么不需要后端场地：断言的是"账本记不记得住、抛出的句子带不带现场"。
 * 服务是自己起的 `listen(0)`（内核分配端口，不碰任何在用的端口），而
 * `getInvitationToken` 在发出任何请求之前就会因为库里没有 token 而抛——
 * 那正好是一条能在无后端下跑到的真分支。
 *
 * 只在 chromium 档跑一次：这把尺子与引擎无关，五个项目各乘一遍只会把 29 分钟的串行档拉长。
 */
async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/needs401') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"detail":"unauthorized"}');
      return;
    }
    if (req.url === '/api/dies') {
      // 网络层失败这一档：连接直接被掐，浏览器只会发 requestfailed，不会发 response。
      res.destroy();
      return;
    }
    if (req.url === '/api/hang') {
      return; // 在飞这一档：收下了但永远不回，账本里应保持 status=-1。
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><p>api-activity probe</p></body></html>');
  });
  // 挂住的连接会让 srv.close() 一直等，所以自己记下 socket 并在收尾时销毁。
  const sockets = new Set<import('node:net').Socket>();
  srv.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  const { port } = srv.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const s of sockets) s.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    },
  };
}

test.describe('归因量具（apiActivity）自检', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    '量具与引擎无关，只在 chromium 档跑一次',
  );

  test('归因量具自检：账本要记到非 2xx，且生产路径的抛出必须自带现场', async ({ page }) => {
    const s = await startServer();
    try {
      // 反例侧先跑：不装监听器就什么都看不见——否则下面那句"看见 401"可能是页面自己报的。
      await page.goto(s.origin);
      await page.evaluate(() => fetch('/api/needs401').catch(() => {}));
      expect(apiActivity(page)).toContain('/api 响应 0 条');

      // 正例侧：装完之后同一条 401 必须进摘要，并带上当时的 URL。
      watchApi(page);
      await page.goto(s.origin);
      await page.evaluate(() => fetch('/api/needs401').catch(() => {}));
      await expect
        .poll(() => apiActivity(page), { message: '账本没记到那条 401：监听器没承重' })
        .toContain('非 2xx 1 条');
      const summary = apiActivity(page);
      expect(summary).toContain('401 GET /api/needs401');
      expect(summary).toContain(`URL=${s.origin}/`);
      // 匹配不到的那次读要说"一条都没有"——这正是 runner 那格要分辨的形状（没发出 vs 发了没回）。
      expect(apiActivity(page, /\/api\/suppliers/)).toContain('的响应 0 条：一条都没有');

      // 生产路径：helpers 里那格的抛出必须自带现场，不能只剩一句 not found。
      let message = '';
      try {
        await getInvitationToken(page, 'inq-probe', 'sup-probe');
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('procurement_token not found in localStorage');
      expect(message).toContain(`URL=${s.origin}/`);
      expect(message).toMatch(/非 2xx 1 条/);
    } finally {
      await s.close();
    }
  });

  test('账本超限时必须自报是下界，不能把 400 冒充总数', async ({ page }) => {
    const s = await startServer();
    try {
      watchApi(page);
      await page.goto(s.origin);
      const fired = MAX_ROWS + 5;
      await page.evaluate(async (n) => {
        for (let i = 0; i < n; i++) await fetch('/api/needs401').catch(() => {});
      }, fired);
      const summary = apiActivity(page);
      // 三条都得在：精确总数带 ≥、丢弃条数点名、非 2xx 也标成下界。
      expect(summary).toContain(`/api 响应 ≥${fired} 条`);
      expect(summary).toContain('挤掉最早 5 条');
      expect(summary).toContain(`非 2xx ≥${MAX_ROWS} 条`);
      // 反向对照：未超限时不许出现 ≥／丢弃字样（否则这条断言恒真，等于没测）。
      const fresh = await page.context().newPage();
      watchApi(fresh);
      await fresh.goto(s.origin);
      await fresh.evaluate(() => fetch('/api/needs401').catch(() => {}));
      expect(apiActivity(fresh)).not.toContain('≥');
      expect(apiActivity(fresh)).not.toContain('挤掉最早');
      await fresh.close();
    } finally {
      await s.close();
    }
  });

  test('三种终态各有各的句子：网络层断掉／在飞没回，外加"根本没发"当对照', async ({ page }) => {
    const s = await startServer();
    try {
      watchApi(page);
      await page.goto(s.origin);

      // 档②：连接被掐——浏览器只发 requestfailed，不发 response。
      // 少了这一档，账本会把"发了但被掐"读成下面那句"根本没发"（R99 的动机）。
      await page.evaluate(() => fetch('/api/dies').catch(() => {}));
      await expect
        .poll(() => apiActivity(page, /\/api\/dies/), { message: 'requestfailed 没进账本' })
        .toContain('网络层失败');

      // 档③：收下了但永远不回——既不该算"回了"，也不该算"没发"。
      void page.evaluate(() => fetch('/api/hang').catch(() => {}));
      await expect
        .poll(() => apiActivity(page, /\/api\/hang/), { message: '在飞的那条没进账本' })
        .toContain('在飞没回');

      // 摘要头部三档各自计数，别糊成一个"响应 N 条"。
      const head = apiActivity(page);
      expect(head).toContain('网络层失败 1 条');
      expect(head).toContain('在飞 1 条');

      // 档①的对照：什么都没发生时，必须仍然说"根本没发"。
      // 这句是分辨句的零侧——上一段两档若写坏，这句会跟着一起绿，所以它必须自己站得住。
      expect(apiActivity(page, /\/api\/never/)).toContain('的响应 0 条：一条都没有');
    } finally {
      await s.close();
    }
  });
});
