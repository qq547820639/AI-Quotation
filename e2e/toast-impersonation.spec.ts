import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * R34 的**机制实证**（不是回归断言，而是"这条不变量真的会被违反"的可复现证明）。
 *
 * 为什么要有它：登记册里那 5 处未指名断言的豁免理由全是读码判定（"该文档内它是第一条成功提示"），
 * 从未实测。本文件用一次受控注入把"冒充"本身跑出来，让豁免清单第一次拿到机器读数。
 *
 * 装置：系统设置页**同屏**两张卡各带一个「保存」按钮（不是 Tabs，所以不需要切页），
 * 且两条成功文案互不包含（审批设置已保存 / AI 设置已保存）。
 * 把第二个动作的 `PUT /api/settings` 用 page.route 挂住不放 ⇒ 出现一个确定窗口：
 * A 的 toast 还在屏上（antd message 默认约 3s），而 B 的写还没回来。
 *
 * 三条读数：
 *  ① 未指名的 `.ant-message-success` 在该窗口内**可见** ⇒ 冒充是真的（ALLOW 台账里那一格就是它）；
 *  ③ 只指名到公共后缀"设置已保存" ⇒ 同样可见 ⇒ 光"写了文案"不够，文案必须能唯一区分。
 *     这正是 AST 判据 ambiguous 档（实参命中 ≥2 条成功文案）要拦的形状；
 *  ② 指到能唯一区分 B 的完整文案 ⇒ 该窗口内必须还没有它，放行后才出现。
 *
 * 前提用断言钉住：注入必须真的挂住过请求（`held > 0`），否则 ① 会退化成"B 恰好比 A 快"的假绿。
 *
 * 身份必须是管理员：第一版写成采购人员 `李明辉`（u-1），他在 `/settings` 上拿到的是
 * 403 Result 页（真实栈实测：`element(s) not found` + a11y 树里只有"返回首页"），
 * 于是"两张卡同屏"这个装置前提根本不成立 ⇒ 用 `周大海`（u-6，同 `permission.spec.ts:50`）。
 */
const SAVE_BTN = /保\s*存|Save/;

test.describe('成功提示冒充机制的实证（R34 豁免清单的地基）', () => {
  test('上一条 toast 会满足未指名断言；能唯一区分的指名不会', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, '周大海');
    await page.goto('/settings');

    const approvalCard = page.locator('.ant-card').filter({ hasText: '审批配置' });
    const aiCard = page.locator('.ant-card').filter({ hasText: 'AI 设置' });
    await expect(approvalCard.first()).toBeVisible({ timeout: 15_000 });
    await expect(aiCard.first()).toBeVisible({ timeout: 15_000 });

    // 动作 A：保存审批配置，成功提示落地（这条断言本身是"活 locator"的正向对照）。
    // 闸门必须装在这条之后：第一版在动作 A 之前就 page.route，于是 A 自己的 PUT 也被挂住、
    // A 的成功提示永远不出现 ⇒ 用例卡在第一条断言上 15s 判红（真实栈实测，不是推断）。
    await approvalCard.getByRole('button', { name: SAVE_BTN }).first().click();
    await expect(
      page.locator('.ant-message-success').filter({ hasText: '审批设置已保存' }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 此刻才装闸门：只挡得住动作 B 的写请求
    let held = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        held += 1;
        await gate;
      }
      await route.continue().catch(() => {
        /* 页面已跳转 / 连接已断开时忽略 */
      });
    });

    // 动作 B：保存 AI 设置，但写请求被挂住
    await aiCard.getByRole('button', { name: SAVE_BTN }).first().click();
    await expect.poll(() => held, { timeout: 10_000 }).toBeGreaterThan(0);

    // 把窗口撑到 1s：这一步才让"挂住"成为断言的**承重件**。
    // 实测反证：只点完立刻读时，删掉 handler 里的 `await gate`（让 B 真的落库）用例照样绿——
    // B 的往返只有几十毫秒，`toHaveCount(0)` 靠自然延迟就成立，注入根本没在做事。
    // 撑到 1s 后（远大于一次 PUT 往返，又短于 antd message 约 3s 的存活期）：
    // ② 只在请求真被挂住时成立，① ③ 仍由 A 那条活着的提示满足。
    await page.waitForTimeout(1_000);

    // ① 未指名 ⇒ 被 A 的提示满足（R34 那次的形状，本轮实测而非推断）
    await expect(page.locator('.ant-message-success').first()).toBeVisible();

    // ③ 指了名但不能唯一区分（A 的文案以它为后缀）⇒ 一样被满足
    await expect(
      page.locator('.ant-message-success').filter({ hasText: '设置已保存' }).first(),
    ).toBeVisible();

    // ② 指到能唯一区分 B 的完整文案 ⇒ 窗口内**这一瞬间**必须还没有它。
    //    刻意不用 toHaveCount(0)：那是重试型断言，一条"已经出现过、又淡掉了"的提示
    //    会在它淡出之后把 0 凑出来。实测对照：把 `await gate` 换成放行后，
    //    toHaveCount(0) 依然判绿（3s 后场上当然没有它），红的是末尾那条 visible——
    //    等于缺席断言没在挡任何东西。一次性 count() 读的才是窗口内的现场。
    const namedInWindow = await page
      .locator('.ant-message-success')
      .filter({ hasText: 'AI 设置已保存' })
      .count();
    expect(namedInWindow, '写请求已被挂住，指名的成功提示此刻不该在场').toBe(0);

    release();
    await expect(
      page.locator('.ant-message-success').filter({ hasText: 'AI 设置已保存' }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
