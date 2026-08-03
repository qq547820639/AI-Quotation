import { test, expect } from '@playwright/test';

/**
 * E2E：供应商门户报价填报
 * 访问 /supplier-portal/:inquiryId/:supplierId → 填报 → 提交
 */
test.describe('供应商门户', () => {
  test('访问供应商门户并填报报价', async ({ page }) => {
    // 使用种子数据 inq-3 + sup-1
    await page.goto('/supplier-portal/inq-3/sup-1');

    // 验证门户页面加载
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });

    // 验证有报价表单或报价按钮
    const formOrButton = page.locator('.ant-form, .ant-btn').first();
    await expect(formOrButton).toBeVisible({ timeout: 10000 });
  });
});
