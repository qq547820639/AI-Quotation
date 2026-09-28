#!/usr/bin/env node
/* global console, process */
/**
 * 「R 号引用必须落得到格」判据（R100）
 *
 * 存在理由：本轮我在 `scripts/check-e2e-attribution-wrap.mjs` 的头顶注释里写了"登记于 R97"，
 * 而登记册那一格实际落成了 R98——**一个指向不存在的格的指针**，读的人按它去找会一无所获。
 * 这类句子在本仓到处都是（5900 行登记册＋代码里的 `R32 残留`、`R44 的守卫`），手工只查得了一次。
 * R95 那条"文档里的前向引用同样是已做主张"是纪律，这条把它变成门禁。
 *
 * 分母（一句话写死）：**除登记册自身以外**的全部 `git ls-files` 跟踪文件里出现的每个
 * `R<两位以上数字>` 记号；记号必须在登记册里出现过才算落得到格。
 * 排除登记册本身：它内部互相引用属于同一本账，自引用没有信息量。
 *
 * 已知看不见的一面（写在脸上）：
 *   1) 只认 `Rnn` 记号；"见上面那轮"这类没编号的指针看不见。
 *   2) "登记册里出现过号"不等于"那一格是条目"——正文引用也算（被多处引用的号通常确实是某轮记录）；
 *      要严格到"必须是条目"得改判据并另配反证臂。
 *
 * 用法：node scripts/check-doc-references.mjs [--self-test|--json]
 * 退码：0=全部落得到格 / 1=有悬空引用 / 2=量具故障（读不到登记册、git 不可用、参数打错）
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-doc-references.mjs';
const REGISTER = '.trae/documents/仓库运行风险评估与修复计划.md';
const TOKEN = /\bR(\d{2,3})\b/g;

/** 返回 { tracked, refs(悬空), known }；任何前提读不到都抛错（调用方映射到退码 2）。 */
function analyze(root) {
  let registerText;
  try {
    registerText = readFileSync(join(root, REGISTER), 'utf8');
  } catch (e) {
    throw new Error(`读不到登记册 ${REGISTER}：${e.message}`);
  }
  const known = new Set([...registerText.matchAll(TOKEN)].map((m) => Number(m[1])));
  if (known.size === 0)
    throw new Error('登记册里一个 R 号都没有——前提塌了，不能把"空"读成"所有引用都悬空"');
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch (e) {
    throw new Error(`git ls-files 失败（不是仓库或 git 不在 PATH）：${e.message}`);
  }
  const refs = [];
  for (const f of tracked) {
    if (f === REGISTER) continue;
    let s;
    try {
      s = readFileSync(join(root, f), 'utf8');
    } catch {
      continue; // 二进制或读不动：不算站点，也不算通过
    }
    const lines = s.split('\n');
    for (const m of s.matchAll(TOKEN)) {
      const n = Number(m[1]);
      if (known.has(n)) continue;
      const line = s.slice(0, m.index).split('\n').length;
      refs.push({ file: f, num: n, line, snippet: (lines[line - 1] || '').trim().slice(0, 90) });
    }
  }
  return { tracked, refs, known: known.size };
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-refs-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

/** 自检：每条轴正反成对，且必须证明这把尺子会开火；夹具一律落 tmpdir。 */
function selfTestRun() {
  const root = fixture({
    [REGISTER]: '# 登记册\n\n**R31：一条记录**\n\n正文里也提一次 R12 作为历史引用。\n',
    'scripts/ok.mjs': '// 引用 R31（条目号）与 R12（正文引用），两个号登记册里都在\n',
    'scripts/bad.mjs': '// 引用 R77，登记册里没有这一格\n',
    'notes/clean.txt': '完全没有 R 记号的一行\n',
  });
  const cases = [];
  const push = (name, ok) => cases.push({ name, ok });
  try {
    const res = analyze(root);
    push(
      '正例：指向不存在格的引用必须被点名（含文件、行号、原文片段）',
      res.refs.length === 1 &&
        res.refs[0].num === 77 &&
        res.refs[0].file === 'scripts/bad.mjs' &&
        res.refs[0].line > 0 &&
        /R77/.test(res.refs[0].snippet),
    );
    push(
      '反例：条目号与正文引用号都算"落得到格"，不得判红',
      !res.refs.some((r) => r.file === 'scripts/ok.mjs'),
    );
    push(
      '无记号的文件不进分母（不因"没引用"被报成问题）',
      !res.refs.some((r) => r.file === 'notes/clean.txt'),
    );
    push('登记册自身排除（自引用不算悬空）', !res.refs.some((r) => r.file === REGISTER));
    push('分母是跟踪文件数（4 个）', res.tracked.length === 4);

    // 悬空被修掉后必须转绿：把 R77 改成已存在的号，同一棵树的读数就该是 0 处
    writeFileSync(join(root, 'scripts/bad.mjs'), '// 改成 R31 之后不该再有悬空\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    push('修好后同一棵树必须转绿（否则红绿同源，断言恒真）', analyze(root).refs.length === 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // 故障档：空登记册与读不到登记册都必须是"前提塌"，不是"全绿"也不是"全悬空"
  let emptyThrew = '';
  const root2 = fixture({ [REGISTER]: '\n' });
  try {
    analyze(root2);
  } catch (e) {
    emptyThrew = e.message;
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
  push('空登记册 ⇒ 报"前提塌"，而不是把所有引用判成悬空', /前提塌/.test(emptyThrew));

  const root3 = mkdtempSync(join(tmpdir(), 'docs-refs-none-'));
  let missingThrew = '';
  try {
    analyze(root3);
  } catch (e) {
    missingThrew = e.message;
  } finally {
    rmSync(root3, { recursive: true, force: true });
  }
  push(
    '读不到登记册 ⇒ 报错而不是返回空集（空集会冒充"全部通过"）',
    /读不到登记册/.test(missingThrew),
  );

  const bad = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
  console.log(`${SELF} 自测：${cases.length - bad.length}/${cases.length} 通过`);
  process.exit(bad.length ? 1 : 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTestRun();
  const unknown = args.filter((a) => a !== '--json');
  if (unknown.length) {
    console.error(`✗ 未知参数：${unknown.join(' ')}（本件只接 --self-test|--json）`);
    process.exit(2);
  }
  let res;
  try {
    res = analyze(ROOT);
  } catch (e) {
    console.error(`✗ 量具故障：${e.message}`);
    process.exit(2);
  }
  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        { tracked: res.tracked.length, known: res.known, dangling: res.refs },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `跟踪文件 ${res.tracked.length} 个、登记册出现过 ${res.known} 个 R 号：` +
        (res.refs.length ? `${res.refs.length} 处悬空引用` : '每个 R 引用都落得到格'),
    );
    for (const r of res.refs)
      console.log(`✗ ${r.file}:${r.line} 引用 R${r.num} —— 登记册里没有这个号｜${r.snippet}`);
    console.log('限度：只认 Rnn 记号（"见上面那轮"看不见）；"出现过号"不要求那一格是条目。');
  }
  process.exit(res.refs.length ? 1 : 0);
}

main();
