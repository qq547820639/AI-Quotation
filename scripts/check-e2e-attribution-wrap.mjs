#!/usr/bin/env node
/* global console, process */
/**
 * 「现场包装必须引用账本」判据（R95 / R96 一族，登记于 R97）
 *
 * 存在理由：R95 给两类"说不清的红"装了现场包装——把 `.catch` 里的错误文本从一句话
 * 改成"原文｜现场"（现场＝ `apiActivity(page)`：当时 URL、`/api` 非 2xx 计数、那次读响应过几条）。
 * 但 R95 自己留了一条未验证面：`e2e/exception-scenarios.spec.ts` 里那次 GET 的包装
 * **没有任何常驻断言钉着**，删掉它不会有测试翻红。Playwright 侧补不了这一口
 * （那个函数要真后端场地才能跑到），所以按本仓既有做法交给源码形状门禁：
 * **凡是把 `.catch(e => throw)` 用作"给错误补现场"的地方，现场必须真的来自 `apiActivity`。**
 *
 * 分母（一句话写死）：`e2e 目录里的 .ts 文件` 里所有形如
 *   `.catch((e: ...) => { ... throw new Error(...) ... })`
 * 的 CallExpression——即"捕获后重新抛出"的包装点。不在此形状里的 `.catch(() => {})`
 * （吞掉错误）与 `.catch(console.error)`（不重抛）**不算站点**，因为它们不带"补现场"的意图。
 *
 * 已知看不见的一面（写在脸上）：
 *   1) 只认"重抛型 catch"。若有人改成"在 throw 前 console.log 现场"，本件看不见；
 *   2) 只要求出现 `apiActivity(` 调用，不核对它传的确实是同一页（跨页张冠李戴看不见）。
 *
 * 用法：node scripts/check-e2e-attribution-wrap.mjs [--self-test|--print-sites|--json]
 * 退码：0=通过 / 1=真实违规 / 2=量具故障（读不到语料、参数打错都不许冒充 0 或 1）
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-e2e-attribution-wrap.mjs';
const TARGET_DIRS = ['e2e'];

/** 递归列出目录下所有 .ts（跳过明显的生成物与测试产物目录）。 */
function listSources(root) {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', 'coverage']);
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      throw new Error(`读不到目录 ${dir}: ${e.message}`);
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) walk(p);
      } else if (/\.(ts)$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) {
        out.push(p);
      }
    }
  };
  for (const d of TARGET_DIRS) walk(join(root, d));
  return out.sort();
}

/** 该箭头函数体里是否存在 `throw`。 */
function bodyThrows(fn, sf) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isThrowStatement(n) || ts.isThrowExpression(n)) found = true;
    n.forEachChild(visit);
  };
  if (fn.body) {
    if (ts.isBlock(fn.body)) fn.body.forEachChild(visit);
    else visit(fn.body);
  }
  void sf;
  return found;
}

/** 一个"重抛型 catch"包装点，返回它的文本与行号（行号来自真实 SourceFile，不用 pos）。 */
function catchWrapSites(sf) {
  const sites = [];
  const seen = new Set();
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0];
      if ((ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.parameters.length >= 1) {
        const throws = bodyThrows(arg, sf);
        if (throws) {
          const key = `${sf.fileName}:${node.getStart(sf)}:${node.end}`;
          if (!seen.has(key)) {
            seen.add(key);
            const text = node.getText(sf);
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            sites.push({
              file: sf.fileName,
              line: line + 1,
              text,
              hasLedger: /apiActivity\s*\(/.test(text),
            });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return sites;
}

function analyze(root) {
  const files = listSources(root);
  const sites = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    for (const s of catchWrapSites(sf)) sites.push({ ...s, file: f.replace(`${root}/`, '') });
  }
  return { sites, fileCount: files.length };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTestRun();
  const print = args.includes('--print-sites');
  const asJson = args.includes('--json');
  const others = args.filter((a) => !a.startsWith('--'));
  if (others.length) {
    console.error(`✗ 未知参数：${others.join(' ')}（本件只接 --self-test|--print-sites|--json）`);
    process.exit(2);
  }
  let res;
  try {
    res = analyze(ROOT);
  } catch (e) {
    console.error(`✗ 量具故障，读不到语料：${e.message}`);
    process.exit(2);
  }
  const bad = res.sites.filter((s) => !s.hasLedger);
  if (asJson) {
    console.log(JSON.stringify({ files: res.fileCount, total: res.sites.length, bad }, null, 2));
  } else {
    console.log(
      `现场包装站点 ${res.sites.length} 处（扫 ${res.fileCount} 个 ${TARGET_DIRS.join('/')} 文件）：` +
        (bad.length ? `其中 ${bad.length} 处没引用 apiActivity` : '全部带账本现场'),
    );
    if (print)
      for (const s of res.sites) console.log(`  ${s.file}:${s.line} 带现场=${s.hasLedger}`);
    for (const s of bad)
      console.log(`✗ ${s.file}:${s.line} 重抛型 catch 没有把现场（apiActivity）并进错误文本`);
    console.log(
      `限度：只认"捕获后重抛"这一形状；改成 throw 前打日志的形状看不见；也不核对 apiActivity 传的是不是同一页。`,
    );
  }
  process.exit(bad.length ? 1 : 0);
}

/** 自检：每条轴都要正反成对，且必须证明这把尺子会开火。夹具一律落 tmpdir。 */
function selfTestRun() {
  const root = mkdtempSync(join(tmpdir(), 'attr-wrap-'));
  const w = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    return p;
  };
  try {
    w(
      'e2e/ok.spec.ts',
      `export async function f(page: any) {
  await page.evaluate(() => 1).catch((e: Error) => {
    throw new Error(\`\${e.message}｜\${apiActivity(page)}\`);
  });
}
`,
    );
    w(
      'e2e/bad.spec.ts',
      `export async function g(page: any) {
  await page.waitForResponse(() => true).catch((e: Error) => {
    throw new Error(e.message);
  });
}
`,
    );
    w(
      'e2e/notsite.spec.ts',
      `export async function h(page: any) {
  await page.evaluate(() => 1).catch(() => {});
  await page.goto('/x').catch(console.error);
}
`,
    );
    const res = analyze(root);
    const byFile = (frag) => res.sites.filter((s) => s.file.includes(frag));
    const cases = [];
    const push = (name, ok) => cases.push({ name, ok });
    push(
      '正例：重抛但没引用账本 ⇒ 必须判红',
      byFile('bad.spec.ts').length === 1 && !byFile('bad.spec.ts')[0].hasLedger,
    );
    push(
      '反例：重抛且引用 apiActivity ⇒ 不得判红',
      byFile('ok.spec.ts').length === 1 && byFile('ok.spec.ts')[0].hasLedger,
    );
    push(
      '形状外不进分母：吞掉的 .catch(() => {}) 与不重抛的 .catch(console.error)',
      byFile('notsite.spec.ts').length === 0,
    );
    push('对账：Σ站点 == 分母（此处 2）', res.sites.length === 2);
    push('行号来自真实 SourceFile（非 0）', byFile('bad.spec.ts')[0].line > 0);

    let emptyErr = '';
    try {
      analyze(join(root, 'no-such-dir'));
    } catch (e) {
      emptyErr = e.message;
    }
    push('读不到语料时报错而不是静默返回空集（空集会被读成"全绿"）', emptyErr.length > 0);

    const bad = cases.filter((c) => !c.ok);
    for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
    console.log(`${SELF} 自测：${cases.length - bad.length}/${cases.length} 通过`);
    process.exit(bad.length ? 1 : 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
