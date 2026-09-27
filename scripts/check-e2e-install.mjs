#!/usr/bin/env node
/* global console, process */
/**
 * 装树完整性检查（E2E 采信前的前置门禁）
 *
 * 背景（2026-09-27 实测）：一次 `npm install --no-save <插件>` 在**正在跑 Playwright 的同一棵树上**
 * 执行。`--no-save` 保住了 `package.json` 与 `package-lock.json`，于是 `git status` 全程干净——
 * 而 npm 仍按 `^` 区间重新求解并顺手升级了 **79 个包**，其中 `@playwright/test` 与 `playwright-core`
 * 从 1.62.1 变成 1.63.0。新版本要求的 webkit 构建（2359）本机没有，最后起跑的那个 project 的
 * **39 条用例全灭**于 `browserType.launch: Executable doesn't exist`，先起跑的 4 个 project 照旧绿。
 * 整份读数看起来像"产品回归"，实际是"我把被测环境换了"。
 *
 * 与本仓 `check-e2e-demo-password.mjs` 同族：那条防的是"三处同一事实的副本漂移会让全线 429
 * 读起来像限流 bug"，这条防的是"未跟踪的 `node_modules` 与锁文件漂移，会让全线红读起来像产品缺陷"。
 * `git status` 看不见这个面（`node_modules` 未跟踪），所以必须有这把独立的尺子。
 *
 * 判据（只读，绝不写 `node_modules`）：
 *   1. 锁文件里每个**非可选且本平台适用**的包，磁盘上的 version 必须等于锁里的 version；
 *   2. 磁盘上多出、而锁文件里没有的顶层包，也算漂移（本次事故里 `eslint-plugin-playwright` 就是这一类）；
 *   3. 平台专属的可选依赖（`@esbuild/linux-x64`、`@rollup/rollup-darwin-x64` 等）缺失是**正常的**，
 *      不判红——第一版把 47 个这样的包误报成"缺失"，那会把一次正常安装读成损坏。
 *
 * 退码：0=一致；1=有漂移（逐条列出）；2=量具故障（锁文件缺失/不可解析，或未识别的参数——
 *      两者都不静默当"通过"。R58：9d5787e 上打错字的参数被静默忽略、默认档照跑退 0，
 *      "这一臂不存在"与"这一臂跑了且过了"在退出码上完全同形，故未识别参数一律判 2。
 *
 * 用法：node scripts/check-e2e-install.mjs
 *      node scripts/check-e2e-install.mjs --self-test   # 验证这把尺子会开火
 *      node scripts/check-e2e-install.mjs --root <dir>  # 对另一棵树取证（值必填，缺值判 2）
 * 接线：① `playwright.config.ts` 的 `globalSetup`（e2e/global-setup.ts）——覆盖一切会启动
 * Playwright 的路径，含 `npx playwright test`；② CI docker-e2e job 的显式一步。
 * 曾另挂 npm 的 `pree2e` 生命周期，因与 ① 完全重叠（只会让本尺子跑两遍）而删除。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 本平台是否适用该包的 os/cpu 约束（无约束=适用）。 */
function applicable(meta) {
  const match = (field, actual) => {
    const want = meta[field];
    if (want == null) return true;
    const list = Array.isArray(want) ? want : [want];
    const neg = list.some((x) => String(x).startsWith('!'));
    const hit = list.some((x) => (x.startsWith('!') ? x.slice(1) === actual : x === actual));
    return neg ? !list.some((x) => x.startsWith('!') && x.slice(1) === actual) || hit : hit;
  };
  return match('os', process.platform) && match('cpu', process.arch);
}

/**
 * 核心判据：给定"树根 + 锁对象"，返回漂移清单。
 * 与真实仓库解耦，好让 --self-test 能在临时目录里造必开火的夹具。
 */
export function findDrift(root, lock) {
  const drift = [];
  const expected = new Map(); // node_modules/xxx 顶层或嵌套路径 -> version
  for (const [path, meta] of Object.entries(lock.packages || {})) {
    if (!path.startsWith('node_modules/')) continue;
    if (!meta.version) continue; // 工作区自身条目无 version
    expected.set(path, meta);
    const pkgJson = join(root, path, 'package.json');
    if (!existsSync(pkgJson)) {
      if (meta.optional || !applicable(meta)) continue; // 平台专属：缺了是正常的
      drift.push(`${path}: 锁里有 ${meta.version}，磁盘上没有（且本平台适用）`);
      continue;
    }
    let have;
    try {
      have = JSON.parse(readFileSync(pkgJson, 'utf8')).version;
    } catch {
      drift.push(`${path}: 磁盘上的 package.json 读不出 JSON`);
      continue;
    }
    if (have !== meta.version) drift.push(`${path}: 锁=${meta.version} 磁盘=${have}`);
  }
  // 反方向：磁盘上有、锁里没有的顶层包（npm install <新包> 的典型痕迹）
  const topExpected = new Set(
    [...expected.keys()].map((p) => p.split('/')[1]).filter((n) => n && !n.startsWith('@')),
  );
  // 注意切片起点：路径以 `node_modules/` 打头，作用域名占**两段**（`node_modules/@scope/name`），
  // 所以是 slice(1,3) 而不是 slice(0,2)——写成后者会得到 `node_modules/@scope`，
  // 与磁盘侧的 `@scope/name` 永远对不上，于是把全部作用域包（本仓 133 个）误报成"未在册"。
  const topExpectedScoped = new Set(
    [...expected.keys()]
      .map((p) => p.split('/').slice(1, 3).join('/'))
      .filter((n) => n.startsWith('@')),
  );
  const nm = join(root, 'node_modules');
  if (existsSync(nm)) {
    for (const name of readdirSync(nm)) {
      if (name.startsWith('.')) continue; // .package-lock.json 等
      if (name.startsWith('@')) {
        for (const sub of readdirSync(join(nm, name))) {
          const key = `${name}/${sub}`;
          if (!topExpectedScoped.has(key) && existsSync(join(nm, key, 'package.json'))) {
            drift.push(`node_modules/${key}: 磁盘上有，锁里没有`);
          }
        }
        continue;
      }
      if (!topExpected.has(name) && existsSync(join(nm, name, 'package.json'))) {
        drift.push(`node_modules/${name}: 磁盘上有，锁里没有`);
      }
    }
  }
  return drift;
}

/** 读锁文件；不可用时返回 null，由调用方判"前提不成立"（退 2），而不是当成一致。 */
function loadLock(root) {
  const f = join(root, 'package-lock.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

export function check(root = ROOT) {
  const lock = loadLock(root);
  if (!lock) return { rc: 2, lines: ['(前提) 读不到可解析的 package-lock.json —— 不判为通过'] };
  const drift = findDrift(root, lock);
  if (drift.length === 0) {
    const n = Object.keys(lock.packages || {}).length;
    return { rc: 0, lines: [`✔ 装树与锁文件一致（比对 ${n} 条）`] };
  }
  return {
    rc: 1,
    lines: [`✘ 装树与锁文件不一致：${drift.length} 处漂移`, ...drift.map((d) => `  ${d}`)],
  };
}

/* ------------------------------ 判据自测 ------------------------------ */

/** 造一棵最小假树：{ [相对路径]: 内容 } -> 临时目录 */
function mkTree(files) {
  const dir = join(tmpdir(), `qqi-instcheck-${Math.random().toString(36).slice(2)}`);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

/* ------------------------ 参数闸门（R58 假绿的根治位） ------------------------ */

/**
 * 本门禁真正处理的参数全集，与文件末尾的分支、与文件头 usage 行一一对应。
 * `--root` 是**带值**参数：它后面必须跟一个目录，那个值本身不当"是不是在册参数"判。
 */
const FLAGS = ['--self-test', '--root'];
const USAGE = `node scripts/check-e2e-install.mjs [--self-test|--root <dir>]`;
const SELF = fileURLToPath(import.meta.url);

/**
 * 真实的参数解析入口：文件末尾的 CLI 与自测臂走的就是同一个函数，臂不重抄判据。
 * @returns {string|null} 故障原因（点名被拒参数 + 列出接受集）；null = 全部接受
 */
function argFault(argv) {
  const bad = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) {
        bad.push(`--root（缺少目录值，收到 ${v === undefined ? '空' : `'${v}'`}）`);
        continue;
      }
      i++; // 值不是参数，跳过它继续判下一个
    } else if (!FLAGS.includes(a)) {
      bad.push(`'${a}'`);
    }
  }
  if (!bad.length) return null;
  return (
    `未识别的参数 ${bad.join(' ')} ⇒ 量具故障，不折算成通过。` +
    `本门禁只认：${FLAGS.join(' / ')}（--root 必须带一个目录值）`
  );
}

/** 从已校验过的参数里取 `--root` 的值；没给就是当前工作树。 */
function rootArg(argv) {
  const i = argv.indexOf('--root');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : ROOT;
}

async function selfTest() {
  const cases = [];
  const add = (name, ok, note = '') => cases.push({ name, ok, note });
  const pkg = (v) => ({ name: 'x', version: v });
  const lockOf = (pkgs) => ({
    name: 'fixture',
    packages: { '': { name: 'fixture' }, ...pkgs },
  });

  // 1) 合规树必须静默
  let dir = mkTree({
    'package-lock.json': lockOf({ 'node_modules/x': pkg('1.0.0') }),
    'node_modules/x/package.json': pkg('1.0.0'),
  });
  let r = check(dir);
  add('一致 → 必须静默且退 0', r.rc === 0, `rc=${r.rc}`);
  rmSync(dir, { recursive: true, force: true });

  // 2) 版本漂移必须开火（正是本次事故的形状：锁 1.62.1 / 磁盘 1.63.0）
  dir = mkTree({
    'package-lock.json': lockOf({ 'node_modules/x': pkg('1.62.1') }),
    'node_modules/x/package.json': pkg('1.63.0'),
  });
  r = check(dir);
  add(
    '磁盘版本高于锁版本 → 必须开火',
    r.rc === 1 && r.lines.some((l) => l.includes('1.62.1')),
    `rc=${r.rc}`,
  );
  rmSync(dir, { recursive: true, force: true });

  // 3) 锁里没有、磁盘上多出来的包必须开火（npm install <新包> 的痕迹）。
  //    两支都要：普通名与作用域名走的是不同的键构造，slice 写错时普通支照样开火、
  //    作用域支却是永久误报或永久漏报——只测普通名会把这个 bug 放过去（实测第一版就漏过）。
  dir = mkTree({
    'package-lock.json': lockOf({
      'node_modules/x': pkg('1.0.0'),
      'node_modules/@real/kept': pkg('2.0.0'),
    }),
    'node_modules/x/package.json': pkg('1.0.0'),
    'node_modules/@real/kept/package.json': { name: '@real/kept', version: '2.0.0' },
    'node_modules/stray/package.json': { name: 'stray', version: '9.9.9' },
    'node_modules/@ghost/stray-scoped/package.json': {
      name: '@ghost/stray-scoped',
      version: '9.9.9',
    },
  });
  r = check(dir);
  add(
    '磁盘多出未在册的包（普通名 + 作用域名各一支）→ 必须各开火一次',
    r.rc === 1 &&
      r.lines.some((l) => l.includes('node_modules/stray:')) &&
      r.lines.some((l) => l.includes('@ghost/stray-scoped')),
    `rc=${r.rc} 命中=${r.lines.length - 1}`,
  );
  add(
    '在册的作用域包不得被误报（slice(0,2) 那版会全量误伤）',
    !r.lines.some((l) => l.includes('@real/kept')),
    '',
  );
  rmSync(dir, { recursive: true, force: true });

  // 4) 平台专属可选包缺失：不得误伤（第一版就在这里误报 47 个）
  dir = mkTree({
    'package-lock.json': lockOf({
      'node_modules/x': pkg('1.0.0'),
      'node_modules/linux-only': { version: '2.0.0', os: ['linux'], cpu: ['x64'] },
    }),
    'node_modules/x/package.json': pkg('1.0.0'),
  });
  r = check(dir);
  add('本平台不适用的可选包缺失 → 不得开火', r.rc === 0, `rc=${r.rc} ${r.lines[0] || ''}`);
  rmSync(dir, { recursive: true, force: true });

  // 5) 锁文件不存在：必须判前提不成立，绝不能静默退 0
  dir = mkTree({ 'node_modules/x/package.json': pkg('1.0.0') });
  r = check(dir);
  add('缺锁文件 → 退 2（不折算成通过）', r.rc === 2, `rc=${r.rc}`);
  rmSync(dir, { recursive: true, force: true });

  // 6) 真仓库当前必须一致：尺子没坏，且这轮修复确实落到了树上
  r = check(ROOT);
  add(
    '真实仓库 → 必须静默（尺子未坏）',
    r.rc === 0,
    `rc=${r.rc} ${(r.lines[0] || '').slice(0, 60)}`,
  );

  /* 参数闸门两极性（R58）：由 spawnSync 打**真实 CLI**，臂不重抄判据。
     · 未识别参数（含 --root 少值）必须退 2 —— 打错字不得冒充通过
     · 有效参数不得退 2，且 '--self-test' 必须真的抵达自测档（"拒绝一切"的解析器也不算修好）
     子进程带 GATE_ARG_NO_SPAWN=1：只跳过会自测套自测的那一臂，其余臂照跑。 */
  const typo = spawnSync(process.execPath, [SELF, '--self-tset'], { encoding: 'utf8' });
  const typoMsg = `${typo.stderr || ''}\n${typo.stdout || ''}`;
  add(
    "臂ARG-1 参数闸门开火：真实 CLI 收到 '--self-tset' ⇒ 退 2 且点名该参数、列出接受集",
    typo.status === 2 && typoMsg.includes('--self-tset') && FLAGS.every((f) => typoMsg.includes(f)),
    `rc=${typo.status} ${(typo.stderr || '').trim().slice(0, 70)}`,
  );
  const bare = spawnSync(process.execPath, [SELF, '--root'], { encoding: 'utf8' });
  add(
    "臂ARG-1b 参数闸门开火（带值参数少值）：'--root' 后面没目录 ⇒ 退 2，不退回默认树",
    bare.status === 2 && (bare.stderr || '').includes('--root'),
    `rc=${bare.status}`,
  );
  const otherRoot = spawnSync(process.execPath, [SELF, '--root', ROOT], { encoding: 'utf8' });
  add(
    "臂ARG-2 参数闸门反极性：有效参数 '--root <dir>' 不被拒（退 ≠2），" +
      '且无参数/--self-test/--root 带值都在接受集内',
    otherRoot.status !== 2 &&
      argFault([]) === null &&
      FLAGS.includes('--self-test') &&
      argFault(['--self-test']) === null &&
      argFault(['--root', ROOT]) === null &&
      argFault(['--root']) !== null,
    `rc=${otherRoot.status} FLAGS=${JSON.stringify(FLAGS)}`,
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
  const isSelfTest = ARGS.includes('--self-test');
  if (isSelfTest) {
    process.exit(await selfTest());
  } else {
    // `--root <dir>`：对**另一棵树**取证，而不是只对当前工作树（值必填，缺值在上面就判 2）。
    // 用途是拿事故现场当边界对象复放（`mv` 留档的漂移树 + 一份真锁文件），
    // 用来说"这把尺子当时会不会红"——这比一个合成夹具强，因为被量的是真事故。
    const root = rootArg(ARGS);
    const out = check(root);
    console.log(`(root=${root})`);
    console.log(out.lines.join('\n'));
    if (out.rc === 1) {
      console.log(
        '\n修法：npm ci（先 `mv node_modules node_modules.drift` 留一手，别直接 rm -rf）。',
      );
      console.log('若确属有意改动依赖：改 package.json 后重新生成 package-lock.json，不要手改锁。');
    }
    process.exit(out.rc);
  }
} catch (e) {
  process.exit(toolFault(e));
}
