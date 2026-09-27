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
 *
 * 用法：node scripts/check-i18n.mjs
 * 由 package.json 的 `i18n:check` 脚本调用，并在 CI 中执行。
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

function readLocale(file) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'src/locales', file), 'utf-8'));
  return flatten(raw);
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

/** 从源码文本提取所有被引用的翻译键（含模板前缀） */
function extractUsedKeys() {
  const used = new Set();
  const prefixes = new Set();
  const files = collectSourceFiles(SRC);
  for (const file of files) {
    const code = readFileSync(file, 'utf-8');
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
 */
function collectCarriedKeys(definedKeys) {
  const carried = new Set();
  for (const file of collectSourceFiles(SRC)) {
    const code = readFileSync(file, 'utf-8');
    for (const m of code.matchAll(/['"`]([a-z][\w]*(?:\.[\w-]+)+)['"`]/g)) {
      if (definedKeys.has(m[1])) carried.add(m[1]);
    }
  }
  return carried;
}

// 1) 中英文键集合一致性
const zh = readLocale('zh-CN.json');
const en = readLocale('en-US.json');
const zhKeys = new Set(Object.keys(zh));
const enKeys = new Set(Object.keys(en));

const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));

let failed = false;
if (missingInEn.length || missingInZh.length) {
  failed = true;
  console.error('✘ zh-CN 与 en-US 键集合不一致：');
  if (missingInEn.length) {
    console.error(`  zh-CN 有但 en-US 缺失（${missingInEn.length}）：\n    ${missingInEn.join('\n    ')}`);
  }
  if (missingInZh.length) {
    console.error(`  en-US 有但 zh-CN 缺失（${missingInZh.length}）：\n    ${missingInZh.join('\n    ')}`);
  }
} else {
  console.log(`✔ 中英文键集合一致（共 ${zhKeys.size} 个键）`);
}

// 2) 源码引用的键必须存在
const { used, prefixes } = extractUsedKeys();
const definedKeys = zhKeys;
const missingUsed = [...used].filter((k) => !definedKeys.has(k));
// 模板前缀：locale 中至少有一个键以该前缀开头
const missingPrefix = [...prefixes].filter(
  (p) => ![...definedKeys].some((k) => k.startsWith(`${p}.`)),
);
if (missingUsed.length || missingPrefix.length) {
  failed = true;
  console.error('✘ 源码引用了 locale 中不存在的翻译键：');
  if (missingUsed.length) {
    console.error(`  缺失键（${missingUsed.length}）：\n    ${missingUsed.join('\n    ')}`);
  }
  if (missingPrefix.length) {
    console.error(`  缺失键前缀（${missingPrefix.length}）：\n    ${missingPrefix.join('\n    ')}`);
  }
} else {
  console.log(`✔ 源码引用的 ${used.size} 个静态键 + ${prefixes.size} 个动态前缀均已在 locale 中定义`);
}

// 3) 未使用翻译键（提示，不阻断）
const carried = collectCarriedKeys(definedKeys);
const prefixed = (k) => [...prefixes].some((p) => k.startsWith(`${p}.`));
const usedOrPrefixed = (k) => used.has(k) || carried.has(k) || prefixed(k);
const unusedKeys = [...definedKeys].filter((k) => !usedOrPrefixed(k));
// 这张宽面救回多少条（旧版会误报的"键写在数据里"那一类）——读数必须自己报出来，
// 否则下一轮没有人知道 386 → N 的差额是谁贡献的
const rescued = [...carried].filter((k) => !used.has(k) && !prefixed(k));
console.log(
  `ℹ️  引用面拆解：静态 t() ${used.size} 个 / 动态前缀 ${prefixes.size} 个 / 仅以字面量写在数据里 ${rescued.length} 个`,
);
if (unusedKeys.length) {
  console.warn(`ℹ️  未使用翻译键（${unusedKeys.length}，仅供排查，不阻断）：\n    ${unusedKeys.join('\n    ')}`);
} else {
  console.log('✔ 无未使用翻译键');
}

if (failed) {
  console.error('\n✘ i18n 检查未通过');
  process.exit(1);
}
console.log('\n✔ i18n 检查通过');