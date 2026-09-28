#!/usr/bin/env node
/* global console, process */
/**
 * 把 Trivy 的 JSON 报表打成一段**行数有界**的摘要，并保留原门禁（命中 HIGH/CRITICAL 即 exit 1）。
 *
 * 为什么要它：CI 的取证载体只取失败步时间窗的**结尾 60 行**（`.github/workflows/ci.yml` 的
 * failed-logs 作业），而 `trivy image --format table` 的命中清单印在窗口中段，
 * 结尾被后续 upload 步骤的 `##[group]` 占满 ⇒ 作业判红、但日志里读不到它到底判了什么
 * （run=36380814151 的 `#9 Image scan (Trivy)` 就是这个形状：775 行窗口、60 行结尾里没有一条 CVE）。
 * 本件把摘要打到 stdout 末尾，让"判红的那份清单"落在读数能取到的位置。
 *
 * 用法：node scripts/ci-summarize-trivy.mjs [--max N] <report.json> [report2.json ...]
 *   退码：2=输入不可用（文件缺失/不是合法 Trivy JSON），1=命中 > 0，0=零命中。
 *   2 与 1 必须分开：报表没读到时判"干净"是假绿，判"有漏洞"是假红，两种都不能要。
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const MAX_DEFAULT = 8;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  let max = MAX_DEFAULT;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) fail(`--max 需要正整数，收到 ${argv[i]}`);
      max = n;
    } else if (argv[i] === '--self-test') {
      return { selfTest: true, max, files };
    } else files.push(argv[i]);
  }
  return { selfTest: false, max, files };
}

/** 读一份 Trivy JSON 报表；结构不合预期返回 null（调用方按"读不到"处理，不当零命中）。 */
function readReport(file) {
  if (!existsSync(file)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  // 只认 Results 是数组的文档：拿到 `{}`（扫描没跑成）时报"零命中"就是假绿。
  if (!doc || !Array.isArray(doc.Results)) return null;
  const hits = [];
  for (const res of doc.Results) {
    for (const v of res.Vulnerabilities ?? []) {
      if (v.Severity === 'HIGH' || v.Severity === 'CRITICAL') {
        hits.push({
          cve: v.VulnerabilityID ?? '(无编号)',
          pkg: v.PkgName ?? '(无包名)',
          installed: v.InstalledVersion ?? '(无版本)',
          fixed: v.FixedVersion || '',
          severity: v.Severity,
        });
      }
    }
  }
  hits.sort((a, b) =>
    a.severity === b.severity ? a.cve.localeCompare(b.cve) : a.severity === 'CRITICAL' ? -1 : 1,
  );
  return { targets: doc.Results.length, hits };
}

function summarize(files, max) {
  const lines = ['Trivy HIGH/CRITICAL 摘要（取自本步骤刚写出的 JSON 报表，一手）'];
  let total = 0;
  let fixable = 0;
  let unreadable = 0;
  for (const f of files) {
    const r = readReport(f);
    if (!r) {
      unreadable++;
      lines.push(`- ${f}: 报表读不到（文件缺失或非 Trivy JSON）⇒ 不作零命中处理`);
      continue;
    }
    total += r.hits.length;
    fixable += r.hits.filter((h) => h.fixed).length;
    lines.push(`- ${f}: OS/语言目标 ${r.targets} 个，HIGH/CRITICAL 命中 ${r.hits.length} 条`);
    for (const h of r.hits.slice(0, max)) {
      lines.push(
        `    ${h.cve}  ${h.severity.padEnd(8)} ${h.pkg} ${h.installed} → ${h.fixed ? `修复版本 ${h.fixed}` : '上游尚无修复版本'}`,
      );
    }
    if (r.hits.length > max) lines.push(`    （其余 ${r.hits.length - max} 条见报表文件本体）`);
  }
  lines.push(
    `合计命中 ${total} 条，其中 ${fixable} 条已有修复版本、${total - fixable} 条尚无（后者靠换基镜像未必能清）。`,
  );
  if (unreadable) lines.push(`注意：${unreadable} 份报表读不到，本次读数不完整。`);
  lines.push(
    total > 0
      ? '判定：命中 > 0 ⇒ 本步骤以退出码 1 结束（门禁不变）。'
      : '判定：零命中 ⇒ 退出码 0。',
  );
  return { text: lines.join('\n'), total, unreadable };
}

/** 自检：每条轴正反成对，且必须证明这把尺子会开火。夹具落 tmpdir，跑完 rmSync。 */
function selfTestRun() {
  const dir = mkdtempSync(join(tmpdir(), 'trivy-sum-'));
  const w = (name, obj) => {
    const p = join(dir, name);
    writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return p;
  };
  const hit = (id, sev, fixed) => ({
    VulnerabilityID: id,
    PkgName: 'openssl',
    InstalledVersion: '3.5.2-r0',
    FixedVersion: fixed,
    Severity: sev,
  });
  const empty = w('empty.json', {
    SchemaVersion: 2,
    Results: [{ Target: 'nginx:alpine', Vulnerabilities: [] }],
  });
  const mixed = w('mixed.json', {
    SchemaVersion: 2,
    Results: [
      {
        Target: 't',
        Vulnerabilities: [
          hit('CVE-9', 'LOW', '1'),
          hit('CVE-2', 'CRITICAL', ''),
          hit('CVE-1', 'HIGH', '2.8.5-r0'),
        ],
      },
    ],
  });
  const broken = w('broken.json', 'not json at all');
  const shell = w('shell.json', { SchemaVersion: 2 });
  const missing = join(dir, 'nope.json');

  const run = (...args) => {
    const res = spawnSync(process.execPath, [SELF, ...args], { encoding: 'utf8' });
    return { rc: res.status, out: res.stdout + res.stderr };
  };

  const cases = [];
  const push = (name, ok) => cases.push({ name, ok });
  let r = run(empty);
  push('正例：零命中 ⇒ rc=0 且打印合计 0', r.rc === 0 && /合计命中 0 条/.test(r.out));
  r = run(mixed);
  push('反例：HIGH/CRITICAL 各 1 条 ⇒ rc=1（LOW 不计入）', r.rc === 1 && /命中 2 条/.test(r.out));
  push('「已有修复版本」与「尚无」分开计数', /其中 1 条已有修复版本、1 条尚无/.test(r.out));
  push(
    'CRITICAL 排在 HIGH 之前',
    r.out.indexOf('CVE-2') !== -1 && r.out.indexOf('CVE-2') < r.out.indexOf('CVE-1'),
  );
  push('修复版本逐字印出（不是只印包名）', /2\.8\.5-r0/.test(r.out));
  r = run(broken);
  push('坏 JSON ⇒ rc=2 并声明不作零命中', r.rc === 2 && /不作零命中处理/.test(r.out));
  r = run(shell);
  push('空壳 JSON（没有 Results）⇒ rc=2，不是"干净"', r.rc === 2);
  r = run(missing);
  push('文件缺失 ⇒ rc=2 并点名该文件', r.rc === 2 && /nope\.json/.test(r.out));
  r = run('--max', '1', mixed);
  push('--max 截断并报出剩余条数', /其余 1 条见报表文件本体/.test(r.out));
  r = run('--max', '0', empty);
  push('--max 非正整数 ⇒ rc=2', r.rc === 2);
  r = run();
  push('没有参数 ⇒ rc=2（不许静默通过）', r.rc === 2);

  rmSync(dir, { recursive: true, force: true });
  const bad = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
  console.log(`ci-summarize-trivy 自测：${cases.length - bad.length}/${cases.length} 通过`);
  process.exit(bad.length ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTestRun();
const { max, files } = parseArgs(args);
if (files.length === 0) fail('没有传入报表路径');
const out = summarize(files, max);
console.log(out.text);
if (out.unreadable) process.exit(2);
process.exit(out.total > 0 ? 1 : 0);
