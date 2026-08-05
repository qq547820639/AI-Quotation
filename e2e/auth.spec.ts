import { test, expect } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

/**
 * E2E：认证流程（G4 重写：消除恒真式，强化断言）
 * 1. 登录采购人员 → 验证工作台统计卡片可见
 * 2. 登录后刷新页面 → 验证登录态持久化
 */
test.describe('认证流程', () => {
  test('登录采购人员并验证工作台数据', async ({ page }) => {
    await page.goto('/login');

    // 选择用户 u-1（李明辉，采购人员）
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '李明辉' }).click();

    // 输入密码（演示环境任意值）
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);

    // 点击登录
    await page.getByRole('button', { name: /登录|Login/ }).click();

    // 验证跳转到工作台
    await expect(page).toHaveURL(/\/dashboard/);

    // 验证工作台统计卡片可见（具体断言，非恒真式）
    await expect(page.locator('.ant-statistic').first()).toBeVisible({ timeout: 10000 });
    const statCount = await page.locator('.ant-statistic').count();
    expect(statCount).toBeGreaterThan(0);
  });

  test('登录态刷新后持久化', async ({ page }) => {
    // 登录管理员
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 刷新页面，验证仍保持登录态（未跳回 /login）
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    // 验证侧边栏菜单存在（登录态标志）
    await expect(page.locator('.ant-menu').first()).toBeVisible({ timeout: 10000 });
  });
});
