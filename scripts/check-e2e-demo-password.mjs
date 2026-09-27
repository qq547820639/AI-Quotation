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
 *      未识别的参数 ⇒ 退 2（量具故障），绝不折算成"通过"（R58：9d5787e 上打错字的参数被静默忽略、
 *      默认档照跑退 0，"这一臂不存在"与"这一臂跑了且过了"在退出码上完全同形）
 * 退码：0=通过 / 1=真实产品违规 / 2=量具故障（崩溃与打错字都不许冒充 0 或 1）
 * 由 package.json 的 `e2e:config:check` 调用，并在 CI 的 docker-e2e job 里先于 compose 启动执行。
 */
import { spawnSync } from 'node:child_process';
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

/* ------------------------ 参数闸门（R58 假绿的根治位） ------------------------ */

/**
 * 本门禁真正处理的参数全集，与 `main()` 里的分支、与文件头 usage 行一一对应。
 */
const FLAGS = ['--self-test'];
const USAGE = `node scripts/check-e2e-demo-password.mjs [${FLAGS.join('|')}]`;
const SELF = fileURLToPath(import.meta.url);

/**
 * 真实的参数解析入口：`main()` 与自测臂走的就是同一个函数，臂不重抄判据。
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
  /* 参数闸门两极性（R58）：由 spawnSync 打**真实 CLI**，臂不重抄判据。
     · 未识别参数必须退 2（打错字不得冒充通过）
     · 有效参数不得退 2，且 '--self-test' 必须真的抵达自测档（"拒绝一切"的解析器也不算修好）
     子进程带 GATE_ARG_NO_SPAWN=1：只跳过会自测套自测的那一臂，其余臂照跑。 */
  const typo = spawnSync(process.execPath, [SELF, '--self-tset'], { encoding: 'utf8' });
  const typoMsg = `${typo.stderr || ''}\n${typo.stdout || ''}`;
  if (
    typo.status !== 2 ||
    !typoMsg.includes('--self-tset') ||
    !FLAGS.every((f) => typoMsg.includes(f))
  ) {
    console.error(
      `✗ 自检失败：参数闸门不开火——'--self-tset' 实际 rc=${typo.status}（应为 2），` +
        `stderr=${JSON.stringify((typo.stderr || '').trim().slice(0, 180))} ⇒ 打错字仍会冒充通过`,
    );
    return 1;
  }
  if (
    argFault([]) !== null ||
    !FLAGS.includes('--self-test') ||
    argFault(['--self-test']) !== null
  ) {
    console.error(
      `✗ 自检失败：参数闸门把有效输入也拒了（无参数与 '--self-test' 都应被接受）⇒ ` +
        `拒绝一切的解析器在本臂读数上冒充了修好。FLAGS=${JSON.stringify(FLAGS)}`,
    );
    return 1;
  }
  if (process.env.GATE_ARG_NO_SPAWN) {
    console.log(
      `   SKIP 参数闸门 --self-test 端到端臂（父自测进程注入 GATE_ARG_NO_SPAWN=1 以免自测套自测）`,
    );
  } else {
    const good = spawnSync(process.execPath, [SELF, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, GATE_ARG_NO_SPAWN: '1' },
    });
    const goodOut = `${good.stdout || ''}\n${good.stderr || ''}`;
    if (good.status === 2 || !goodOut.includes('✔ 自检通过')) {
      console.error(
        `✗ 自检失败：'--self-test' rc=${good.status} 或其输出里没有自测档的收尾读数 ⇒ ` +
          'dispatch 与接受集脱钩（这个 CLI 参数本身坏了）',
      );
      return 1;
    }
  }
  console.log(
    `✔ 自检通过：真实仓库三处一致（${ok.value}），注入漂移与删除位点均会翻红；` +
      `参数闸门未识别 '--self-tset' 退 2、有效参数不退 2`,
  );
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const badArg = argFault(args);
  if (badArg) {
    console.error(`✘ ${badArg}`);
    console.error(`  用法：${USAGE}`);
    return 2;
  }
  if (args.includes('--self-test')) return selfTest();
  const { errors, value } = check(read);
  if (errors.length) {
    console.error('✗ 演示密码一致性检查未通过：');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(`✔ 演示密码一致性检查通过：${SITES.length} 处位点同为 ${value}，宿主 env 可整体覆盖`);
  return 0;
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
  process.exit(main());
} catch (e) {
  process.exit(toolFault(e));
}
