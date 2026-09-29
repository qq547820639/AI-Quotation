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
 * 退码：0=全覆盖；1=有文件没被类型检查到；2=量具故障（前提不成立，或未识别的参数）。
 * 用法：node scripts/check-tsc-coverage.mjs
 *      node scripts/check-tsc-coverage.mjs --self-test   # 验证这把尺子会开火
 *      未识别的参数 ⇒ 退 2（量具故障），绝不折算成"通过"（R58：9d5787e 上打错字的参数被静默忽略、
 *      默认档照跑退 0，"这一臂不存在"与"这一臂跑了且过了"在退出码上完全同形）
 */
import { execFileSync, spawnSync } from 'node:child_process';
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
    .filter(
      (p) =>
        p.startsWith('src/') && (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.d.ts'),
    )
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
  if (!existsSync(join(ROOT, 'package.json')))
    return { rc: 2, lines: ['(前提) 找不到仓库根的 package.json'] };
  let tracked;
  try {
    tracked = run('git', ['ls-files', 'src']);
  } catch (e) {
    return { rc: 2, lines: [`(前提) git ls-files 失败：${e.message}`] };
  }
  const sources = trackedSources(tracked);
  if (sources.length === 0) {
    return {
      rc: 2,
      lines: ['(前提) git ls-files src 里没有 .ts/.tsx —— 空分母会恒真通过，不判为"全覆盖"'],
    };
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
    return {
      rc: 2,
      lines: [`(前提) tsc --noEmit 退出码 ${rc}；类型检查本身没跑通时这份清单无意义`],
    };
  }
  const collected = collectedByTsc(out, ROOT + '/');
  if (collected.length === 0) {
    return {
      rc: 2,
      lines: ['(前提) tsc --listFiles 没解析出任何 src 文件 —— 判据不接受"空分子=没覆盖"的读数'],
    };
  }
  const uncovered = diffUncovered(sources, collected);
  if (uncovered.length === 0) {
    return {
      rc: 0,
      lines: [`✔ src 下 ${sources.length} 个被跟踪的 .ts/.tsx 全部进了 tsc 的类型检查面`],
    };
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

/* ------------------------ 参数闸门（R58 假绿的根治位） ------------------------ */

/**
 * 本门禁真正处理的参数全集，与文件末尾的分支、与文件头 usage 行一一对应。
 */
const FLAGS = ['--self-test'];
const USAGE = `node scripts/check-tsc-coverage.mjs [${FLAGS.join('|')}]`;
const SELF = fileURLToPath(import.meta.url);

/**
 * 真实的参数解析入口：文件末尾的 CLI 与自测臂走的就是同一个函数，臂不重抄判据。
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

/* ------------------------------ 判据自测 ------------------------------ */

async function selfTest() {
  const cases = [];
  const add = (name, ok, note = '') => cases.push({ name, ok, note });

  const S = ['src/a.ts', 'src/b.tsx'];
  add('两边一致 → 必须静默', diffUncovered(S, S).length === 0);

  // 大小写撞名那一类的真实形状：.tsx 被丢掉
  add(
    '组件测试 .tsx 未进 tsc → 必须开火并点名它',
    diffUncovered(['src/x/One.test.tsx', 'src/x/one.test.ts'], ['src/x/one.test.ts']).join() ===
      'src/x/One.test.tsx',
  );

  // 非类型检查面（.d.ts / 未跟踪 / 测试之外目录）不得进分母
  add(
    '分母必须剔除 .d.ts 与 src 外文件',
    JSON.stringify(
      trackedSources('src/typings.d.ts\nsrc/a.ts\nvite.config.d.ts\nbackend/x.py\ne2e/a.ts'),
    ) === JSON.stringify(['src/a.ts']),
  );

  // 分子解析：绝对路径要能还原成仓库相对路径
  add(
    '绝对路径按算出的仓库根归一；树外路径与别的检出目录不得混进来',
    JSON.stringify(
      collectedByTsc(
        '/repo/src/a.ts\n/repo/src/b.tsx\n/repo/src/typings.d.ts\n/Users/me/node_modules/typescript/lib/lib.es5.d.ts\n/other-checkout/src/a.ts',
        '/repo/',
      ),
    ) === JSON.stringify(['src/a.ts', 'src/b.tsx']),
  );

  // 空分子不得折算成"零缺失"
  add('空分子（tsc 没吐出 src 文件）→ 判据本身不得当作全覆盖', diffUncovered(S, []).length === 2);

  // 真仓库当前必须一致（本轮改名之后才该成立；改名前这条就是开火的）
  const r = check();
  add(
    '真实仓库 → 必须静默（尺子未坏且改名后确无漏网）',
    r.rc === 0,
    `rc=${r.rc} ${(r.lines[0] || '').slice(0, 52)}`,
  );

  /* 参数闸门两极性（R58）：由 spawnSync 打**真实 CLI**，臂不重抄判据。
     · 未识别参数必须退 2 —— 打错字不得冒充通过
     · 有效参数不得退 2，且 '--self-test' 必须真的抵达自测档（"拒绝一切"的解析器也不算修好）
     子进程带 GATE_ARG_NO_SPAWN=1：只跳过会自测套自测的那一臂，其余臂照跑。 */
  const typo = spawnSync(process.execPath, [SELF, '--self-tset'], { encoding: 'utf8' });
  const typoMsg = `${typo.stderr || ''}\n${typo.stdout || ''}`;
  add(
    "臂ARG-1 参数闸门开火：真实 CLI 收到 '--self-tset' ⇒ 退 2 且点名该参数、列出接受集",
    typo.status === 2 && typoMsg.includes('--self-tset') && FLAGS.every((f) => typoMsg.includes(f)),
    `rc=${typo.status} ${(typo.stderr || '').trim().slice(0, 70)}`,
  );
  add(
    "臂ARG-2 参数闸门反极性：无参数与 '--self-test' 都在接受集内（拒绝一切也判绿的话这里红）",
    argFault([]) === null && FLAGS.includes('--self-test') && argFault(['--self-test']) === null,
    `FLAGS=${JSON.stringify(FLAGS)}`,
  );
  if (process.env.GATE_ARG_NO_SPAWN) {
    add(
      '臂ARG-3 SKIP：--self-test 端到端臂由父自测进程关掉（GATE_ARG_NO_SPAWN=1，防自测套自测）',
      true,
    );
  } else {
    const good = spawnSync(process.execPath, [SELF, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, GATE_ARG_NO_SPAWN: '1' },
    });
    const goodOut = `${good.stdout || ''}\n${good.stderr || ''}`;
    add(
      "臂ARG-3 真 CLI 的 '--self-test'：不退 2 且输出里有自测档收尾读数（dispatch 与接受集没脱钩）",
      good.status !== 2 && goodOut.includes('判据自测'),
      `rc=${good.status}`,
    );
  }

  let bad = 0;
  for (const c of cases) {
    if (!c.ok) bad++;
    console.log(`${c.ok ? '✔' : '✘'} ${c.name}${c.note ? ` [${c.note}]` : ''}`);
  }
  console.log(
    bad === 0 ? `判据自测 ${cases.length}/${cases.length} 通过` : `判据自测 ${bad} 条失败`,
  );
  return bad === 0 ? 0 : 1;
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
  const ARGS = process.argv.slice(2);
  const badArg = argFault(ARGS);
  if (badArg) {
    console.error(`✘ ${badArg}`);
    console.error(`  用法：${USAGE}`);
    process.exit(2);
  }
  if (ARGS.includes('--self-test')) {
    process.exit(await selfTest());
  } else {
    const out = check();
    console.log(out.lines.join('\n'));
    process.exit(out.rc);
  }
} catch (e) {
  process.exit(toolFault(e));
}
