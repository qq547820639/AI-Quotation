import { test, expect } from '@playwright/test';

/**
 * E2E：供应商门户报价填报（关键步骤直接断言，不 `if visible` 跳过）
 * 访问 /supplier-portal/:inquiryId/:supplierId
 * - 报价表单必须可见 → 填写单价/交货期 → 正式提交 → 确认 → 断言成功
 * beforeEach 清空 localStorage，保证种子询价 inq-3/sup-1 处于未报价状态（表单必然可见，而非已提交成功页）。
 */
test.describe('供应商门户', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('访问供应商门户并填报报价', async ({ page }) => {
    await page.goto('/supplier-portal/inq-3/sup-1');

    // 关键步骤1：报价表单单价输入框必须可见（否则直接失败，不跳过）
    const unitPriceInput = page.locator('.ant-table .ant-input-number').first();
    await expect(unitPriceInput).toBeVisible({ timeout: 10000 });

    // 关键步骤2：填写单价
    await unitPriceInput.click();
    await unitPriceInput.fill('100');

    // 关键步骤3：填写交货期（第3个 InputNumber）
    const deliveryInput = page.locator('.ant-table .ant-input-number').nth(2);
    await expect(deliveryInput).toBeVisible({ timeout: 5000 });
    await deliveryInput.click();
    await deliveryInput.fill('7');

    // 关键步骤4：正式提交报价
    const submitBtn = page.getByRole('button', { name: /正式提交|Submit/ });
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // 关键步骤5：确认弹窗
    const confirmBtn = page.locator('.ant-modal-confirm-btns .ant-btn-primary');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // 断言提交成功（成功提示或成功页）
    await expect(
      page.locator('.ant-message-success, .ant-result-success, .ant-notification-notice-success').first(),
    ).toBeVisible({ timeout: 10000 });
  });
});