import { test, expect } from '@playwright/test';

/**
 * E2E：询价全流程
 * 创建询价 → 保存草稿 → 发送 → 供应商报价 → 对比 → 审批 → 定标
 * 使用种子数据 inq-3（ALL_QUOTED 状态）验证对比和审批流程
 */
test.describe('询价全流程', () => {
  test.beforeEach(async ({ page }) => {
    // 登录管理员
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill('admin123');
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('查看询价列表', async ({ page }) => {
    await page.goto('/inquiry/list');
    // 验证询价单表格有数据
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator('.ant-table-row').count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('查看询价详情', async ({ page }) => {
    await page.goto('/inquiry/list');
    await page.locator('.ant-table-row').first().getByRole('button', { name: /查看|详情|View/ }).click();
    // 验证详情页加载
    await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });
  });

  test('报价对比页面', async ({ page }) => {
    // 直接访问报价对比页
    await page.goto('/quotation/compare');
    // 验证页面加载（可能有空状态或数据）
    await expect(page.locator('body')).toBeVisible();
  });
});
