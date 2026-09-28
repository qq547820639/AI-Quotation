#!/usr/bin/env node
/* global console, process */
/**
 * 场地寿命／逐格缺陷读数器（登记册 R104 的取证件，不是门禁）
 *
 * 要答的问题（R94 三档里的两档）：runner 上那批红是
 * ①「场地跑到后半程自己劣化」还是 ②「个别用例真有缺陷」——第三档③「共享主机负载」
 * 只能靠同窗的主机读数旁证，不能在这份产物里判。
 *
 * 判据形状（都只报读数，不改判）：
 *   - 把全部用例结果按 `startTime` 排成一条时间线，按十分位分桶，报每桶的
 *     中位数／p95／均值与失败数；末桶中位数 ÷ 首桶中位数 ≥ 比值阈值即打「后段变慢」旗标。
 *   - 失败按 (项目, 文件:行, 标题) 归组：同一格在**多轮**里重复红 ⇒ ② 的证据；
 *     只红一次的格 ⇒ 不成档。
 *   - `--sampler` 给同窗采样 tsv（`ready=<code> <秒>` …）时，按时间线切同样本桶，
 *     报首末桶的 `/api/ready` 中位延迟与 load 轨迹；**采样缺失不等于没事**。
 *
 * 退码：0=读数正常出完；1=出现「后段变慢」或「重复红」旗标之一（便于人一眼看出要不要读）；
 * 2=输入不可读／JSON 解析不了／结果为空（前提塌，任何旗标都不出）。
 *
 * 限度（印在读数里）：十分位是中性的分母，样本少的桶噪声大；比值阈值 1.5 是**软档**，
 * 用来标"值得再看"，不是定案；`startTime` 由 Node 侧记录，长跑里事件本身可能晚到几秒（R103）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RATIO_SOFT = 1.5;

/** 把 Playwright JSON 报告摊平成结果行。 */
function flatten(report) {
  const out = [];
  const walkSpec = (spec, projectName) => {
    for (const t of spec.tests || []) {
      for (const r of t.results || []) {
        if (typeof r.duration !== 'number' || !r.startTime) continue;
        out.push({
          project: projectName,
          file: spec.file || '',
          line: spec.line || 0,
          title: spec.title || '',
          status: r.status || '',
          duration: r.duration,
          start: new Date(r.startTime).getTime(),
        });
      }
    }
  };
  const walkSuite = (suite, projectName) => {
    for (const s of suite.suites || []) walkSuite(s, projectName);
    for (const sp of suite.specs || []) walkSpec(sp, projectName);
  };
  for (const s of report.suites || []) walkSuite(s, report.name || s.title || '');
  // 顶层 specs 形状（单文件报告）也要接住
  for (const sp of report.specs || []) walkSpec(sp, report.name || '');
  return out;
}

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((sortedAsc.length - 1) * q)));
  return sortedAsc[idx];
}
const median = (a) => quantile(a, 0.5);

function deciles(rows, k = 10) {
  const sorted = [...rows].sort((x, y) => x.start - y.start);
  const buckets = [];
  for (let i = 0; i < k; i++) {
    const lo = Math.floor((sorted.length * i) / k);
    const hi = i === k - 1 ? sorted.length : Math.floor((sorted.length * (i + 1)) / k);
    if (hi > lo) buckets.push({ i, rows: sorted.slice(lo, hi) });
  }
  return buckets;
}

/** 主读数：返回 { lines, flags }。 */
function readRun(jsonFiles, samplerFile) {
  const rows = [];
  for (const f of jsonFiles) {
    let raw;
    try {
      raw = fs.readFileSync(f, 'utf8');
    } catch (e) {
      return { rc: 2, why: `读不到报告 ${f}：${e.message}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { rc: 2, why: `报告 ${f} 不是合法 JSON：${e.message}` };
    }
    const flat = flatten(parsed);
    if (!flat.length) return { rc: 2, why: `报告 ${f} 里一条结果都没有` };
    rows.push(...flat);
  }
  const buckets = deciles(rows);
  const lines = [];
  lines.push(
    `结果行 ${rows.length} 条，时间窗 ${new Date(rows[0].start).toISOString()} → ` +
      `${new Date(rows[rows.length - 1].start).toISOString()}`,
  );
  lines.push('十分位（按 startTime 排）：桶 样本 中位 p95 均值 非通过');
  const meds = [];
  for (const b of buckets) {
    const d = b.rows.map((r) => r.duration).sort((x, y) => x - y);
    const bad = b.rows.filter((r) => r.status !== 'passed' && r.status !== 'skipped').length;
    const skip = b.rows.filter((r) => r.status === 'skipped').length;
    const mean = Math.round(d.reduce((x, y) => x + y, 0) / d.length);
    meds.push(median(d));
    lines.push(
      `  ${String(b.i + 1).padStart(2)}/${buckets.length}  ${String(b.rows.length).padStart(4)}  ` +
        `${String(Math.round(median(d))).padStart(6)}ms ${String(Math.round(quantile(d, 0.95))).padStart(6)}ms ` +
        `${String(mean).padStart(6)}ms  ${bad}（跳过 ${skip}）`,
    );
  }
  // 分母对账：各桶样本数之和必须等于总行数
  const summed = buckets.reduce((a, b) => a + b.rows.length, 0);
  if (summed !== rows.length) {
    return { rc: 2, why: `分桶对不上分母：Σ桶=${summed} ≠ 行数=${rows.length}，读数作废` };
  }
  const first = meds[0];
  const last = meds[meds.length - 1];
  const ratio = first > 0 ? last / first : NaN;
  const flags = [];
  lines.push(
    `首桶中位 ${Math.round(first)}ms → 末桶中位 ${Math.round(last)}ms（比值 ${ratio.toFixed(2)}，软档阈值 ${RATIO_SOFT}）`,
  );
  if (Number.isFinite(ratio) && ratio >= RATIO_SOFT) {
    flags.push('后段变慢：末桶中位数 ≥ 首桶 × ' + RATIO_SOFT + '（值得看场地寿命／负载那一档）');
  }
  // 重复红：同一 (项目, 文件:行, 标题) 的红**次数**≥2。
  // 数的是失败结果行数，不是不同时间戳的个数——时间戳会撞（多轮合成夹具就撞），
  // 用它当判据等于悄悄把"重复红"做成一支永不开火的门。
  const byId = new Map();
  for (const r of rows) {
    if (r.status === 'passed' || r.status === 'skipped') continue;
    const key = `${r.project}|${r.file}:${r.line}|${r.title}`;
    byId.set(key, (byId.get(key) || 0) + 1);
  }
  const repeats = [...byId.entries()].filter(([, n]) => n >= 2);
  lines.push(
    `红过的格 ${byId.size} 个（按 项目|文件:行|标题 归组），其中重复红 ${repeats.length} 个`,
  );
  for (const [k, n] of repeats.slice(0, 12)) lines.push(`  重复红 ×${n}：${k}`);
  if (repeats.length) flags.push('重复红：同一格多次失败 ⇒ ②「逐格缺陷」那一档有证据');

  if (samplerFile) {
    const s = readSampler(samplerFile, rows);
    lines.push(...s.lines);
    flags.push(...s.flags);
  }
  lines.push(
    '限度：十分位对样本量敏感；比值是软档不是定案；startTime 是 Node 侧送达时刻，' +
      '事件本身可能晚到几秒（登记册 R103）⇒ 时间线用于分桶够用，逐格时刻别当精确读数。',
  );
  return { rc: flags.length ? 1 : 0, lines, flags };
}

/** 同窗采样：`<ISO>\tready=<code> <sec>\t...load=<a b c>...` */
function readSampler(file, rows) {
  const lines = [];
  const flags = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { lines: [`采样文件读不到：${e.message}（缺采样≠没事，这一档按未覆盖记）`], flags };
  }
  const points = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^(\S+)\s+ready=(\d{3})\s+([\d.]+)/);
    if (!m) continue;
    const t = new Date(m[1]).getTime();
    if (Number.isNaN(t)) continue;
    points.push({ t, code: Number(m[2]), sec: Number(m[3]), raw: l });
  }
  if (!points.length) {
    lines.push('采样 0 行可用（解析不到 `ready=<code> <秒>`）⇒ 主机侧这一档未覆盖');
    return { lines, flags };
  }
  const spanLo = rows[0].start;
  const spanHi = rows[rows.length - 1].start;
  const inSpan = points.filter((p) => p.t >= spanLo - 60_000 && p.t <= spanHi + 60_000);
  const secs = inSpan.map((p) => p.sec).sort((a, b) => a - b);
  const half = Math.floor(secs.length / 2);
  const head = secs.slice(0, half);
  const tail = secs.slice(half);
  const codes = new Set(inSpan.map((p) => p.code));
  lines.push(
    `采样可用 ${inSpan.length}/${points.length} 行（落在跑批时间窗 ±60s 内）；ready 状态码集合 {${[...codes].join(',')}}`,
  );
  if (head.length && tail.length) {
    lines.push(
      `ready 延迟中位：前半 ${median(head).toFixed(3)}s → 后半 ${median(tail).toFixed(3)}s` +
        `（比值 ${(median(tail) / median(head)).toFixed(2)}）`,
    );
    if (median(tail) / median(head) >= RATIO_SOFT) {
      flags.push('后段变慢也出现在 /api/ready 上 ⇒ 场地侧（不是用例侧）的读数支持');
    }
  }
  const bad = inSpan.filter((p) => p.code !== 200);
  if (bad.length) lines.push(`  ready 非 200 的采样点 ${bad.length} 个，首末 ${bad[0].raw.slice(0, 40)} …`);
  const loads = inSpan
    .map((p) => (p.raw.match(/load=([\d.]+)/) || [])[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  if (loads.length) {
    lines.push(
      `主机 1 分钟 loadavg：中位 ${median(loads).toFixed(1)}，最大 ${loads[loads.length - 1].toFixed(1)}` +
        `（这是本机租户负载的旁证，③ 那档只能靠它，不能在这份产物里判）`,
    );
  }
  return { lines, flags };
}

/** 自测：合成夹具落 mkdtemp，验「会开火」与「不开火」两极。 */
function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-lifespan-'));
  const mkReport = (name, durations, failTitles) => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const specs = durations.map((d, i) => ({
      title: `case-${i}`,
      file: `spec-${i % 3}.ts`,
      line: i,
      tests: [
        {
          results: [
            {
              status: failTitles.includes(`case-${i}`) ? 'failed' : 'passed',
              duration: d,
              startTime: new Date(t0 + i * 1000).toISOString(),
            },
          ],
        },
      ],
    }));
    const obj = { name: 'p', suites: [{ title: 's', specs }] };
    fs.writeFileSync(path.join(root, name), JSON.stringify(obj));
    return path.join(root, name);
  };
  const cases = [];
  const push = (n, ok, extra = '') => cases.push({ n, ok, extra });
  try {
    // 夹具 1：平的耗时轨迹 ⇒ 不许打「后段变慢」
    const flat = mkReport('flat.json', Array.from({ length: 40 }, () => 1000), []);
    const r1 = readRun([flat], null);
    push('反例：平轨迹不得打「后段变慢」', !r1.flags.some((f) => f.includes('后段变慢')), `rc=${r1.rc}`);
    // 夹具 2：单调涨到 8 倍 ⇒ 必须打
    const rising = mkReport(
      'rising.json',
      Array.from({ length: 40 }, (_, i) => 1000 + i * 700),
      [],
    );
    const r2 = readRun([rising], null);
    push('正例：后段中位涨到 ≥1.5× 必须打旗标', r2.flags.some((f) => f.includes('后段变慢')), `rc=${r2.rc}`);
    // 夹具 3：同一格跨两轮重复红 ⇒ 必须打「重复红」
    const fA = mkReport('rep-a.json', Array.from({ length: 20 }, () => 1000), ['case-3']);
    const fB = mkReport('rep-b.json', Array.from({ length: 20 }, () => 1000), ['case-3']);
    const r3 = readRun([fA, fB], null);
    push('正例：同一格两次红必须点出来', r3.flags.some((f) => f.includes('重复红')), `rc=${r3.rc}`);
    // 夹具 3b：打印那行必须带上真实次数——只断旗标会让 `×undefined` 这种打印坏掉静默通过。
    push(
      '正例：重复红那行要打印出次数 ×2',
      r3.lines.some((l) => l.includes('重复红 ×2：')),
      r3.lines.filter((l) => l.includes('重复红 ×')).join(' / ') || '(没有这行)',
    );
    // 夹具 4：两个不同格各红一次 ⇒ 不许打「重复红」（否则上一条是恒真）
    const fC = mkReport('two-a.json', Array.from({ length: 20 }, () => 1000), ['case-1']);
    const fD = mkReport('two-b.json', Array.from({ length: 20 }, () => 1000), ['case-2']);
    const r4 = readRun([fC, fD], null);
    push('反例：不同格各红一次不得算重复红', !r4.flags.some((f) => f.includes('重复红')), `rc=${r4.rc}`);
    // 夹具 5：坏 JSON ⇒ rc=2（前提塌，不清任何旗标）
    const badPath = path.join(root, 'bad.json');
    fs.writeFileSync(badPath, '{这不是JSON');
    const r5 = readRun([badPath], null);
    push('坏 JSON 必须退 2 而不是 0', r5.rc === 2, `rc=${r5.rc}`);
    // 夹具 6：文件不存在 ⇒ rc=2
    const r6 = readRun([path.join(root, 'nope.json')], null);
    push('报告缺失必须退 2', r6.rc === 2, `rc=${r6.rc}`);
    // 夹具 7：采样器有后半变慢 ⇒ 必须打 ready 旗标
    const sPath = path.join(root, 's.tsv');
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const sLines = [];
    for (let i = 0; i < 20; i++) {
      const sec = i < 10 ? 0.02 : 0.30;
      sLines.push(
        `${new Date(t0 + i * 5000).toISOString()}\tready=200 ${sec.toFixed(3)}\troot=200 0.001\tload=8.0 7.0 6.0`,
      );
    }
    fs.writeFileSync(sPath, sLines.join('\n') + '\n');
    const r7 = readRun([rising], sPath);
    push('正例：ready 后半中位涨 ≥1.5× 必须打场地旗标', r7.flags.some((f) => f.includes('/api/ready')), `rc=${r7.rc}`);
    // 夹具 8：采样文件不存在 ⇒ 明说未覆盖，且不因此判通过
    const r8 = readRun([flat], path.join(root, 'no-such.tsv'));
    push(
      '采样缺失要写"缺采样≠没事"',
      r8.lines.some((l) => l.includes('缺采样≠没事')),
      `rc=${r8.rc}`,
    );
    // 夹具 9：分母对账——桶样本和必须等于行数（人为造 37 条这种非整除样本）
    const odd = mkReport('odd.json', Array.from({ length: 37 }, () => 1000), []);
    const r9 = readRun([odd], null);
    push('非整除样本数也要过对账', r9.rc === 0, `rc=${r9.rc}`);
    // 夹具 10：参数拆分——只给一个文件时必须收进来（这里曾经把 argv[0] 静默吃掉）
    const p10 = pickArgs(['/abs/one.json']);
    push('只给一个报告文件时不能被丢掉', p10.files.length === 1 && p10.files[0] === '/abs/one.json', JSON.stringify(p10));
    // 夹具 11：带 --sampler 时，采样值不算报告文件、报告文件仍要留下
    const p11 = pickArgs(['/abs/a.json', '/abs/b.json', '--sampler', '/abs/s.tsv']);
    push(
      '--sampler 的值不得混进报告分母',
      p11.files.length === 2 && p11.samplerFile === '/abs/s.tsv',
      JSON.stringify(p11),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.n} ${c.extra}`);
  console.log(`自测 ${cases.length - failed.length}/${cases.length} 通过`);
  return failed.length ? 1 : 0;
}

/** 参数拆分单独成函数：漏掉第一个文件这种形状只有在这里才测得出（不靠真产物跑一遍）。 */
export function pickArgs(argv) {
  const sIdx = argv.indexOf('--sampler');
  const samplerFile = sIdx >= 0 ? argv[sIdx + 1] : null;
  // 只排掉 `--sampler` 本身和它后面那一个值；写成 `i !== sIdx + 1` 会在没有 --sampler 时
  // 把 sIdx=-1 算成"排除第 0 个参数"，于是第一个报告文件被静默吃掉（本机实测踩过）。
  const files = argv.filter((a, i) => !a.startsWith('--') && !(sIdx >= 0 && i === sIdx + 1));
  return { files, samplerFile };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const { files, samplerFile } = pickArgs(argv);
  if (!files.length) {
    console.log('用法：ci-analyze-venue-lifespan.mjs <报告.json> [...报告.json] [--sampler <tsv>] | --self-test');
    process.exit(2);
  }
  const r = readRun(files, samplerFile);
  if (r.rc === 2) {
    console.log(`前提塌：${r.why} ⇒ 不出任何判决`);
    process.exit(2);
  }
  for (const l of r.lines) console.log(l);
  for (const f of r.flags) console.log(`⚑ ${f}`);
  console.log(r.flags.length ? `旗标 ${r.flags.length} 个` : '无旗标');
  process.exit(r.rc);
}

main();
