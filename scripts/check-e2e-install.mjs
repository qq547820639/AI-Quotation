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
 * 退码：0=一致；1=有漂移（逐条列出）；2=前提不成立（锁文件缺失/不可解析，绝不静默当"通过"）。
 *
 * 用法：node scripts/check-e2e-install.mjs
 *      node scripts/check-e2e-install.mjs --self-test   # 验证这把尺子会开火
 * 接线：package.json 的 `pree2e`（npm 生命周期：每次 `npm run e2e` 自动先跑），
 *      以及 CI docker-e2e job 里 `e2e:config:check` 之后。
 */
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
    const hit = list.some(
      (x) => (x.startsWith('!') ? x.slice(1) === actual : x === actual),
    );
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
  return { rc: 1, lines: [`✘ 装树与锁文件不一致：${drift.length} 处漂移`, ...drift.map((d) => `  ${d}`)] };
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
  add('磁盘版本高于锁版本 → 必须开火', r.rc === 1 && r.lines.some((l) => l.includes('1.62.1')), `rc=${r.rc}`);
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
    'node_modules/@ghost/stray-scoped/package.json': { name: '@ghost/stray-scoped', version: '9.9.9' },
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
  add('真实仓库 → 必须静默（尺子未坏）', r.rc === 0, `rc=${r.rc} ${(r.lines[0] || '').slice(0, 60)}`);

  let bad = 0;
  for (const c of cases) {
    if (!c.ok) bad++;
    console.log(`${c.ok ? '✔' : '✘'} ${c.name}${c.note ? ` [${c.note}]` : ''}`);
  }
  console.log(bad === 0 ? `判据自测 ${cases.length}/${cases.length} 通过` : `判据自测 ${bad} 条失败`);
  return bad === 0 ? 0 : 1;
}

const isSelfTest = process.argv.includes('--self-test');
if (isSelfTest) {
  process.exit(await selfTest());
} else {
  // `--root <dir>`：对**另一棵树**取证，而不是只对当前工作树。
  // 用途是拿事故现场当边界对象复放（`mv` 留档的漂移树 + 一份真锁文件），
  // 用来说"这把尺子当时会不会红"——这比一个合成夹具强，因为被量的是真事故。
  const ri = process.argv.indexOf('--root');
  const root = ri >= 0 && process.argv[ri + 1] ? process.argv[ri + 1] : ROOT;
  const out = check(root);
  console.log(`(root=${root})`);
  console.log(out.lines.join('\n'));
  if (out.rc === 1) {
    console.log('\n修法：npm ci（先 `mv node_modules node_modules.drift` 留一手，别直接 rm -rf）。');
    console.log('若确属有意改动依赖：改 package.json 后重新生成 package-lock.json，不要手改锁。');
  }
  process.exit(out.rc);
}
