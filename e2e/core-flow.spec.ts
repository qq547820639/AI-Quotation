import { test, expect } from '@playwright/test';
import {
  login,
  confirmOk,
  createAndSendInquiry,
  submitQuoteViaPortal,
  SUPPLIER_A,
} from './helpers';

/**
 * E2E：真实贯通的核心业务链路（Task 10）
 * 采购（本测试用采购主管 u-2 王志强，具备创建/发送/审批/定标全部权限）：
 *   登录 → 创建询价（基本信息+物料）→ 选择供应商 → 发送询价
 *   → 供应商门户提交报价（多供应商，使用邀请 Token 路由）→ 采购查看报价对比 → 填写评审意见
 *   → 发起审批 → 审批通过/驳回 → 完成定标 → 校验最终状态与持久化
 *
 * 关键步骤直接失败（不 `if visible then click` 跳过）；数据用唯一时间戳，可重复执行。
 * 报价金额设计为 ≥ 审批阈值（50000），触发审批链路。
 */

const APPROVER = '王志强'; // u-2 采购主管，具备 INQUIRY_CONFIRM/INQUIRY_APPROVE

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
    await submitQuoteViaPortal(page, inquiryId, 'sup-2', '6000');
    await submitQuoteViaPortal(page, inquiryId, 'sup-5', '6100');

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
    await page
      .locator('.ant-modal')
      .getByRole('button', { name: /确定|OK/ })
      .click();
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
    await submitQuoteViaPortal(page, inquiryId, 'sup-2', '6000');
    await submitQuoteViaPortal(page, inquiryId, 'sup-5', '6100');

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
    await page
      .locator('.ant-modal')
      .getByRole('button', { name: /确定|OK/ })
      .click();
    await expect(page.locator('.ant-message-success').first()).toBeVisible({ timeout: 5000 });

    // 驳回后审批节点为 REJECTED，不应出现"确认定标"按钮（无法定标）
    await page.goto(`/quotation/compare/${inquiryId}`);
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /确认定标|Confirm Result/ })).not.toBeVisible({
      timeout: 5000,
    });
  });
});
