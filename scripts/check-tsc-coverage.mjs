#!/usr/bin/env node
/* global console, process */
/**
 * 「每个被 git 跟踪的前端源文件都必须真的被类型检查到」的门禁。
 *
 * 起因（2026-09-27 实测）：`src/pages/dashboard/__tests__/` 下同时有
 * `ActionWorkbench.test.tsx` 与 `actionWorkbench.test.ts` —— 两者**去掉扩展名后大小写不敏感相等**。
 * 在 `useCaseSensitiveFileNames === false` 的卷（本 APFS 卷）上，TypeScript 的 include 展开
 * 会丢掉后收集的那一个，于是 `tsc --noEmit` 报 rc=0、`vitest` 也照常跑它（vitest 自己按 glob 收文件），
 * 而**这个组件测试文件从未被类型检查过**，也没有任何门禁知道。
 * 更要紧的是：这条曾被写进登记册当"全仓开 no-floating-promises 的阻塞理由"，
 * 而那句诊断是错的（include 实际是 ["src"] 且无 exclude）——只有"文件到底进没进 tsc"这个读数是真的。
 *
 * 判据（不看命名规律，只看两边集合差）：
 *   分母 = `git ls-files src` 里以 .ts/.tsx 结尾、且非 .d.ts 的文件
 *   分子 = `tsc --noEmit --listFiles` 输出里落在仓库内、且属于分母的文件
 *   差集非空 ⇒ 判红并逐个列出。
 * 前提闸门（缺任何一条都判 2，不折算成"0 个缺失=通过"）：
 *   - `git ls-files` 必须返回非空（不在仓库里/路径写错 ⇒ 空集 ⇒ 恒真通过）
 *   - `tsc` 退出码必须是 0 且 --listFiles 非空（类型检查本身挂了时，缺失清单没有意义）
 *
 * 退码：0=全覆盖；1=有文件没被类型检查到；2=前提不成立。
 * 用法：node scripts/check-tsc-coverage.mjs
 *      node scripts/check-tsc-coverage.mjs --self-test   # 验证这把尺子会开火
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 分母：被 git 跟踪、需要类型检查的源文件（相对仓库根，正斜杠） */
export function trackedSources(list) {
  return list
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.endsWith('.ts') || s.endsWith('.tsx'))
    .filter((s) => !s.endsWith('.d.ts'))
    .filter((s) => s.startsWith('src/'))
    .sort();
}

/** 分子：tsc --listFiles 的输出行里，挑出属于本仓库、且在分母候选范围内的路径。
 *  rootPrefix 必须是**算出来的**仓库根（`ROOT + '/'`），不能写死目录名 ——
 *  写死过一次，结果对 `git worktree` 的检出（另一个绝对路径）全部失配、分子为空、判 rc=2。 */
export function collectedByTsc(out, rootPrefix) {
  const marker = rootPrefix.replace(/\\/g, '/');
  return out
    .split('\n')
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .filter((line) => line.startsWith(marker))
    .map((line) => line.slice(marker.length))
    .filter((p) => p.startsWith('src/') && (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.d.ts'))
    .sort();
}

/** 纯判据：两边集合的差。与真实命令解耦，好让 --self-test 造必开火的夹具。 */
export function diffUncovered(sources, collected) {
  const have = new Set(collected);
  return sources.filter((s) => !have.has(s));
}

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function check() {
  if (!existsSync(join(ROOT, 'package.json'))) return { rc: 2, lines: ['(前提) 找不到仓库根的 package.json'] };
  let tracked;
  try {
    tracked = run('git', ['ls-files', 'src']);
  } catch (e) {
    return { rc: 2, lines: [`(前提) git ls-files 失败：${e.message}`] };
  }
  const sources = trackedSources(tracked);
  if (sources.length === 0) {
    return { rc: 2, lines: ['(前提) git ls-files src 里没有 .ts/.tsx —— 空分母会恒真通过，不判为"全覆盖"'] };
  }
  let out = '';
  let rc = 0;
  try {
    out = run('npx', ['tsc', '--noEmit', '--listFiles']);
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : -1;
    out = String(e.stdout || '');
  }
  if (rc !== 0) {
    return { rc: 2, lines: [`(前提) tsc --noEmit 退出码 ${rc}；类型检查本身没跑通时这份清单无意义`] };
  }
  const collected = collectedByTsc(out, ROOT + '/');
  if (collected.length === 0) {
    return { rc: 2, lines: ['(前提) tsc --listFiles 没解析出任何 src 文件 —— 判据不接受"空分子=没覆盖"的读数'] };
  }
  const uncovered = diffUncovered(sources, collected);
  if (uncovered.length === 0) {
    return { rc: 0, lines: [`✔ src 下 ${sources.length} 个被跟踪的 .ts/.tsx 全部进了 tsc 的类型检查面`] };
  }
  return {
    rc: 1,
    lines: [
      `✘ 有 ${uncovered.length} 个被 git 跟踪的源文件从未被类型检查到（分母 ${sources.length}）：`,
      ...uncovered.map((u) => `  ${u}`),
      '成因通常是同目录内「去掉扩展名后大小写不敏感相等」的文件对：',
      'TS 在 useCaseSensitiveFileNames=false 的卷上会丢掉后收集的那一个。改名即可，别用 tsconfig 的 files 兜。',
    ],
  };
}

/* ------------------------------ 判据自测 ------------------------------ */

async function selfTest() {
  const cases = [];
  const add = (name, ok, note = '') => cases.push({ name, ok, note });

  const S = ['src/a.ts', 'src/b.tsx'];
  add('两边一致 → 必须静默', diffUncovered(S, S).length === 0);

  // 大小写撞名那一类的真实形状：.tsx 被丢掉
  add(
    '组件测试 .tsx 未进 tsc → 必须开火并点名它',
    diffUncovered(['src/x/One.test.tsx', 'src/x/one.test.ts'], ['src/x/one.test.ts']).join() === 'src/x/One.test.tsx',
  );

  // 非类型检查面（.d.ts / 未跟踪 / 测试之外目录）不得进分母
  add(
    '分母必须剔除 .d.ts 与 src 外文件',
    JSON.stringify(trackedSources('src/typings.d.ts\nsrc/a.ts\nvite.config.d.ts\nbackend/x.py\ne2e/a.ts')) ===
      JSON.stringify(['src/a.ts']),
  );

  // 分子解析：绝对路径要能还原成仓库相对路径
  add(
    '绝对路径按算出的仓库根归一；树外路径与别的检出目录不得混进来',
    JSON.stringify(
      collectedByTsc(
        '/repo/src/a.ts\n/repo/src/b.tsx\n/repo/src/typings.d.ts\n/Users/me/node_modules/typescript/lib/lib.es5.d.ts\n/other-checkout/src/a.ts',
        '/repo/',
      ),
    ) ===
      JSON.stringify(['src/a.ts', 'src/b.tsx']),
  );

  // 空分子不得折算成"零缺失"
  add('空分子（tsc 没吐出 src 文件）→ 判据本身不得当作全覆盖', diffUncovered(S, []).length === 2);

  // 真仓库当前必须一致（本轮改名之后才该成立；改名前这条就是开火的）
  const r = check();
  add('真实仓库 → 必须静默（尺子未坏且改名后确无漏网）', r.rc === 0, `rc=${r.rc} ${(r.lines[0] || '').slice(0, 52)}`);

  let bad = 0;
  for (const c of cases) {
    if (!c.ok) bad++;
    console.log(`${c.ok ? '✔' : '✘'} ${c.name}${c.note ? ` [${c.note}]` : ''}`);
  }
  console.log(bad === 0 ? `判据自测 ${cases.length}/${cases.length} 通过` : `判据自测 ${bad} 条失败`);
  return bad === 0 ? 0 : 1;
}

if (process.argv.includes('--self-test')) {
  process.exit(await selfTest());
} else {
  const out = check();
  console.log(out.lines.join('\n'));
  process.exit(out.rc);
}
