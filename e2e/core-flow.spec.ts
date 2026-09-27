import { test, expect } from '@playwright/test';
import {
  expectWriteLanded,
  login,
  confirmOk,
  createAndSendInquiry,
  submitQuoteViaPortal,
  chooseSupplierOnCompare,
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
    // R65：这一格换成等 PUT /api/inquiries/:id（inquiryApi.update 带 selectedSupplierMap）返回 <300。
    // 两处同形（本用例与"审批驳回后不可定标"）一起换：各自下一步都只在选择真落地后才存在
    // （下一步是"提交审批"按钮的可见性），所以撤掉瞬时提示不撤覆盖。
    await expectWriteLanded(
      page,
      /\/api\/inquiries\/[^/]+$/,
      async () => {
        await chooseSupplierOnCompare(page, SUPPLIER_A);
      },
      'PUT',
    );

    // 5. 填写评审意见（CommentEditor 自动保存）
    const comment = page.locator('textarea').first();
    await comment.fill('价格合理，交货及时，建议采用');
    await expect(page.locator('body')).toContainText(/已保存|Saved/, { timeout: 5000 });

    // 6. 发起审批（金额≥阈值，出现"提交审批"按钮）
    const submitApprovalBtn = page.getByRole('button', { name: /提交审批|Submit Approval/ });
    await expect(submitApprovalBtn).toBeVisible({ timeout: 5000 });
    // R65 续：写落地凭据用 /submit-approval 的响应；下一步 goto('/approval') 的行断言继续负责"状态真的变了"
    await expectWriteLanded(page, /\/api\/inquiries\/[^/]+\/submit-approval$/, async () => {
      await submitApprovalBtn.click();
      await confirmOk(page);
    });

    // 7. 审批通过
    await page.goto('/approval');
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    const approvalRow = page.locator('.ant-table-row').filter({ hasText: subject });
    await expect(approvalRow).toBeVisible({ timeout: 5000 });
    // 按钮带前导图标，可访问名是「check-circle 通 过」→ 不能用 ^ 锚定行首
    // R65：凭据换成"审批写请求 2xx"。原来这里只等一条会自动消失的绿色提示，
    // n=30 的 webkit 复跑里 3/60 红都红在它身上（写其实成功了），属"把瞬时 UI 当权威"的假红。
    // 审批是否真的生效仍有人管：第 8 步要看到「确认定标」按钮，而那按钮只在审批通过后出现。
    await expectWriteLanded(page, /\/api\/inquiries\/[^/]+\/approve$/, async () => {
      await approvalRow.getByRole('button', { name: /通\s*过|Approve/ }).click();
      await page
        .locator('.ant-modal')
        .getByRole('button', { name: /确\s*定|OK/ })
        .click();
    });

    // 8. 完成定标
    await page.goto(`/quotation/compare/${inquiryId}`);
    const confirmBtn = page.getByRole('button', { name: /确认定标|Confirm Result/ });
    await expect(confirmBtn).toBeVisible({ timeout: 10000 });
    // R65 续：同上，等 /confirm 的响应；后面详情页的终态断言负责"真的定标了"
    await expectWriteLanded(page, /\/api\/inquiries\/[^/]+\/confirm$/, async () => {
      await confirmBtn.click();
      await confirmOk(page);
    });

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
    // R65：这一格换成等 PUT /api/inquiries/:id（inquiryApi.update 带 selectedSupplierMap）返回 <300。
    // 两处同形（本用例与"审批驳回后不可定标"）一起换：各自下一步都只在选择真落地后才存在
    // （下一步是"提交审批"按钮的可见性），所以撤掉瞬时提示不撤覆盖。
    await expectWriteLanded(
      page,
      /\/api\/inquiries\/[^/]+$/,
      async () => {
        await chooseSupplierOnCompare(page, SUPPLIER_A);
      },
      'PUT',
    );

    const submitApprovalBtn = page.getByRole('button', { name: /提交审批|Submit Approval/ });
    await expect(submitApprovalBtn).toBeVisible({ timeout: 5000 });
    // R65 续：写落地凭据用 /submit-approval 的响应；下一步 goto('/approval') 的行断言继续负责"状态真的变了"
    await expectWriteLanded(page, /\/api\/inquiries\/[^/]+\/submit-approval$/, async () => {
      await submitApprovalBtn.click();
      await confirmOk(page);
    });

    // 审批驳回
    await page.goto('/approval');
    const approvalRow = page.locator('.ant-table-row').filter({ hasText: subject });
    await expect(approvalRow).toBeVisible({ timeout: 10000 });
    // R68：这一处是 R65 批量换凭据时漏下的位点（文案与结构与其他几处不同，正则没匹配到它）。
    // A/B 两臂各出 1 次 flaky 的都是它 —— 与序号保护无关，纯粹是"拿瞬时提示当唯一凭据"。
    // 换成等 POST /api/inquiries/:id/reject 返回 <300；驳回是否真生效仍由本用例后半的"不可定标"断言管。
    await expectWriteLanded(
      page,
      /\/api\/inquiries\/[^/]+\/reject$/,
      async () => {
        await approvalRow.getByRole('button', { name: /驳\s*回|Reject/ }).click();
        await page
          .locator('.ant-modal')
          .getByRole('button', { name: /确\s*定|OK/ })
          .click();
      },
      'POST',
    );

    // 驳回后审批节点为 REJECTED，不应出现"确认定标"按钮（无法定标）
    await page.goto(`/quotation/compare/${inquiryId}`);
    await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /确认定标|Confirm Result/ })).not.toBeVisible({
      timeout: 5000,
    });
  });
});
