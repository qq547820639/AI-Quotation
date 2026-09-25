#!/usr/bin/env node
/* global console, process */
/**
 * 演示种子密码一致性检查
 * 背景：E2E 登录密码来自宿主 env `DEMO_USER_PASSWORD`，兜底值写死在 e2e/helpers.ts；
 * 后端种子用户的密码哈希来自 `docker-compose.dev.yml` 注入的 `DEMO_USER_PASSWORD`。
 * 两处默认值一旦漂移（历史上已发生两次：`test123`→`123456`、`123456`≠dev compose 值），
 * 干净签出跑 E2E 会先吃 5 次 401、再被 LOGIN_MAX_ATTEMPTS=5 的锁定换成全线 429，
 * 读起来像限流 bug 而不是配置漂移。这里把三处同一事实的副本机械对齐。
 *
 * 检查面：
 *   1. docker-compose.dev.yml 的 `${DEMO_USER_PASSWORD:-<默认>}`
 *   2. e2e/helpers.ts 的 `process.env.DEMO_USER_PASSWORD || '<兜底>'`
 *   3. README.md 对外承诺的演示密码
 *
 * 用法：node scripts/check-e2e-demo-password.mjs
 *      node scripts/check-e2e-demo-password.mjs --self-test   # 验证尺子会开火
 * 由 package.json 的 `e2e:config:check` 调用，并在 CI 的 docker-e2e job 里先于 compose 启动执行。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** 三处位点：名字 → { 文件, 正则（捕获组 1 即密码字面量） } */
const SITES = [
  {
    name: 'docker-compose.dev.yml 注入后端的默认值',
    file: 'docker-compose.dev.yml',
    re: /- DEMO_USER_PASSWORD=\$\{DEMO_USER_PASSWORD:-([^}]*)\}/,
  },
  {
    name: 'e2e/helpers.ts 的兜底常量',
    file: 'e2e/helpers.ts',
    re: /process\.env\.DEMO_USER_PASSWORD\s*\|\|\s*'([^']*)'/,
  },
  {
    name: 'README.md 对外承诺的演示密码',
    file: 'README.md',
    re: /演示种子账号统一密码为 `([^`]*)`/,
  },
];

/**
 * 从给定文本里抽出密码字面量。
 * @returns {{value: string|null, reason?: string}}
 */
function extract(site, text) {
  const m = text.match(site.re);
  if (!m) return { value: null, reason: '锚点未命中（位点被改写或删除）' };
  return { value: m[1] };
}

function check(getText) {
  const found = [];
  const errors = [];
  for (const site of SITES) {
    const { value, reason } = extract(site, getText(site.file));
    if (value === null) errors.push(`${site.name}：${reason}，文件 ${site.file}`);
    else found.push({ ...site, value });
  }
  const distinct = [...new Set(found.map((f) => f.value))];
  if (found.length === SITES.length && distinct.length > 1) {
    errors.push(
      '三处演示密码默认值不一致：\n' +
        found
          .map(
            (f) => `  - ${f.value === distinct[0] ? '·' : '✗'} ${f.file} → ${f.name} = ${f.value}`,
          )
          .join('\n') +
        '\n  修法：以种子注入方（docker-compose.dev.yml）为准对齐，或让宿主 env 同时覆盖两侧。',
    );
  }
  return { errors, value: distinct[0] ?? null };
}

function selfTest() {
  const real = (f) => read(f);
  const ok = check(real);
  if (ok.errors.length) {
    console.error('✗ 自检失败：真实仓库读数本身就不一致，先看上面的原因');
    return 1;
  }
  // 反向对照：只改 helpers 的兜底值，尺子必须翻红
  const drifted = (f) =>
    f === 'e2e/helpers.ts' ? real(f).replace(/(\|\|\s*')[^']*'/, "$1'wrong-password'") : real(f);
  const bad = check(drifted);
  if (bad.errors.length === 0) {
    console.error('✗ 自检失败：注入的漂移未被发现，尺子不可信');
    return 1;
  }
  // 反向对照 2：删掉 compose 位点，必须报「锚点未命中」而不是静默通过
  const missing = (f) =>
    f === 'docker-compose.dev.yml'
      ? real(f).replace(/- DEMO_USER_PASSWORD=\$\{[^}]*\}/, '# removed')
      : real(f);
  const gone = check(missing);
  if (!gone.errors.some((e) => e.includes('锚点未命中'))) {
    console.error('✗ 自检失败：位点消失未被发现');
    return 1;
  }
  console.log(`✔ 自检通过：真实仓库三处一致（${ok.value}），注入漂移与删除位点均会翻红`);
  return 0;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const { errors, value } = check(read);
  if (errors.length) {
    console.error('✗ 演示密码一致性检查未通过：');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(`✔ 演示密码一致性检查通过：${SITES.length} 处位点同为 ${value}，宿主 env 可整体覆盖`);
  return 0;
}

process.exit(main());
