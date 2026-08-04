import { test, expect } from '@playwright/test';

/**
 * E2E：询价全流程（G4 重写：强化断言 + 新增创建页用例）
 * 1. 查看询价列表 → 断言表格有数据
 * 2. 查看询价详情 → 断言描述列表可见
 * 3. 报价对比页 → 断言页面加载（表格或空状态）
 * 4. 创建询价单页面 → 断言步骤条与操作按钮可见
 * 5. 列表状态标签 → 断言状态 Tag 可见
 */
test.describe('询价全流程', () => {
  test.beforeEach(async ({ page }) => {
    // 登录管理员
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill('123456');
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('查看询价列表有数据', async ({ page }) => {
    await page.goto('/inquiry/list');
    // 验证询价单表格有数据
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator('.ant-table-row').count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('查看询价详情', async ({ page }) => {
    await page.goto('/inquiry/list');
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
    // 点击第一行的查看/详情按钮
    const actionBtn = page
      .locator('.ant-table-row')
      .first()
      .getByRole('button', { name: /查看|详情|View/ });
    if (await actionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await actionBtn.click();
    } else {
      // 若无按钮，点击行本身跳转
      await page.locator('.ant-table-row').first().click();
    }
    // 验证详情页加载（描述列表可见）
    await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });
  });

  test('报价对比页面加载', async ({ page }) => {
    await page.goto('/quotation/compare');
    // 验证页面加载：有表格或有空状态提示（二选一，具体断言）
    const hasTable = page.locator('.ant-table');
    const hasEmpty = page.locator('.ant-empty');
    await expect(hasTable.or(hasEmpty).first()).toBeVisible({ timeout: 10000 });
  });

  test('创建询价单页面步骤与按钮', async ({ page }) => {
    await page.goto('/inquiry/create');
    // 验证步骤条可见
    await expect(page.locator('.ant-steps')).toBeVisible({ timeout: 10000 });
    // 验证"保存草稿"按钮存在
    await expect(page.getByRole('button', { name: /草稿|Draft|保存/ })).toBeVisible({
      timeout: 5000,
    });
    // 验证"下一步"或"发送"按钮存在
    const nextBtn = page.getByRole('button', { name: /下一步|Next|发送|Send/ });
    await expect(nextBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('列表状态标签可见', async ({ page }) => {
    await page.goto('/inquiry/list');
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
    // 验证每行有状态 Tag
    await expect(page.locator('.ant-table-row .ant-tag').first()).toBeVisible({ timeout: 5000 });
  });
});
