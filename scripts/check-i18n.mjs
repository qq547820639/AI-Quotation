#!/usr/bin/env node
/* global console, process */
/**
 * i18n 翻译键一致性检查（Task 18）
 * 职责：
 *   1. zh-CN 与 en-US 扁平化键集合必须完全一致（缺失/多余键即失败）
 *   2. 源码中 t()/i18n.t() 引用的键必须都存在于 locale（缺失键即失败）
 *   3. 报告 locale 中「未被任何源码引用」的键（未使用翻译键，仅提示不阻断）
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
const usedOrPrefixed = (k) =>
  used.has(k) || [...prefixes].some((p) => k.startsWith(`${p}.`));
const unusedKeys = [...definedKeys].filter((k) => !usedOrPrefixed(k));
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