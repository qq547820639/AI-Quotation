/**
 * E2E 共享辅助函数（Task 1 修复：供应商门户改用不可预测的邀请 Token 路由）
 * - 供应商门户路由已从 /supplier-portal/:inquiryId/:supplierId 改为 /supplier-portal/:invitationToken
 * - 通过内部重新生成链接接口获取有效邀请令牌后，再访问新的邀请令牌路由
 * - 关键步骤直接断言，不 `if visible` 跳过
 */
import { expect, type Page } from '@playwright/test';

export const SUPPLIER_A = '苏州联创自动化科技有限公司'; // sup-2
export const SUPPLIER_B = '杭州启明供应链有限公司'; // sup-5

/** 登录（选中用户 + 任意密码），登录本身直接断言跳转 */
export async function login(page: Page, name: string, password = '123456') {
  await page.goto('/login');
  await page.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: name }).click();
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /登录|Login/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** 点击确认弹窗的确定按钮（antd Modal.confirm） */
export async function confirmOk(page: Page) {
  await page.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
}

/**
 * 通过内部"重新生成邀请链接"接口获取某询价单下某供应商的有效邀请令牌。
 * 需已登录采购账号且 localstorage 持有 Bearer token（procurement_token）。
 * 返回的原始 token 仅经此接口返回一次，不落库；门户侧按 token 哈希校验。
 */
export async function getInvitationToken(
  page: Page,
  inquiryId: string,
  supplierId: string,
): Promise<string> {
  const token = await page.evaluate(
    async ({ inquiryId, supplierId }) => {
      const authToken = localStorage.getItem('procurement_token');
      if (!authToken) throw new Error('procurement_token not found in localStorage');
      const res = await fetch(`/api/inquiries/${inquiryId}/invitations/${supplierId}/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`regenerate invitation failed: ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (!data.token) throw new Error('regenerate invitation returned no token');
      return data.token as string;
    },
    { inquiryId, supplierId },
  );
  return token;
}

/** 创建并发送询价，返回 { inquiryId, subject } */
export async function createAndSendInquiry(
  page: Page,
): Promise<{ inquiryId: string; subject: string }> {
  const subject = `E2E核心链路-${Date.now()}`;
  await page.goto('/inquiry/create');
  await expect(page.locator('.ant-steps')).toBeVisible({ timeout: 10000 });

  // 步骤1 基本信息
  await page.locator('#subject').fill(subject);
  await page.locator('#deliveryAddress').fill('总部仓库（上海市嘉定区工业园区）');
  await page.getByRole('button', { name: /下一步|Next/ }).click();

  // 步骤2 物料：新增一行并填写名称与数量
  await page.getByRole('button', { name: /新增物料行|Add Material Row/ }).click();
  const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.locator('input.ant-input').first().fill('PLC控制器');
  await row.locator('.ant-input-number input').first().fill('10');
  await page.getByRole('button', { name: /下一步|Next/ }).click();

  // 步骤3 供应商匹配：勾选两家供应商
  await expect(page.locator('.ant-table').last()).toBeVisible({ timeout: 5000 });
  await page
    .locator('.ant-table-row')
    .filter({ hasText: SUPPLIER_A })
    .locator('.ant-checkbox-input')
    .first()
    .click();
  await page
    .locator('.ant-table-row')
    .filter({ hasText: SUPPLIER_B })
    .locator('.ant-checkbox-input')
    .first()
    .click();
  await page.getByRole('button', { name: /下一步|Next/ }).click();

  // 步骤4 预览：发送
  await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 5000 });
  await page
    .getByRole('button', { name: /一键批量发送询价|Batch Send Inquiry/ })
    .last()
    .click();
  await confirmOk(page);

  // 发送成功跳转详情页
  await page.waitForURL(/\/inquiry\/detail\//);
  const inquiryId = page.url().split('/detail/')[1];
  await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('body')).toContainText(subject);
  return { inquiryId, subject };
}

/** 供应商通过邀请令牌门户提交报价（单价/交货期），断言成功 */
export async function submitQuoteViaPortal(
  page: Page,
  inquiryId: string,
  supplierId: string,
  unitPrice: string,
) {
  const invitationToken = await getInvitationToken(page, inquiryId, supplierId);
  await page.goto(`/supplier-portal/${invitationToken}`);
  // 报价表单的单价输入框（首个 InputNumber）可见
  await expect(page.locator('.ant-input-number input').first()).toBeVisible({ timeout: 10000 });
  await page.locator('.ant-input-number input').first().fill(unitPrice);
  await page.locator('.ant-input-number input').nth(2).fill('7'); // 交货期
  await page.getByRole('button', { name: /正式提交|Submit/ }).click();
  await confirmOk(page);
  await expect(page.locator('.ant-result-success, .ant-message-success').first()).toBeVisible({
    timeout: 10000,
  });
}
