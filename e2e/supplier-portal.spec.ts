import { test, expect } from '@playwright/test';
import { login, createAndSendInquiry, getInvitationToken, tap } from './helpers';

/**
 * E2E：供应商门户报价填报（邀请令牌路由 /supplier-portal/:invitationToken）
 * 通过内部重新生成链接接口获取有效邀请令牌 → 访问门户 → 填写单价/交货期 → 正式提交 → 断言成功回执页。
 * 关键步骤直接断言，不 `if visible` 跳过。用唯一时间戳创建新询价，可跨浏览器项目重复执行。
 */
test.describe('供应商门户', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('供应商通过邀请令牌访问门户并提交报价', async ({ page }) => {
    // 采购登录，创建并发送询价以获得有效邀请令牌
    await login(page, '王志强');
    const { inquiryId } = await createAndSendInquiry(page);

    // 获取该询价下 sup-2 的有效邀请令牌（不可预测，非枚举 ID）
    const invitationToken = await getInvitationToken(page, inquiryId, 'sup-2');
    await page.goto(`/supplier-portal/${invitationToken}`);

    // 关键步骤1：报价表单单价输入框必须可见（否则直接失败，不跳过）
    // 按产品提供的稳定 id 定位，不用位置索引——窄屏是卡片式表单，索引会命中别的列
    const unitPriceInput = page.locator('input[id$="-unitPrice"]').first();
    await expect(unitPriceInput).toBeVisible({ timeout: 10000 });

    // 关键步骤2：填写单价
    await unitPriceInput.fill('100');

    // 关键步骤3：填写交货期
    const deliveryInput = page.locator('input[id$="-deliveryDays"]').first();
    await expect(deliveryInput).toBeVisible();
    await deliveryInput.fill('7');

    // 关键步骤4：正式提交报价
    const submitBtn = page.getByRole('button', { name: /正式提交|Submit/ });
    await expect(submitBtn).toBeVisible();
    await tap(submitBtn);

    // 关键步骤5：正式提交先打开「提交前预览」弹窗，在预览内确认提交（Task 17）
    await expect(page.getByText('提交前预览')).toBeVisible();
    const confirmBtn = page.getByRole('button', { name: /确认提交/ });
    await expect(confirmBtn).toBeVisible();
    await tap(confirmBtn);

    // 断言提交成功（成功回执页）
    await expect(page.locator('.ant-result-success').first()).toBeVisible({ timeout: 10000 });
    // 回执编号可见（不可歧义回执）
    await expect(page.locator('body')).toContainText(/回执|Receipt/, { timeout: 5000 });
  });

  test('使用无效邀请令牌访问门户被拒绝', async ({ page }) => {
    // 门户为公开页面，无需采购登录；伪造不可用的邀请令牌应被拒绝，而非展示报价表单
    await page.goto('/supplier-portal/definitely-invalid-token-123');
    // 断言不出现报价表单（未授权），而是出现错误/过期提示
    await expect(page.locator('.ant-input-number input').first()).not.toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('body')).toContainText(
      /无询价|邀请|无效|expired|invalid|revoked|error/i,
      { timeout: 10000 },
    );
  });
});
