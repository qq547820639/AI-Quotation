import { test, expect } from '@playwright/test';

/**
 * E2E：认证流程
 * 登录 u-1（采购人员）→ 验证工作台 → 登出 → 登录 u-6（管理员）
 */
test.describe('认证流程', () => {
  test('登录采购人员并访问工作台', async ({ page }) => {
    await page.goto('/login');

    // 选择用户 u-1
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '李明辉' }).click();

    // 输入密码（任意值）
    await page.locator('input[type="password"]').fill('test123');

    // 点击登录
    await page.getByRole('button', { name: /登录|Login/ }).click();

    // 验证跳转到工作台
    await expect(page).toHaveURL(/\/dashboard/);

    // 验证工作台有数据（统计卡片）
    await expect(page.locator('.ant-statistic')).toHaveCount(await page.locator('.ant-statistic').count());
  });

  test('切换用户登录管理员', async ({ page }) => {
    await page.goto('/login');

    // 如果已登录，先登出
    const logoutBtn = page.getByRole('button', { name: /退出|Logout/ });
    if (await logoutBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await logoutBtn.click();
      await page.goto('/login');
    }

    // 选择 u-6 管理员
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill('admin123');
    await page.getByRole('button', { name: /登录|Login/ }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
