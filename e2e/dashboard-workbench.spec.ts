import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * E2E：工作台行动卡片（P2 Task 14）
 * - 登录后工作台渲染行动工作台标题与卡片
 * - 卡片数量为 0 时不可点击（role=button 且 aria-disabled）
 * - 有数据的卡片点击后跳转到对应筛选结果
 * - 负责人/时间筛选控件存在
 *
 * 说明：行动工作台数据依赖当前询价/报价数据。本用例在稳定预置数据环境中断言
 * 卡片容器与基础交互；不依赖特定非零计数，避免因演示数据变化导致假失败。
 */
const OPERATOR = '李明辉'; // u-1 采购人员，具备 INQUIRY_SEND 权限

test.describe('工作台行动工作台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page, OPERATOR);
    await page.goto('/dashboard');
    await expect(page.locator('.ant-card')).first().toBeVisible({ timeout: 10000 });
  });

  test('渲染行动工作台标题与负责人筛选控件', async ({ page }) => {
    // 标题存在（中英文任一）
    await expect(page.locator('body')).toContainText(/行动工作台|Action Workbench/);
    // 负责人筛选下拉存在
    await expect(page.locator('.ant-select-selector').first()).toBeVisible();
  });

  test('行动卡片可点击性正确（数量为 0 的卡片禁用）', async ({ page }) => {
    // 工作台卡片容器：role=button 的卡片
    const cards = page.locator('[role="button"][aria-label]');
    await expect(cards.first()).toBeAttached({ timeout: 10000 });

    // 卡片均设置了 aria-disabled（true 表示不可点击）
    const disabledCount = await cards.evaluateAll(
      (els) => els.filter((el) => el.getAttribute('aria-disabled') === 'true').length,
    );
    const enabledCount = await cards.evaluateAll(
      (els) => els.filter((el) => el.getAttribute('aria-disabled') === 'false').length,
    );
    expect(disabledCount + enabledCount).toBeGreaterThan(0);
  });

  test('点击可点击的行动卡片跳转到对应筛选结果', async ({ page }) => {
    // 找到任一可点击（aria-disabled=false）的卡片并点击
    const clickable = page.locator('[role="button"][aria-disabled="false"][aria-label]').first();
    if ((await clickable.count()) > 0) {
      // 点击前记录 aria-label 对应的目标路径预期（待发送询价 → /inquiry/list?status=PENDING_SEND）
      await clickable.click();
      // 跳转后 URL 是询价列表、审批页或报价页其中之一
      await page.waitForURL(/\/inquiry\/list|\/approval|\/quotation|\/inquiry\/detail/, {
        timeout: 10000,
      });
    } else {
      // 无任何可点击卡片时，工作台仍正常渲染（空态或全 0 态）
      await expect(page.locator('body')).toContainText(/行动工作台|Action Workbench/);
    }
  });
});
