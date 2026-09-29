#!/usr/bin/env node
/* global console, process */
/**
 * E2E「写落地凭据」判据（AST 版）
 *
 * 不变量：证明一次写操作落地的成功提示断言必须**指名文案**。
 * antd 的 message 会停留约 3s，上一条操作的 toast 还挂在屏上时，
 * 不指名的 `.ant-message-success` 断言会被别人的 toast 立刻满足（R34 实测 8/8 次：
 * 「提交审批成功」在 67~85ms 通过，而审批 POST 自身耗时 147ms）。
 *
 * 本轮把识别面从文本面换成 AST。原文本判据认的是
 * `locator('…ant-message-success…')` 之后**紧跟** `.filter(`，于是三种写法直接绕过：
 *   ① 选择器写成模板字符串（`locator(`${PRE} .ant-message-success`)`）；
 *   ② locator 先赋给变量，下一行才 `.filter({hasText})` 或 `expect(v)`；
 *   ③ 改用 `getByText(...)` / `getByRole(_, {name})` 命中 toast 文案 ——
 *      这一条不只是"换个 API"：文本型实参若是**多条成功文案的子串**，
 *      它和 R34 那个缺陷同形（能被别的操作的 toast 满足），所以按实参能匹配几条
 *      成功文案来判，而不是按类名。
 *
 * 分母（一句话）：被扫面（e2e/*.spec.ts + e2e/helpers.ts）里
 *   每个「选择器静态文本命中 toast 类的 locator 调用」+ 每个「实参能匹配 ≥1 条成功文案的
 *   文本型 locator（getByText / getByRole 的 name）」+ 每个 `expectSuccessToast` 调用。
 * 排除面：e2e 之外的文件、注释与字符串（AST 天然不吃注释——旧文本判据曾在
 *   helpers.ts 的注释行上凭空多报过一次）。
 *
 * 档位：Σ 必须等于分母，不等即"读数作废"并非零退出。
 *   named        合规：同一调用链上确有 .filter({hasText: …})（含经由变量再 filter）
 *   helper       合规：走 expectSuccessToast(page, 文案)，且文案实参真的传了
 *   named-text   合规：文本型实参在成功文案目录里唯一命中
 *   generic      违规：toast 选择器无人指名（受 ALLOW 台账约束）
 *   ambiguous    违规：文本型实参能匹配 ≥2 条成功文案，会被别的操作的 toast 满足
 *   bad-helper   违规：expectSuccessToast 少传文案参数（等价于不指名）
 *   unresolved   解不开：选择器/实参取不到静态文本。单列一档，两边都不折算
 *
 * 用法：node scripts/check-e2e-toast-assertions.mjs
 *      --self-test   尺子必须会开火（夹具落 tmpdir，不写进被扫描的树）
 *      --print-sites 逐位点读数（不改退出码语义）
 *      未识别的参数 ⇒ 退 2（量具故障），绝不折算成"通过"（R58：9d5787e 上打错字的参数被静默忽略、
 *      默认档照跑退 0，"这一臂不存在"与"这一臂跑了且过了"在退出码上完全同形）
 * 退码：0=通过 / 1=真实产品违规 / 2=量具故障（崩溃与打错字都不许冒充 0 或 1）
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TOAST_SELECTOR = /ant-(?:message|notification)-success|ant-result-success|ant-message-notice/;
const HELPER = 'expectSuccessToast';
/**
 * 轴 ③ 只认 getByText。
 * 第一版把 getByRole(_, {name}) 也拉进来，实测在真语料上打出 2 处假红
 * （e2e/permission.spec.ts:42、:60 的 `/保\s*存|Save/` 是**按钮**名，正则恰好命中
 * 三条含"保存"的成功文案）——按钮名不是 toast 断言，一条 FP 非 0 的规则不配当门禁，
 * 故收窄回 getByText，并把那两条假红留在注释里作为证据。
 */
const TEXT_METHODS = new Set(['getByText']);
const DYN = '\u0001'; // 模板插值占位
const VERDICTS = [
  'named',
  'helper',
  'named-text',
  'negative',
  'generic',
  'ambiguous',
  'bad-helper',
  'unresolved',
];

/**
 * 已核实的豁免位点（只管 generic 一档）：文件 → { 允许条数, 为什么不指名也安全 }
 * 读数出处：R34 同类面普查（改前泛化断言共 11 处，7 处已改指名）。
 */
const ALLOW = {
  'e2e/exception-scenarios.spec.ts': {
    // R65 续：原有两条 generic，:520（重试成功）已改成等 PUT 2xx ⇒ 额度随之降到 1。
    // 剩这一条（:387）的理由仍然成立：它是该文档内第一条成功提示，前一条是 error 提示，没有可冒充它的存活 toast。
    n: 1,
    why: '该文档内第一条成功提示，前一条是 error 提示，没有可冒充它的存活 toast',
  },
  'e2e/sse-live-events.spec.ts': {
    n: 1,
    why: '门户提交回执 `.ant-result-success` 是整页结果态，且每次都从 portal.goto 起新文档',
  },
  'e2e/helpers.ts': {
    n: 1,
    why: '同上：submitQuoteViaPortal 的门户回执态，新文档内不存在更早的成功提示',
  },
  'e2e/supplier-portal.spec.ts': {
    n: 1,
    why:
      ':50 是门户提交后的整页回执态（.ant-result-success），该文档由门户链接进入，' +
      '在此之前本页没有别的成功提示可冒充它；同文件 :110 是 toHaveCount(0) 的缺席断言，' +
      '由 negative 档处理、不占豁免额度',
  },
  'e2e/toast-impersonation.spec.ts': {
    n: 1,
    why:
      '这处未指名断言本身就是冒充实验的正例：它要的读数正是"A 的 toast 还挂在屏上时，' +
      '不指名的断言会不会通过"，所以它必须不指名才完成证明。同文件里当写落地凭据用的断言都指了名' +
      '（② 段断 /审批配置|approval/ 此刻不可见、放行后可见）。台账"必须用完"那条会盯着这格。',
  },
};

function scanFiles() {
  const dir = join(ROOT, 'e2e');
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.spec.ts')) out.push(`e2e/${name}`);
  }
  out.push('e2e/helpers.ts');
  return out.sort();
}

/* ---------------- 静态文本与实参读取 ---------------- */

function staticText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { text: node.text, dynamic: false };
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const s of node.templateSpans) out += DYN + s.literal.text;
    return { text: out, dynamic: true };
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return { text: node.text, dynamic: false, regex: node.text };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = staticText(node.left);
    const r = staticText(node.right);
    if (l && r) return { text: l.text + r.text, dynamic: l.dynamic || r.dynamic };
  }
  return null;
}

function propOf(objLiteral, name) {
  if (!objLiteral || !ts.isObjectLiteralExpression(objLiteral)) return null;
  for (const p of objLiteral.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText().replace(/['"]/g, '') === name) return p;
  }
  return null;
}

function callName(node) {
  if (!ts.isCallExpression(node)) return null;
  const c = node.expression;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  if (ts.isIdentifier(c)) return c.text;
  return null;
}

/**
 * 这条位点最终服务的断言，是"必须在场"还是"必须不在场"？
 * 缺席断言（`toHaveCount(0)`、`.not.*`）不可能被上一条残留 toast 冒充 ——
 * 恰恰相反，残留 toast 会让它翻红。所以它不进违规面，单列 negative 一档。
 * （真语料里的这个形状：e2e/supplier-portal.spec.ts:110
 *  `expect(page.locator('.ant-result-success')).toHaveCount(0)` —— 断"提交失败不得进回执态"。）
 */
function isAbsentAssertion(node) {
  let cur = node;
  let expectCall = null;
  for (let g = 0; g < 32; g += 1) {
    const p = cur.parent;
    if (!p) break;
    if (ts.isCallExpression(p) && callName(p) === 'expect') {
      expectCall = p;
      break;
    }
    cur = p;
  }
  if (!expectCall) return false;
  let chain = expectCall;
  for (let g = 0; g < 10; g += 1) {
    const p = chain.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === chain) {
      if (p.name.text === 'not') return true;
      chain = p;
      continue;
    }
    if (ts.isCallExpression(p) && p.expression === chain) {
      const m = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : '';
      const a0 = p.arguments[0];
      if (m === 'toHaveCount' && a0 && ts.isNumericLiteral(a0) && a0.text === '0') return true;
      chain = p;
      continue;
    }
    break;
  }
  return false;
}

/** 沿父链往上走同一条成员调用链，看有没有 .filter({hasText}) */
function chainHasHasText(node) {
  let cur = node;
  for (let guard = 0; guard < 64; guard += 1) {
    const p = cur.parent;
    if (!p) return false;
    if (ts.isPropertyAccessExpression(p) && p.expression === cur) {
      cur = p;
      continue;
    }
    if (ts.isCallExpression(p) && p.expression === cur) {
      if (ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'filter') {
        const arg0 = p.arguments[0];
        if (arg0 && propOf(arg0, 'hasText')) return true;
      }
      cur = p;
      continue;
    }
    // 变量间接：`const t = <chain>` 之后 `t.filter({hasText})` —— 由第二遍补判
    return false;
  }
  return false;
}

/* ---------------- 文案目录（外部事实） ---------------- */

function readJsonDict(readFile, loc) {
  try {
    return JSON.parse(readFile(`src/locales/${loc}.json`));
  } catch {
    return null;
  }
}

function lookupKey(dicts, key) {
  for (const d of dicts) {
    if (!d) continue;
    const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), d);
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** src 里 notifySuccess(...) 用到的文案：t('key') 解析成 locale 值，字面量原样收 */
function toastCatalog(readFile, srcFiles) {
  const dicts = ['zh-CN', 'en-US'].map((l) => readJsonDict(readFile, l));
  const messages = new Set();
  const missing = new Set();
  for (const rel of srcFiles) {
    const text = readFile(rel);
    if (!text.includes('notifySuccess')) continue;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true);
    walk(sf, (node) => {
      if (callName(node) !== 'notifySuccess') return;
      const a = node.arguments[0];
      if (!a) return;
      const key = i18nKeyOf(a);
      if (key) {
        const v = lookupKey(dicts, key);
        if (v) messages.add(v);
        else missing.add(key);
        return;
      }
      const s = staticText(a);
      if (s && s.text.trim()) messages.add(s.text);
    });
  }
  return { messages: [...messages], missing: [...missing], dictsOk: dicts.some(Boolean) };
}

function i18nKeyOf(node) {
  if (!ts.isCallExpression(node)) return null;
  const c = node.expression;
  const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : null;
  if (name !== 't') return null;
  const a = node.arguments[0];
  if (a && ts.isStringLiteral(a)) return a.text;
  if (a && ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  return null;
}

function walk(node, fn) {
  fn(node);
  node.forEachChild((c) => walk(c, fn));
}

/* ---------------- 主判据 ---------------- */

/** 文本型实参能吃几条成功文案（字符串按 Playwright 的子串语义，正则按 RegExp 语义） */
function matchCount(needle, messages) {
  if (needle.regex) {
    const last = needle.regex.lastIndexOf('/');
    const body = needle.regex.slice(1, last > 0 ? last : needle.regex.length);
    const flags = last > 0 ? needle.regex.slice(last + 1) : '';
    let re;
    try {
      re = new RegExp(body, flags.includes('i') ? flags : flags + 'i');
    } catch {
      return null; // 解不开：正则本身读不懂
    }
    return messages.filter((m) => re.test(m)).length;
  }
  if (!needle.text) return 0;
  return messages.filter((m) => m.includes(needle.text)).length;
}

function analyze(files, FIX) {
  const sites = [];
  for (const [rel, text] of Object.entries(files)) {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true);
    const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

    // 第一遍：locator 链的变量绑定、"变量后来被 .filter({hasText}) 用了"的名字集合、
    // 以及同文件 const 字面量绑定（给 getByText(常量) 用）
    const varOfLocator = new Map();
    const filteredVars = new Set();
    const consts = new Map();
    walk(sf, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (callName(node.initializer) === 'locator')
          varOfLocator.set(node.name.text, node.initializer);
        if (!consts.has(node.name.text)) consts.set(node.name.text, node.initializer);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'filter' &&
        ts.isIdentifier(node.expression.expression)
      ) {
        if (node.arguments[0] && propOf(node.arguments[0], 'hasText')) {
          filteredVars.add(node.expression.expression.text);
        }
      }
    });

    const needleOf = (a) => {
      if (!a) return null;
      const direct = staticText(a);
      if (direct && (direct.text || direct.dynamic === false)) return direct;
      if (ts.isIdentifier(a)) {
        const init = consts.get(a.text);
        const s = init ? staticText(init) : null;
        if (s) return { ...s, via: a.text };
        return null;
      }
      return direct;
    };

    walk(sf, (node) => {
      const name = callName(node);
      if (!name) return;
      const at = { file: rel, line: line(node.getStart(sf)) };

      if (name === 'locator') {
        const sel = staticText(node.arguments[0]);
        if (!sel) return; // 无选择器就无从判断，不进分母
        if (!TOAST_SELECTOR.test(sel.text)) return;
        if (isAbsentAssertion(node)) {
          sites.push({ ...at, verdict: 'negative', note: '缺席断言，残留 toast 只会让它更红' });
          return;
        }
        const viaVar = [...varOfLocator.entries()].find(([, n]) => n === node);
        const named = chainHasHasText(node) || Boolean(viaVar && filteredVars.has(viaVar[0]));
        sites.push({
          ...at,
          verdict: named ? 'named' : 'generic',
          note:
            [sel.dynamic ? '模板字符串选择器' : '', viaVar ? `经变量 ${viaVar[0]}` : '']
              .filter(Boolean)
              .join('，') || undefined,
        });
        return;
      }

      if (name === HELPER) {
        sites.push({ ...at, verdict: node.arguments[1] ? 'helper' : 'bad-helper' });
        return;
      }

      if (TEXT_METHODS.has(name)) {
        if (isAbsentAssertion(node)) return; // 缺席断言与"被别的 toast 冒充"无关，不进分母
        const needle = needleOf(node.arguments[0]);
        if (!needle || (needle.dynamic && needle.regex === undefined && needle.via === undefined)) {
          sites.push({
            ...at,
            verdict: 'unresolved',
            note: '实参取不到静态文本（跨文件常量或运行期拼接）',
          });
          return;
        }
        const n = matchCount(needle, FIX.messages);
        if (n === null) {
          sites.push({ ...at, verdict: 'unresolved', note: `正则实参读不懂：${needle.regex}` });
          return;
        }
        if (n === 0) return; // 与成功文案无关 ⇒ 不是本不变量的位点
        sites.push({
          ...at,
          verdict: n >= 2 ? 'ambiguous' : 'named-text',
          note: `实参 ${JSON.stringify(needle.text)} 命中 ${n} 条成功文案`,
        });
        return;
      }
    });
  }
  return sites;
}

function judge(sites, allow) {
  const errors = [];
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const s of sites) counts[s.verdict] += 1;

  const Σ = Object.values(counts).reduce((a, b) => a + b, 0);
  if (Σ !== sites.length) {
    return {
      errors: [`档位加总 ${Σ} != 站点数 ${sites.length} —— 读数作废（有档位没被计入）`],
      counts,
    };
  }

  const genericByFile = {};
  for (const s of sites.filter((x) => x.verdict === 'generic')) {
    (genericByFile[s.file] ||= []).push(s);
  }
  for (const [file, list] of Object.entries(genericByFile)) {
    const a = allow[file];
    if (!a) {
      errors.push(
        `${file}：${list.length} 处未指名的成功提示断言（行 ${list.map((s) => s.line).join(', ')}）。` +
          '修法：改用 e2e/helpers.ts 的 expectSuccessToast(page, /指名文案/)、' +
          '或给 locator 直接 .filter({hasText})；确证不可能被上一条 toast 冒充后再进豁免清单。',
      );
      continue;
    }
    if (list.length > a.n) {
      errors.push(
        `${file}：未指名断言 ${list.length} 处，超出豁免 ${a.n} 处（行 ${list.map((s) => s.line).join(', ')}）`,
      );
    }
  }
  for (const [file, a] of Object.entries(allow)) {
    const got = (genericByFile[file] || []).length;
    if (got < a.n) {
      errors.push(
        `${file}：豁免登记 ${a.n} 处，实际只剩 ${got} 处 —— 清单已过期，` +
          '请把用掉的那几条从 ALLOW 里删掉（否则这条门禁会在将来静默失效）。',
      );
    }
  }
  for (const s of sites.filter((x) => x.verdict === 'ambiguous' || x.verdict === 'bad-helper')) {
    errors.push(
      `${s.file}:${s.line} ${s.verdict === 'ambiguous' ? '文本型实参可被多条成功文案满足' : 'expectSuccessToast 未传文案参数'}（${s.note || ''}）`,
    );
  }
  // unresolved 不判红也不判绿：把它当错误会让任何一处动态实参都卡住整条门禁，
  // 但必须打印出来并计入档位，否则"看不见"会被读成"没有"。
  const notes = sites
    .filter((x) => x.verdict === 'unresolved')
    .map((x) => `  解不开 ${x.file}:${x.line} —— ${x.note}`);
  return { errors, notes, counts };
}

/* ------------------------ 参数闸门（R58 假绿的根治位） ------------------------ */

/**
 * 本门禁真正处理的参数全集，与 `main()` 里的分支、与文件头 usage 行一一对应。
 * 名单在这里而不是散在 if 里：usage 说"只认这两个"，判据就必须只认这两个。
 */
const FLAGS = ['--self-test', '--print-sites'];
const USAGE = `node scripts/check-e2e-toast-assertions.mjs [${FLAGS.join('|')}]`;
const SELF = fileURLToPath(import.meta.url);

/**
 * 真实的参数解析入口：`main()` 与自测臂走的就是同一个函数，臂不重抄判据。
 * @returns {string|null} 故障原因（点名被拒参数 + 列出接受集）；null = 全部接受
 */
function argFault(argv) {
  const bad = argv.filter((a) => !FLAGS.includes(a));
  if (!bad.length) return null;
  return (
    `未识别的参数 ${bad.map((b) => `'${b}'`).join(' ')} ⇒ 量具故障，不折算成通过。` +
    `本门禁只认：${FLAGS.join(' / ')}`
  );
}

/* ---------------- 自测 ---------------- */

function selfTest() {
  const FIX = { messages: ['审批提交成功', '已选择推荐供应商', '设置保存成功'] };
  const cases = [];
  const push = (name, ok) => cases.push({ name, ok });
  const run = (body) => {
    const dir = mkdtempSync(join(tmpdir(), 'toastgate-'));
    try {
      writeFileSync(join(dir, 'a.spec.ts'), body, 'utf8');
      const text = readFileSync(join(dir, 'a.spec.ts'), 'utf8');
      const sites = analyze({ 'e2e/a.spec.ts': text }, FIX);
      return { sites, ...judge(sites, {}) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const v = (r) => r.sites.map((s) => s.verdict);

  const A = `
test('x', async () => {
  await expect(page.locator('.ant-message-success').first()).toBeVisible();
});`;
  push('正例 generic：裸 toast 选择器必须开火', v(run(A)).includes('generic'));

  const B = `
const PRE = '.wrap';
test('x', async () => {
  await expect(page.locator(\`\${PRE} .ant-message-success\`).first()).toBeVisible();
});`;
  push('正例 ①：模板字符串选择器同样开火（旧文本判据盲区）', v(run(B)).includes('generic'));

  const C = `
test('x', async () => {
  const t = page.locator('.ant-message-success');
  await expect(t).toBeVisible();
});`;
  push('正例 ②：locator 先赋值给变量再断言，仍开火', v(run(C)).includes('generic'));

  const D = `
test('x', async () => {
  await expect(page.locator('.ant-message-success').filter({ hasText: /审批提交成功/ })).toBeVisible();
});`;
  push('反例：直接 .filter({hasText}) 不得开火', !v(run(D)).includes('generic'));

  const E = `
test('x', async () => {
  const t = page.locator('.ant-message-success');
  await expect(t.filter({ hasText: /审批提交成功/ })).toBeVisible();
});`;
  const e = run(E);
  push(
    '反例：变量→下一行 filter 判为合规（named，且不留 generic）',
    !v(e).includes('generic') && v(e).includes('named'),
  );

  const F = `
test('x', async () => { await expectSuccessToast(page, /审批提交成功/); });`;
  push(
    '反例：走 sanctioned helper 判 helper',
    v(run(F)).includes('helper') && !v(run(F)).includes('bad-helper'),
  );

  const G = `
test('x', async () => { await expectSuccessToast(page); });`;
  push('正例：helper 少传文案参数必须开火', v(run(G)).includes('bad-helper'));

  const H = `
test('x', async () => { await expect(page.getByText('成功')).toBeVisible(); });`;
  push('正例 ③：实参是三条成功文案的共同子串 ⇒ ambiguous', v(run(H)).includes('ambiguous'));

  const I = `
test('x', async () => { await expect(page.getByText('审批提交成功')).toBeVisible(); });`;
  push('反例 ③：实参唯一命中一条成功文案 ⇒ 合规', v(run(I)).includes('named-text'));

  const J = `
test('x', async () => { await expect(page.getByText('本月询价单')).toBeVisible(); });`;
  push('对账：与 toast 无关的 getByText 不进分母', run(J).sites.length === 0);

  const K = `
test('x', async () => { await expect(page.getByText(label)).toBeVisible(); });`;
  push('解不开档：实参是跨文件变量 ⇒ 既不合规也不违规，单独成档', v(run(K)).includes('unresolved'));

  const K2 = `
const NEEDLE = '审批提交成功';
test('x', async () => { await expect(page.getByText(NEEDLE)).toBeVisible(); });`;
  push(
    '同文件常量解析：getByText(常量) 要能吃到值 ⇒ named-text 而不是 unresolved',
    v(run(K2)).includes('named-text'),
  );

  const M = `
test('x', async () => {
  await expect(page.locator('.ant-result-success')).toHaveCount(0);
});`;
  push(
    '缺席断言（toHaveCount(0)）不得算未指名 ⇒ negative 一档',
    v(run(M)).includes('negative') && !v(run(M)).includes('generic'),
  );

  const N = `
test('x', async () => {
  await expect(page.locator('.ant-message-success').first()).not.toBeVisible();
});`;
  push('缺席断言（.not.*）同样不得算未指名', !v(run(N)).includes('generic'));

  const O = `
test('x', async () => {
  await expect(page.getByRole('button', { name: /保\\s*存|Save/ })).toBeVisible();
});`;
  push('假红对照：按钮名（getByRole）不是 toast 断言，不进分母', run(O).sites.length === 0);

  const L = `
test('x', async () => {
  await expect(page.locator('.ant-message-success').first()).toBeVisible();
});`;
  const withAllow = judge(analyze({ 'e2e/a.spec.ts': L }, FIX), { 'e2e/a.spec.ts': { n: 2 } });
  push(
    '台账反向：豁免登记 2 处而实际只剩 1 处 ⇒ 判"清单已过期"',
    withAllow.errors.some((x) => x.includes('清单已过期')),
  );

  const r = run(A);
  push(
    '对账：Σ档位 == 站点数',
    r.sites.length === 1 && Object.values(r.counts).reduce((a, b) => a + b, 0) === 1,
  );

  // 破坏性对照：把判据里的 TOAST_SELECTOR 判不到的形状（类名改名）读成零站点——
  // 如果哪天分母规则失效，这条会先红
  push('对账：真语料站点数 > 0（尺子不是空转）', realReading().sites.length > 0);

  /* 参数闸门两极性（R58）：都由 spawnSync 打**真实 CLI**，臂不重抄判据。
     · 未识别参数必须退 2（打错字不得冒充通过）
     · 有效参数不得退 2，且 '--self-test' 必须真的抵达自测档（"拒绝一切"的解析器也不算修好）
     子进程带 GATE_ARG_NO_SPAWN=1：只跳过会自测套自测的那一臂，其余臂照跑。 */
  const typo = spawnSync(process.execPath, [SELF, '--self-tset'], { encoding: 'utf8' });
  const typoMsg = `${typo.stderr || ''}\n${typo.stdout || ''}`;
  push(
    `臂ARG-1 参数闸门开火：真实 CLI 收到 '--self-tset' ⇒ rc=${typo.status}（应为 2）、` +
      `点名该参数并列出 ${FLAGS.join('/')}`,
    typo.status === 2 && typoMsg.includes('--self-tset') && FLAGS.every((f) => typoMsg.includes(f)),
  );
  const sites = spawnSync(process.execPath, [SELF, '--print-sites'], { encoding: 'utf8' });
  push(
    `臂ARG-2 参数闸门反极性：有效参数不得被拒（rc=${sites.status}，应 ≠2）` +
      `——无参数与每个在册参数都得被接受，FLAGS=${JSON.stringify(FLAGS)}`,
    sites.status !== 2 &&
      argFault([]) === null &&
      FLAGS.includes('--self-test') &&
      FLAGS.every((f) => argFault([f]) === null),
  );
  if (process.env.GATE_ARG_NO_SPAWN) {
    push(
      '臂ARG-3 SKIP：--self-test 端到端臂由父自测进程关掉（GATE_ARG_NO_SPAWN=1，防自测套自测）',
      true,
    );
  } else {
    const good = spawnSync(process.execPath, [SELF, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, GATE_ARG_NO_SPAWN: '1' },
    });
    const goodOut = `${good.stdout || ''}\n${good.stderr || ''}`;
    push(
      `臂ARG-3 真 CLI 的 --self-test：rc=${good.status}（应 ≠2）且输出里有自测档收尾读数`,
      good.status !== 2 && goodOut.includes('判据自测'),
    );
  }

  let rc = 0;
  for (const c of cases) {
    rc = c.ok ? rc : 1;
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
  }
  const real = realReading();
  const j = judge(real.sites, ALLOW);
  if (j.errors.length) {
    console.log('FAIL 真实仓库读数未过门禁（自测不得放过）');
    for (const e2 of j.errors) console.log(`  ${e2}`);
    rc = 1;
  }
  console.log(
    `判据自测 ${cases.filter((c) => c.ok).length}/${cases.length} ${rc === 0 ? '通过' : '失败'}`,
  );
  return rc;
}

/* ---------------- 真实语料 ---------------- */

function srcTsFiles() {
  const out = [];
  const dirs = [
    'src/pages',
    'src/utils',
    'src/store',
    'src/components',
    'src/layouts',
    'src/hooks',
  ];
  const ls = (d) => {
    try {
      return readdirSync(resolve(ROOT, d), { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const d of dirs) {
    for (const e of ls(d)) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === '__tests__') continue;
        for (const g of ls(rel))
          if (g.isFile() && /\.(ts|tsx)$/.test(g.name)) out.push(`${rel}/${g.name}`);
      } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
  }
  return out;
}

function readFileReal(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function catalog() {
  return toastCatalog(readFileReal, srcTsFiles());
}

function realReading() {
  const cat = catalog();
  const files = {};
  for (const f of scanFiles()) files[f] = readFileReal(f);
  return { sites: analyze(files, { messages: cat.messages }), cat };
}

function main() {
  const args = process.argv.slice(2);
  const badArg = argFault(args);
  if (badArg) {
    console.error(`✘ ${badArg}`);
    console.error(`  用法：${USAGE}`);
    return 2;
  }
  if (args.includes('--self-test')) return selfTest();
  const { sites, cat } = realReading();
  // 前提：文案目录取不到时不得判绿——ambiguous 档会静默变零命中
  if (!cat.dictsOk || !cat.messages.length) {
    console.error(
      '✗ 前提缺失：读不到 src/locales 的成功文案目录，ambiguous 档无从判断（读数作废）',
    );
    return 2;
  }
  const { errors, notes, counts } = judge(sites, ALLOW);
  const Σ = Object.values(counts).reduce((a, b) => a + b, 0);
  if (Σ !== sites.length) {
    console.error(`✗ Σ档位 ${Σ} != 站点数 ${sites.length}，读数作废`);
    return 2;
  }
  if (process.argv.includes('--print-sites')) {
    for (const s of sites)
      console.log(`  ${s.file}:${s.line} ${s.verdict}${s.note ? ' — ' + s.note : ''}`);
  }
  if (errors.length) {
    console.error('✗ E2E 写落地凭据判据（AST 版）未通过：');
    for (const e of errors) console.error(`  ${e}`);
    for (const n of notes) console.error(n.replace('  解不开', '  解不开（伴随红）'));
    return 1;
  }
  for (const n of notes) console.log(n);
  const parts = VERDICTS.filter((v) => counts[v]).map((v) => `${v}=${counts[v]}`);
  console.log(
    `✔ E2E 写落地凭据判据通过：站点 ${sites.length}（${parts.join(' ')}）；` +
      `未指名豁免 ${Object.values(ALLOW).reduce((a, b) => a + b.n, 0)} 处全部在册；` +
      `文案目录 ${cat.messages.length} 条`,
  );
  if (cat.missing.length) {
    console.log(
      `  限度：${cat.missing.length} 个 notifySuccess 的 key 在 locale 里解析不到值 ⇒ 这些文案不参与 ambiguous 判定`,
    );
  }
  console.log(
    '  限度：跨文件的 locator 变量别名与选择器常量（在别的文件里定义的字符串）判为解不开，不折算成合规',
  );
  return 0;
}

/** 崩溃不得冒充产品判红：未捕获异常一律按量具故障退 2（沿用 check-settings-inert.mjs 的约定）。 */
function toolFault(e) {
  console.error(
    '✘ 量具故障（未捕获异常，不得当成产品判红）：',
    e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e,
  );
  return 2;
}

try {
  process.exit(main());
} catch (e) {
  process.exit(toolFault(e));
}
