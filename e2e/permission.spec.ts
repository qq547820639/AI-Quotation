import { test, expect } from '@playwright/test';
import { login } from './helpers';

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
    // 登录采购人员 u-1（李明辉，无 SETTINGS_MANAGE 权限）。
    // 走共享 login() 而不是自己抄一遍：它额外断言"选项真的落地 + 接口返回 2xx"，
    // 自己抄的那份点了没落地也会一路静默到跳转断言。
    await login(page, '李明辉');

    // 尝试访问设置页
    await page.goto('/settings');

    // 断言不能重述自己的守卫：原来写成
    //   if (A || B) { expect(A || B).toBeTruthy() } else { …保存按钮不可见… }
    // 那条 expect 在 if 分支里恒真、永不失败，于是"被踢到 /login"也算通过——
    // 用例宣称的是"权限被拦"，实际测的是"页面确实跳了个地方"。
    // 收紧成：只接受两种产品语义上成立的结果（跳 403 / 留在设置页并被组件拦住），
    // 第三类落点（尤其 /login）必须判红。
    const url = page.url();
    const onForbidden = url.includes('/forbidden') || url.includes('/403');
    const stillOnSettings = url.includes('/settings');
    expect(
      onForbidden || stillOnSettings,
      `采购人员访问 /settings 只应「跳 403」或「留在设置页且无保存权」，实际停在 ${url}`,
    ).toBe(true);
    if (stillOnSettings) {
      // 仍在 /settings，验证保存按钮不可见（权限组件拦截）
      await expect(page.getByRole('button', { name: /保\s*存|Save/ })).not.toBeVisible({
        timeout: 5000,
      });
    }
  });

  test('管理员可正常访问设置页', async ({ page }) => {
    // 登录管理员 u-6（周大海），同样走共享 login()
    await login(page, '周大海');

    // 访问设置页
    await page.goto('/settings');

    // 验证设置页正常加载（表单元素可见）
    await expect(
      page.locator('.ant-form-item, .ant-switch, .ant-input-number').first(),
    ).toBeVisible({ timeout: 10000 });
    // 验证保存按钮可见
    await expect(page.getByRole('button', { name: /保\s*存|Save/ }).first()).toBeVisible({
      timeout: 5000,
    });
  });
});
