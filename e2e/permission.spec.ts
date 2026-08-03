import { test, expect } from '@playwright/test';

/**
 * E2E：RBAC 权限控制
 * u-1（采购人员）访问 /settings → 403 提示
 * u-6（管理员）访问 /settings → 正常加载
 */
test.describe('RBAC 权限', () => {
  test('采购人员访问设置页受限', async ({ page }) => {
    // 登录采购人员 u-1
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '李明辉' }).click();
    await page.locator('input[type="password"]').fill('test123');
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 尝试访问设置页
    await page.goto('/settings');

    // 验证：要么跳转到 403 页面，要么显示无权限提示
    const currentUrl = page.url();
    const hasForbidden = currentUrl.includes('/forbidden') || currentUrl.includes('/403');
    const hasErrorMessage = await page.locator('text=/(?:无权限|forbidden|403)/i').isVisible({ timeout: 3000 }).catch(() => false);

    // 至少有一种权限限制表现
    expect(hasForbidden || hasErrorMessage || !currentUrl.includes('/settings')).toBeTruthy();
  });

  test('管理员可正常访问设置页', async ({ page }) => {
    // 登录管理员 u-6
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill('admin123');
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 访问设置页
    await page.goto('/settings');

    // 验证设置页正常加载（有表单元素）
    await expect(page.locator('.ant-form-item, .ant-switch, .ant-input-number').first()).toBeVisible({ timeout: 10000 });
  });
});
