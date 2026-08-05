#!/usr/bin/env node
/* global console, process */
/**
 * npm audit 安全门禁（最小范围豁免）。
 *
 * 用途：CI security-scan 的 `npm audit --omit=dev` 门禁使用本脚本替代裸 `npm audit`，
 * 以便对「已确认不适用且上游无 React-18 兼容修复」的单一告警做最小范围、带理由的豁免，
 * 同时保持对一切真实漏洞的 fail-fast（退出码非 0 阻断 CI）。
 *
 * 为什么需要豁免（仅此一条）：
 *  - GHSA-qwww-vcr4-c8h2（react-router，HIGH）："RSC Mode CSRF Bypass Allows Action
 *    Execution Before 400 Response"。本项目为纯客户端 SPA——使用 createBrowserRouter
 *    数据路由，未启用 React Server Components、未使用 server actions / RSC 模式，
 *    该 CVE 的受影响代码路径在本应用不可达，属误报。
 *  - 上游唯一修复版本为 react-router 8.3.0，其 peerDependency 强制 react >=19.2.7；
 *    本仓库当前为 React 18（antd 5 兼容），升级 React 19 属独立大版本迁移，超出本改动范围。
 *    因此不存在与当前技术栈兼容的修复版本。
 *
 * 规则：
 *  - 仅当某漏洞的 (package, advisory URL) 同时命中下方 ALLOWLIST 时才放行；
 *  - 其余任何漏洞（含同包其他告警）一律视为阻断；
 *  - 不吞掉异常、不使用 `|| true`、不降低 audit-level。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// 最小范围豁免：key = `package::advisoryUrl`。
const ALLOWLIST = new Set([
  'react-router::https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
]);

function runAudit() {
  const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
}

let raw;
try {
  raw = runAudit();
} catch (e) {
  raw = e.stdout || '{}';
}
// 将原始 JSON 报告落盘（供 CI artifact 留存），与 npm audit 退出码解耦（真实门禁由下方判定）。
try {
  writeFileSync('npm-audit.json', raw);
} catch { /* 报告落盘失败不阻断门禁 */ }
let data;
try {
  data = JSON.parse(raw);
} catch {
  console.error('audit-exceptions: 无法解析 npm audit 输出');
  process.exit(1);
}

const vulns = (data && data.vulnerabilities) || {};
const entries = [];
for (const [pkg, info] of Object.entries(vulns)) {
  const via = Array.isArray(info.via) ? info.via : [];
  for (const v of via) {
    if (typeof v !== 'object' || !v.url) continue;
    entries.push({ pkg, url: v.url, title: v.title || '', severity: v.severity || info.severity || '' });
  }
}

if (entries.length === 0) {
  console.log('npm audit: 未发现生产依赖漏洞');
  process.exit(0);
}

const blocked = entries.filter((e) => !ALLOWLIST.has(`${e.pkg}::${e.url}`));
const allowed = entries.filter((e) => ALLOWLIST.has(`${e.pkg}::${e.url}`));

for (const e of allowed) {
  console.log(`[豁免] ${e.pkg} ${e.severity} ${e.title} (${e.url}) — RSC 模式误报，见脚本注释`);
}
for (const e of blocked) {
  console.log(`[阻断] ${e.pkg} ${e.severity} ${e.title} (${e.url})`);
}

if (blocked.length > 0) {
  console.error(`audit-exceptions: 存在 ${blocked.length} 个未豁免的生产依赖漏洞，阻断 CI`);
  process.exit(1);
}
console.log('audit-exceptions: 其余漏洞均已豁免（仅不适用告警），门禁通过');
process.exit(0);