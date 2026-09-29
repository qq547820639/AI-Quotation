#!/usr/bin/env node
/* global console, process */
/**
 * 把 Playwright 的 JSON 报表打成"每条红用例一句人话 + 最慢 N 条"的摘要，供 CI 贴回 PR。
 *
 * 为什么要它：零重试档的 runner 读数只有 `5 failed / 4 skipped / 215 passed` 这种计数，
 * 逐条错误在 4400 行日志的中段，而取证载体只取失败步时间窗的结尾 60 行 ⇒ 两轮读数
 * （R88 的 6 格与 run=36380814151 的 5 格）互相没有交集，却谁也说不清"这一格到底报的什么错"。
 * 本件从 JSON 里按用例取 `error.message` 首行、时长与起止时刻，把归因面补齐。
 *
 * 用法：node scripts/ci-summarize-e2e.mjs [--slow N] <playwright.json>
 *   退码：2=报表读不到/不合形状，1=有 unexpected（红），0=没有红。
 *   与 ci-summarize-trivy 一样：读不到报表时不许报"干净"。
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const SLOW_DEFAULT = 10;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

/** 递归展平 Playwright JSON 的 suites 树，取到 (project, title, result) 粒度。 */
function collect(doc) {
  const rows = [];
  const walk = (node, file) => {
    const specFile = node.file ?? file;
    for (const spec of node.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const project = t.projectName ?? '(无 project)';
        for (const res of t.results ?? []) {
          rows.push({
            project,
            title: spec.title ?? '(无标题)',
            file: specFile ?? '(无文件)',
            line: spec.line ?? '',
            status: t.status ?? '(无状态)',
            resultStatus: res.status ?? '',
            duration: res.duration ?? 0,
            start: res.startTime ?? '',
            error: (res.error && (res.error.message || res.error.value)) || '',
          });
        }
      }
    }
    for (const child of node.suites ?? []) walk(child, specFile);
  };
  for (const suite of doc.suites ?? []) walk(suite, null);
  return rows;
}

function firstLine(msg) {
  // ANSI 转义用码位构造，不写字面量转义（eslint 的 no-control-regex 禁控制字符正则）。
  const ansi = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
  const clean = String(msg)
    .replace(ansi, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return clean.length ? clean[0].slice(0, 220) : '(错误信息为空)';
}

function summarize(file, slowN) {
  if (!existsSync(file)) fail(`${file} 不存在——报表没生成不等于没有失败`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} 不是合法 JSON`);
  }
  if (!doc || !Array.isArray(doc.suites))
    fail(`${file} 里没有 suites 数组，不是 Playwright JSON 报表`);

  const rows = collect(doc);
  const red = rows.filter((r) => r.status === 'unexpected' || r.status === 'flaky');
  const lines = [];
  lines.push(`E2E 逐条归因（一手，取自 ${file}）`);
  lines.push(
    `展平到用例×结果粒度共 ${rows.length} 行；status=unexpected/flaky 的 ${red.length} 行（flaky 在零重试档不该出现，出现即说明重试没关干净）。`,
  );
  for (const r of red) {
    const loc = `${r.file}${r.line ? ':' + r.line : ''}`;
    lines.push(
      `- [${r.project}] ${r.title}（${loc}）result=${r.resultStatus} ${Math.round(r.duration / 1000)}s @${r.start}`,
    );
    lines.push(`    ${firstLine(r.error)}`);
  }
  const timed = rows.filter(
    (r) =>
      r.resultStatus === 'passed' || r.resultStatus === 'failed' || r.resultStatus === 'timedOut',
  );
  const slow = [...timed].sort((a, b) => b.duration - a.duration).slice(0, slowN);
  lines.push(`最慢 ${slow.length} 条（用来判"红是不是落在预算边缘"）：`);
  for (const r of slow) {
    lines.push(
      `    ${(r.duration / 1000).toFixed(1)}s  [${r.project}] ${r.title.slice(0, 40)}  @${r.start}`,
    );
  }
  const starts = timed
    .map((r) => r.start)
    .filter(Boolean)
    .sort();
  if (starts.length) {
    lines.push(
      `执行时刻跨度：首条 ${starts[0]} → 末条 ${starts[starts.length - 1]}（串行档下可直接看红是不是排在尾部）`,
    );
  }
  lines.push(
    red.length ? `判定：有 ${red.length} 行红 ⇒ 退出码 1。` : '判定：没有 unexpected ⇒ 退出码 0。',
  );
  return { lines, redCount: red.length };
}

function selfTestRun() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-sum-'));
  const w = (name, obj) => {
    const p = join(dir, name);
    writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return p;
  };
  const mk = (project, title, status, dur, err, start) => ({
    title,
    file: 'e2e/x.spec.ts',
    line: 42,
    specs: [
      {
        title,
        file: 'e2e/x.spec.ts',
        line: 42,
        tests: [
          {
            projectName: project,
            status,
            results: [
              {
                status: status === 'unexpected' ? 'failed' : 'passed',
                duration: dur,
                startTime: start,
                error: err ? { message: err } : undefined,
              },
            ],
          },
        ],
      },
    ],
  });
  const good = w('good.json', {
    suites: [mk('chromium', '正常格', 'expected', 5000, null, '2026-09-28T05:20:00.000Z')],
  });
  const redDoc = w('red.json', {
    suites: [
      mk('chromium', '正常格', 'expected', 5000, null, '2026-09-28T05:20:00.000Z'),
      mk(
        'webkit',
        '红格：waitForResponse 超时',
        'unexpected',
        20_500,
        'TimeoutError: page.waitForResponse: Timeout 20000ms exceeded\n  at foo',
        '2026-09-28T05:47:00.000Z',
      ),
      mk(
        'mobile-ios',
        '红格：token 丢失',
        'unexpected',
        12_000,
        'Error: procurement_token not found in localStorage',
        '2026-09-28T05:48:00.000Z',
      ),
      mk(
        'firefox',
        '闪一下又过的格',
        'flaky',
        900,
        'first attempt blew up',
        '2026-09-28T05:30:00.000Z',
      ),
    ],
  });
  const broken = w('broken.json', 'oops not json');
  const shell = w('shell.json', { stats: {} });
  const missing = join(dir, 'nope.json');
  const run = (...args) => {
    const res = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8' });
    return { rc: res.status, out: res.stdout + res.stderr };
  };

  const cases = [];
  const push = (name, ok) => cases.push({ name, ok });
  let r = run(good);
  push('正例：全 expected ⇒ rc=0 且红行数 0', r.rc === 0 && /的 0 行/.test(r.out));
  r = run(redDoc);
  push(
    '反例：2 unexpected ⇒ rc=1 并逐条点名 project',
    r.rc === 1 && /\[webkit\]/.test(r.out) && /\[mobile-ios\]/.test(r.out),
  );
  push(
    '错误信息取首行、剥掉堆栈第二行',
    /TimeoutError: page\.waitForResponse/.test(r.out) && !/at foo/.test(r.out),
  );
  push(
    'flaky 计入红（零重试档不该有 flaky）',
    /\[firefox\] 闪一下又过的格/.test(r.out) && /flaky 在零重试档不该出现/.test(r.out),
  );
  push('给出 file:line 而不是只有标题', /e2e\/x\.spec\.ts:42/.test(r.out));
  push('最慢榜按时钟降序', r.out.indexOf('20.5s') < r.out.indexOf('12.0s'));
  push(
    '执行时刻跨度首末都印出',
    /首条 2026-09-28T05:20:00.000Z/.test(r.out) && /末条 2026-09-28T05:48:00.000Z/.test(r.out),
  );
  r = run(broken);
  push('坏 JSON ⇒ rc=2，不报"没有红"', r.rc === 2 && /不是合法 JSON/.test(r.out));
  r = run(shell);
  push('缺 suites 的壳报表 ⇒ rc=2', r.rc === 2 && /suites/.test(r.out));
  r = run(missing);
  push('报表文件缺失 ⇒ rc=2 并说明"不等于没有失败"', r.rc === 2 && /不等于没有失败/.test(r.out));
  r = run('--slow', 'x', good);
  push('--slow 非正整数 ⇒ rc=2', r.rc === 2);
  const esc = String.fromCharCode(27);
  const colored = w('colored.json', {
    suites: [
      mk(
        'webkit',
        '带 ANSI 的格',
        'unexpected',
        1000,
        esc + '[31mTimeoutError: 带颜色的错' + esc + '[39m\n  at bar',
        '2026-09-28T05:00:00.000Z',
      ),
    ],
  });
  r = run(colored);
  push(
    'ANSI 转义被剥掉（首行只剩正文）',
    /TimeoutError: 带颜色的错/.test(r.out) && !r.out.includes(esc + '[31m') && r.rc === 1,
  );

  // 多报表（CI 按 project 分别起跑）：红在第二份也必须 rc=1，且合计行要把两份都点名。
  r = run(good, redDoc);
  push(
    '正例：多报表时红在第二份也要 rc=1，合计行点名两份',
    r.rc === 1 &&
      /多报表汇总（2 份）/.test(r.out) &&
      /good\.json 红 0/.test(r.out) &&
      /red\.json 红 3/.test(r.out),
  );
  // 反向对照：两份都干净时不许判红（否则上面那条恒真），但合计行仍要在——它是"确实读了两份"的证据。
  const good2 = w('good2.json', {
    suites: [mk('firefox', '另一档全绿', 'expected', 1000, null, '2026-09-28T05:31:00.000Z')],
  });
  r = run(good, good2);
  push(
    '反例：两份都干净必须 rc=0 且合计红 0',
    r.rc === 0 && /多报表汇总（2 份）/.test(r.out) && /合计红 0 个/.test(r.out),
  );

  rmSync(dir, { recursive: true, force: true });
  const bad = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
  console.log(`ci-summarize-e2e 自测：${cases.length - bad.length}/${cases.length} 通过`);
  process.exit(bad.length ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTestRun();
let slowN = SLOW_DEFAULT;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--slow') {
    const n = Number(argv[++i]);
    if (!Number.isInteger(n) || n <= 0) fail(`--slow 需要正整数，收到 ${argv[i]}`);
    slowN = n;
  } else files.push(argv[i]);
}
if (files.length < 1) fail(`用法：${SELF} [--slow N] <playwright.json> [...更多报表]（收到 0 个）`);
// 多报表是 CI 的常态：docker-e2e 现在按 project 分别起跑（每个 project 之前复位场地），
// 一次调用只留一份报表的话，第五份会覆盖前四份，"哪一档红的"这个读数就没了。
let totalRed = 0;
const perFile = [];
for (const f of files) {
  const { lines, redCount } = summarize(f, slowN);
  console.log(lines.join('\n'));
  totalRed += redCount;
  perFile.push(`${basename(f)} 红 ${redCount}`);
}
if (files.length > 1) {
  console.log(`多报表汇总（${files.length} 份）：${perFile.join('，')} ⇒ 合计红 ${totalRed} 个`);
}
process.exit(totalRed > 0 ? 1 : 0);
