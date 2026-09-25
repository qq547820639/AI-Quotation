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
    await page.getByRole('button', { name: /登\s*录|Login/ }).click();

    // 验证跳转到工作台
    await expect(page).toHaveURL(/\/dashboard/);

    // 验证统计卡渲染（工作台用自定义 StatCard，不是 antd Statistic，按标题文本断言）
    await expect(page.getByText('本月询价单')).toBeVisible({ timeout: 10000 });
    expect(await page.getByText('询价中').count()).toBeGreaterThan(0);
    // 验证种子数据真的渲染进了页面：store 在首帧之后才拿到数据时，
    // 页面若用不订阅数据的派生写法会永远显示空态（登录后列表恒为空的回归点）
    await expect(page.getByText('暂无询价单')).toHaveCount(0);
    await expect(page.locator('.ant-card').first()).toBeVisible();
  });

  test('登录态刷新后持久化', async ({ page }) => {
    // 登录管理员
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /登\s*录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 刷新页面，验证仍保持登录态（未跳回 /login）
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    // 验证登录后专属的布局外壳存在（登录态标志）。
    // 窄屏（mobile-* 项目）下 Sider 折叠为抽屉，触发器是 .anticon-menu-unfold，
    // 因此断言"侧栏菜单或抽屉触发器"，两者都只在已登录布局里出现。
    await expect(page.locator('.ant-menu, .anticon-menu-unfold').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
