import { test, expect, type Page } from '@playwright/test';

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
const PURCHASER = '李明辉'; // u-1 采购人员，无 INQUIRY_APPROVE / SETTINGS_MANAGE
const SUP1 = '上海恒远工业设备有限公司'; // sup-1，初始 COOPERATING

/** 登录（选中用户 + 任意密码） */
async function login(page: Page, name: string, password = '123456') {
  await page.goto('/login');
  await page.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: name }).click();
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /登录|Login/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** 点击确认弹窗的确定按钮（antd Modal.confirm） */
async function confirmOk(page: Page) {
  await page.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
}

/** 打开供应商列表并点击第一行（sup-1）的停用/启用按钮 */
async function openSupplierPageAndToggle(page: Page) {
  await page.goto('/supplier');
  await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
  const row = page.locator('.ant-table-row').filter({ hasText: SUP1 });
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.getByRole('button', { name: /停用|禁用|Disable/ }).click();
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
    await openSupplierPageAndToggle(page);
    await confirmOk(page);

    // 客户端 axios 15s 超时后提示"请求超时"
    await expect(page.locator('.ant-message')).toContainText(/请求超时|Request timeout/, {
      timeout: 20000,
    });
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
          body: JSON.stringify({ detail: 'boom' }),
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
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
    const row = page.locator('.ant-table-row').filter({ hasText: SUP1 });
    await row.getByRole('button', { name: /停用|禁用|Disable/ }).click();
    await confirmOk(page);

    // 请求未完成时再次点击确定，应被 pendingOps 拦截（不发起第二次请求）
    await page
      .locator('.ant-modal-confirm-btns .ant-btn-primary')
      .click({ force: true, timeout: 500 })
      .catch(() => {});
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    expect(putCount).toBe(1);
  });

  test('部分批量操作失败：提示成功/失败条数', async ({ page }) => {
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
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });

    // 勾选 sup-1 与 sup-2 两行
    await page
      .locator('.ant-table-row')
      .filter({ hasText: SUP1 })
      .locator('.ant-checkbox-input')
      .click();
    await page
      .locator('.ant-table-row')
      .filter({ hasText: '苏州联创自动化科技有限公司' })
      .locator('.ant-checkbox-input')
      .click();

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
    await page.getByRole('button', { name: /下一步|Next/ }).click();

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
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });

    await page.reload();
    // 刷新后未跳回登录，且供应商列表仍可加载
    await expect(page).toHaveURL(/\/supplier/);
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
  });

  test('浏览器返回：从详情返回列表，前一页状态保留', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/inquiry/list');
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });

    // 进入第一行详情
    await page.locator('.ant-table-row').first().click();
    await expect(page).toHaveURL(/\/inquiry\/detail\//);
    await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });

    // 浏览器返回，回到列表页
    await page.goBack();
    await expect(page).toHaveURL(/\/inquiry\/list/);
    await expect(page.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
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
            body: JSON.stringify({ detail: 'boom' }),
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
    const row = page.locator('.ant-table-row').filter({ hasText: SUP1 });
    await row.getByRole('button', { name: /停用|禁用|Disable/ }).click();
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
