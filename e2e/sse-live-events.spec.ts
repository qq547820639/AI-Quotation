import { test, expect, type Page } from '@playwright/test';
import { login, createAndSendInquiry, getInvitationToken, DATA_ROW, tap } from './helpers';

/**
 * E2E：SSE 实时推送（/api/events/stream）
 * 覆盖两个真实缺陷：
 * 1. 浏览器原生 EventSource 无法携带 Authorization 头，事件流恒为 401；
 *    改用 fetch + eventsource-parser 后必须以请求头鉴权建流（且 token 不出现在 URL 里）。
 * 2. 供应商提交报价后，采购端应在不刷新页面的前提下被推送刷新。
 */
const STREAM_PATH = '/api/events/stream';

/** 在门户页（独立 page）以邀请令牌提交一条报价 */
async function submitFromPortal(portal: Page, invitationToken: string, unitPrice: string) {
  await portal.goto(`/supplier-portal/${invitationToken}`);
  const unitPriceInput = portal.locator('input[id$="-unitPrice"]').first();
  const deliveryInput = portal.locator('input[id$="-deliveryDays"]').first();
  await expect(unitPriceInput).toBeVisible({ timeout: 15000 });
  await unitPriceInput.fill(unitPrice);
  await deliveryInput.fill('7');
  await tap(portal.getByRole('button', { name: /正式提交|Submit/ }));
  await expect(portal.getByText('提交前预览')).toBeVisible({ timeout: 10000 });
  await tap(portal.getByRole('button', { name: /确认提交/ }));
  // R65 续：原来写的是"整页回执 或 瞬时提示"两者其一，瞬时件能单独满足这条 ⇒ 收成整页回执。
  // 门户提交成功后渲染的就是 .ant-result-success 结果页（supplier-portal.spec.ts:50 同一形状），
  // 这里不是"放宽"而是去掉那条可以被残留提示满足的分支。
  await expect(portal.locator('.ant-result-success').first()).toBeVisible({ timeout: 15000 });
}

test.describe('SSE 实时推送', () => {
  test('登录后的事件流以已鉴权方式建立：200 且令牌不进 URL', async ({ page }) => {
    const seen: { status: number; url: string }[] = [];
    page.on('response', (res) => {
      if (res.url().includes(STREAM_PATH)) seen.push({ status: res.status(), url: res.url() });
    });

    await login(page, '王志强');
    await expect
      .poll(() => seen.filter((s) => s.status === 200).length, { timeout: 20000 })
      .toBeGreaterThan(0);

    const opened = seen.find((s) => s.status === 200);
    expect(opened?.url).not.toMatch(/token=/i);
    // 未登录时根本不发流请求（登录页挂载 App 也不应留下 401 噪声）
    expect(seen.every((s) => s.status === 200)).toBe(true);
  });

  test('供应商提交报价后采购端免刷新收到推送', async ({ page, context }) => {
    await login(page, '王志强');
    const { inquiryId, subject } = await createAndSendInquiry(page);
    const invitationToken = await getInvitationToken(page, inquiryId, 'sup-2');

    await page.goto('/quotation/pending');
    const row = page.locator(DATA_ROW).filter({ hasText: subject }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText('0/2');
    // 页内标记：断言后续更新发生在同一次文档生命周期内（未被整页刷新掩盖）
    await page.evaluate(() => {
      (window as unknown as { __docMark?: number }).__docMark = 1;
    });

    const portal = await context.newPage();
    await submitFromPortal(portal, invitationToken, '1280');
    await portal.close();

    await expect(row).toContainText('1/2', { timeout: 20000 });
    expect(await page.evaluate(() => (window as unknown as { __docMark?: number }).__docMark)).toBe(
      1,
    );
  });
});
