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
 * 只在 chromium 项目跑：`download` 事件在 webkit 上的落地语义与文件名处理不同；
 * mobile-android 虽是 chromium 引擎但列表走卡片布局，工具栏那颗按钮不在。
 * 注意 skip 谓词只能拿到 fixture（第二参数不是 testInfo），所以 project 名要在用例体内
 * 用 `test.info()` 读——写成 describe 级的 `(_, testInfo) => …` 会在每个 project 里直接抛
 * `Cannot read properties of undefined (reading 'project')`（本轮实测）。
 */
const BULK_TOAST = '已导出当前筛选结果';
const ROW_TOAST = '导出成功';
const ONLY_CHROMIUM = '下载事件语义只在 chromium 项目验过，其余 project 不并入本轮读数';

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
    test.skip(test.info().project.name !== 'chromium', ONLY_CHROMIUM);
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
    test.skip(test.info().project.name !== 'chromium', ONLY_CHROMIUM);
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

    // 两下都用 dispatchEvent，不用 click()：实测 Playwright 的 click() 会在这个按钮切换成
    // loading 形状后做到位/稳定复检，等它返回时那一次生成已经完成（同文件另一格读到
    // dl=431ms、toast=451ms），第二下就落在守卫窗口之外——那样测的是"顺序导出两次出两份"，
    // 是正确行为而不是守卫。dispatchEvent 直接再进一次 React 的 onClick，才压得住同一次生成。
    await btn.dispatchEvent('click');
    await btn.dispatchEvent('click');

    await expect.poll(() => seen.length, { timeout: 30_000 }).toBeGreaterThan(0);
    // 判别量用页内生成计数，不用 download 条数（理由见 armGenerationCounter 的注释）。
    // 四臂实测（同一把尺子，改的是被测代码）：
    //   原样（守卫 + loading）        → gen=1，绿
    //   删 handler 守卫（arm B）      → 仍 gen=1，绿 ⇒ 这一臂**没有判别力**，
    //        因为 antd Button 在 loading 期间自己吞掉 click（探针读到两次 DOM click、一次生成）
    //   删守卫 + 删 loading（arm C）  → gen=2 且落两份文件，红 ✓
    //   留守卫 + 删 loading（arm D）  → gen=1，绿 ✓ ⇒ 守卫单独成立
    // 所以本用例证的是"连点只出一份"这条用户可见不变量，并把两层防护的分工写在这里；
    // 它**不**单独证明 handler 守卫必要——在桌面点击路径上组件层已经先挡住了。
    await page.waitForTimeout(1_500);
    const gens = await readGenerations(page);
    const disabledAfterFirst = await btn.isDisabled().catch(() => false);
    expect(
      gens,
      `连点只该启动一次生成（实测该按钮 loading 时 disabled=${disabledAfterFirst}，` +
        `所以挡住第二下的应是 handler 里的 early return 而不是组件），实际生成 ${gens} 次，` +
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
