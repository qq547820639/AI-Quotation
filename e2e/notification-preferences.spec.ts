/**
 * E2E：通知偏好的「写穿」与「一次性迁移」（R62）——真后端一手读数
 *
 * 登记册 R62 的三条主张此前只有 jsdom＋mock 证据（`npx vitest run src/store`）。这个文件把它们
 * 换成真实 HTTP 的凭据：
 *  A. 设置页的开关经 `PUT /api/notifications/preferences` 落到服务端，换一个本机状态全空的新浏览器
 *     仍然读得到 ⇒ 权威在服务端，不是"只有这台机子的 localStorage 记得"。
 *  B. 服务端没有对应位的那一位（待办提醒）不出现在 PUT 体里 ⇒ "写穿"没被写成"整包同步"，
 *     本机概念没被冒充成服务端概念。
 *  C. 只存在于本机的关闭被一次性搬到服务端；而服务端**已经**是关的时候绝不补发写请求
 *     （否则会把别的设备真实关掉的位翻回开）。
 */
import { test, expect, type Page, type Response as PwResponse } from '@playwright/test';
import { login, createAndSendInquiry } from './helpers';

/**
 * 两格用两个用户，各按各自的前提：
 * - 写穿那格要走设置页 UI，而 `/settings` 受 SETTINGS_MANAGE 管，采购人员会被拦
 *   （`e2e/permission.spec.ts:19` 钉的就是这件事；第一版我拿 u-1 跑，卡定位直接 0 命中）；
 * - 迁移那格不碰 UI，只用登录后的 boot，留 u-1 与另一格互不干扰（偏好本来就是按用户存的）。
 */
const SETTINGS_USER = '周大海';
const MIGRATION_USER = '李明辉';
const PREFS_RE = /\/api\/notifications\/preferences/;
/** `storage.ts` 的 key 前缀 + 各 store 自己那一段：这里刻意不从 store 里抄串，抄了就和被测代码同源 */
const SETTINGS_KEY = 'procurement_settings';
const MIGRATED_KEY = 'procurement_notify_pref_migrated_v1';
const SCHEMA_VERSION = 2;

interface Prefs {
  deadlineReminder: boolean;
  deadlineReminderHours: number;
  quotationSubmitted: boolean;
  approvalResult: boolean;
  inquirySent: boolean;
  [k: string]: unknown;
}

/** 带 Bearer 的直接 API 读/写：绕开 UI，专门拿"服务端到底存了什么"这一手凭据（同 helpers.getInvitationToken 的做法） */
async function apiFetch<T>(
  page: Page,
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  return (await page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem('procurement_token');
      if (!token)
        throw new Error(`procurement_token 不在 localStorage，无法以该用户身份访问 ${path}`);
      const res = await fetch(`/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`${method} /api${path} → ${res.status}`);
      return (await res.json()) as T;
    },
    { method, path, body },
  )) as T;
}

const prefsApi = (page: Page, method: 'GET' | 'PUT', body?: Prefs) =>
  apiFetch<Prefs>(page, method, '/notifications/preferences', body);

interface ServerNotification {
  id: string;
  inquiryId?: string | null;
  type: string;
}

/**
 * 数服务端某一询价下 `inquiry_sent` 那条记录出现没有，出现即返回、否则每 2 s 重读一次到超时。
 * 两档共用同一个窗口：`addNotification` 是 `void` 出去的（`src/store/useInquiryStore.ts:413`），
 * 发送接口返回 2xx 只证明"铸通知那一行执行到了"，不证明那次 POST 已落库，
 * 所以"关档读不到"必须拿"开档在读得到"来校准，否则它可能只是在读一个还没发生的写。
 */
async function inquirySentRowFor(page: Page, inquiryId: string, windowMs = 20000) {
  const deadline = Date.now() + windowMs;
  for (;;) {
    const rows = await apiFetch<ServerNotification[]>(page, 'GET', '/notifications');
    const hit = rows.filter((n) => n.type === 'inquiry_sent' && n.inquiryId === inquiryId);
    if (hit.length > 0 || Date.now() >= deadline) return hit.length;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** 让"本机关掉了询价发送通知"这件事只存在于本机——正是 R62 步骤一要从旧版本手里搬走的那个状态 */
async function seedLocalToggleOff(page: Page) {
  await page.addInitScript(
    ([key, payload]) => localStorage.setItem(key, payload),
    [
      SETTINGS_KEY,
      JSON.stringify({ v: SCHEMA_VERSION, data: { notifications: { inquirySent: false } } }),
    ],
  );
}

test.describe('R62 通知偏好：真后端写穿与一次性迁移', () => {
  test('关掉「询价发送通知」保存后：值落到服务端、换浏览器仍生效；「待办提醒」不进 PUT 体', async ({
    page,
    browser,
  }) => {
    // 前提可观测：登录那次认证态翻转要真的把偏好拉下来（R61 接上的那根线）。
    // 拉不下来的话 mergePreferences 会按 R62 的前置直接拒保存，下面那条 PUT 根本不该出现。
    const bootGet = page.waitForResponse(
      (r) => r.request().method() === 'GET' && PREFS_RE.test(r.url()),
      { timeout: 20000 },
    );
    await login(page, SETTINGS_USER);
    const bootGetRes = await bootGet;
    expect(bootGetRes.status(), '登录后启动时那次 GET /notifications/preferences 必须成功').toBe(
      200,
    );
    const bootPrefs = (await bootGetRes.json()) as Prefs;

    // 前提要在**它承重的那一刻**验，不是在上一次启动时验：`page.goto` 是一次文档级导航，
    // App 会重新挂载并再跑一遍 bootstrapStores ⇒ 又一次 loadPreferences；
    // 那一趟如果失败，`preferencesLoaded` 会被收回 false（useNotificationStore.ts:168-171），
    // 于是 `mergePreferences` 直接拒保存（:206）——本用例要的 PUT 根本不会发出。
    // 第一版就是栽在这里：断言的是登录那次启动的 GET 200，保存却发生在设置页这次加载之后。
    const prefsGetAtSettings = page.waitForResponse(
      (r) => r.request().method() === 'GET' && PREFS_RE.test(r.url()),
      { timeout: 20000 },
    );
    await page.goto('/settings');
    expect(
      (await prefsGetAtSettings).status(),
      '进入设置页那次启动必须把偏好拉回来，否则保存会被 R62 的前置拒掉',
    ).toBe(200);

    const card = page.locator('.ant-card').filter({ hasText: /通知设置|Notification Settings/ });
    await expect(card).toHaveCount(1);
    const inquirySwitch = card.locator('#notification-inquirySent');
    await expect(inquirySwitch).toBeVisible();
    // 起点写在断言里而不是 if 里：本格用的是全新上下文（localStorage 空），
    // 设置卡上的开关必然取自 `useSettingsStore` 的 DEFAULTS（inquirySent: true）。
    // 哪天默认值变了或被谁接上了服务端，这一条会以"起点不是开"红出来，而不是悄悄反向。
    await expect(inquirySwitch).toHaveAttribute('aria-checked', 'true');
    await inquirySwitch.click();
    await expect(inquirySwitch).toHaveAttribute('aria-checked', 'false');

    // 用"看得见拒绝理由"的方式等这次写，而不是干等一次裸超时：
    // PUT 没发出时（多半就是上面那个前置没满足），把页面上的报错文案一起带进失败信息，
    // 否则红只说"20 s 没等到 response"，下一轮还得从猜开始。
    const putSeen: PwResponse[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && PREFS_RE.test(r.url())) putSeen.push(r);
    });
    await card.getByRole('button', { name: /保存|Save/ }).click();
    await expect
      .poll(
        async () => {
          if (putSeen.length) return `put:${putSeen[0].status()}`;
          const t = await page
            .locator('.ant-message-error')
            .first()
            .textContent({ timeout: 500 })
            .catch(() => '');
          return `toast:${t}`;
        },
        { timeout: 20000, message: '点保存后必须发出 PUT；没发出时把页面的拒绝理由带出来' },
      )
      .toContain('put:');
    // 断 PUT 只有**一次**：注册第二次 waitForResponse 已经在响应之后，永远等不到
    const putRes = putSeen[0];
    expect(putSeen, `PUT 发了 ${putSeen.length} 次，写穿不该被重复触发`).toHaveLength(1);
    expect(putRes.status(), '写穿失败时设置页只该报错，不该弹"已保存"').toBe(200);

    const sent = (await putRes.request().postDataJSON()) as Prefs;
    expect(sent.inquirySent, '关掉的那一位必须真的出现在 PUT 体里').toBe(false);
    // todoReminder 的本机值（默认 false）与这一条无关：要点是它作为"键"永不出现在 PUT 体里，
    // 因为服务端 schema 没有这一位——整包同步会把本机概念冒充成服务端概念。
    expect('todoReminder' in sent).toBe(false);
    // 只动被点的那一位，其余三位保持服务端原值
    expect(sent.quotationSubmitted).toBe(bootPrefs.quotationSubmitted);
    expect(sent.approvalResult).toBe(bootPrefs.approvalResult);
    expect(sent.deadlineReminder).toBe(bootPrefs.deadlineReminder);

    // 一手读回：全新上下文（localStorage / cookie 全空）登录后，服务端仍是关
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, SETTINGS_USER);
    const serverPrefs = await prefsApi(p2, 'GET');
    expect(serverPrefs.inquirySent).toBe(false);
    expect('todoReminder' in serverPrefs).toBe(false);

    // 收尾还原成本格跑之前的值：留下被改过的演示账号，下一次跑就以"起点已经是关"为由假绿
    const restored = await prefsApi(p2, 'PUT', {
      ...serverPrefs,
      inquirySent: bootPrefs.inquirySent,
    } as Prefs);
    expect(restored.inquirySent).toBe(bootPrefs.inquirySent);
    await ctx2.close();
  });

  test('本机独有的关闭一次性搬到服务端；服务端已关时不补发写请求', async ({ browser }) => {
    // 正例在前：先证明这根线真的能开火，再信后面那条"没有 PUT"的缺席断言。
    const ctxA = await browser.newContext();
    const pA = await ctxA.newPage();
    await seedLocalToggleOff(pA);
    const getA = pA.waitForResponse(
      (r) => r.request().method() === 'GET' && PREFS_RE.test(r.url()),
      { timeout: 20000 },
    );
    const putA = pA.waitForResponse(
      (r) => r.request().method() === 'PUT' && PREFS_RE.test(r.url()),
      { timeout: 20000 },
    );
    await login(pA, MIGRATION_USER);
    // 迁移发生在那次读之后，所以 GET 的响应体就是"搬之前服务端本来是什么"——还原要用它，
    // 不能拿事后的值当基线（那会把本次改动读成没改动）。
    const baseline = (await (await getA).json()) as Prefs;
    const putARes = await putA;
    expect(putARes.status()).toBe(200);
    const bodyA = (await putARes.request().postDataJSON()) as Prefs;
    expect(bodyA.inquirySent, '迁移只把本机的 false 推上去').toBe(false);
    // 标记只在写成功之后才打：没有这一步，下次启动会白跑一趟
    await expect
      .poll(async () => await pA.evaluate((k) => localStorage.getItem(k), MIGRATED_KEY), {
        message: '迁移完成后才会落下一次性标记',
      })
      .toBeTruthy();
    const afterA = await prefsApi(pA, 'GET');
    expect(afterA.inquirySent).toBe(false);
    // ctxA 留到收尾再用：还原服务端值需要一次带 Bearer 的写，而 pA 是本档唯一还活着的页

    // 反向对照：服务端此刻已经是 false，本机再"关"一次——正确行为是什么都不写。
    // 若迁移实现成了"把本地整份覆盖上去/把 true 也推一遍"，这一格就会开火。
    const putSeen: string[] = [];
    const ctxB = await browser.newContext();
    const pB = await ctxB.newPage();
    pB.on('response', (r) => {
      if (r.request().method() === 'PUT' && PREFS_RE.test(r.url())) putSeen.push(r.url());
    });
    await seedLocalToggleOff(pB);
    const getB = pB.waitForResponse(
      (r) => r.request().method() === 'GET' && PREFS_RE.test(r.url()),
      { timeout: 20000 },
    );
    await login(pB, MIGRATION_USER);
    const getBRes = await getB;
    expect(getBRes.status()).toBe(200);
    // 缺席断言要有落定的判据：迁移这条路径跑完的标志是标记落盘，等它而不是等挂钟
    await expect
      .poll(async () => await pB.evaluate((k) => localStorage.getItem(k), MIGRATED_KEY), {
        message: '迁移分支执行完毕（无事可搬也要打标记）',
      })
      .toBeTruthy();
    expect(putSeen, `服务端已关，不该再补发 PUT：${JSON.stringify(putSeen)}`).toHaveLength(0);
    expect(((await prefsApi(pB, 'GET')) as Prefs).inquirySent).toBe(false);
    await ctxB.close();

    // 还原成本格开始前的值：别把这个偏好永久留在关，否则下一次跑这一格就以"反正已经关了"假绿
    const restored = await prefsApi(pA, 'PUT', baseline);
    expect(restored.inquirySent).toBe(baseline.inquirySent);
    await ctxA.close();
  });

  test('偏好为关时真实发送询价不再铸出该条通知；偏好为开时会铸（R62 的效果面）', async ({
    browser,
  }) => {
    // 两档只差服务端那一位，其余（用户、UI 流程、预算窗口）完全相同。
    // 开档先跑：它既是要证的产品主张，也是关档那条缺席断言的窗口校准——
    // 铸通知是 `void` 出去的，发送接口 2xx 只证明那行执行到了，不证明 POST 已落库。
    const setPref = async (inquirySent: boolean) => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await login(p, MIGRATION_USER);
      const cur = await prefsApi(p, 'GET');
      const after = await prefsApi(p, 'PUT', { ...cur, inquirySent } as Prefs);
      expect(after.inquirySent).toBe(inquirySent);
      await ctx.close();
      return cur;
    };

    const original = await setPref(true);

    const runOnce = async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await login(page, MIGRATION_USER);
      const { inquiryId } = await createAndSendInquiry(page);
      const rows = await inquirySentRowFor(page, inquiryId);
      await ctx.close();
      return rows;
    };

    expect(
      await runOnce(),
      '偏好为开：发送询价应当在服务端留下那条 inquiry_sent 通知',
    ).toBeGreaterThan(0);

    await setPref(false);
    expect(await runOnce(), '偏好为关：同一条铸造路径不该再落库').toBe(0);

    await setPref(original.inquirySent);
  });
});
