/**
 * E2E 共享辅助函数（Task 1 修复：供应商门户改用不可预测的邀请 Token 路由）
 * - 供应商门户路由已从 /supplier-portal/:inquiryId/:supplierId 改为 /supplier-portal/:invitationToken
 * - 通过内部重新生成链接接口获取有效邀请令牌后，再访问新的邀请令牌路由
 * - 关键步骤直接断言，不 `if visible` 跳过
 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * 用键盘 Enter 触发按钮（等价于点击，但不做命中测试）。
 *
 * 窄屏 E2E 项目（mobile-android / mobile-ios）里，创建向导与门户的底部操作栏是
 * `position: sticky`、弹窗按钮在 `position: fixed` 层内；CDP 返回的内容四边形仍是
 * "未吸附"的布局位置，于是 Playwright 的 actionability 命中测试把按钮判成
 * "被表单遮挡（subtree intercepts pointer events）"而 10s 超时——
 * 同坐标下 `document.elementFromPoint` 实测拿到的正是按钮本身（探针已确认）。
 * Enter 走的是同一 onClick，键盘用户本来也这样操作，且不受命中测试影响。
 */
export async function tap(locator: Locator, options?: { timeout?: number }): Promise<void> {
  await locator.press('Enter', options);
}

/**
 * 勾选复选框：与 tap 同理，用 Space 键触发（antd Table 的固定列/固定表头会在窄屏下
 * 克隆出重叠单元格，命中测试会点到别的行上），并在触发后断言真的勾上了。
 */
export async function tick(locator: Locator, options?: { timeout?: number }): Promise<void> {
  await locator.press('Space', options);
  await expect(locator).toBeChecked();
}

export const SUPPLIER_A = '苏州联创自动化科技有限公司'; // sup-2
export const SUPPLIER_B = '杭州启明供应链有限公司'; // sup-5

/**
 * 数据行定位器（跨 5 个 E2E 项目通用）。
 * 询价列表 / 供应商 / 物料 / 待回收报价 这些页面在窄屏下（useIsMobile）
 * 把 antd Table 换成 List 卡片，`.ant-table-row` 在 mobile-android / mobile-ios
 * 项目里根本不存在；并集让同一条断言在桌面与窄屏两种渲染下都成立。
 */
export const DATA_ROW = '.ant-table-row, .ant-list-item';

/**
 * 演示账号密码。生产/CI 形态下种子用户的密码由 DEMO_USER_PASSWORD 注入（强随机值），
 * 本地开发默认 123456。E2E 必须使用与后端种子一致的值，否则登录断言会失败。
 */
export const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || '123456';

/** 登录（选中用户 + 任意密码），登录本身直接断言跳转 */
export async function login(page: Page, name: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.locator('.ant-select-selector').click();
  await page.locator('.ant-select-item-option').filter({ hasText: name }).click();
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /登\s*录|Login/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * 点击确认弹窗的确定按钮。
 * antd v5 的 danger 确认按钮渲染为 ant-btn-dangerous（不带 ant-btn-primary），
 * 因此主/危险两种 okType 都要覆盖。
 */
export async function confirmOk(page: Page) {
  // .first()：前一个确认弹窗退场动画未结束时同时存在两个按钮，
  // press()/click() 的严格模式会因命中 2 个元素而报错
  await tap(
    page
      .locator(
        '.ant-modal-confirm-btns .ant-btn-primary, .ant-modal-confirm-btns .ant-btn-dangerous',
      )
      .first(),
  );
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
  await tap(page.getByRole('button', { name: /下一步|Next/ }));

  // 步骤2 物料：新增一行并填写名称与数量
  await page
    .getByRole('button', { name: /新增物料行|Add Material Row/ })
    .first()
    .click();
  const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.locator('input.ant-input').first().fill('PLC控制器');
  await row.locator('.ant-input-number input').first().fill('10');
  await tap(page.getByRole('button', { name: /下一步|Next/ }));

  // 步骤3 供应商匹配：勾选两家供应商
  await expect(page.locator('.ant-table').last()).toBeVisible({ timeout: 5000 });
  await tick(
    page
      .locator('.ant-table-row')
      .filter({ hasText: SUPPLIER_A })
      .locator('.ant-checkbox-input')
      .first(),
  );
  await tick(
    page
      .locator('.ant-table-row')
      .filter({ hasText: SUPPLIER_B })
      .locator('.ant-checkbox-input')
      .first(),
  );
  await tap(page.getByRole('button', { name: /下一步|Next/ }));

  // 步骤4 预览：发送
  await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 5000 });
  await tap(page.getByRole('button', { name: /一键批量发送询价|Batch Send Inquiry/ }).last());
  await confirmOk(page);

  // 发送成功跳转详情页
  await page.waitForURL(/\/inquiry\/detail\//);
  const inquiryId = page.url().split('/detail/')[1];
  await expect(page.locator('.ant-descriptions').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('body')).toContainText(subject);
  return { inquiryId, subject };
}

/** 供应商通过邀请令牌门户提交报价（单价/交货期），断言成功 */
/**
 * 在报价对比页为第一条物料选择推荐供应商。
 * 对比表首列是 sticky 单元格：窄屏（mobile-* 项目）下 CDP 仍按"未吸附"的位置返回元素
 * 四边形，鼠标点击的命中测试会落到相邻行上（实测报"被 .ant-row 子树拦截"）。
 * 键盘 ArrowDown 打开下拉不依赖命中测试，桌面与窄屏行为一致。
 */
export async function chooseSupplierOnCompare(page: Page, supplierName: string) {
  const row = page.locator('.ant-table-row').first();
  await row.getByRole('combobox').first().press('ArrowDown');
  const option = page.locator('.ant-select-item-option').filter({ hasText: supplierName }).first();
  await expect(option).toBeVisible({ timeout: 10000 });
  await tap(option);
}

export async function submitQuoteViaPortal(
  page: Page,
  inquiryId: string,
  supplierId: string,
  unitPrice: string,
) {
  const invitationToken = await getInvitationToken(page, inquiryId, supplierId);
  await page.goto(`/supplier-portal/${invitationToken}`);
  // 按产品给每个输入框的稳定 id（`${inquiryItemId}-unitPrice` / `-deliveryDays`）定位：
  // 位置索引（first/nth(2)）在窄屏卡片式表单下会命中别的列，导致提交被校验挡下
  const unitPriceInput = page.locator('input[id$="-unitPrice"]').first();
  const deliveryInput = page.locator('input[id$="-deliveryDays"]').first();
  await expect(unitPriceInput).toBeVisible({ timeout: 10000 });
  await unitPriceInput.fill(unitPrice);
  await deliveryInput.fill('7');
  // 「正式提交」先打开提交前预览弹窗（Task 17），确认按钮在预览内，不是 Modal.confirm
  await tap(page.getByRole('button', { name: /正式提交|Submit/ }));
  await expect(page.getByText('提交前预览')).toBeVisible({ timeout: 10000 });
  await tap(page.getByRole('button', { name: /确认提交/ }));
  await expect(page.locator('.ant-result-success, .ant-message-success').first()).toBeVisible({
    timeout: 10000,
  });
}
