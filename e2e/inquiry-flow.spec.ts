import { test, expect } from '@playwright/test';
import { DEMO_PASSWORD, createAndSendInquiry, submitQuoteViaPortal, DATA_ROW } from './helpers';

/**
 * E2E：询价全流程（G4 重写：强化断言 + 新增创建页用例）
 * 1. 查看询价列表 → 断言表格有数据
 * 2. 查看询价详情 → 断言描述列表可见
 * 3. 报价对比页（无 id）→ 自建"已有一家提交"的询价，断言卡片列出并可进入对比视图
 * 4. 创建询价单页面 → 断言步骤条与操作按钮可见
 * 5. 列表状态标签 → 断言状态 Tag 可见
 */
test.describe('询价全流程', () => {
  test.beforeEach(async ({ page }) => {
    // 登录管理员
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /登\s*录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('查看询价列表有数据', async ({ page }) => {
    await page.goto('/inquiry/list');
    // 验证询价单表格有数据
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator(DATA_ROW).count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('查看询价详情', async ({ page }) => {
    await page.goto('/inquiry/list');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    // 点击第一行的查看/详情按钮
    const actionBtn = page
      .locator(DATA_ROW)
      .first()
      .getByRole('button', { name: /查\s*看|详\s*情|View/ });
    if (await actionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await actionBtn.click();
    } else {
      // 若无按钮，点击行本身跳转
      await page.locator(DATA_ROW).first().click();
    }
    // 验证详情页加载（描述列表可见）
    await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });
  });

  test('报价对比页（无 id）列出可对比询价单并可进入对比视图', async ({ page }) => {
    // 可对比的判定条件是"该询价至少有一家已提交报价"，因此先造出这条数据，
    // 不再依赖环境里恰好存在/恰好不存在满足条件的询价单（此前该用例正是这样偶发漂移）。
    const { inquiryId, subject } = await createAndSendInquiry(page);
    await submitQuoteViaPortal(page, inquiryId, 'sup-2', '100');

    await page.goto('/quotation/compare');
    const card = page.locator('.ant-card[role="button"]').filter({ hasText: subject }).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/quotation/compare/${inquiryId}`));
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 15000 });
  });

  test('创建询价单页面步骤与按钮', async ({ page }) => {
    await page.goto('/inquiry/create');
    // 验证步骤条可见
    await expect(page.locator('.ant-steps')).toBeVisible({ timeout: 10000 });
    // 验证"保存草稿"按钮存在
    await expect(page.getByRole('button', { name: /保存草稿|Draft/ })).toBeVisible({
      timeout: 5000,
    });
    // 验证"下一步"或"发送"按钮存在
    const nextBtn = page.getByRole('button', { name: /下一步|Next|发\s*送|Send/ });
    await expect(nextBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('列表状态标签可见', async ({ page }) => {
    await page.goto('/inquiry/list');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    // 验证每行有状态 Tag
    await expect(page.locator(`${DATA_ROW} .ant-tag`).first()).toBeVisible();
  });
});
