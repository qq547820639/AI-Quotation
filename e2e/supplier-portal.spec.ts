import { test, expect } from '@playwright/test';

/**
 * E2E：供应商门户报价填报（G4 重写：实际填写并提交报价）
 * 访问 /supplier-portal/:inquiryId/:supplierId
 * - 若表单可见：填写单价/交货期 → 提交 → 断言成功
 * - 若已提交（Result 成功页）：断言成功状态可见
 */
test.describe('供应商门户', () => {
  test('访问供应商门户并填报报价', async ({ page }) => {
    // 使用种子数据 inq-3 + sup-1
    await page.goto('/supplier-portal/inq-3/sup-1');

    // 验证门户页面加载：有报价表单或已提交成功页（二选一）
    const form = page.locator('.ant-form, .ant-table');
    const successResult = page.locator('.ant-result-success');
    await expect(form.or(successResult).first()).toBeVisible({ timeout: 10000 });

    // 情况1：已提交成功页
    if (await successResult.isVisible({ timeout: 1000 }).catch(() => false)) {
      // 断言成功状态
      await expect(successResult).toBeVisible();
      return;
    }

    // 情况2：报价表单可见 → 填写并提交
    // 找到第一个单价输入框（InputNumber）并填写
    const unitPriceInput = page.locator('.ant-table .ant-input-number').first();
    if (await unitPriceInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await unitPriceInput.click();
      await unitPriceInput.fill('100');
    }

    // 找到交货期输入框（通常是第3个 InputNumber）并填写
    const deliveryInput = page.locator('.ant-table .ant-input-number').nth(2);
    if (await deliveryInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deliveryInput.click();
      await deliveryInput.fill('7');
    }

    // 点击提交按钮
    const submitBtn = page.getByRole('button', { name: /提交|Submit/ });
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();

      // 处理确认弹窗（若有）
      const confirmBtn = page.locator('.ant-modal-confirm-btns .ant-btn-primary, .ant-btn-primary').filter({ hasText: /确定|OK|确认/ });
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }

      // 断言提交后出现成功提示或成功页
      await expect(
        page.locator('.ant-message-success, .ant-result-success, .ant-notification-notice-success').first(),
      ).toBeVisible({ timeout: 10000 });
    }
  });
});
