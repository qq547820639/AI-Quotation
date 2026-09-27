import { test, expect } from '@playwright/test';
import { login, createAndSendInquiry, submitQuoteViaPortal, DATA_ROW, tap } from './helpers';

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
    await login(page, '周大海');
  });

  test('查看询价列表有数据', async ({ page }) => {
    // R65 续三：先等"喂这张表的读"落地（每次 goto 是整文档加载，App 挂载即引导 GET /api/inquiries，
    // 见 src/App.tsx:29 → src/store/useInquiryStore.ts:175），再断渲染。
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/inquiries/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto('/inquiry/list'),
    ]);
    // 验证询价单表格有数据
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator(DATA_ROW).count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('查看询价详情', async ({ page }) => {
    // R65 续三：列表这一跳先等 GET /api/inquiries 落地，行渲染断言原样留着——
    // 这样它只在"数据到了却渲染不出行"时红，不再赌"读+渲染挤不挤得进 10 s"。
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/inquiries/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto('/inquiry/list'),
    ]);
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    // 点击第一行的查看/详情按钮
    // 桌面表格给行内「查看」按钮，移动端卡片视图只有「更多」下拉里的同名项，两种入口都算通过。
    // R45 把这条留成就地豁免而不是关档：新写的用例若没有这种已核实的布局差异，仍会被规则拦住。
    const actionBtn = page
      .locator(DATA_ROW)
      .first()
      .getByRole('button', { name: /查\s*看|详\s*情|View/ });
    // eslint-disable-next-line playwright/no-conditional-in-test
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

    // R65 续三：卡列表由 GET /api/inquiries 喂（inquiries.length === 0 时整页是 Empty，
    // 见 src/pages/quotation/compare/CompareInquiryPicker.tsx:21），先等这条读落地再断卡片渲染。
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/inquiries/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto('/quotation/compare'),
    ]);
    const card = page.locator('.ant-card[role="button"]').filter({ hasText: subject }).first();
    await expect(card).toBeVisible({ timeout: 15000 });
    // 卡片自带 role="button" + Enter 处理；用键盘避开弹层/浮层的命中测试干扰
    await tap(card);
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
    // R65 续三：行与行内的状态 Tag 同源于这份列表数据，先等 GET /api/inquiries 落地，
    // 后面两条渲染断言（含那条不带显式超时的 `.ant-tag`）原样不动。
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/inquiries/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto('/inquiry/list'),
    ]);
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    // 验证每行有状态 Tag
    await expect(page.locator(`${DATA_ROW} .ant-tag`).first()).toBeVisible();
  });
});
