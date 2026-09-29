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
    // R65 续三：门户的可报价表单只在 GET /api/portal/inquiries（src/api/portal.ts:249）回来后
    // 才从 loading 切到 valid 渲染（src/pages/supplier-portal/index.tsx:157-200）。
    // 先等这条读，后面单价/交货期/正式提交三步的渲染断言原样不动。
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/portal\/inquiries/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto(`/supplier-portal/${invitationToken}`),
    ]);

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

  test('门户重复报价被后端 409 拒绝：提示用后端的可执行文案（R21 残留）', async ({ page }) => {
    await login(page, '王志强');
    const { inquiryId } = await createAndSendInquiry(page);
    const invitationToken = await getInvitationToken(page, inquiryId, 'sup-2');
    // R65 续三：本用例下面的 page.route 只桩 POST /api/portal/quotations/submit，
    // 不拦门户这条 GET，所以等的仍是真实读：先等 GET /api/portal/inquiries 再断表单渲染。
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && /\/api\/portal\/inquiries/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto(`/supplier-portal/${invitationToken}`),
    ]);

    const unitPriceInput = page.locator('input[id$="-unitPrice"]').first();
    await expect(unitPriceInput).toBeVisible({ timeout: 10000 });
    await unitPriceInput.fill('100');
    const deliveryInput = page.locator('input[id$="-deliveryDays"]').first();
    await expect(deliveryInput).toBeVisible();
    await deliveryInput.fill('7');

    // 后端 R21 的重复冲突响应形状（与 backend/tests/test_invitation_security.py 断言的
    // r.json()["detail"]["error_type"] 同构）：文案在 detail 信封里，不在顶层 message
    await page.route('**/api/portal/quotations/submit', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: {
            error_type: 'duplicate_quotation',
            message: '该供应商已存在此询价单的报价，请勿重复创建',
            inquiryId,
            supplierId: 'sup-2',
          },
        }),
      });
    });

    await tap(page.getByRole('button', { name: /正式提交|Submit/ }));
    await expect(page.getByText('提交前预览')).toBeVisible();
    const res = page.waitForResponse((r) => r.url().includes('/api/portal/quotations/submit'), {
      timeout: 15000,
    });
    await tap(page.getByRole('button', { name: /确认提交/ }));
    // 效力断言：请求确实发出并被拦成 409
    expect((await res).status()).toBe(409);

    // 用户看到的必须是"请勿重复创建"这句可执行的提示，而不是通用的"数据已被他人修改"
    await expect(page.locator('.ant-message').first()).toContainText(
      /请勿重复创建|do not submit a duplicate/,
      {
        timeout: 10000,
      },
    );
    // 判别性对照（同一时刻取，上一条刚等到提示出现，所以提示仍在屏上）：
    // 不得把"刷新重试"这类通用冲突提示当成结论展示。
    // 注：先前写的 .ant-message-content 在 antd v5 里不存在（正确类名是 .ant-message-notice-content），
    // 空 locator 会让 not.toContainText 直接报 "element(s) not found"。
    await expect(page.locator('.ant-message')).not.toContainText(
      /数据已被他人修改|modified by others/,
      { timeout: 5000 },
    );
    // 提交失败不能把用户带进"已提交"回执态
    await expect(page.locator('.ant-result-success')).toHaveCount(0);
  });

  test('使用无效邀请令牌访问门户被拒绝', async ({ page }) => {
    // 门户为公开页面，无需采购登录；伪造不可用的邀请令牌应被拒绝，而非展示报价表单
    // R65 续三：无效令牌下 loadValidData（含 GET /api/portal/inquiries）根本不会被调用
    // （src/pages/supplier-portal/index.tsx:254 只在 status==='valid' 分支进），等它会挂死；
    // 决定这块渲染的是 validate 那次 GET——它必带响应（后端 portal.py:129 的 401 也算），故按它等。
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'GET' && /\/api\/portal\/invitations\/validate/.test(r.url()),
        {
          timeout: 20000,
        },
      ),
      page.goto('/supplier-portal/definitely-invalid-token-123'),
    ]);
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
