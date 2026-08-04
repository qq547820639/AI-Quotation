import { test, expect, type Page } from '@playwright/test';

/**
 * E2E：真实贯通的核心业务链路（Task 10）
 * 采购（本测试用采购主管 u-2 王志强，具备创建/发送/审批/定标全部权限）：
 *   登录 → 创建询价（基本信息+物料）→ 选择供应商 → 发送询价
 *   → 供应商门户提交报价（多供应商）→ 采购查看报价对比 → 填写评审意见
 *   → 发起审批 → 审批通过/驳回 → 完成定标 → 校验最终状态与持久化
 *
 * 关键步骤直接失败（不 `if visible then click` 跳过）；数据用唯一时间戳，可重复执行。
 * 报价金额设计为 ≥ 审批阈值（50000），触发审批链路。
 */

const APPROVER = '王志强'; // u-2 采购主管，具备 INQUIRY_CONFIRM/INQUIRY_APPROVE
const SUPPLIER_A = '苏州联创自动化科技有限公司'; // sup-2
const SUPPLIER_B = '杭州启明供应链有限公司'; // sup-5

/** 登录（选中用户 + 任意密码），非关键步骤，登录本身直接断言跳转 */
async function login(page: Page, name: string, password = 'test123') {
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

/** 创建并发送询价，返回 { inquiryId, subject } */
async function createAndSendInquiry(page: Page): Promise<{ inquiryId: string; subject: string }> {
  const subject = `E2E核心链路-${Date.now()}`;
  await page.goto('/inquiry/create');
  await expect(page.locator('.ant-steps')).toBeVisible({ timeout: 10000 });

  // 步骤1 基本信息：填主题与收货地址（其余有默认值）
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
  await page.locator('.ant-table-row').filter({ hasText: SUPPLIER_A }).locator('.ant-checkbox-input').first().click();
  await page.locator('.ant-table-row').filter({ hasText: SUPPLIER_B }).locator('.ant-checkbox-input').first().click();
  await page.getByRole('button', { name: /下一步|Next/ }).click();

  // 步骤4 预览：发送
  await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /一键批量发送询价|Batch Send Inquiry/ }).last().click();
  await confirmOk(page);

  // 发送成功跳转详情页
  await page.waitForURL(/\/inquiry\/detail\//);
  const inquiryId = page.url().split('/detail/')[1];
  await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('body')).toContainText(subject);
  return { inquiryId, subject };
}

/** 供应商门户提交报价（单价/交货期），断言成功 */
async function submitQuote(page: Page, inquiryId: string, supplierId: string, unitPrice: string) {
  await page.goto(`/supplier-portal/${inquiryId}/${supplierId}`);
  // 报价表单的单价输入框（首个 InputNumber）可见
  await expect(page.locator('.ant-input-number input').first()).toBeVisible({ timeout: 10000 });
  await page.locator('.ant-input-number input').first().fill(unitPrice);
  await page.locator('.ant-input-number input').nth(2).fill('7'); // 交货期
  await page.getByRole('button', { name: /正式提交|Submit/ }).click();
  await confirmOk(page);
  await expect(page.locator('.ant-result-success, .ant-message-success').first()).toBeVisible({ timeout: 10000 });
}

test.describe('核心业务链路', () => {
  test.beforeEach(async ({ page }) => {
    // 清空 localStorage，保证可重复执行、测试间不互相依赖
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('采购→询价→报价→审批通过→定标全链路', async ({ page }) => {
    await login(page, APPROVER);

    // 1. 创建并发送询价
    const { inquiryId, subject } = await createAndSendInquiry(page);

    // 2. 两家供应商分别提交报价（单价 6000 × 数量10 = 60000 ≥ 审批阈值 50000）
    await submitQuote(page, inquiryId, 'sup-2', '6000');
    await submitQuote(page, inquiryId, 'sup-5', '6100');

    // 3. 采购查看报价对比
    await page.goto(`/quotation/compare/${inquiryId}`);
    await expect(page.locator('.ant-statistic').first()).toBeVisible({ timeout: 10000 });
    // 对比表出现（含供应商列）
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });

    // 4. 为物料选择推荐供应商（触发 selectedSupplierMap）
    const materialRow = page.locator('.ant-table-row').first();
    await materialRow.locator('.ant-select-selector').first().click();
    await page.locator('.ant-select-item-option').filter({ hasText: SUPPLIER_A }).click();
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 5. 填写评审意见（CommentEditor 自动保存）
    const comment = page.locator('textarea').first();
    await comment.fill('价格合理，交货及时，建议采用');
    await expect(page.locator('body')).toContainText(/已保存|Saved/, { timeout: 5000 });

    // 6. 发起审批（金额≥阈值，出现"提交审批"按钮）
    const submitApprovalBtn = page.getByRole('button', { name: /提交审批|Submit Approval/ });
    await expect(submitApprovalBtn).toBeVisible({ timeout: 5000 });
    await submitApprovalBtn.click();
    await confirmOk(page);
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 7. 审批通过
    await page.goto('/approval');
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    const approvalRow = page.locator('.ant-table-row').filter({ hasText: subject });
    await expect(approvalRow).toBeVisible({ timeout: 5000 });
    await approvalRow.getByRole('button', { name: /^通过|Approve/ }).click();
    await page.locator('.ant-modal').getByRole('button', { name: /确定|OK/ }).click();
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 8. 完成定标
    await page.goto(`/quotation/compare/${inquiryId}`);
    const confirmBtn = page.getByRole('button', { name: /确认定标|Confirm Result/ });
    await expect(confirmBtn).toBeVisible({ timeout: 10000 });
    await confirmBtn.click();
    await confirmOk(page);
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 9. 校验最终状态与持久化（刷新后仍在详情页看到已完成状态）
    await page.goto(`/inquiry/detail/${inquiryId}`);
    await expect(page.locator('body')).toContainText(subject, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(/已完成|Completed/, { timeout: 5000 });
    await page.reload();
    await expect(page.locator('body')).toContainText(subject, { timeout: 10000 });
  });

  test('审批驳回后不可定标', async ({ page }) => {
    await login(page, APPROVER);

    const { inquiryId, subject } = await createAndSendInquiry(page);
    await submitQuote(page, inquiryId, 'sup-2', '6000');
    await submitQuote(page, inquiryId, 'sup-5', '6100');

    // 进入对比页，选择供应商并提交审批
    await page.goto(`/quotation/compare/${inquiryId}`);
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    await page.locator('.ant-table-row').first().locator('.ant-select-selector').first().click();
    await page.locator('.ant-select-item-option').filter({ hasText: SUPPLIER_A }).click();
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    const submitApprovalBtn = page.getByRole('button', { name: /提交审批|Submit Approval/ });
    await expect(submitApprovalBtn).toBeVisible({ timeout: 5000 });
    await submitApprovalBtn.click();
    await confirmOk(page);
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 审批驳回
    await page.goto('/approval');
    const approvalRow = page.locator('.ant-table-row').filter({ hasText: subject });
    await expect(approvalRow).toBeVisible({ timeout: 10000 });
    await approvalRow.getByRole('button', { name: /^驳回|Reject/ }).click();
    await page.locator('.ant-modal').getByRole('button', { name: /确定|OK/ }).click();
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 驳回后审批节点为 REJECTED，不应出现"确认定标"按钮（无法定标）
    await page.goto(`/quotation/compare/${inquiryId}`);
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /确认定标|Confirm Result/ })).not.toBeVisible({ timeout: 5000 });
  });
});