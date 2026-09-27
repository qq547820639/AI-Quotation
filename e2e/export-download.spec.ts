import { test, expect } from '@playwright/test';
import { login, DATA_ROW } from './helpers';

/**
 * 导出链路的浏览器级覆盖。
 *
 * 为什么现在补：接线 R45 时实测 `grep -rniE "导出|xlsx|download" e2e/` 读数为 **0**，
 * 也就是说 R41（"还没生成就替用户宣布成功"）与 R44（连点叠发多份文件/多个 toast）
 * 两个修复都只有单元形状与代码形状作证据，浏览器里到底有没有真出过一份文件没人验过。
 *
 * 三条读数各对应一次真实缺陷：
 *  ① 点击「导出当前筛选结果」必须真产生一次浏览器下载，文件名是 `表名_14位时间戳.xlsx`
 *     （`src/utils/excel.ts:54` 的 `${filename}_${stamp}.xlsx` 形状）；
 *  ② **顺序**：下载锚点先出现、成功提示后出现。这是 R41 那次的直接反证——
 *     修之前 `notifySuccess` 在 `exportAOA` 之前同步执行，两条读数的先后正好相反。
 * ③ 连点只出一份文件（R44 的守卫在浏览器里的效果）。
 *
 * 为什么 ② 不能用"点完立刻读 toast 在场与否"：本轮先写成那样，两个 project 都读出 `Received: 1`。
 * 那次红不是产品病，是我的读数到不了"同一瞬间"——`await btn.click()` 之后再来一次
 * CDP 往返已经是几毫秒之后，小数据量的 exceljs 生成比它更快，
 * 于是"提示早于生成"与"生成只花了几毫秒"两种情况在同一形状下不可区分。
 * 改成页内单一时钟的累加器（performance.now 序），先后关系由**记录顺序**给出，不跨时钟比较。
 *
 * 适用域是量出来的，不是猜的：把跳过临时全关后跑一遍 5 个 project，读数 **8 passed / 2 failed**，
 * 两个失败恰好都是"逐行导出"那一格、恰好都在移动 project（`mobile-android` / `mobile-ios`）——
 * 因为窄屏列表是卡片 + 「更多」下拉，行内没有那颗「导出」按钮。
 * ⇒ 批量导出与顺序断言（①②）在 5 个 project 全绿，**不挑引擎**（webkit 的 download 语义一并验过）；
 *   逐行重入那一格（③）只对桌面 project 成立，且移动端的两次点击天然落在不同代生成
 *   （下拉必须重开，见登记册 R44 一节），窗口打不到 ⇒ 按 project 名跳过，而不是全关。
 * 另记一条 Playwright API 形状：`test.skip` 的谓词第二参数**不是** testInfo，
 * 写成 describe 级 `(_, testInfo) => …` 会在每个 project 直接抛
 * `Cannot read properties of undefined (reading 'project')`（实测）；project 名只能在用例体内 `test.info()` 读。
 */
const BULK_TOAST = '当前筛选结果已开始下载';
const ROW_TOAST = '文件已开始下载';
const DESKTOP_ONLY =
  '逐行导出的行内按钮只在桌面布局存在（窄屏是卡片 + 「更多」下拉），移动端这一格打不到重入窗口';

/**
 * 页内计数器：`downloadFromBuffer` 每次生成都会 `URL.createObjectURL(blob)` 一次
 * （`src/utils/excel.ts:25`），所以它数的是"这段代码真跑了几次生成"。
 * 为什么不用 Playwright 的 download 事件数当判别：实测把 R44 的逐行守卫整段删掉，
 * 连点两下仍然只落一份 download —— Chromium 对"短时间内第二次自动下载"有自己的策略，
 * 于是 download 计数在"守卫在"与"守卫没"两种形状下读出来一样 ⇒ 那条断言没有牙。
 * 要验的是代码里那层 early return，就得 spy 代码自己调的那个 API。
 */
async function armGenerationCounter(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __gen: number };
    w.__gen = 0;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((blob: Blob) => {
      w.__gen += 1;
      return orig(blob);
    }) as typeof URL.createObjectURL;
  });
}

async function readGenerations(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __gen: number }).__gen);
}

/**
 * 页内累加器：按发生顺序记录"下载锚点插入"与"指定文案的成功提示插入"。
 * 两类节点都在同一个 MutationObserver 里、同一条 performance.now 时间轴上，
 * 所以先后关系不需要比较页面时钟与 Node 时钟。
 */
async function armOrderRecorder(page: import('@playwright/test').Page, toastNeedle: string) {
  await page.evaluate((needle: string) => {
    const w = window as unknown as { __order: string[] };
    w.__order = [];
    const seen = new Set<string>();
    const stamp = () => `${Math.round(performance.now())}ms`;
    const scan = (root: ParentNode | Element) => {
      const hits: Element[] = [];
      if (root.matches?.('a[download]')) hits.push(root as Element);
      if (root.matches?.('.ant-message-success')) hits.push(root as Element);
      root.querySelectorAll?.('a[download]').forEach((el) => hits.push(el));
      root.querySelectorAll?.('.ant-message-success').forEach((el) => hits.push(el));
      for (const el of hits) {
        const text = (el.textContent || '').trim();
        if (el.tagName === 'A') {
          const key = `dl|${el.getAttribute('download') ?? ''}`;
          if (!seen.has(key)) {
            seen.add(key);
            w.__order.push(`${stamp()}|${key}`);
          }
        } else if (text.includes(needle)) {
          const key = `toast|${text}`;
          if (!seen.has(key)) {
            seen.add(key);
            w.__order.push(`${stamp()}|${key}`);
          }
        }
      }
    };
    new MutationObserver((ms) =>
      ms.forEach((m) =>
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scan(n as Element);
        }),
      ),
    ).observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  }, toastNeedle);
}

async function readOrder(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __order: string[] }).__order);
}

test.describe('Excel 导出的浏览器级落地（R41 顺序 + R44 重入）', () => {
  test('导出当前筛选结果：真出文件，且成功提示排在下载之后', async ({ page }) => {
    // 5 个 project 全绿（含 webkit），所以这一格不设适用域闸门
    test.setTimeout(120_000);
    await login(page, '李明辉');
    await page.goto('/inquiry/list');
    await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 15_000 });

    const btn = page.getByRole('button', { name: /导出当前筛选结果|Export current/ });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await armOrderRecorder(page, BULK_TOAST);

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await btn.click();

    const dl = await downloadPromise;
    expect(dl.suggestedFilename()).toMatch(/^询价单管理_\d{14}\.xlsx$/);
    const toast = page.locator('.ant-message-success').filter({ hasText: BULK_TOAST });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });

    const order = await readOrder(page);
    const dlAt = order.findIndex((s) => s.includes('|dl|'));
    const toastAt = order.findIndex((s) => s.includes('|toast|'));
    expect(dlAt, `页内没记录到下载锚点，实际记录 ${JSON.stringify(order)}`).toBeGreaterThanOrEqual(
      0,
    );
    expect(
      toastAt,
      `页内没记录到"${BULK_TOAST}"提示，实际记录 ${JSON.stringify(order)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      toastAt,
      `成功提示必须排在下载锚点之后（R41 修的就是这个先后），实际记录 ${JSON.stringify(order)}`,
    ).toBeGreaterThan(dlAt);
  });

  test('逐行导出连点两次只出一份文件（R44 的守卫）', async ({ page }) => {
    test.skip(test.info().project.name.startsWith('mobile'), DESKTOP_ONLY);
    test.setTimeout(120_000);
    await login(page, '李明辉');
    await page.goto('/inquiry/list');
    const row = page.locator(DATA_ROW).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const btn = row.getByRole('button', { name: /导\s*出|Export/ }).first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await armOrderRecorder(page, ROW_TOAST);
    await armGenerationCounter(page);

    const seen: string[] = [];
    page.on('download', (d) => {
      seen.push(d.suggestedFilename());
    });

    // 五下压进**同一个任务**里同步派发：Playwright 的 dispatchEvent 每次是一趟独立往返，
    // 两趟之间 React 可能已经重渲染完，守卫就读得到上一把的状态了——那样的"绿"取决于往返时机。
    // 实测把两下改成 element 内的一次 evaluate 连发五下之后，这一格才从"3 次红 1 次"变成确定性地红
    // （R52：根因就是守卫读 state、而 state 要等下一次渲染才可见，见 src/pages/inquiry/list/index.tsx:598）。
    await btn.evaluate((el) => {
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });

    await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(0);
    // 判别量用页内生成计数，不用 download 条数（理由见 armGenerationCounter 的注释）。
    // 更正一条旧读数：这里原先记的四臂表（"arm D 留守卫 + 删 loading → gen=1，绿 ⇒ 守卫单独成立"）
    // 是在**两下跨往返**的弱注入下取的；换成同任务连发五下后，同一格在 3 次里红过 1 次（R52），
    // 也就是说那次"绿"是非判别性的巧合，不能当"守卫有效"的证据。四臂在新注入下的重测读数见登记册 R52。
    // 组件层吞 loading 期 click 这一层仍然成立，但它挡的是跨 tick 的第二次点击；同批内的连发只有同步守卫有用。
    await page.waitForTimeout(1_500);
    const gens = await readGenerations(page);
    const disabledAfterFirst = await btn.isDisabled().catch(() => false);
    expect(
      gens,
      `同任务连发 5 下只该启动一次生成（实测该按钮 loading 时 disabled=${disabledAfterFirst}，` +
        `组件层吞不掉同一个批里的派发），实际生成 ${gens} 次，` +
        `download 事件 ${JSON.stringify(seen)}`,
    ).toBe(1);

    const toast = page.locator('.ant-message-success').filter({ hasText: ROW_TOAST });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });
    const order = await readOrder(page);
    expect(
      order.findIndex((s) => s.includes('|toast|')),
      `逐行导出的成功提示也必须排在下载之后，实际记录 ${JSON.stringify(order)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      order.findIndex((s) => s.includes('|toast|')),
      `逐行导出的成功提示也必须排在下载之后，实际记录 ${JSON.stringify(order)}`,
    ).toBeGreaterThan(order.findIndex((s) => s.includes('|dl|')));
  });
});
