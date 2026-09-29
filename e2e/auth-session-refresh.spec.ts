/**
 * E2E：Access Token 过期后的自动续期（真实浏览器 + 真实后端）
 *
 * 覆盖仓库风险评估里的 P0 项（前端未接 refresh → 每 15 分钟强制登出）修复后的真实链路：
 * 浏览器发出的 Origin 是省略默认端口的 `http://localhost`，后端同源/白名单校验必须放行，
 * 否则自动续期在反代部署下形同虚设。
 */
import { test, expect } from '@playwright/test';
import { login, DATA_ROW } from './helpers';

/** 把 Access Token 换成无效值，等价于放了 15 分钟后自然过期（Refresh Cookie 仍然有效） */
async function expireAccessToken(page: import('@playwright/test').Page) {
  await page.evaluate(() => localStorage.setItem('procurement_token', 'expired-access-token'));
}

test.describe('Access Token 自动续期', () => {
  // R66：这一格验的是"默认端口下 Origin 被序列化成 http://localhost"这一形状（R9 白名单要吃的就是它）。
  // 换宿主端口起第二套栈时它结构必红（origin 会带 :port），于是每轮全量白报 5 条"产品红"。
  // 前提放在 beforeEach 里声明并跳过（本仓的 playwright/no-conditional-in-test 也要求这么写）；
  // 关键是**不放宽断言** —— 断言一旦改弱，R9 那条守卫就没有人在真浏览器里守着了。
  test.describe('需默认端口（:80）', () => {
    test.beforeEach(async ({ baseURL }) => {
      const port = baseURL ? new URL(baseURL).port : '';
      test.skip(!!port && port !== '80', '非默认端口部署：本格需在 :80 上跑，见登记册 R66');
    });

    test('token 过期后刷新页面：自动续期并重放请求，不被踢回登录页', async ({ page }) => {
      await login(page, '李明辉');

      // 前提：会话有效（否则下面的"未跳登录页"可能因为压根没登录而假绿）
      await expect(page).toHaveURL(/\/dashboard/);

      const browserOrigin = await page.evaluate(() => window.location.origin);
      // 浏览器对默认端口 http://localhost:80 序列化为不带端口——后端同源校验要吃的就是这个值
      expect(browserOrigin).toBe('http://localhost');

      await expireAccessToken(page);

      const refreshResponsePromise = page.waitForResponse('**/api/auth/refresh', {
        timeout: 30000,
      });
      // R65 续三：同一次 goto 由两个等待器共享。第二个等"喂这次列表渲染的那次读"落地
      // （GET /api/inquiries 的列表端点形状，排除 401 那一趟——本用例里它必然先 401 再被续期重放），
      // 于是下面的渲染断言测的是"数据到了却没渲染"，而不是"读+渲染没挤进 30 s"。断言原样保留。
      const dataListResponsePromise = page.waitForResponse(
        (r) =>
          r.request().method() === 'GET' &&
          r.status() < 400 &&
          /\/api\/inquiries(\?|$)/.test(r.url()),
        { timeout: 20000 },
      );
      await Promise.all([
        refreshResponsePromise,
        dataListResponsePromise,
        page.goto('/inquiry/list'),
      ]);
      const refreshResponse = await refreshResponsePromise;

      // 真发生了续期，且后端按同源放行了（403 = Origin 校验把续期挡在门外）
      // 注：Origin 属浏览器托管头，Playwright 的 request.headers() 不暴露它，
      // 故以"浏览器实际序列化出的 origin"（上一条断言）+ 续期返回 200 作为同源放行的证据。
      expect(refreshResponse.status()).toBe(200);

      // 原本 401 的请求被自动重放并成功渲染
      await expect(page).toHaveURL(/\/inquiry\/list/);
      await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 30000 });

      // 本地 token 已换成新值，会话没被清
      const storedToken = await page.evaluate(() => localStorage.getItem('procurement_token'));
      expect(storedToken).toBeTruthy();
      expect(storedToken).not.toBe('expired-access-token');
      expect(page.url()).not.toContain('/login');
    });
  });

  test('反向对照：缺少 refresh cookie 时续期失败，仍然要正常登出', async ({ page, context }) => {
    await login(page, '李明辉');
    await expireAccessToken(page);
    await context.clearCookies();

    const responsePromise = page
      .waitForResponse('**/api/auth/refresh', { timeout: 30000 })
      .catch(() => null);
    // goto 的"被另一跳打断"要吞掉：本用例的落点**就是**这次被打断的跳转。
    // 常驻套件里这条已抖过两轮（[webkit]，同一格、同一读法：
    // `Navigation to ".../inquiry/list" is interrupted by another navigation to ".../login"`）——
    // 客户端拿到 401 后跳 /login 抢在 load 之前，Playwright 就把 goto 判成失败。
    // 吞掉的只是这一次导航错误；后面三条（必须观测到续期请求且返回 401、停在 /login、看不到数据）
    // 仍要求真发生，不会因此把"根本没尝试续期"读成绿。
    await page.goto('/inquiry/list').catch(() => {
      /* 守卫的 /login 跳转抢在前面，正是本用例要的结果 */
    });
    const refreshResponse = await responsePromise;

    // 没有可用的 refresh token → 续期必须失败（401），不允许被当成同源而放行。
    // 原来写成 `if (refreshResponse) { expect(status).toBe(401) }`：一条**根本没发出续期请求**
    // 的实现同样满足它（`responsePromise` 已被 `.catch(() => null)` 兜成 null），
    // 这正是 R38 那类"断言只在分支成立时才执行"的形状。改成先无条件钉住请求在场，再判状态码。
    expect(
      refreshResponse,
      '过期 access token 落地时必须观测到一次 /api/auth/refresh 请求，否则"续期失败"根本没被验证',
    ).not.toBeNull();
    // 上一行已经无条件钉住"请求在场"，这里只看它的状态码；写 `?.` 不是为了放过 null，
    // 而是让 TS 不再要求第二次判空（判空责任已经在上一条断言里尽了）。
    expect(refreshResponse?.status()).toBe(401);
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await expect(page.locator(DATA_ROW).first(), '未登录不应看到询价数据').toHaveCount(0);
  });
});
