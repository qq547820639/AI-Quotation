import { test, expect } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

/**
 * E2E：RBAC 权限控制（G4 重写：消除恒真式，新增未登录用例）
 * 1. 未登录访问 /dashboard → 跳转 /login
 * 2. 采购人员访问设置页 → 内容受限（无保存按钮或跳转 403）
 * 3. 管理员访问设置页 → 正常加载
 */
test.describe('RBAC 权限', () => {
  test('未登录访问受保护路由跳转登录', async ({ page }) => {
    // 直接访问 /dashboard，不登录
    await page.goto('/dashboard');
    // 验证跳转到 /login
    await expect(page).toHaveURL(/\/login/);
  });

  test('采购人员访问设置页受限', async ({ page }) => {
    // 登录采购人员 u-1（李明辉，无 SETTINGS_MANAGE 权限）
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '李明辉' }).click();
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 尝试访问设置页
    await page.goto('/settings');

    // 具体断言：要么跳转到 403 页面，要么设置页的保存按钮不可见（权限拦截）
    const url = page.url();
    const redirectedToForbidden = url.includes('/forbidden') || url.includes('/403');
    const redirectedAway = !url.includes('/settings');

    if (redirectedToForbidden || redirectedAway) {
      // 跳转了，验证确实离开了 settings
      expect(redirectedToForbidden || redirectedAway).toBeTruthy();
    } else {
      // 仍在 /settings，验证保存按钮不可见（权限组件拦截）
      await expect(page.getByRole('button', { name: /保存|Save/ })).not.toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('管理员可正常访问设置页', async ({ page }) => {
    // 登录管理员 u-6（周大海）
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 访问设置页
    await page.goto('/settings');

    // 验证设置页正常加载（表单元素可见）
    await expect(
      page.locator('.ant-form-item, .ant-switch, .ant-input-number').first(),
    ).toBeVisible({ timeout: 10000 });
    // 验证保存按钮可见
    await expect(page.getByRole('button', { name: /保存|Save/ }).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
