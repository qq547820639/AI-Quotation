import { test, expect } from '@playwright/test';

/**
 * E2E：国际化与主题切换（G4 重写：消除空跑与恒真式，具体文案断言）
 * 1. 切换 English → 验证菜单文案变为英文
 * 2. 切换暗色主题 → 验证 data-theme 变化 → 刷新验证持久化
 */
test.describe('i18n 与主题', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.locator('.ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: '周大海' }).click();
    await page.locator('input[type="password"]').fill('admin123');
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('切换语言为 English 并验证文案', async ({ page }) => {
    // 找到语言切换按钮（GlobalOutlined 图标，含"中"或"EN"文字）
    const langBtn = page.locator('button:has(.anticon-global)').first();
    await expect(langBtn).toBeVisible({ timeout: 5000 });

    // 点击展开语言菜单
    await langBtn.click();

    // 点击 English 选项
    const englishOption = page.locator('.ant-dropdown-menu-item').filter({ hasText: /English/ });
    await expect(englishOption).toBeVisible({ timeout: 3000 });
    await englishOption.click();

    // 验证页面文案变化：菜单或标题出现英文
    await expect(page.locator('body')).toContainText(/Dashboard|Inquiry|Supplier/i, { timeout: 5000 });

    // 切回中文（恢复默认状态）
    await langBtn.click();
    const chineseOption = page.locator('.ant-dropdown-menu-item').filter({ hasText: /中文/ });
    await chineseOption.click();
  });

  test('切换暗色主题并验证持久化', async ({ page }) => {
    // 找到主题切换按钮（aria-label 含 switchToLight/switchToDark）
    const themeBtn = page.locator('button[aria-label*="switchTo"], button:has(.anticon-moon), button:has(.anticon-sun)').first();
    await expect(themeBtn).toBeVisible({ timeout: 5000 });

    // 记录切换前的 data-theme 或 body class
    const beforeTheme = await page.evaluate(() => {
      const dt = document.documentElement.getAttribute('data-theme');
      const bc = document.body.className;
      const ds = document.documentElement.getAttribute('data-theme');
      // 也检查 antd 暗色算法标志（color scheme）
      const cs = document.documentElement.style.colorScheme || getComputedStyle(document.body).colorScheme;
      return JSON.stringify({ dt, bc, ds, cs });
    });

    // 点击切换主题
    await themeBtn.click();
    await page.waitForTimeout(500);

    // 验证主题发生变化（具体断言，非恒真式）
    const afterTheme = await page.evaluate(() => {
      const dt = document.documentElement.getAttribute('data-theme');
      const bc = document.body.className;
      const ds = document.documentElement.getAttribute('data-theme');
      const cs = document.documentElement.style.colorScheme || getComputedStyle(document.body).colorScheme;
      return JSON.stringify({ dt, bc, ds, cs });
    });
    expect(afterTheme).not.toBe(beforeTheme);

    // 刷新验证持久化
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);

    const persistedTheme = await page.evaluate(() => {
      const dt = document.documentElement.getAttribute('data-theme');
      const bc = document.body.className;
      const ds = document.documentElement.getAttribute('data-theme');
      const cs = document.documentElement.style.colorScheme || getComputedStyle(document.body).colorScheme;
      return JSON.stringify({ dt, bc, ds, cs });
    });
    // 持久化后的主题应与切换后一致
    expect(persistedTheme).toBe(afterTheme);

    // 切回亮色（恢复默认）
    await themeBtn.click();
  });
});
