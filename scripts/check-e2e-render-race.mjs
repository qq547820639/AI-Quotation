#!/usr/bin/env node
/* global console, process */
/**
 * 「渲染竞速断言」判据（R54 / R64 / R65 续三 一族）
 *
 * 存在理由：这套 e2e 里有 ~5–7% 的低频抖动，成因始终没归因清楚（负载、数据量、冷启动三个协变量
 * 都被读数否证过）。已确认的一类直接病因是断言形状本身：
 *   await page.goto(url);
 *   await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
 * 这条绿不绿取决于"那次 GET + 渲染"能不能挤进 10 s —— **机器的速度在决定红绿**，
 * 产品对不对反而没人问。正确形状是先把喂这块视图的那次读等回来，再断渲染：
 *   await Promise.all([ page.waitForResponse(GET …), page.goto(url) ]);
 *   await expect(…).toBeVisible(…);            // 断言一字不动
 * 于是红的含义从"没挤进 10 s"变成"**数据到了却没渲染**"，后者才是缺陷。
 *
 * 这把尺子不判断任何业务规则，它只守一件事：**不许再有人凭手感写第 27 个这种断言**。
 * 手工扫一轮修掉了 26 处，但下个月写新用例的人不知道这段历史。
 *
 * 已知看不见的一面（写在脸上，不假装全覆盖）：
 *   1) 导航在共享 helper 里、断言在调用方的用例里 ⇒ 看不见（跨函数不配对）。今天的形状恰好
 *      是"helper 里导航 + helper 里断言"，所以 helper 自己会被判到；但新用例可以绕过。
 *   2) 只认 `page.goto/reload` 这一类导航词，`page.setContent`/直接 `locator.click()` 触发的
 *      SPA 重取不在分母里。
 *
 * 用法：node scripts/check-e2e-render-race.mjs [--self-test|--print-sites|--json]
 * 退码：0=通过 / 1=真实违规或豁免失效 / 2=量具故障（读不到语料、参数打错都不许冒充 0 或 1）
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 被扫语料：整份 e2e 目录（helpers 也被用例直接消费，同层） */
const TARGET_DIRS = ['e2e'];

/**
 * 数据驱动的 locator：只可能由某次读喂出来的东西。
 * 反面（.ant-steps / .ant-menu / .ant-form-item / toHaveURL / .ant-message-*）是外壳或路由，
 * 与读无关；纳进来只会逼人加一个假的 waiter。
 */
const DATA_DRIVEN = [
  /\.ant-table\b/,
  /\.ant-table-row/,
  /\.ant-statistic/,
  /\bDATA_ROW\b/,
  /input\[id\$="-unitPrice"\]/,
  /input\[id\$="-deliveryDays"\]/,
  /\.ant-descriptions/,
  /\.ant-empty/,
  /\.ant-list-item/,
];

/** 会"喂"一个数据驱动视图的断言词。`.not.` 的缺席断言另案：它的问题是假绿，不是竞速。 */
const ASSERT_METHODS = ['toBeVisible', 'toContainText', 'toHaveCount', 'toBeAttached'];

/** 会改变"这块视图由谁喂"的用户动作：出现在导航与断言之间，断言就不再是文档加载竞速 */
const USER_ACTION = new Set([
  'click',
  'fill',
  'press',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'type',
  'blur',
  'focus',
  'waitForURL',
  'waitForSelector',
]);

/**
 * 豁免：确有理由不等读的位点。每条必须同时命中"导航语句文本"与"断言文本"；
 * 命中不到就是**失效豁免**并判红——名单与真树分叉属于 R39 那一类缺陷，不是文档小事。
 *
 * 现在是空的，而且这个空是**量具自己挣来的**：初版这里写了一条
 * "exception-scenarios 的 compare 页被 page.route 亲自 fulfill 成 500"，跑真树时它被判"失效"。
 * 重开代码才看清：那一格的断言是 `getByText(/还不能判断/)`，不在数据驱动 locator 名单里，
 * 本来就不该由本尺管。**先写一条想当然的豁免，被自己的失效豁免档打回**——这条红留着当证据，
 * 别把它删成"从没有过"。
 */
const EXEMPT = [];

const FLAGS = ['--self-test', '--print-sites', '--json'];

function argFault(argv) {
  for (const a of argv) {
    if (a.startsWith('-') && !FLAGS.includes(a)) {
      return `未识别的参数：${a}（可用：${FLAGS.join(' ')}）`;
    }
  }
  return null;
}

/** 一条语句里出现的所有属性调用方法名（`page.goto` → goto） */
function callNames(node) {
  const names = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      names.push(n.expression.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * 判据本体（与真实文件读取解耦，好让 --self-test 造必开火的夹具）。
 * @param {Record<string,string>} files  相对路径 → 源码
 */
export function analyze(files, exempt = EXEMPT) {
  const findings = [];
  const usedExemptions = new Set();

  for (const [file, source] of Object.entries(files)) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const textOf = (n) => source.slice(n.getStart(sf), n.end);
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const fns = [];
    const collectFns = (n) => {
      if (
        ts.isFunctionDeclaration(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isMethodDeclaration(n)
      ) {
        fns.push(n);
      }
      ts.forEachChild(n, collectFns);
    };
    ts.forEachChild(sf, collectFns);

    for (const fn of fns) {
      if (!fn.body) continue;
      const fnText = textOf(fn.body);

      // 先扫一遍：哪些变量名是从 waitForResponse 来的。
      // `const w = page.waitForResponse(...); await Promise.all([w, page.goto(u)])` 是合法形状，
      // 只看 Promise.all 那一行的话里面没有 `waitForResponse(` 字样，会被误判成"没绑读的导航"
      // （真树里 `auth-session-refresh.spec.ts:52` 就是这个形状，第一版被它骗过一次）。
      const waitVars = new Set();
      const prewalk = (n) => {
        // 与主扫同一规矩：不下钻进嵌套函数，免得把别处的同名变量当成本处的 waiter
        if (
          (ts.isFunctionDeclaration(n) ||
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n) ||
            ts.isMethodDeclaration(n)) &&
          n !== fn
        ) {
          return;
        }
        if (ts.isVariableStatement(n)) {
          if (callNames(n).includes('waitForResponse')) {
            n.declarationList.declarations.forEach((d) => {
              if (ts.isIdentifier(d.name)) waitVars.add(d.name.text);
            });
          }
        }
        ts.forEachChild(n, prewalk);
      };
      if (fn.body) prewalk(fn.body);

      const events = [];
      const walk = (n) => {
        // 不下钻进嵌套的函数体：一条语句只属于**最内层**那个函数。
        // 早先没加这条时，describe 回调会把里头的用例整体再扫一遍，同一格被报 3 次
        // （本文件有两层 describe ⇒ 3 份）。
        if (
          ts.isFunctionDeclaration(n) ||
          ts.isArrowFunction(n) ||
          ts.isFunctionExpression(n) ||
          ts.isMethodDeclaration(n)
        ) {
          if (n !== fn) return;
        }
        if (ts.isExpressionStatement(n) || ts.isVariableStatement(n)) {
          const names = callNames(n);
          if (names.some((m) => m === 'goto' || m === 'reload')) {
            const navText = textOf(n);
            const covered =
              names.includes('waitForResponse') ||
              [...waitVars].some((v) => new RegExp(`\\b${v}\\b`).test(navText));
            events.push({ kind: 'nav', covered, node: n, text: navText });
          } else if (names.some((m) => USER_ACTION.has(m))) {
            // 用户在中间动了手（点下一步、填表）⇒ 之后那块视图是**那次交互**喂的，
            // 不再由文档加载决定。不重置就会把 SPA 多步表单里的断言错配到页首那次 goto 上
            // （`helpers.ts` 的 createAndSendInquiry 就是这个形状）。代价：SPA 交互引起的
            // 同类竞速本尺看不见——它属于"已知看不见"，不是判错。
            events.push({ kind: 'action', node: n });
          } else {
            const txt = textOf(n);
            const method = ASSERT_METHODS.find((m) => new RegExp(`\\.${m}\\(`).test(txt));
            // 缺席断言（.not.*，以及 toHaveCount(0) 这种"断言个数为 0"的形状）的病是假绿，
            // 不是竞速——交给 `check-e2e-toast-assertions` 那一族，本尺不响。
            const negative = /\.not\./.test(txt) || /\.toHaveCount\(\s*0\s*\)/.test(txt);
            if (method && !negative) {
              // `const row = page.locator(DATA_ROW)…` 之后再 `expect(row)`：
              // 只看断言那一行会看不见 locator 是什么。这里把标识符就地解析回它的声明文本。
              let probe = txt;
              const m = /expect\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(txt);
              if (m) {
                const decl = new RegExp(`(const|let)\\s+${m[1]}\\s*=`).exec(fnText);
                if (decl) {
                  probe = `${txt}\n${fnText.slice(decl.index, fnText.indexOf('\n', decl.index))}`;
                }
              }
              if (DATA_DRIVEN.some((re) => re.test(probe))) {
                events.push({ kind: 'assert', node: n, text: probe });
              }
            }
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(fn.body);
      events.sort((a, b) => a.node.getStart(sf) - b.node.getStart(sf));

      let lastNav = null;
      for (const e of events) {
        if (e.kind === 'nav') {
          lastNav = e;
          continue;
        }
        if (e.kind === 'action') {
          lastNav = null;
          continue;
        }
        if (!lastNav || lastNav.covered) continue;
        const hit = exempt.find(
          (x) =>
            x.file === file &&
            !usedExemptions.has(x) &&
            lastNav.text.includes(x.nav) &&
            e.text.includes(x.assertion),
        );
        if (hit) {
          usedExemptions.add(hit);
          continue;
        }
        findings.push({
          file,
          navLine: lineOf(lastNav.node),
          assertLine: lineOf(e.node),
          locator: e.text.replace(/\s+/g, ' ').slice(0, 120),
        });
      }
    }
  }
  return { findings, staleExemptions: exempt.filter((x) => !usedExemptions.has(x)) };
}

/** 读真实语料。语料为空必须炸——空分母会让任何"⊆"恒真通过（R58 一族）。 */
function readTargets() {
  const files = {};
  for (const dir of TARGET_DIRS) {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir));
    } catch (e) {
      throw new Error(`读不到语料目录 ${dir}：${e.message}`);
    }
    for (const f of entries) {
      if (!/\.spec\.ts$/.test(f) && f !== 'helpers.ts') continue;
      files[`${dir}/${f}`] = readFileSync(join(ROOT, dir, f), 'utf8');
    }
  }
  if (Object.keys(files).length === 0)
    throw new Error('语料为空：一个文件都没读到，空分母不判为"全覆盖"');
  return files;
}

// ------------------------------------------------------------------ 自测

const FIX = {
  fires: `
test('a', async ({ page }) => {
  await page.goto('/supplier');
  await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
});
`,
  fixed: `
test('a', async ({ page }) => {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'GET' && /x/.test(r.url()), { timeout: 20000 }),
    page.goto('/supplier'),
  ]);
  await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 10000 });
});
`,
  shell: `
test('a', async ({ page }) => {
  await page.goto('/inquiry/create');
  await expect(page.locator('.ant-steps')).toBeVisible({ timeout: 10000 });
});
`,
  noAssert: `
test('a', async ({ page }) => {
  await page.goto('/supplier');
  await page.click('button');
});
`,
  two: `
test('a', async ({ page }) => {
  await page.goto('/supplier');
  await expect(page.locator('.ant-table').first()).toBeVisible();
});
test('b', async ({ page }) => {
  await page.goto('/inquiry/list');
  await expect(page.locator(DATA_ROW).first()).toBeVisible();
});
`,
  // 间接 locator：断言行里看不见 .ant-table，只有变量名——这一臂钉的就是上面"已知看不见"的第 1 类里
  // **同函数内**的那半（看不见的那半写在文件头，不假装覆盖）
  indirect: `
test('a', async ({ page }) => {
  await page.goto('/supplier');
  const row = page.locator(DATA_ROW).filter({ hasText: 'x' });
  await expect(row).toBeVisible();
});
`,
  // 缺席断言（.not.）不该被这把尺子管——它的病是假绿，另一把尺子在治
  negative: `
test('a', async ({ page }) => {
  await page.goto('/supplier');
  await expect(page.locator('.ant-empty')).not.toBeVisible();
});
`,
  // 嵌套 describe：同一格只能报一次。早先不下钻嵌套函数体时，两层 describe 回调会把
  // 里头的用例整体再扫一遍，同一格被报 3 次——这类"重复计数"会让修好的人以为是新违规。
  nested: `
test.describe('outer', () => {
  test.describe('inner', () => {
    test('a', async ({ page }) => {
      await page.goto('/supplier');
      await expect(page.locator('.ant-table').first()).toBeVisible();
    });
  });
});
`,
  // 用户在中间动了手（多步表单）：断言由那次点击喂，不再由文档加载决定 ⇒ 不许开火
  afterAction: `
test('a', async ({ page }) => {
  await page.goto('/inquiry/create');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('.ant-table').last()).toBeVisible();
});
`,
  // 与上一臂成对：把那次 click 去掉，同一份语料必须回到 1 —— 证明"重置"真的在跟动作走，
  // 而不是这条 fixture 本来就不开火。
  afterActionRemoved: `
test('a', async ({ page }) => {
  await page.goto('/inquiry/create');
  await expect(page.locator('.ant-table').last()).toBeVisible();
});
`,
  aliased: `
test('a', async ({ page }) => {
  const listPromise = page.waitForResponse((r) => r.request().method() === 'GET', { timeout: 20000 });
  await Promise.all([listPromise, page.goto('/inquiry/list')]);
  await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 30000 });
});
`,
  aliasedRemoved: `
test('a', async ({ page }) => {
  await Promise.all([page.goto('/inquiry/list')]);
  await expect(page.locator(DATA_ROW).first()).toBeVisible({ timeout: 30000 });
});
`,
  // 断言"个数为 0"是缺席断言的另一种拼法，不能因为没写 `.not.` 就被算成竞速位点
  countZero: `
test('a', async ({ page }) => {
  await page.goto('/inquiry/list');
  await expect(page.locator(DATA_ROW).first(), '未登录不该看到数据').toHaveCount(0);
});
`,
};

function selfTest() {
  const dir = join(tmpdir(), `render-race-selftest-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const rows = [];
  const expectCount = (name, source, want) => {
    const got = analyze({ 'x/a.spec.ts': source }).findings.length;
    rows.push({ ok: got === want, name, want, got });
  };
  try {
    expectCount('臂1 必开火：goto 后直接断数据驱动可见性', FIX.fires, 1);
    expectCount('臂2 已修形状不许开火', FIX.fixed, 0);
    expectCount('臂3 静态外壳不是竞速', FIX.shell, 0);
    expectCount('臂4 反向对照：删掉断言即归零（证明看的是断言而不是 goto）', FIX.noAssert, 0);
    expectCount('臂5 计数控制：两处必须恰好 2', FIX.two, 2);
    expectCount('臂6 间接 locator：断言行里没有类名也要抓到', FIX.indirect, 1);
    expectCount('臂7 缺席断言交给他尺，本尺不响', FIX.negative, 0);

    const before = analyze({ 'x/a.spec.ts': FIX.fires }).findings.length;
    const withWaiter = FIX.fires.replace(
      "await page.goto('/supplier');",
      "await Promise.all([page.waitForResponse(() => true), page.goto('/supplier')]);",
    );
    const after = analyze({ 'x/a.spec.ts': withWaiter }).findings.length;
    rows.push({
      ok: before === 1 && after === 0,
      name: '臂8 单变量：同一份语料只加 waiter，读数必须 1 → 0',
      want: '1→0',
      got: `${before}→${after}`,
    });

    const real = readTargets();
    rows.push({
      ok: Object.keys(real).length > 5,
      name: `臂9 真语料非空（读到 ${Object.keys(real).length} 个文件，空分母不算绿）`,
      want: '>5',
      got: String(Object.keys(real).length),
    });

    // 臂17：在**真语料**上做单变量。只在玩具夹具上过火的尺子不算有牙——真树的 locator
    // 形状（模板串、跨行 Promise.all、`.first()` 链、别名变量）比夹具野得多。
    // 这里把 core-flow 里第一处 `waitForResponse(` 就地改名（只在内存里，不落盘），
    // 那一格就退回"未绑读的导航"，命中数必须恰好 +1。
    // 判据写成"相对差"而不是"绝对 ≥1"：否则这把尺子的自测会跟真树的干净程度绑死。
    const base = analyze(real);
    const cfKey = 'e2e/core-flow.spec.ts';
    const mutatedSource = real[cfKey].replace(
      'page.waitForResponse(',
      'page.waitForResponseRenamed(',
    );
    const mutated = analyze({ ...real, [cfKey]: mutatedSource });
    const newOnes = mutated.findings.filter(
      (f) => !base.findings.some((b) => b.file === f.file && b.assertLine === f.assertLine),
    );
    // 期望写成"新增命中 ≥1，且它们全部挂在同一个导航上"，不是"恰好 +1"：
    // 一个未绑读的导航会把它之后、下一个动作之前的**每一条**数据驱动断言都带下水
    // （core-flow 那一格后面正好跟着 .ant-statistic 与 .ant-table 两条 ⇒ 实测 +2）。
    // 第一版按"+1"写，被这条控制打回，说明它真的在看行为不是在配合我。
    const navLines = new Set(newOnes.map((f) => `${f.file}:${f.navLine}`));
    rows.push({
      ok:
        mutatedSource !== real[cfKey] &&
        newOnes.length >= 1 &&
        navLines.size === 1 &&
        newOnes.every((f) => f.file === cfKey),
      name: '臂17 真语料单变量：改掉 core-flow 一处 waiter ⇒ 新增命中≥1 且同源于那一个导航',
      want: '≥1 命中 / 1 个导航',
      got: `${newOnes.length} 命中 / ${navLines.size} 个导航`,
    });

    // 崩溃档：语法坏掉的文件不能伪装成"0 命中"
    writeFileSync(join(dir, 'broken.spec.ts'), 'export const x = ;');
    const broken = analyze({
      'x/broken.spec.ts': readFileSync(join(dir, 'broken.spec.ts'), 'utf8'),
    });
    rows.push({
      ok: broken.findings.length === 0,
      name: '臂10 语法坏文件：不产出命中（因此"全绿"必须靠臂9 证明语料真的被读了）',
      want: 0,
      got: broken.findings.length,
    });

    rows.push({
      ok: argFault(['--self-tset']) !== null && argFault(['--self-test']) === null,
      name: '臂11 参数闸门两极性：打错字要退 2，正字不能被拒',
      want: '拒/收',
      got: `${argFault(['--self-tset']) !== null}/${argFault(['--self-test']) === null}`,
    });

    expectCount('臂12 嵌套 describe：同一格只报一次', FIX.nested, 1);
    expectCount('臂13 中间有用户动作 ⇒ 不是文档加载竞速', FIX.afterAction, 0);
    expectCount('臂13b 与臂13 成对：去掉那次 click 必须回到 1', FIX.afterActionRemoved, 1);
    expectCount('臂14 toHaveCount(0) 是缺席断言，不算竞速位点', FIX.countZero, 0);
    expectCount('臂16 waiter 先存进变量再进 Promise.all：合法形状不许开火', FIX.aliased, 0);
    expectCount('臂16b 成对：把那次 waiter 变量去掉必须回到 1', FIX.aliasedRemoved, 1);

    // 臂15 失效豁免必须判红：注入一条对不上真树的豁免，它自己就是缺陷。
    // 这一臂是初版写出来的那条"想当然的豁免"教我的——它当时被真树打回，说明这条控制值钱。
    const bogus = [
      { file: 'x/a.spec.ts', nav: '/never/', assertion: 'never', reason: '注入的假豁免' },
    ];
    const stale = analyze({ 'x/a.spec.ts': FIX.fires }, bogus);
    const used = analyze({ 'x/a.spec.ts': FIX.fires }, [
      { file: 'x/a.spec.ts', nav: '/supplier', assertion: '.ant-table', reason: '命中的真豁免' },
    ]);
    rows.push({
      ok:
        stale.staleExemptions.length === 1 &&
        used.staleExemptions.length === 0 &&
        used.findings.length === 0,
      name: '臂15 失效豁免判红、生效豁免既吃掉位点也不被判失效',
      want: '失效 1 / 生效 0 且位点 0',
      got: `失效 ${stale.staleExemptions.length} / 生效 ${used.staleExemptions.length} 位点 ${used.findings.length}`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = rows.filter((r) => !r.ok);
  for (const r of rows) {
    console.log(`  ${r.ok ? '✔' : '✗'} ${r.name} — 期望 ${r.want} 实得 ${r.got}`);
  }
  console.log(
    failed.length === 0
      ? `✔ 自测通过：${rows.length} 臂全绿（必开火／不许开火成对，另含计数、分母、参数与失效豁免四道控制）`
      : `✗ 自测未通过：${failed.length}/${rows.length} 臂不绿`,
  );
  return failed.length === 0 ? 0 : 1;
}

// -------------------------------------------------------------------- CLI

const ARGS = process.argv.slice(2);
const fault = argFault(ARGS);
if (fault) {
  console.error(`✗ ${fault}`);
  process.exit(2);
}
if (ARGS.includes('--self-test')) process.exit(selfTest());

let out;
try {
  out = analyze(readTargets());
} catch (e) {
  console.error(`✗ 量具故障：${e.message}`);
  process.exit(2);
}

if (ARGS.includes('--json')) {
  console.log(JSON.stringify({ ...out, exempt: EXEMPT.length }, null, 2));
  process.exit(out.findings.length + out.staleExemptions.length > 0 ? 1 : 0);
}
if (ARGS.includes('--print-sites')) {
  for (const f of out.findings) {
    console.log(`${f.file}:${f.assertLine} 紧跟在未绑读的导航 :${f.navLine} — ${f.locator}`);
  }
  process.exit(0);
}

for (const f of out.findings) {
  console.log(`  ✗ ${f.file}:${f.assertLine} 紧跟在未绑读的导航 :${f.navLine} — ${f.locator}`);
}
for (const s of out.staleExemptions) {
  console.log(
    `  ✗ 失效豁免（名单与真树分叉）：${s.file} nav~"${s.nav}" assertion~"${s.assertion}"`,
  );
}
if (out.findings.length || out.staleExemptions.length) {
  console.log(
    `✗ 渲染竞速判据未通过：${out.findings.length} 处未豁免位点、${out.staleExemptions.length} 条失效豁免（豁免在册 ${EXEMPT.length} 条）`,
  );
  process.exit(1);
}
console.log(`✔ 渲染竞速判据通过：0 处未豁免位点；豁免 ${EXEMPT.length} 条全部命中在册`);
