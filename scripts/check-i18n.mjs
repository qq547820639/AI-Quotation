#!/usr/bin/env node
/* global console, process */
/**
 * i18n 翻译键一致性检查（Task 18）
 * 职责：
 *   1. zh-CN 与 en-US 扁平化键集合必须完全一致（缺失/多余键即失败）
 *   2. 源码中 t()/i18n.t() 引用的键必须都存在于 locale（缺失键即失败）
 *   3. 报告 locale 中「未被任何源码引用」的键（未使用翻译键，仅提示不阻断）
 *
 * R55 改的是第 3 条的面：旧版只认 `t('字面量')` 与 `t(\`前缀.${}\`)` 两张面，
 * 于是"键写在数据里、运行时才传给 t()"这一整类被误报为未使用
 * （实测 386 条里有 32 条是这种，全在 `ActionWorkbench.tsx` 的卡片配置里——照着这份清单删键，
 *  工作台标签会直接渲染成 `dashboard.workbench.pendingSend` 这样的裸键）。
 * 现在第 3 条额外认第三张面：源码里任何**恰好等于某个已定义键**的字符串字面量。
 * 注意两张面的分工是刻意的，不许合并：
 *   - 第 2 条（会判红的那条）**不**吃这张面 ⇒ 随便一个 `'a.b'` 形状的字符串
 *     （类名、事件名、URL）不会被当成"引用了 locale 里没有的键"而假红。
 *   - 只有"减少未使用清单"这一侧才用宽面 ⇒ 它只会让清单变短，不会引入任何判红。
 *   这条分工现在由 `--self-test` 的臂④常驻守着：宽面一旦漏进第 2 条（判红侧），臂④立刻红。
 *
 * R55 余量（本轮）：上一轮那四臂是在真树上手工注入-还原跑出来的，不是常驻量具。
 * 现在 check() 的三个语料入口（locale 读取 / 文件清单 / 文件正文）全部参数化，
 * 四臂搬成内存夹具 ⇒ 自测既不写 src/ 也不写 locale JSON，真实跑的打印契约不变。
 * 臂②（必须开火）是整套夹具的非恒真证明：缺了它，"清单少了 32 条"与"尺子整体失明"
 * 在读数上完全同形，谁也无法区分修好了和修坏了。
 *
 * 用法：node scripts/check-i18n.mjs [--self-test]
 *      --self-test  用虚拟语料逐臂验证这把尺子会开火、也不会乱开火，最后一臂打真实仓库
 * 由 package.json 的 `i18n:check` / `i18n:check:selftest` 脚本调用，并在 CI 中执行。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** 扁平化嵌套 JSON 为 { 'a.b.c': value } */
function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

/** 递归收集 src 下所有 .ts/.tsx 文件 */
function collectSourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'locales') continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (extname(full) === '.ts' || extname(full) === '.tsx') {
      acc.push(full);
    }
  }
  return acc;
}

// 真实语料的三个入口。check() 只认参数、不认 fs ⇒ 自测可以把整份语料换成内存夹具；
// 常驻门禁不能像上一轮那样以"改一遍真树再逐文件比 sha 还原"为前提。
const realLocale = (file) => readFileSync(join(ROOT, 'src/locales', file), 'utf-8');
const realFile = (full) => readFileSync(full, 'utf-8');
const realFiles = () => collectSourceFiles(SRC);

/**
 * 判红侧（第 2 条）的两张面：`t('字面量')` 与 `t(\`前缀.${}\`)`。
 * 这两张面窄是刻意的：只有显式出现在 t() 实参位上的串才算引用，宽面不许渗进来。
 */
function extractUsedKeys(readFile, listFiles) {
  const used = new Set();
  const prefixes = new Set();
  for (const file of listFiles()) {
    const code = readFile(file);
    // t('key') / t("key") / i18n.t('key') / useTranslation 的 t('key')
    // \bt 同时匹配裸 `t('...')` 与 `i18n.t('...')`（.t 中 t 前有词边界）
    for (const m of code.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
      used.add(m[1]);
    }
    // t(`prefix.${...}`) 模板：记录静态前缀（不含 ${} 部分）
    for (const m of code.matchAll(/\bt\(\s*`([^`]*?)\$\{/g)) {
      const prefix = m[1].replace(/\.$/, '');
      if (prefix) prefixes.add(prefix);
    }
  }
  return { used, prefixes };
}

/**
 * 第三张面（只喂给第 3 条诊断，不参与任何判红）：
 * 源码里出现的、恰好等于某个**已定义键**的字符串字面量——即"键写在数据里、运行时才传给 t()"。
 * 只取已定义键这一限法是刻意的：`'btn.lg'`、`'click.ok'` 这类形状相似的杂串不会进来，
 * 所以这张面只会把未使用清单变短，不会把别的键牵进来。
 * ⚠ 这张面一旦被接进第 2 条，或去掉 `definedKeys.has` 这层限法，就会把杂串读成"引用了不存在的键"
 *   ⇒ 假红。臂④就是钉这个分工的（见文件头"两张面的分工不许合并"）。
 */
function collectCarriedKeys(readFile, listFiles, definedKeys) {
  const carried = new Set();
  for (const file of listFiles()) {
    const code = readFile(file);
    for (const m of code.matchAll(/['"`]([a-z][\w]*(?:\.[\w-]+)+)['"`]/g)) {
      if (definedKeys.has(m[1])) carried.add(m[1]);
    }
  }
  return carried;
}

/**
 * 纯判据：语料入口全部注入，不碰 fs。返回的字段就是打印契约需要的全部读数，
 * 两条会判红的条款各自把"被点名的键"留在结构化字段里，自测据此断言开火，不靠猜文本。
 */
function check(readLocale, readFile, listFiles) {
  // 1) 中英文键集合一致性
  const zh = flatten(JSON.parse(readLocale('zh-CN.json')));
  const en = flatten(JSON.parse(readLocale('en-US.json')));
  const zhKeys = new Set(Object.keys(zh));
  const enKeys = new Set(Object.keys(en));
  const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
  const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));

  // 2) 源码引用的键必须存在
  const { used, prefixes } = extractUsedKeys(readFile, listFiles);
  const definedKeys = zhKeys;
  const missingUsed = [...used].filter((k) => !definedKeys.has(k));
  // 模板前缀：locale 中至少有一个键以该前缀开头
  const missingPrefix = [...prefixes].filter(
    (p) => ![...definedKeys].some((k) => k.startsWith(`${p}.`)),
  );

  // 3) 未使用翻译键（提示，不阻断）
  const carried = collectCarriedKeys(readFile, listFiles, definedKeys);
  const prefixed = (k) => [...prefixes].some((p) => k.startsWith(`${p}.`));
  const usedOrPrefixed = (k) => used.has(k) || carried.has(k) || prefixed(k);
  const unusedKeys = [...definedKeys].filter((k) => !usedOrPrefixed(k));
  // 这张宽面救回多少条（旧版会误报的"键写在数据里"那一类）——读数必须自己报出来，
  // 否则下一轮没有人知道 386 → N 的差额是谁贡献的
  const rescued = [...carried].filter((k) => !used.has(k) && !prefixed(k));

  // 前提闸门：语料入口给空时，"0 个不一致 / 0 个未使用"与"尺子或作用域坏了"在读数上同形，
  // 不能把看不见折算成通过（自测的臂 G 钉这条）。
  const guards = [];
  if (definedKeys.size === 0) guards.push('locale 里零个已定义键 ⇒ 尺子或作用域坏了，不信这个绿');
  if (definedKeys.size > 0 && used.size === 0 && prefixes.size === 0)
    guards.push('源码里零个 t() 引用 ⇒ 扫描面没吃到东西，不信这个绿');

  const red =
    missingInEn.length > 0 ||
    missingInZh.length > 0 ||
    missingUsed.length > 0 ||
    missingPrefix.length > 0 ||
    guards.length > 0;

  return {
    zhKeys,
    enKeys,
    missingInEn,
    missingInZh,
    used,
    prefixes,
    carried,
    missingUsed,
    missingPrefix,
    unusedKeys,
    rescued,
    guards,
    red,
  };
}

/**
 * 打印契约（默认路径与自测共用同一份，这样"谁被点名"是可断言的事实而不是副作用）：
 * 三行摘要 + 未使用清单 + 结论。真实跑的这几行文本与 R55 修完后的输出逐字相同。
 */
function format(r) {
  const out = [];
  if (r.missingInEn.length || r.missingInZh.length) {
    out.push(['error', '✘ zh-CN 与 en-US 键集合不一致：']);
    if (r.missingInEn.length) {
      out.push([
        'error',
        `  zh-CN 有但 en-US 缺失（${r.missingInEn.length}）：\n    ${r.missingInEn.join('\n    ')}`,
      ]);
    }
    if (r.missingInZh.length) {
      out.push([
        'error',
        `  en-US 有但 zh-CN 缺失（${r.missingInZh.length}）：\n    ${r.missingInZh.join('\n    ')}`,
      ]);
    }
  } else {
    out.push(['log', `✔ 中英文键集合一致（共 ${r.zhKeys.size} 个键）`]);
  }

  if (r.missingUsed.length || r.missingPrefix.length) {
    out.push(['error', '✘ 源码引用了 locale 中不存在的翻译键：']);
    if (r.missingUsed.length) {
      out.push([
        'error',
        `  缺失键（${r.missingUsed.length}）：\n    ${r.missingUsed.join('\n    ')}`,
      ]);
    }
    if (r.missingPrefix.length) {
      out.push([
        'error',
        `  缺失键前缀（${r.missingPrefix.length}）：\n    ${r.missingPrefix.join('\n    ')}`,
      ]);
    }
  } else {
    out.push([
      'log',
      `✔ 源码引用的 ${r.used.size} 个静态键 + ${r.prefixes.size} 个动态前缀均已在 locale 中定义`,
    ]);
  }

  out.push([
    'log',
    `ℹ️  引用面拆解：静态 t() ${r.used.size} 个 / 动态前缀 ${r.prefixes.size} 个 / 仅以字面量写在数据里 ${r.rescued.length} 个`,
  ]);
  if (r.unusedKeys.length) {
    out.push([
      'warn',
      `ℹ️  未使用翻译键（${r.unusedKeys.length}，仅供排查，不阻断）：\n    ${r.unusedKeys.join('\n    ')}`,
    ]);
  } else {
    out.push(['log', '✔ 无未使用翻译键']);
  }
  for (const g of r.guards) out.push(['error', `✘ ${g}`]);
  out.push(r.red ? ['error', '\n✘ i18n 检查未通过'] : ['log', '\n✔ i18n 检查通过']);
  return out;
}

const emit = (lines) => lines.forEach(([level, text]) => console[level](text));

/* ------------------------------ 自测（R55 余量） ------------------------------ */

const PROBE = 'zzProbe.neverUsed';
const DATA_ONLY = 'dash.card.pendingSend';
const JUNK = 'btn.lg.big';

/**
 * 虚拟语料。三个靶必须同时在一份夹具里才分得开极性：
 *   PROBE     两份 locale 都有、源码无人引用 ⇒ 必须进未使用清单（臂②，非恒真证明）
 *   DATA_ONLY 只在数据字面量里出现（运行时才传给 t()）⇒ 必须不在清单里（臂①③，宽面的靶）
 *   JUNK      键形状但 locale 里没有的杂串 ⇒ 既不提名也不改变读数（臂④，宽面/判红侧的分工）
 */
const FIX_ZH = {
  common: { ok: '确定', cancel: '取消' },
  dash: { card: { pendingSend: '待发送' } },
  enum: { status: { DRAFT: '草稿' } },
  zzProbe: { neverUsed: '探针' },
};
const FIX_EN = {
  common: { ok: 'OK', cancel: 'Cancel' },
  dash: { card: { pendingSend: 'Pending send' } },
  enum: { status: { DRAFT: 'Draft' } },
  zzProbe: { neverUsed: 'Probe' },
};
const FIX_SRC = {
  'src/pages/a.tsx': `
import { useTranslation } from 'react-i18next';
export const A = () => {
  const { t } = useTranslation();
  const cards = [{ labelKey: 'dash.card.pendingSend' }, { cssClass: 'btn.lg.big' }];
  return <div>{t('common.ok')}{cards.map((c) => t(c.labelKey))}</div>;
};
`,
  'src/pages/b.ts': `
export const label = (x: string) => t(\`enum.status.\${x}\`);
export const cancel = () => t('common.cancel');
`,
};

function corpus({ zh = FIX_ZH, en = FIX_EN, src = FIX_SRC } = {}) {
  const files = Object.keys(src);
  return {
    files,
    readLocale: (f) => JSON.stringify(f === 'en-US.json' ? en : zh),
    readFile: (rel) => src[rel],
    listFiles: () => files,
  };
}

/** 跑一臂，并把整段打印文本带回来——臂④判的是"谁被点名"，只能从打印面读，不能只读字段 */
function arm(options) {
  const c = corpus(options);
  const r = check(c.readLocale, c.readFile, c.listFiles);
  return {
    r,
    text: format(r)
      .map(([, t]) => t)
      .join('\n'),
    files: c.files,
  };
}

function selfTest() {
  const cases = [];
  const push = (name, ok, note) => cases.push({ name, ok, note });

  const base = arm();

  // 臂①：宽面必须有效——只写在数据里的键不得被报成孤儿（R55 修的就是这一类误报）
  push(
    `臂① 基线：仅以数据字面量出现的键 ${DATA_ONLY} 不在未使用清单里`,
    !base.r.unusedKeys.includes(DATA_ONLY),
    `未使用清单=${JSON.stringify(base.r.unusedKeys)}`,
  );

  // 臂②：必须开火。没有这一臂，"清单变短"和"尺子整体失明"给出完全相同的读数
  push(
    `臂② 必须开火：两份 locale 都有、无人引用的键 ${PROBE} 必须进清单并被打印`,
    base.r.unusedKeys.includes(PROBE) && base.text.includes(PROBE) && !base.r.red,
    `未使用清单=${JSON.stringify(base.r.unusedKeys)}｜判红=${base.r.red}`,
  );

  // 硬计数：夹具必须真的被扫到，否则上面两臂的读数可能来自别的语料（同 storage 门禁的 Σ档位）
  const counted =
    base.r.zhKeys.size === 5 &&
    base.r.used.size === 2 &&
    base.r.prefixes.size === 1 &&
    base.r.carried.size === 3 &&
    base.r.rescued.length === 1 &&
    base.r.unusedKeys.length === 1;
  push(
    '臂②b 硬计数：夹具面读数应为 键5/静态2/前缀1/宽面3/救回1/未使用1（虚拟语料确实被扫到）',
    counted,
    `键=${base.r.zhKeys.size} 静态=${base.r.used.size} 前缀=${base.r.prefixes.size} 宽面=${base.r.carried.size} 救回=${base.r.rescued.length} 未使用=${base.r.unusedKeys.length}`,
  );

  // 夹具来源核对：读过的文件必须恰好是夹具清单（自测不得去读真实 src/，更不写盘）
  const readNames = new Set();
  const traced = corpus();
  check(
    traced.readLocale,
    (f) => {
      readNames.add(f);
      return traced.readFile(f);
    },
    traced.listFiles,
  );
  push(
    '臂②c 语料来源：读到的文件集合 == 夹具清单（自测不读写真实 src/ 与 locale JSON）',
    readNames.size === traced.files.length && [...readNames].every((f) => f in FIX_SRC),
    `读到 ${JSON.stringify([...readNames])}`,
  );

  // 臂③：极性的另一半——同一个键改成数据里的字面量（全程不经 t()）必须让它消失
  const carried = arm({
    src: {
      ...FIX_SRC,
      'src/pages/a.tsx': `${FIX_SRC['src/pages/a.tsx']}export const probeCard = { labelKey: '${PROBE}' };\n`,
    },
  });
  push(
    `臂③ 极性翻转：把 ${PROBE} 写成数据字面量（不经 t()）必须让它从清单消失`,
    base.r.unusedKeys.includes(PROBE) &&
      !carried.r.unusedKeys.includes(PROBE) &&
      carried.r.unusedKeys.length === 0 &&
      !carried.r.red,
    `臂②清单 ${base.r.unusedKeys.length} 条 → 臂③清单 ${carried.r.unusedKeys.length} 条`,
  );

  // 臂④：两张面的分工。宽面（或任何键形状字面量）漏进判红侧，这条立刻红
  const noJunk = arm({
    src: {
      ...FIX_SRC,
      'src/pages/a.tsx': FIX_SRC['src/pages/a.tsx'].replace(`'${JUNK}'`, `'btn-lg-big'`),
    },
  });
  push(
    `臂④ 宽面≠判红：键形状但 locale 里没有的杂串 '${JUNK}' ⇒ rc=0、不提名、读数与无杂串版逐字相同`,
    !base.r.red && !base.text.includes(JUNK) && base.text === noJunk.text,
    `判红=${base.r.red}｜提名=${base.text.includes(JUNK)}｜与无杂串版${base.text === noJunk.text ? '同' : '不同'}`,
  );

  // 会判红的第 2 条（静态引用面）：必须开火并点名，同时不许扰动未使用清单
  const missRef = arm({
    src: { ...FIX_SRC, 'src/pages/c.ts': `export const bad = () => t('nope.absentKey');\n` },
  });
  push(
    "臂R-a 判红侧开火：t('nope.absentKey') ⇒ rc=1 且点名该键（未使用清单不受扰）",
    missRef.r.red &&
      missRef.r.missingUsed.includes('nope.absentKey') &&
      missRef.text.includes('nope.absentKey') &&
      missRef.r.unusedKeys.length === 1,
    `missingUsed=${JSON.stringify(missRef.r.missingUsed)} 未使用=${missRef.r.unusedKeys.length}`,
  );

  // 第 2 条的另一半：动态前缀面也得会开火，否则 `t(\`ghost.${x}\`)` 这类是判红盲区
  const missPrefix = arm({
    src: {
      ...FIX_SRC,
      'src/pages/d.ts': `export const dyn = (x: string) => t(\`nope.ns.\${x}\`);\n`,
    },
  });
  push(
    '臂R-a2 判红侧开火：t(`nope.ns.${}`) 且 locale 无该前缀 ⇒ rc=1 且点名前缀',
    missPrefix.r.red &&
      missPrefix.r.missingPrefix.includes('nope.ns') &&
      missPrefix.text.includes('nope.ns'),
    `missingPrefix=${JSON.stringify(missPrefix.r.missingPrefix)}`,
  );

  // 会判红的第 1 条：键集合不一致，两个方向各一臂
  const zhOnly = arm({ zh: { ...FIX_ZH, onlyZh: { k: '只有中文有' } } });
  push(
    '臂R-b1 判红侧开火：zh-CN 有、en-US 缺 ⇒ rc=1 且点名 onlyZh.k',
    zhOnly.r.red &&
      zhOnly.r.missingInEn.includes('onlyZh.k') &&
      !zhOnly.r.missingInZh.length &&
      zhOnly.text.includes('onlyZh.k'),
    `missingInEn=${JSON.stringify(zhOnly.r.missingInEn)}`,
  );
  const enOnly = arm({ en: { ...FIX_EN, onlyEn: { k: 'Only in en-US' } } });
  push(
    '臂R-b2 判红侧开火（反向）：en-US 有、zh-CN 缺 ⇒ rc=1 且点名 onlyEn.k',
    enOnly.r.red &&
      enOnly.r.missingInZh.includes('onlyEn.k') &&
      !enOnly.r.missingInEn.length &&
      enOnly.text.includes('onlyEn.k'),
    `missingInZh=${JSON.stringify(enOnly.r.missingInZh)}`,
  );

  // 前提闸门：locale 为空语料时"0 个未使用"不得被折算成通过
  const empty = arm({ zh: {}, en: {} });
  push(
    '臂G 前提闸门：locale 零个已定义键 ⇒ 必须开火（"看不见"≠"没问题"）',
    empty.r.red && empty.r.guards.length > 0,
    `guards=${JSON.stringify(empty.r.guards)}`,
  );

  // 真实语料：门禁必须干净，且尺子在真树上不失明；打印契约的计数只能来自这里
  const realRun = check(realLocale, realFile, realFiles);
  push(
    `臂REAL 真实语料：门禁干净且尺子不失明（键 ${realRun.zhKeys.size} / 静态引用 ${realRun.used.size} / 动态前缀 ${realRun.prefixes.size} / 宽面救回 ${realRun.rescued.length} / 未使用 ${realRun.unusedKeys.length}）`,
    !realRun.red &&
      realRun.guards.length === 0 &&
      realRun.zhKeys.size > 0 &&
      realRun.used.size > 0 &&
      // 真树读数必须比夹具大 ⇒ 默认路径打印的计数来自 fs，而不是漏进来的夹具
      realRun.zhKeys.size > base.r.zhKeys.size,
    `判红=${realRun.red}｜guards=${JSON.stringify(realRun.guards)}`,
  );

  let rc = 0;
  for (const c of cases) {
    if (!c.ok) rc = 1;
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : `\n     实际读数：${c.note}`}`);
  }
  console.log(
    `判据自测 ${cases.filter((c) => c.ok).length}/${cases.length} ${rc === 0 ? '通过' : '失败'}`,
  );
  return rc;
}

/* ------------------------------ 真实语料 ------------------------------ */

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const r = check(realLocale, realFile, realFiles);
  emit(format(r));
  return r.red ? 1 : 0;
}

process.exit(main());
