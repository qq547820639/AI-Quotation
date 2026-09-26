#!/usr/bin/env node
/* global console, process */
/**
 * E2E「写落地凭据」判据棘轮
 * 背景（R34）：`expect(page.locator('.ant-message-success').first()).toBeVisible()`
 * 这种**不指名**的成功提示断言不能证明任何写请求已经落地 —— antd 的 message 会停留约 3s，
 * 上一条操作的提示还挂在屏上时它立刻通过。实测 8/8 次：`core-flow.spec.ts` 里
 * 「提交审批成功」的断言在 67~85ms 就通过（小于审批 POST 自身 147ms 的服务端耗时），
 * 屏上文案其实是上一步的「已选择推荐供应商」，审批 POST 的响应时刻读数为 -1，
 * 随后 `page.goto()` 把请求掐断 —— 于是「审批后的单能不能出现在审批页」变成掷硬币。
 *
 * 判据：证明写落地的成功提示断言必须 `.filter({ hasText: … })` 指名文案。
 * 未指名的位点逐条豁免并写明为什么不构成风险；豁免**必须被用完**，
 * 否则判红（防止清单悄悄过期，变成一条永远不红的假门禁）。
 *
 * 用法：node scripts/check-e2e-toast-assertions.mjs
 *      node scripts/check-e2e-toast-assertions.mjs --self-test   # 验证尺子会开火
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 被扫面：e2e 下所有 spec + 共享 helper */
function scanFiles() {
  const dir = join(ROOT, 'e2e');
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.spec.ts')) out.push(`e2e/${name}`);
  }
  out.push('e2e/helpers.ts');
  return out;
}

/**
 * 已核实的豁免位点：文件 → { 允许条数, 为什么这里不指名也安全 }
 * 读数出处：R34 同类面普查（改前泛化断言共 11 处，7 处已改指名）。
 */
const ALLOW = {
  'e2e/exception-scenarios.spec.ts': {
    n: 2,
    why: '各自是其文档内第一条成功提示，前一条是 error 提示，没有可冒充它的存活 toast',
  },
  'e2e/sse-live-events.spec.ts': {
    n: 1,
    why: '门户提交回执 `.ant-result-success` 是整页结果态，且每次都从 portal.goto 起新文档',
  },
  'e2e/helpers.ts': {
    n: 1,
    why: '同上：submitQuoteViaPortal 的门户回执态，新文档内不存在更早的成功提示',
  },
};

/**
 * 只认 `locator('…ant-message-success…')` 这一种形态：
 * 锚到调用上，且禁止跨行 —— 第一版写成 /['"][^'"]*ant-message-success[^'"]*['"]/，
 * 于是从上一行无关的单引号字符串一路匹到下一个选择器，在 helpers.ts 上凭空多报一处。
 */
const NEEDLE = /locator\(\s*['"]([^'"\n]*ant-message-success[^'"\n]*)['"]\s*\)/g;

function genericSites(text) {
  const sites = [];
  for (const m of text.matchAll(NEEDLE)) {
    const after = text.slice(m.index + m[0].length);
    if (!/^\.filter\(/.test(after)) {
      sites.push({ line: text.slice(0, m.index).split('\n').length, selector: m[1] });
    }
  }
  return sites;
}

function check(getText) {
  const errors = [];
  const used = {};
  for (const file of scanFiles()) {
    const sites = genericSites(getText(file));
    if (!sites.length) continue;
    const allow = ALLOW[file];
    if (!allow) {
      errors.push(
        `${file}：出现 ${sites.length} 处未指名的成功提示断言（行 ${sites
          .map((s) => s.line)
          .join(', ')}）。` +
          '修法：改用 e2e/helpers.ts 的 expectSuccessToast(page, /指名文案/)，' +
          '或确证该位点不可能被上一条 toast 冒充后再进豁免清单。',
      );
      continue;
    }
    used[file] = sites.length;
    if (sites.length > allow.n) {
      errors.push(
        `${file}：未指名断言 ${sites.length} 处，超出豁免 ${allow.n} 处（行 ${sites
          .map((s) => s.line)
          .join(', ')}）`,
      );
    }
  }
  for (const [file, allow] of Object.entries(ALLOW)) {
    const got = used[file] ?? 0;
    if (got < allow.n) {
      errors.push(
        `${file}：豁免登记 ${allow.n} 处，实际只剩 ${got} 处 —— 清单已过期，` +
          '请把用掉的那几条从 ALLOW 里删掉（否则这条门禁会在将来静默失效）。',
      );
    }
  }
  return errors;
}

function selfTest() {
  const real = (f) => readFileSync(join(ROOT, f), 'utf8');
  const ok = check(real);
  if (ok.length) {
    console.error('✗ 自检失败：真实仓库读数未过门禁，先看上面的原因');
    for (const e of ok) console.error(`  ${e}`);
    return 1;
  }
  // 正对照：新写一条**已指名**的断言，不得开火。
  // 故意在它前面放一行无关的单引号字符串 —— 第一版判据正是被这种形状骗到的。
  const named = (f) =>
    f === 'e2e/core-flow.spec.ts'
      ? real(f).replace(
          "test.describe('核心业务链路', () => {",
          "test.describe('核心业务链路', () => {\n" +
            "  const decoy = '.ant-modal-confirm-btns .ant-btn-primary, .ant-modal-confirm-btns .ant-btn-dangerous';\n" +
            "  const p = page.locator('.ant-message-success').filter({ hasText: /x/ });\n",
        )
      : real(f);
  if (check(named).length) {
    console.error('✗ 自检失败：已指名的断言被误判为违规（含跨行误配的形状）');
    return 1;
  }
  // 反对照 1：注入一条未指名断言，必须开火
  const injected = (f) =>
    f === 'e2e/core-flow.spec.ts'
      ? real(f).replace(
          "test.describe('核心业务链路', () => {",
          "test.describe('核心业务链路', () => {\n  // 探针\n  const p = page.locator('.ant-message-success').first();\n",
        )
      : real(f);
  const bad = check(injected);
  if (!bad.some((e) => e.includes('core-flow.spec.ts') && e.includes('未指名'))) {
    console.error('✗ 自检失败：注入的未指名断言未被发现，尺子不可信');
    return 1;
  }
  // 反对照 2：把一条在册豁免改成已指名（相当于有人修好了它），
  // 必须报「清单已过期」——否则清单会随代码演进静默失真，门禁退化为永远不红。
  const stale = check((f) =>
    f === 'e2e/sse-live-events.spec.ts'
      ? real(f).replace(
          "locator('.ant-result-success, .ant-message-success')",
          "locator('.ant-result-success, .ant-message-success').filter({ hasText: /x/ })",
        )
      : real(f),
  );
  if (!stale.some((e) => e.includes('清单已过期'))) {
    console.error('✗ 自检失败：豁免清单过期未被发现');
    return 1;
  }
  const total = Object.values(ALLOW).reduce((a, b) => a + b.n, 0);
  console.log(
    `✔ 自检通过：真实仓库泛化断言 ${total} 处全部在册并逐条有理由；` +
      '注入未指名断言、以及把在册位点改好后不清单，两种情况均会翻红',
  );
  return 0;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const errors = check((f) => readFileSync(join(ROOT, f), 'utf8'));
  if (errors.length) {
    console.error('✗ E2E 写落地凭据判据未通过：');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  const total = Object.values(ALLOW).reduce((a, b) => a + b.n, 0);
  console.log(`✔ E2E 写落地凭据判据通过：未指名断言 ${total} 处，全部在册且有豁免理由`);
  return 0;
}

process.exit(main());
