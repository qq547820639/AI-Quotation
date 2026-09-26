import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  login,
  DATA_ROW,
  tap,
  tick,
  createAndSendInquiry,
  submitQuoteViaPortal,
  chooseSupplierOnCompare,
  SUPPLIER_A,
} from './helpers';

/**
 * E2E：异常场景（Task 11）
 * 覆盖：请求超时 / 网络中断 / 后端 500 / 401 token 失效 / 403 / 409 数据冲突
 *       / 重复点击 / 部分批量失败 / 表单校验失败 / 页面刷新 / 浏览器返回
 *       / 保存失败后重试 / 不同权限访问同一功能
 *
 * 用 page.route 拦截指定 API 路由模拟异常，断言前端给出对应 i18n 文案（正则兼容中英文）。
 * 关键操作均直接断言，不跳过。
 */

const ADMIN = '周大海'; // u-6 管理员，具备全部权限（含 SUPPLIER_DISABLE / INQUIRY_CANCEL）
const LEAD = '王志强'; // u-2 采购主管，具备 INQUIRY_CONFIRM（定标）
const PURCHASER = '李明辉'; // u-1 采购人员，无 INQUIRY_APPROVE / SETTINGS_MANAGE
const SUP1 = '上海恒远工业设备有限公司'; // sup-1，初始 COOPERATING

/**
 * 从此刻起把页面上出现过的每一条 antd message 记进 `window.__toasts`（按 类型|文案 去重）。
 * 为什么必须这样取样：message 3 秒自动消失，而 `expect(locator).toHaveCount(0)` 这类
 * **会重试的负向断言**会在提示淡出之后才判 —— 变异档（不 await 就弹成功）实测就是这样被判成绿的
 * （`toHaveCount(0)` 先看到 1、等 3 秒元素消失后看到 0）。负向断言只能在"出现的那一刻"判，
 * 所以这里连续记录，事后对记录做断言。
 */
async function recordToasts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const seen = new Set<string>();
    const scan = (root: ParentNode | Element) => {
      root.querySelectorAll?.('.ant-message-custom-content').forEach((el) => {
        const cls = el.className || '';
        const type = cls.includes('error')
          ? 'error'
          : cls.includes('success')
            ? 'success'
            : cls.includes('warning')
              ? 'warning'
              : 'other';
        const key = `${type}|${(el.textContent || '').trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          w.__toasts.push(key);
        }
      });
    };
    new MutationObserver((ms) =>
      ms.forEach((m) =>
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scan(n as Element);
        }),
      ),
    ).observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  });
}

async function readToasts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts ?? []);
}

/** 定标按钮的可访问名（中英文都可能在 CI 语言下出现） */
const CONFIRM_AWARD = /确认定标|Confirm Award/;

/** 点击确认弹窗的确定按钮（antd Modal.confirm） */
async function confirmOk(page: Page) {
  // .first()：前一个确认弹窗退场动画未结束时同时存在两个按钮，
  // press()/click() 的严格模式会因命中 2 个元素而报错
  await tap(
    page
      .locator(
        '.ant-modal-confirm-btns .ant-btn-primary, .ant-modal-confirm-btns .ant-btn-dangerous',
      )
      .first(),
  );
}

/**
 * 打开供应商列表并对 sup-1 触发停用/启用。
 * 桌面表格里它是行内按钮；窄屏卡片把行操作收进了「更多 ▾」下拉
 * （antd Dropdown 默认 hover 触发），两条都是产品真实的用户路径。
 */
/** 对某一行触发「停用/启用」：桌面行内按钮与窄屏「更多 ▾」两条路径都覆盖 */
async function toggleSupplierRow(page: Page, row: Locator) {
  const inline = row.getByRole('button', { name: /停\s*用|禁\s*用|Disable/ });
  if (await inline.count()) {
    await tap(inline);
    return;
  }
  const more = row.getByRole('button', { name: /更\s*多|More/ });
  await expect(more).toBeVisible({ timeout: 5000 });
  // 触屏上下文里 rc-trigger 把 hover 触发改成了点击展开（实测 hover 不出弹层、click 出）
  await more.click();
  const item = page
    .locator('.ant-dropdown')
    .getByRole('menuitem', { name: /停\s*用|禁\s*用|Disable/ });
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
}

async function openSupplierPageAndToggle(page: Page) {
  await page.goto('/supplier');
  await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
  const row = page.locator(DATA_ROW).filter({ hasText: SUP1 });
  await expect(row).toBeVisible({ timeout: 5000 });
  await toggleSupplierRow(page, row);
}

test.describe('异常场景', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('请求超时：后端挂起，提示超时', async ({ page }) => {
    // 停用供应商的 PUT 请求挂起超过客户端 15s 超时
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await new Promise((r) => setTimeout(r, 16000));
        try {
          await route.abort();
        } catch {
          /* 客户端已超时，忽略 */
        }
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await page.goto('/supplier');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    const row = page.locator(DATA_ROW).filter({ hasText: SUP1 }).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await toggleSupplierRow(page, row);
    await confirmOk(page);

    // 请求被挂起 16s：Chromium 下由 axios 自身的 15s 超时给出"请求超时"（实测）；
    // WebKit（webkit / mobile-ios 项目）在 15s 之前就先中止了停滞连接，axios 看到的是
    // 网络错误 → 提示"网络错误，请检查连接"（实测）。两种都是"不悬挂、明确告知用户"，
    // 因此跨引擎断言"出现错误提示"，并在 Chromium 项目上继续钉住超时这一具体文案。
    const wording =
      test.info().project.name === 'chromium'
        ? /请求超时|Request timeout/
        : /请求超时|网络错误|Request timeout|Network error/i;
    await expect(page.locator('.ant-message-error').first()).toContainText(wording, {
      timeout: 25000,
    });
    // 失败的停用必须回滚：合作状态标签仍是"合作中"（若乐观更新未回滚会变成"停用"）
    await expect(row.locator('.ant-tag').filter({ hasText: /合作中|Cooperating/ })).toBeVisible();
    await expect(row.locator('.ant-tag').filter({ hasText: /^停用$/ })).toHaveCount(0);
  });

  test('网络中断：abort 引发网络错误提示', async ({ page }) => {
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    await expect(page.locator('.ant-message')).toContainText(/网络错误|Network error/, {
      timeout: 10000,
    });
  });

  test('后端 500：提示服务器错误', async ({ page }) => {
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'internal_error' }),
        });
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    await expect(page.locator('.ant-message')).toContainText(/服务器错误|Server error/, {
      timeout: 10000,
    });
  });

  test('401 token 失效：清理会话并跳转登录', async ({ page }) => {
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'unauthorized' }),
        });
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    // 401 触发会话清理并跳转 /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('403 无权限：提示无权限访问', async ({ page }) => {
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'forbidden' }),
        });
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    await expect(page.locator('.ant-message')).toContainText(/无权限|Access denied|forbidden/, {
      timeout: 10000,
    });
  });

  test('409 数据冲突：提示数据已被他人修改', async ({ page }) => {
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'conflict' }),
        });
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    await expect(page.locator('.ant-message')).toContainText(/数据已被他人修改|冲突|conflict/, {
      timeout: 10000,
    });
  });

  test('报价清单加载失败（500）：不得声称「暂无已提交报价」（R33）', async ({ page }) => {
    await login(page, LEAD);
    const { inquiryId } = await createAndSendInquiry(page);
    await submitQuoteViaPortal(page, inquiryId, 'sup-2', '6000');
    await submitQuoteViaPortal(page, inquiryId, 'sup-5', '6100');

    // 用 500 而不是 401 注入：401 会走"清会话 + 跳登录"那条既有路径（另有常驻用例钉着），
    // 根本到不了比价页。500 才是"加载失败但会话仍在"的形状。
    // 生产形态 MOCK_FALLBACK_ENABLED=false，store 拿不到数据只能留空。
    await page.route('**/api/quotations', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'boom' }),
      });
    });
    await page.goto(`/quotation/compare/${inquiryId}`);

    // 产品缺陷面：加载失败不是"没有数据"。旧实现会把 loaded 置真而数据为空，
    // 于是页面断言「该询价单暂无已提交报价」——把一次同步失败说成业务事实。
    await expect(page.locator('.ant-empty-description')).not.toContainText(
      /暂无已提交报价|No submitted quotation/,
      { timeout: 15000 },
    );
    // 必须给出"加载失败/未同步"这一类可恢复提示，而不是空态
    await expect(
      page
        .locator('.ant-card, .ant-result, .ant-alert')
        .filter({ hasText: /加载失败|未同步|重试|离线|retry|failed/i }),
    )
      .first()
      .toBeVisible({ timeout: 15000 });
  });

  test('定标接口 500：只报失败，不得伪造「已确认定标」（R32）', async ({ page }) => {
    await login(page, LEAD);

    const { inquiryId } = await createAndSendInquiry(page);
    // 单价 100 × 数量 10 = 1000，低于审批阈值 50000 → 不必走审批即可定标
    await submitQuoteViaPortal(page, inquiryId, 'sup-2', '100');
    await submitQuoteViaPortal(page, inquiryId, 'sup-5', '110');
    await page.goto(`/quotation/compare/${inquiryId}`);
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    await chooseSupplierOnCompare(page, SUPPLIER_A);

    await page.route('**/api/inquiries/*/confirm', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'boom' }),
      });
    });

    const confirmBtn = page.getByRole('button', { name: CONFIRM_AWARD });
    await expect(confirmBtn).toBeVisible({ timeout: 10000 });

    // 先装记录器再点：否则"弹过又自动消失"的那一条抓不到（见 recordToasts 说明）
    await recordToasts(page);

    const confirmRes = page.waitForResponse(
      (res) => new URL(res.url()).pathname.endsWith('/confirm'),
      { timeout: 15000 },
    );
    await confirmBtn.click();
    await confirmOk(page);
    // 效力断言：请求确实发出并被拦成 500（与"根本没发请求"的 R28 形态区分开）
    expect((await confirmRes).status()).toBe(500);

    // 两条提示都要给足出现时间（旧实现的成功提示是点击瞬间就弹的）
    await page.waitForTimeout(1200);
    const toasts = await readToasts(page);
    // 牙齿：旧实现不 await 写操作结果就弹成功提示，接口 500 时用户看到「已确认定标」
    expect(
      toasts.filter((t) => t.startsWith('success|') && /已确认定标|Award confirmed/.test(t)),
      `定标失败时不得出现成功提示，实际抓到：${JSON.stringify(toasts)}`,
    ).toEqual([]);
    // 注：`parseApiError` 把后端 detail 原样当 message，所以失败提示内容是 "boom" 而非通用文案
    expect(
      toasts.some((t) => t.startsWith('error|')),
      `必须给出失败提示，实际抓到：${JSON.stringify(toasts)}`,
    ).toBe(true);

    // 状态没被改动：重新加载后仍可定标（服务端仍是「报价已完成」）
    await page.reload();
    await expect(page.getByRole('button', { name: CONFIRM_AWARD })).toBeVisible({
      timeout: 15000,
    });
  });

  test('重复点击：连点提交按钮不会重复提交', async ({ page }) => {
    let putCount = 0;
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        putCount++;
        await new Promise((r) => setTimeout(r, 800));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await page.goto('/supplier');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
    const row = page.locator(DATA_ROW).filter({ hasText: SUP1 });
    await toggleSupplierRow(page, row);
    await confirmOk(page);

    // 请求未完成时再次点击确定，应被 pendingOps 拦截（不发起第二次请求）
    await page
      .locator(
        '.ant-modal-confirm-btns .ant-btn-primary, .ant-modal-confirm-btns .ant-btn-dangerous',
      )
      .click({ force: true, timeout: 500 })
      .catch(() => {});
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    expect(putCount).toBe(1);
  });

  test('部分批量操作失败：提示成功/失败条数', async ({ page, isMobile }) => {
    // 窄屏供应商卡片只给单条操作（无行多选框），批量停用整条工具栏按
    // selectedRowKeys.length > 0 条件渲染，因此移动端没有可测的批量入口。
    test.skip(isMobile, '窄屏布局不提供批量选择，本项只在桌面布局可测');
    // sup-1 成功，sup-2 失败（500）
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        const url = route.request().url();
        const fail = url.includes('sup-2');
        await route.fulfill({
          status: fail ? 500 : 200,
          contentType: 'application/json',
          body: fail ? JSON.stringify({ detail: 'boom' }) : '{}',
        });
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await page.goto('/supplier');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });

    // 勾选 sup-1 与 sup-2 两行
    await tick(page.locator(DATA_ROW).filter({ hasText: SUP1 }).locator('.ant-checkbox-input'));
    await tick(
      page
        .locator(DATA_ROW)
        .filter({ hasText: '苏州联创自动化科技有限公司' })
        .locator('.ant-checkbox-input'),
    );

    await page.getByRole('button', { name: /批量停用|Batch Disable/ }).click();
    await confirmOk(page);

    // 部分成功：提示成功 1 家 + 失败 1 家（而非笼统"全部成功"）
    await expect(page.locator('.ant-message')).toContainText(
      /已成功处理 1 家供应商|Processed 1 supplier/,
      { timeout: 10000 },
    );
    await expect(page.locator('.ant-message')).toContainText(
      /有 1 家供应商操作失败|Failed to process 1 supplier/,
      { timeout: 10000 },
    );
  });

  test('表单校验失败：必填项为空给出校验错误', async ({ page }) => {
    await login(page, PURCHASER);
    await page.goto('/inquiry/create');
    await expect(page.locator('.ant-steps')).toBeVisible({ timeout: 10000 });

    // 清空主题（必填）后点击下一步，应出现校验错误
    const subject = page.locator('#subject');
    await subject.fill('');
    await tap(page.getByRole('button', { name: /下一步|Next/ }));

    await expect(page.locator('.ant-form-item-explain-error').first()).toContainText(
      /请输入询价主题|Subject/,
      {
        timeout: 5000,
      },
    );
  });

  test('页面刷新：刷新后仍保持登录态且数据可加载', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/supplier');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    // 刷新后未跳回登录，且供应商列表仍可加载
    await expect(page).toHaveURL(/\/supplier/);
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
  });

  test('浏览器返回：从详情返回列表，前一页状态保留', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/inquiry/list');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });

    // 进入第一行详情
    // 详情通过行内「详情」按钮进入（列表行本身不可点击）
    await page
      .locator(DATA_ROW)
      .first()
      .getByRole('button', { name: /详\s*情|Detail/ })
      .click();
    await expect(page).toHaveURL(/\/inquiry\/detail\//);
    await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });

    // 浏览器返回，回到列表页
    await page.goBack();
    await expect(page).toHaveURL(/\/inquiry\/list/);
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 10000 });
  });

  test('保存失败后重试：首次失败提示，重试成功', async ({ page }) => {
    let first = true;
    await page.route('**/api/suppliers/*', async (route) => {
      if (route.request().method() === 'PUT') {
        if (first) {
          first = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'internal_error' }),
          });
        } else {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
      } else {
        await route.continue();
      }
    });

    await login(page, ADMIN);
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    // 首次失败：提示服务器错误
    await expect(page.locator('.ant-message')).toContainText(/服务器错误|Server error/, {
      timeout: 10000,
    });

    // 重试成功：再次停用（乐观更新已回滚，按钮仍为"停用"）
    const row = page.locator(DATA_ROW).filter({ hasText: SUP1 });
    await toggleSupplierRow(page, row);
    await confirmOk(page);
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 10000 });
  });

  test('不同权限访问同一功能：采购人员访问审批页被拦截', async ({ page }) => {
    await login(page, PURCHASER);

    // 采购人员无 INQUIRY_APPROVE，访问 /approval 应被 RequirePermission 拦截到 /403
    await page.goto('/approval');
    await expect(page).toHaveURL(/\/403|forbidden/, { timeout: 10000 });
  });
});
