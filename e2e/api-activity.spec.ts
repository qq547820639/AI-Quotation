import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiActivity, MAX_ROWS, watchApi } from './api-activity';
import { expectWriteLanded, getInvitationToken } from './helpers';

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
 *
 * R101 补的三面（都是账本自己会说的话，不是产品行为）：账本上限挤掉的可能是还在飞的那一行；
 * 套件自家下的 `route` 桩在账本里长什么样（实测：fulfill 也发 request+response，
 * 只有 `timing().requestStart` 能分开）；两个 origin 的同路径读是不是各占一行。
 */
async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const srv = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
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
  return serve(srv);
}

/** 第二个 origin：同一条路径给不同的状态码，用来验账本的键不是路径。 */
async function startOtherServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const srv = http.createServer((_req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"detail":"other origin"}');
  });
  return serve(srv);
}

/** 挂住的连接会让 srv.close() 一直等，所以自己记下 socket 并在收尾时销毁。 */
async function serve(srv: http.Server): Promise<{ origin: string; close: () => Promise<void> }> {
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

      // 档①的对照：什么都没发生时，必须仍然说"没发出"。
      // 这句是分辨句的零侧——上一段两档若写坏，这句会跟着一起绿，所以它必须自己站得住。
      expect(apiActivity(page, /\/api\/never/)).toContain('的响应 0 条：一条都没有');
      expect(apiActivity(page, /\/api\/never/)).toContain('那次读没发出');
    } finally {
      await s.close();
    }
  });

  test('账本上限挤掉的可能是"还在飞"的那一行：满账本时不许写成"根本没发"', async ({ page }) => {
    const s = await startServer();
    try {
      watchApi(page);
      await page.goto(s.origin);
      // 同一次 evaluate 里先出挂住的那条、再串行补满：保证它在账本里是最早的一行，
      // 否则两档挤掉比例由调度决定，断言就成了碰运气。
      await page.evaluate(async (n) => {
        void fetch('/api/hang').catch(() => {});
        for (let i = 0; i < n; i++) await fetch('/api/needs401').catch(() => {});
      }, MAX_ROWS + 1);
      const head = apiActivity(page);
      // 挤掉的 2 条里：1 条当时在飞、1 条已回——旧写法会把这 2 条一并算进"响应"，
      // 于是"在飞 0 条"是账本自己造的假缺席。
      expect(head).toContain('挤掉最早 2 条：已回 1／网络层失败 0／当时在飞 1');
      expect(head).toContain('在飞 ≥1 条');
      expect(head).toContain(`/api 响应 ≥${MAX_ROWS + 1} 条`);
      // 关键反向对照：同一次查询在满账本与空账本下必须是两句话。
      expect(apiActivity(page, /\/api\/hang/)).toContain('不能断定那次读没发');
      const fresh = await page.context().newPage();
      watchApi(fresh);
      await fresh.goto(s.origin);
      expect(apiActivity(fresh, /\/api\/hang/)).toContain('那次读没发出');
      expect(apiActivity(fresh, /\/api\/hang/)).not.toContain('不能断定');
      await fresh.close();
    } finally {
      await s.close();
    }
  });

  test('自家 route 桩的四种形状在账本里各归各位：桩的 2xx 必须带"无网络往返"', async ({ page }) => {
    const s = await startServer();
    try {
      watchApi(page);
      // 形状一：fulfill——实测照样发 request+response，页面拿到的是桩而不是后端。
      await page.route('**/api/stubbed', (route) =>
        route.fulfill({ status: 200, body: '{"stub":true}', contentType: 'application/json' }),
      );
      // 形状二：abort——终态落进"网络层失败"，与真断连同一档。
      await page.route('**/api/killed', (route) => route.abort());
      // 形状三：既不 fulfill 也不 abort 的半吊子——只发 request，永远在飞。
      await page.route('**/api/swallow', () => {});
      await page.goto(s.origin);
      await page.evaluate(() => fetch('/api/stubbed').catch(() => {}));
      await expect
        .poll(() => apiActivity(page, /\/api\/stubbed/), { message: '桩的响应没进账本' })
        .toContain('无网络往返');
      expect(apiActivity(page)).toContain('有 1 条没有网络层 request 阶段');

      await page.evaluate(() => fetch('/api/killed').catch(() => {}));
      await expect
        .poll(() => apiActivity(page, /\/api\/killed/), { message: 'route.abort 没落进网络层失败' })
        .toContain('网络层失败');
      expect(apiActivity(page)).toContain('网络层失败 GET /api/killed');

      // 页面侧不回传那个 Promise：route 永不结算时它收不回来，挂到收尾就成"Test ended"的假红，
      // 而在飞这一档照样记得到。
      await page.evaluate(() => {
        void fetch('/api/swallow').catch(() => {});
      });
      await expect
        .poll(() => apiActivity(page, /\/api\/swallow/), { message: '不结算的桩没算成在飞' })
        .toContain('在飞没回');

      // 互斥对照：同一页里真走网络的那条读不得带上"无网络往返"这个逐行标记——
      // 否则上面那句恒真。（不能拿"桩"字判缺席：头部解释句里就带着它。）
      await page.evaluate(() => fetch('/api/needs401').catch(() => {}));
      await expect
        .poll(() => apiActivity(page, /\/api\/needs401/), { message: '真请求没进账本' })
        .toContain('回了 401');
      expect(apiActivity(page, /\/api\/needs401/)).not.toContain('含无网络往返');
      expect(apiActivity(page, /\/api\/stubbed/)).toContain('含无网络往返');
      // 桩只该被计一次：多算说明"无网络往返"按行数而不是按终态行算。
      expect(apiActivity(page)).toContain('有 1 条没有网络层 request 阶段');
    } finally {
      await s.close();
    }
  });

  test('两个 origin 的同路径读各占一行：账本的键是 Request，不是路径', async ({ page }) => {
    const a = await startServer();
    const b = await startOtherServer();
    try {
      watchApi(page);
      await page.goto(a.origin);
      await page.evaluate(() => fetch('/api/same').catch(() => {}));
      await page.evaluate((u) => fetch(`${u}/api/same`).catch(() => {}), b.origin);
      const txt = apiActivity(page, /\/api\/same/);
      // 若键是路径，第二次会覆盖第一次 ⇒ "账本共 1 条"，两个后端就被读成一个。
      expect(txt).toContain('账本共 2 条');
      expect(txt).toContain('回了 200,404');
      expect(apiActivity(page)).toContain('/api 响应 2 条');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('展示窗口两类各留最近 3 条：一串 4xx 不许把"网络层失败"整档挤没', async ({ page }) => {
    const s = await startServer();
    try {
      watchApi(page);
      await page.goto(s.origin);
      for (let i = 0; i < 4; i++) await page.evaluate(() => fetch('/api/dies').catch(() => {}));
      for (let i = 0; i < 8; i++) await page.evaluate(() => fetch('/api/needs401').catch(() => {}));
      const head = apiActivity(page);
      // 失败档在前、4xx 在后：先拼再截的写法（旧）会让这里只剩 401。
      expect(head).toContain('网络层失败 GET /api/dies');
      expect(head).toContain('401 GET /api/needs401');
      expect(head).toContain('两类各只留最近 3 条');
      // 窗口只裁展示，计数仍是全量。
      expect(head).toContain('网络层失败 4 条');
      expect(head).toContain('非 2xx 8 条');
      // 反向对照：两类都没超过 3 条时不许出现"只留最近"字样。
      const fresh = await page.context().newPage();
      watchApi(fresh);
      await fresh.goto(s.origin);
      await fresh.evaluate(() => fetch('/api/needs401').catch(() => {}));
      expect(apiActivity(fresh)).not.toContain('两类各只留最近 3 条');
      await fresh.close();
    } finally {
      await s.close();
    }
  });

  test('写回执守卫不许把自家桩的 200 当后端回执：未声明必须拒、声明后放行、真失败仍是另一句话', async ({
    page,
  }) => {
    const s = await startServer();
    const fire = (path: string) => () =>
      page.evaluate((p) => {
        void fetch(`/api/${p}`, { method: 'POST' }).catch(() => {});
      }, path);
    try {
      watchApi(page);
      await page.route('**/api/stubwrite', (route) =>
        route.fulfill({ status: 200, body: '{}', contentType: 'application/json' }),
      );
      await page.goto(s.origin);

      // ① 桩给的 200、没声明 via ⇒ 必须拒（这是牙齿：旧形状在这里是静默通过）。
      let msg = '';
      try {
        await expectWriteLanded(page, /\/api\/stubwrite/, fire('stubwrite'), 'POST');
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain('是本用例自己的 route 桩给的');
      expect(msg).toContain('URL=');

      // ② 同一形状、显式声明 stub ⇒ 必须放行（否则这条守卫恒红，等于把用例做废）。
      await expectWriteLanded(page, /\/api\/stubwrite/, fire('stubwrite'), 'POST', { via: 'stub' });

      // ③ 真后端的 200 不得被误判成桩（分档判错会一片假红）。
      await expectWriteLanded(page, /\/api\/realwrite/, fire('realwrite'), 'POST');

      // ④ 真后端的 401 走的是另一句话：写没成功，而不是"这是桩"。
      let msg401 = '';
      try {
        await expectWriteLanded(page, /\/api\/needs401/, fire('needs401'), 'POST');
      } catch (e) {
        msg401 = (e as Error).message;
      }
      expect(msg401).toContain('写请求未成功');
      expect(msg401).not.toContain('route 桩');
    } finally {
      await s.close();
    }
  });
});
