#!/usr/bin/env node
/* global console, process */
/**
 * 「写了本地存储却宣称成功」判据（R50）
 *
 * 存在理由：`src/utils/storage.ts` 的三个写函数（saveJSON / removeKey / clearAll）过去把
 * QuotaExceededError / SecurityError 自己吞掉并返回 void ⇒ 调用方拿不到任何回执；
 * 而登记册 R48 的普查发现多处正好在这之后弹"已保存/已清空/已删除"的成功提示。
 * 那不是文案问题，是**主张超出了凭据**：写没成，UI 已经替用户宣布成了。
 *
 * 判据（函数粒度、AST 面，不用文本窗口猜）：
 *   同一个函数体内，若某个 storage 写调用的返回值被丢弃（表达式语句），它**之后**同函数里
 *   出现 notifySuccess(...)，**且该函数拿不出任何别的凭据** ⇒ 判红。
 * "拿不出别的凭据"这条是必须的收窄：首版只看"丢弃 + 后面有成功提示"，76 站点里报出 4 处，
 * 其中 `inquiry/create/index.tsx:450/500` 是假阳——那两处 await 了 addInquiry/sendInquiry 并读过
 * `result.success` / `sent.success`，removeKey(DRAFT_KEY) 只是收尾清理，成功主张另有凭据。
 * 证据 = 函数里出现过 `.success` 读取，或出现过 `await 某调用`（axios 失败会抛，await 本身就是凭据）。
 * 四档读数：
 *   checked      写结果被消费（赋值/条件/判 `.success`）
 *   evidenced    写结果被丢弃、同函数有成功提示，但另有凭据（await / .success 读取）⇒ 允许
 *   quiet        写结果被丢弃，该函数不宣称成功 ⇒ 允许（快照持久化就是这种）
 *   lying        丢弃 + 宣称成功 + 无任何凭据 ⇒ 违规
 * 另有 self 一档：storage.ts 自己的定义点，不进分母。
 * quiet 档另有一条**只减不增的棘轮**（见 QUIET_BASELINE）：新增静默丢弃写回执的站点会判红，
 * 因为它意味着"又一处写没成没人知道"，要么接住回执、要么显式改基线并写明理由。
 *
 * 用法：node scripts/check-storage-receipt.mjs [--self-test|--print-sites|--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE_FNS = new Set(['saveJSON', 'removeKey', 'clearAll']);
const SUCCESS_FNS = new Set(['notifySuccess']);

function scanFilesRel() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name))
        out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src'));
  return out.sort();
}

/** 找表达式所在的最内层函数节点 */
function enclosingFunction(node) {
  let n = node.parent;
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n)
    ) {
      return n;
    }
    n = n.parent;
  }
  return undefined;
}

/** 该函数里所有 notifySuccess 调用的起点位置 */
function successPoints(fn) {
  const pts = [];
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      SUCCESS_FNS.has(n.expression.text)
    ) {
      pts.push(n.getStart(fn.getSourceFile()));
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return pts;
}

/** 函数内是否存在"别的凭据"：读过 `.success`，或 await 过某个调用 */
function hasEvidence(fn) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'success') {
      found = true;
      return;
    }
    if (ts.isAwaitExpression(n) && ts.isCallExpression(n.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

function getCalleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

/**
 * @param {(rel:string)=>string} getText  语料取号（自测可注入虚拟语料）
 * @param {()=>string[]}          listFiles 文件清单（自测给虚拟清单，真实跑给 scanFiles）
 */
function analyze(getText, listFiles = scanFilesRel) {
  const sites = [];
  for (const rel of listFiles()) {
    const text = getText(rel);
    if (text === undefined) continue;
    const abs = join(ROOT, rel);
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    if (rel === 'src/utils/storage.ts') continue; // 定义/内部实现自成
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const name = getCalleeName(n);
        if (name && WRITE_FNS.has(name)) {
          const fn = enclosingFunction(n);
          const start = n.getStart(sf);
          const discarded = n.parent && ts.isExpressionStatement(n.parent);
          const succ = fn ? successPoints(fn).filter((p) => p > start) : [];
          let bucket;
          if (!fn) bucket = 'top-level';
          else if (discarded && succ.length > 0)
            bucket = fn && hasEvidence(fn) ? 'evidenced' : 'lying';
          else if (discarded) bucket = 'quiet';
          else bucket = 'checked';
          sites.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(start).line + 1,
            fn: name,
            bucket,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sites;
}

const real = (f) => {
  try {
    return readFileSync(join(ROOT, f), 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * quiet 档棘轮（只减不增）。2026-09-27 现算 `quiet=74`。
 * 为什么用数字而不是逐条豁免名单：这几十处里绝大多数是 store 里"每次变更后整表镜像"
 * 的正常形状（`saveJSON(KEY, 全量数组)`），逐条列名会把门禁变成清单维护负担。
 * 但它必须有名有数：新增一处静默丢弃就得连这个数字一起改，评审时看得见。
 * 修掉一处静默丢弃后请把常量一并下调，否则棘轮停在虚高水位上不再起作用。
 */
const QUIET_BASELINE = 74;

function check(getText, listFiles, opts = {}) {
  const sites = analyze(getText, listFiles);
  const tally = {};
  for (const s of sites) tally[s.bucket] = (tally[s.bucket] ?? 0) + 1;
  const errors = [];
  for (const s of sites) {
    if (s.bucket === 'lying') {
      errors.push(
        `${s.file}:${s.line}：${s.fn}() 的返回值被丢弃，同一函数随后又弹成功提示 ⇒ ` +
          '写没成也会报"已保存"。修法：接住回执，失败时走 notifyError/notifyWarning。',
      );
    }
    if (s.bucket === 'top-level') {
      errors.push(`${s.file}:${s.line}：模块顶层的 ${s.fn}() 调用判不出函数边界，需人工定档`);
    }
  }
  // 反向：判据不能看不见东西——分母为 0 就是尺子坏了
  if (sites.length === 0) errors.push('整仓零个 storage 写调用 ⇒ 尺子或作用域坏了，不信这个绿');
  const sum = Object.values(tally).reduce((a, b) => a + b, 0);
  if (sum !== sites.length) errors.push(`Σ档位 ${sum} != 站点数 ${sites.length}`);
  // 棘轮只在真实语料上启用（自测夹具的 quiet 是 1，拿它判基线没有意义）
  if (typeof opts.quietBaseline === 'number' && (tally.quiet ?? 0) > opts.quietBaseline) {
    errors.push(
      `quiet 档 ${tally.quiet ?? 0} 超过棘轮基线 ${opts.quietBaseline} ⇒ ` +
        '新增了一处静默丢弃写回执的站点。要么接住回执，要么把它做成有意的丢弃并在说明里写清为什么。',
    );
  }
  return { errors, sites, tally };
}

/** 夹具共 6 个写站点：checked 1 / lying 3 / quiet 1 / evidenced 1，少一个就是虚拟语料没被扫到 */
function sites_check(tally) {
  const want = { lying: 3, evidenced: 1, checked: 1, quiet: 1 };
  for (const [k, v] of Object.entries(want)) {
    if ((tally[k] ?? 0) !== v) {
      console.error(
        `✗ 自检失败：夹具档位 ${k} 期望 ${v}，实际 ${tally[k] ?? 0} ⇒ 虚拟语料没被扫到`,
      );
      return false;
    }
  }
  return true;
}

function selfTest() {
  const fixtures = {
    'src/a.ts': `
import { saveJSON, removeKey } from '@/utils/storage';
import { notifySuccess } from '@/utils/confirm';
export function saveOk() { const r = saveJSON('k', 1); if (!r.success) return; notifySuccess('已保存'); }
export function saveLying() { saveJSON('k', 1); notifySuccess('已保存'); }
export function removeLying() { removeKey('k'); notifySuccess('已删除'); }
export function quiet() { saveJSON('snapshot', 1); }
export async function evidenced(v) { const r = await addInquiry(v); if (!r.success) return; removeKey('draft'); notifySuccess('已保存'); }
`,
    'src/b.ts': `
import { saveJSON } from '@/utils/storage';
import { notifySuccess } from '@/utils/confirm';
export const arrowLying = () => { saveJSON('k', 2); setTimeout(() => notifySuccess('x')); };
`,
  };
  const byName = (f) => (f in fixtures ? fixtures[f] : real(f));
  const fixtures_ = () => Object.keys(fixtures);
  const { errors, tally } = check(byName, fixtures_);
  const bad = errors.filter((e) => !e.startsWith('整仓') && !e.startsWith('Σ'));
  if (bad.length !== 3) {
    console.error(
      `✗ 自检失败：注入 3 处无凭据违规（saveLying/removeLying/arrowLying），实际判红 ${bad.length}`,
    );
    for (const e of bad) console.error('   ', e);
    return 1;
  }
  if (tally.checked !== 1 || tally.quiet !== 1 || tally.evidenced !== 1) {
    console.error('✗ 自检失败：合规侧/静默侧档位不对', JSON.stringify(tally));
    return 1;
  }
  // 反向对照：把违规函数里的成功提示删掉 ⇒ 必须落到 quiet，不开火
  const noToast = { ...fixtures };
  noToast['src/a.ts'] = noToast['src/a.ts'].replace(
    " saveJSON('k', 1); notifySuccess('已保存');",
    " saveJSON('k', 1);",
  );
  const second = check((f) => (f in noToast ? noToast[f] : real(f)), fixtures_);
  const secondBad = second.errors.filter((e) => !e.startsWith('整仓') && !e.startsWith('Σ'));
  if (secondBad.length !== 2 || second.tally.quiet !== 2) {
    console.error('✗ 自检失败：去掉成功提示后仍判红 ⇒ 判据把"丢弃结果"本身当成了违规（过严）');
    return 1;
  }
  // 夹具必须真的被扫到，否则"红了几处"是真实仓库给的，自测就成了自证
  if (tally.lying === undefined || sites_check(tally) === false) return 1;
  // 棘轮两极性：基线压到 0 必须开火、放宽到 10 必须不开火。
  // 缺这一臂的话，"只减不增"完全可能是一条永不发火的摆设——它红不红取决于有没有人写过它。
  const tight = check(byName, fixtures_, { quietBaseline: 0 });
  if (!tight.errors.some((e) => e.startsWith('quiet 档'))) {
    console.error('✗ 自检失败：基线压到 0 仍未判红 ⇒ quiet 棘轮不会开火，它不是门禁');
    return 1;
  }
  const loose = check(byName, fixtures_, { quietBaseline: 10 });
  if (loose.errors.some((e) => e.startsWith('quiet 档'))) {
    console.error('✗ 自检失败：基线放宽到 10 仍判红 ⇒ 棘轮把"低于基线"也当成了违规（判反了）');
    return 1;
  }
  // 真实仓库必须干净（否则这条门禁是空转的红），棘轮同样按真实基线判一次
  const realRun = check(real, scanFilesRel, { quietBaseline: QUIET_BASELINE });
  if (realRun.errors.length) {
    console.error('✗ 自检失败：真实仓库未过门禁（先修产品，再谈尺子）');
    for (const e of realRun.errors) console.error('   ', e);
    return 1;
  }
  if ((realRun.tally.quiet ?? 0) < QUIET_BASELINE) {
    console.error(
      `⚠ quiet 档实际 ${realRun.tally.quiet ?? 0} 已低于基线 ${QUIET_BASELINE}，` +
        '请把 QUIET_BASELINE 一并下调，否则棘轮停在虚高水位上不再起作用（本轮不判红）',
    );
  }
  console.log(
    `✔ 自检通过：注入 3 处开火、去掉成功提示后降到 2 处（丢弃≠违规）、` +
      `合规侧 checked/quiet 各 1 不掉档、棘轮两极性开火/不开火各一次；` +
      `真实仓库 ${realRun.sites.length} 站点全绿（quiet 基线 ${QUIET_BASELINE}）`,
  );
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());
  // 量具必须能在真实语料上被证明会开火，否则"只减不增"只是在夹具上自证。
  // QUIET_BASELINE=<n> 覆盖基线，用来在真树上跑两极性（今天的树：73 必红、74 必绿）。
  const fromEnv = Number.parseInt(process.env.QUIET_BASELINE ?? '', 10);
  const baseline = Number.isFinite(fromEnv) ? fromEnv : QUIET_BASELINE;
  const { errors, sites, tally } = check(real, undefined, { quietBaseline: baseline });
  if (args.includes('--print-sites')) {
    for (const s of sites) console.log(`${s.bucket.padEnd(8)} ${s.file}:${s.line} ${s.fn}()`);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({ sites, tally, errors }));
    process.exit(errors.length ? 1 : 0);
  }
  if (errors.length) {
    console.error('✗ 本地存储写回执判据未通过：');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  const t = Object.entries(tally)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`✔ 本地存储写回执判据通过：站点 ${sites.length}（${t}）｜quiet 基线 ${baseline}`);
  return 0;
}

process.exit(main());
