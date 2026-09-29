/**
 * E2E 共享辅助函数（Task 1 修复：供应商门户改用不可预测的邀请 Token 路由）
 * - 供应商门户路由已从 /supplier-portal/:inquiryId/:supplierId 改为 /supplier-portal/:invitationToken
 * - 通过内部重新生成链接接口获取有效邀请令牌后，再访问新的邀请令牌路由
 * - 关键步骤直接断言，不 `if visible` 跳过
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { apiActivity, networkPhase, watchApi } from './api-activity';

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
 * 演示账号密码。E2E 必须与后端种子用户的密码一致，否则前 5 次登录吃 401、
 * 之后被 LOGIN_MAX_ATTEMPTS=5 的锁定换成 429，整个套件全线红。
 * CI 用 `DEMO_USER_PASSWORD` 注入强随机值（compose 与 playwright 两步同一个格式串）；
 * 兜底值必须等于 `docker-compose.dev.yml` 注入种子的默认值 —— 由
 * `npm run e2e:config:check` 机械核对，不再靠人记住。
 */
export const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'dev-demo-pass-12345678';

/** 登录（选中用户 + 任意密码），登录本身直接断言跳转 */
export async function login(page: Page, name: string, password = DEMO_PASSWORD) {
  // 装上市面账本：登录之后如果 token 不见了、或某次读根本没响应，
  // 失败文本里要能回答"当时已经被 401 踢回 /login 了吗"（R92 那两格红缺的就是这一句）。
  watchApi(page);
  await page.goto('/login');
  await page.locator('.ant-select-selector').click();
  // 只认"当前展开的那个"下拉：antd 收起后节点仍挂在 DOM 里（只是 hidden），
  // 不加作用域就可能点到上一次展开留下的旧节点。
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: name })
    .click();
  // 必须验证"值真的落地"：`src/pages/login/index.tsx` 的 handleLogin 在 userId 为空时
  // 只弹一条错误提示、**根本不发登录请求**，于是下面那次 waitForResponse 会一直等不到
  // response 事件、30s 后报"超时"，读起来像后端慢，其实是这一次点击什么都没发出
  // （一次 9.9 分钟的全量跑里那 1 个抖动正是这个形状）。选项文本是
  // 「姓名（角色·组织）」，所以按包含断言。
  await expect(page.locator('.ant-select-selection-item')).toContainText(name);
  await page.locator('input[type="password"]').fill(password);
  // 受控 input 的写入竞态：`src/pages/login/index.tsx` 的密码框是 `value={password}` 的受控组件，
  // 一次 fill 若落在 React 尚未挂上监听（或随后一次重渲染把 state 空值回写）的窗口里，
  // DOM 上会短暂有值、state 仍为空 —— 于是 handleLogin 的 `if (!password)` 直接 return，
  // **一个请求都不发**，下一次 `waitForResponse` 只能等满预算报"超时"。
  // 实测证据（一次全量跑里那个抖动用例的失败截图 + aria 快照）：用户已提交、密码框为空、
  // 页面无任何报错提示，而 `waitForResponse` 等满 30s 说明这一次点击什么都没发出去 ——
  // 与 `handleLogin` 的 `if (!password) return` 分支完全一致。
  // 究竟是"fill 落在监听挂载之前"还是"随后的重渲染把空 state 回写"，本轮未定案（复现率 1/36，
  // 且当时的容器日志已随重建丢失），但两种成因的处置相同：不放宽超时（放宽只会把静默失败
  // 拖得更久），而是反复写入直到值真的留在框里。
  const passwordInput = page.locator('input[type="password"]');
  await expect
    .poll(
      async () => {
        await passwordInput.fill(password);
        return passwordInput.inputValue();
      },
      {
        timeout: 10000,
        message: '密码写入未生效：受控 input 被重渲染清空，反复 fill 后仍拿不到值',
      },
    )
    .toBe(password);
  // 登录是全套件最重的一次请求（服务端要跑 bcrypt 校验）。实测各引擎/冷启动下
  // 10s 期望预算会不够（一次 12.8 分钟的全量跑里出现 3 次停在 /login 的红），
  // 因此先显式等待该响应并断言其状态，再给跳转一个与引擎无关的 30s 预算。
  const loginRes = page.waitForResponse(
    (res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST',
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: /登\s*录|Login/ }).click();
  const status = (await loginRes).status();
  expect(
    status,
    status === 401
      ? '登录 401：E2E 密码与后端种子密码不一致（改 DEMO_USER_PASSWORD 时两处要同时改），' +
          '跑 `npm run e2e:config:check` 核对'
      : status === 429
        ? '登录 429：连续失败已触发 LOGIN_MAX_ATTEMPTS=5 锁定，根因通常是更早的 401（密码不一致），' +
          '重启后端容器清计数并跑 `npm run e2e:config:check`'
        : `登录接口必须返回 2xx，实际 ${status}`,
  ).toBeLessThan(300);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });
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
 * 等一条**指名文案**的成功提示，用它当作「这一步的写请求已经落地」的凭据。
 *
 * 不要用泛化的 `.ant-message-success` 断言：antd 的 message 会停留约 3s，
 * 上一条操作的提示还挂在屏上时它会立刻通过。实测（HEAD `03beee8`，8/8 次复现）
 * 「提交审批」之后那条断言命中的是上一步的「已选择推荐供应商」，
 * 而审批 POST 的响应时刻读数为 -1 —— 请求还没回来就被下一次 `page.goto` 掐断，
 * 于是 /approval 能不能看见这条单变成掷硬币（全量跑 1/195 的红即此）。
 * 页面的成功提示都在 `await` 写请求之后才弹，所以按文案指名等就等于等写落地。
 */
/**
 * R65：拿"写落地的响应"当凭据，而不是拿会自动消失的 toast 当凭据。
 *
 * 存在理由（一手取证）：n=30 的 webkit 复跑里 3/60 红全部落在
 * `expectSuccessToast(/审批已通过/)` 这一类断言上（用例总时长 20.5/25.8/32.6 s，
 * 而绿的一般 6~13 s）——写其实成功了，只是那条绿色提示没在 15 s 窗口里被等到。
 * 这与时序无关的产品缺陷不同：它是"把瞬时 UI 当权威"造成的假红（与 R34 同源，方向相反）。
 *
 * 用法：把触发写的两次点击包进 action，本函数先挂响应监听再执行，
 * 断到 2xx 才返回；后续步骤原有的可见性断言继续负责"状态真的变了"。
 *
 * R102 加的牙：`page.route` 的 `fulfill` 照样会发 `response`（实测见登记册），所以同一条用例
 * 自己下的桩能给这个"写落地凭据"送回 2xx——不点名就不许当后端回执用。
 * 确实要按"客户端重试了这次写"解读的格子（如 `exception-scenarios.spec.ts` 的 PUT 重试格），
 * 显式传 `{ via: 'stub' }`，让这句话由调用方说出口而不是由守卫默认。
 */
export async function expectWriteLanded(
  page: Page,
  urlPattern: RegExp,
  action: () => Promise<void>,
  method = 'POST',
  opts: { via?: 'backend' | 'stub' } = {},
): Promise<void> {
  const via = opts.via ?? 'backend';
  const pending = page.waitForResponse(
    (r) => urlPattern.test(r.url()) && r.request().method() === method,
    {
      timeout: 20000,
    },
  );
  await action();
  const res = await pending;
  if (via !== 'stub' && networkPhase(res.request()) === false) {
    throw new Error(
      `这次 ${method} 的 ${res.status()} 没有网络层 request 阶段 ⇒ 是本用例自己的 route 桩给的，不是后端回执；` +
        '若这一格断的是"客户端重试了这次写"，请显式传 { via: \'stub\' }' +
        `｜${apiActivity(page, urlPattern)}`,
    );
  }
  expect(res.status(), `写请求未成功：${method} ${res.url()}`).toBeLessThan(300);
}

export async function expectSuccessToast(page: Page, text: RegExp) {
  await expect(page.locator('.ant-message-success').filter({ hasText: text }).first()).toBeVisible({
    timeout: 15000,
  });
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
  const token = await page
    .evaluate(
      async ({ inquiryId, supplierId }) => {
        const authToken = localStorage.getItem('procurement_token');
        if (!authToken) throw new Error('procurement_token not found in localStorage');
        const res = await fetch(
          `/api/inquiries/${inquiryId}/invitations/${supplierId}/regenerate`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          },
        );
        if (!res.ok)
          throw new Error(`regenerate invitation failed: ${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!data.token) throw new Error('regenerate invitation returned no token');
        return data.token as string;
      },
      { inquiryId, supplierId },
    )
    .catch((e: Error) => {
      // 这一格在 runner 上红过（R92：登录已自证 2xx 且落到 /dashboard，token 却不在库）。
      // 光一句 "not found" 判不了档，所以把当时的 URL 与 /api 非 2xx 记录并进错误文本。
      throw new Error(`${e.message}｜${apiActivity(page)}`);
    });
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
  // 先挂上响应等待再点：R28 的首跑形状是"点了发送、页面停在第 4 步、后端压根没有 /send 记录"，
  // 那时第一个失败信号是 60s 之后的 waitForURL 超时，看不出是没发请求还是发了没跳转。
  const sendRes = page.waitForResponse(
    (res) => /\/api\/inquiries\/[^/]+\/send$/.test(new URL(res.url()).pathname),
    { timeout: 30000 },
  );
  await tap(page.getByRole('button', { name: /一键批量发送询价|Batch Send Inquiry/ }).last());
  await confirmOk(page);
  expect((await sendRes).status(), '发送询价接口必须返回 2xx').toBeLessThan(300);

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
  // R65 续三：先等"喂门户表单的那次读"落地（GET /api/portal/inquiries，见 src/api/portal.ts:249，
  // 它返回的 items 才是下面那些 `-unitPrice` 输入框的来源），再断渲染。
  // 这样红了读作"数据到了却没渲染"，而不是"读+渲染没挤进 10 s"的环境竞速。
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'GET' && /\/api\/portal\/inquiries/.test(r.url()),
      {
        timeout: 20000,
      },
    ),
    page.goto(`/supplier-portal/${invitationToken}`),
  ]);
  // 按产品给每个输入框的稳定 id（`${inquiryItemId}-unitPrice` / `-deliveryDays`）定位：
  // 位置索引（first/nth(2)）在窄屏卡片式表单下会命中别的列，导致提交被校验挡下
  const unitPriceInput = page.locator('input[id$="-unitPrice"]').first();
  const deliveryInput = page.locator('input[id$="-deliveryDays"]').first();
  // 这一条等待是全量套件里唯一读到过"element(s) not found"的共享步骤
  // （[mobile-android] 一次、retries 掩成 flaky，隔离 5 连跑与整 project 跑都不复现）。
  // 原样失败只能看到"没找到输入框"，说不出门户当时是什么状态，所以红了不可归因。
  // 这里不改超时（加大超时是掩盖不是修法），只把失败**之后**的现场并进错误里。
  try {
    await expect(unitPriceInput).toBeVisible({ timeout: 10000 });
  } catch (e) {
    const body = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '(body 读不到)')
    )
      .replace(/\s+/g, ' ')
      .slice(0, 240);
    throw new Error(
      `门户表单里等不到单价输入框 ⇒ 后续提交无法进行。` +
        `URL=${page.url()}｜body 前 240 字=${body}｜原错误=${String(e)
          .split('\n')[0]
          .slice(0, 120)}`,
    );
  }
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
