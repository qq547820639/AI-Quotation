#!/usr/bin/env node
/* global console, process */
/**
 * 「通知铸造不得藏在状态配方里」判据（R53）
 *
 * 存在理由：R53 实测到 8 个写入口（`src/store/useInquiryStore.ts` 7 处 +
 * `src/store/useQuotationStore.ts` 1 处）把一条**过去式**通知（「询价单 X 已取消」）
 * 铸在 zustand 的 `set((state) => { … })` 体内，也就是铸在**乐观那一帧**上。
 * 这些方法的 catch 只回滚实体（`set({ inquiries: snapshot })`），从不撤通知，
 * 而仓里根本没有删除通知的 API（`grep -rn "removeNotification|deleteNotification|dismiss" src/store src/api` = 0 命中）
 * ⇒ 一次被后端拒绝的取消，会在通知中心与本机存储里留下永久的"已取消"记录。
 * 这不是文案病，是**主张早于凭据**（R41/R48/R50 同族），只是这条链上凭据在 await 之后才出现。
 *
 * 判据（AST 面，函数体内不靠 ±N 行文本窗口）：
 *   若某个 `addNotification` 调用的祖先链上存在一个 `set( … )` 调用，
 *   且该调用的第一个实参是箭头/函数表达式（即"状态配方"），而 addNotification 在这个配方体的子树里 ⇒ 判红。
 * 为什么不判"过去式文案"：措辞是移动目标（本仓文案还要走 i18n），
 * 而"在状态配方里铸对外宣称"这个**结构**就是问题本身——配方应当是纯函数。
 *
 * 两档读数：inside_set（违规） / outside（合规）。
 * 用法：node scripts/check-notification-optimistic-mint.mjs [--self-test|--print-sites|--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function scanFilesRel() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
        out.push(relative(ROOT, full).split('\\').join('/'));
      }
    }
  };
  walk(join(ROOT, 'src'));
  return out.sort();
}

const isMint = (n) =>
  ts.isCallExpression(n) &&
  ((ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'addNotification') ||
    (ts.isIdentifier(n.expression) && n.expression.text === 'addNotification'));

/** 这个调用是否落在某个 `set(配方, …)` 的配方子树里 */
function insideSetRecipe(node) {
  let cur = node.parent;
  let child = node;
  while (cur) {
    if (
      ts.isCallExpression(cur) &&
      ts.isIdentifier(cur.expression) &&
      cur.expression.text === 'set' &&
      cur.arguments.length > 0 &&
      (ts.isArrowFunction(cur.arguments[0]) || ts.isFunctionExpression(cur.arguments[0])) &&
      cur.arguments[0].getStart() <= child.getStart() &&
      cur.arguments[0].getEnd() >= child.getEnd()
    ) {
      return { file: undefined, line: 0, recipe: cur.arguments[0] };
    }
    child = cur;
    cur = cur.parent;
  }
  return undefined;
}

function enclosingMethod(node) {
  let n = node.parent;
  while (n) {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    n = n.parent;
  }
  return '(顶层)';
}

function analyze(getText, listFiles = scanFilesRel) {
  const sites = [];
  for (const rel of listFiles()) {
    const text = getText(rel);
    if (text === undefined) continue;
    const sf = ts.createSourceFile(join(ROOT, rel), text, ts.ScriptTarget.Latest, true);
    const visit = (n) => {
      if (isMint(n)) {
        const hit = insideSetRecipe(n);
        sites.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          method: enclosingMethod(n),
          bucket: hit ? 'inside_set' : 'outside',
        });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sites;
}

const real = (f) => {
  try {
    return readFileSync(join(ROOT, f), 'utf8');
  } catch {
    return undefined;
  }
};

function check(getText, listFiles) {
  const sites = analyze(getText, listFiles);
  const tally = {};
  for (const s of sites) tally[s.bucket] = (tally[s.bucket] ?? 0) + 1;
  const errors = [];
  for (const s of sites) {
    if (s.bucket === 'inside_set') {
      errors.push(
        `${s.file}:${s.line}：${s.method}() 在 set(状态配方) 体内铸通知 ⇒ ` +
          '宣称被钉在乐观那一帧上；实体回滚时通知不会撤，且仓里没有删通知的 API。' +
          '修法：把铸造移到该动作被服务端接受（await）之后。',
      );
    }
  }
  if (sites.length === 0)
    errors.push('整仓零个 addNotification 调用 ⇒ 尺子或作用域坏了，不信这个绿');
  const sum = Object.values(tally).reduce((a, b) => a + b, 0);
  if (sum !== sites.length) errors.push(`Σ档位 ${sum} != 站点数 ${sites.length}`);
  return { errors, sites, tally };
}

/** 夹具共 4 个铸造站点：inside_set 2 / outside 2 —— 少一个就是虚拟语料没被扫到 */
function sites_check(tally) {
  const want = { inside_set: 2, outside: 2 };
  for (const [k, v] of Object.entries(want)) {
    if ((tally[k] ?? 0) !== v) {
      console.error(
        `✗ 自检失败：夹具档位 ${k} 期望 ${v}，实际 ${tally[k] ?? 0} ⇒ 虚拟语料没被扫到`,
      );
      return false;
    }
  }
  return true;
}

function selfTest() {
  const fixtures = {
    'src/a.ts': `
import { create } from 'zustand';
const useN = { getState: () => ({ addNotification: (_: unknown) => {} }) };
export const s = create((set, get) => ({
  // 正例 1：箭头配方里铸过去式通知（R53 的真形状）
  cancel: async (id: string) => {
    set((state) => {
      useN.getState().addNotification({ title: '已取消' });
      return { ...state };
    });
  },
  // 正例 2：function 表达式配方里
  approve: async (id: string) => {
    set(function (state: object) {
      useN.getState().addNotification({ title: '审批通过' });
      return state;
    });
  },
  // 反例 1：await 之后才铸（R53 的修法形状）
  reject: async (id: string) => {
    set((state) => ({ ...state }));
    await api.reject(id);
    useN.getState().addNotification({ title: '审批驳回' });
  },
}));
`,
    'src/b.ts': `
// 反例 2：普通函数里铸，和 set 毫无关系
export function notify(x: string) {
  useN.getState().addNotification({ title: x });
}
`,
  };
  const byName = (f) => (f in fixtures ? fixtures[f] : real(f));
  const names = () => Object.keys(fixtures);
  const { errors, tally } = check(byName, names);
  const bad = errors.filter((e) => !e.startsWith('整仓') && !e.startsWith('Σ'));
  if (bad.length !== 2) {
    console.error(`✗ 自检失败：夹具注入 2 处 set 配方内铸造，实际判红 ${bad.length}`);
    for (const e of bad) console.error('   ', e);
    return 1;
  }
  if (tally.outside !== 2) {
    console.error(
      '✗ 自检失败：合规侧（await 之后 / 与 set 无关）掉档 ⇒ 判据把一切铸造都判红了',
      JSON.stringify(tally),
    );
    return 1;
  }
  // 反向对照：换一个"同样铸这 4 次通知、但没有一次藏在配方里"的语料 ⇒ inside_set 必须归零、
  // 合规档必须涨到 4。用手工写的逆语料，不用正则去剥包壳（第一版用 [\s\S]*? 剥，
  // 剥不干净就留下 2 处红，看着像"判据过严"，其实是那臂自己坏了）。
  const unwrapped = {
    'src/a.ts': `
import { create } from 'zustand';
const useN = { getState: () => ({ addNotification: (_: unknown) => {} }) };
export const s = create((set, get) => ({
  cancel: async (id: string) => {
    set((state) => ({ ...state }));
    await api.cancel(id);
    useN.getState().addNotification({ title: '已取消' });
  },
  approve: async (id: string) => {
    set((state) => ({ ...state }));
    await api.approve(id);
    useN.getState().addNotification({ title: '审批通过' });
  },
  reject: async (id: string) => {
    set((state) => ({ ...state }));
    await api.reject(id);
    useN.getState().addNotification({ title: '审批驳回' });
  },
}));
`,
    'src/b.ts': fixtures['src/b.ts'],
  };
  const second = check((f) => (f in unwrapped ? unwrapped[f] : real(f)), names);
  const secondBad = second.errors.filter((e) => !e.startsWith('整仓') && !e.startsWith('Σ'));
  if (
    secondBad.length !== 0 ||
    (second.tally.inside_set ?? 0) !== 0 ||
    second.tally.outside !== 4
  ) {
    console.error(
      '✗ 自检失败：逆语料（4 次铸造全在配方之外）仍被判红或档位不对 ⇒ 判据在打"铸通知"本身，不在打"藏在配方里"',
      JSON.stringify(second.tally),
    );
    return 1;
  }
  if (sites_check(tally) === false) return 1;
  const realRun = check(real, scanFilesRel);
  if (realRun.errors.length) {
    console.error('✗ 自检失败：真实仓库未过门禁（先修产品，再谈尺子）');
    for (const e of realRun.errors) console.error('   ', e);
    return 1;
  }
  console.log(
    `✔ 自检通过：夹具 2 处开火 / 合规侧 2 处不掉档 / 拆掉 set 包壳后 0 处（判据打的是位置不是铸造）；` +
      `真实仓库 ${realRun.sites.length} 站点全绿（inside_set=${realRun.tally.inside_set ?? 0}）`,
  );
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());
  const { errors, sites, tally } = check(real);
  if (args.includes('--print-sites')) {
    for (const s of sites) console.log(`${s.bucket.padEnd(11)} ${s.file}:${s.line} ${s.method}()`);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({ sites, tally, errors }));
    process.exit(errors.length ? 1 : 0);
  }
  if (errors.length) {
    console.error('✗ 通知铸造位置判据未通过：');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  const t = Object.entries(tally)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`✔ 通知铸造位置判据通过：站点 ${sites.length}（${t}）`);
  return 0;
}

process.exit(main());
