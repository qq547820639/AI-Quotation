#!/usr/bin/env node
/* global console, process */
/**
 * 聚合门禁：一次跑完 `scripts/check-*.mjs` 的**本体**与 **`--self-test`**，任一非零即整体非零。
 *
 * 存在理由（今天自己闯的祸）：本仓八把尺子各自都有 `--self-test`，但没有一把会替我把它们全跑一遍；
 * `lint-staged` 只跑 eslint/prettier，所以我今天能连续提交两次而漏掉 `check-storage-receipt`
 * 的棘轮超限（quiet 74 → 79，五处全是我加的）。收尾时是"手动跑了三把我关心的"，不是"跑了全部的"。
 * 这把尺子不判断任何业务规则，它只保证一件事：**没有哪把尺子被静默跳过**。
 *
 * 三条设计约束（都是今天写下的教训）：
 * 1. 退出码从子进程真实 rc 直接聚合，**不经过任何管道**（`echo rc=$? | tee` 曾把 1 洗成 0）；
 * 2. 枚举而不是手写清单（手写的名单会与树上实际存在的尺子不同步，正是 R39 那类"清单与真树分叉"）；
 * 3. 每把子尺若声明支持 `--self-test` 而跑不动/不存在，算作失败而非跳过——
 *    "这个臂不存在"与"这个臂跑过了"在一列 0 里必须长得不一样（R58 的教训）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SELF = 'scripts/check-gates.mjs';

function listGates() {
  return readdirSync('scripts')
    .filter((f) => /^check-.*\.mjs$/.test(f) && f !== 'check-gates.mjs')
    .sort()
    .map((f) => join('scripts', f));
}

/** 跑一把尺子的一种模式；返回真实 rc（无管道） */
function run(script, mode) {
  const args = mode === 'body' ? [] : ['--self-test'];
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { rc: r.status === null ? -1 : r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function aggregate(scripts) {
  const rows = [];
  for (const s of scripts) {
    for (const mode of ['body', 'self-test']) {
      const { rc, out } = run(s, mode);
      rows.push({
        s,
        mode,
        rc,
        note:
          out
            .split('\n')
            .find((l) => l.trim())
            ?.slice(0, 60) ?? '',
      });
    }
  }
  return rows;
}

/**
 * 自检：聚合逻辑本身必须有牙。用一个合成的"必然失败"子尺（写到临时目录）喂给同一套聚合代码，
 * 断言它被判为非零；再用一个必然通过的子尺断言整体为 0。缺一半都算这把尺子没牙。
 */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'qi-gates-'));
  const bad = join(dir, 'check-synthetic-bad.mjs');
  const good = join(dir, 'check-synthetic-good.mjs');
  writeFileSync(bad, "console.log('✗ synthetic failure');\nprocess.exit(1);\n");
  writeFileSync(good, "console.log('✔ synthetic pass');\nprocess.exit(0);\n");
  let fail = 0;
  const badRows = aggregate([bad]);
  if (!badRows.every((r) => r.rc !== 0)) {
    console.log('✗ 自检失败：合成失败子尺没被聚合判红（退出码被洗掉了）');
    fail = 1;
  }
  const goodRows = aggregate([good]);
  if (!goodRows.every((r) => r.rc === 0)) {
    console.log('✗ 自检失败：合成通过子尺被判红（聚合逻辑过严）');
    fail = 1;
  }
  if (fail === 0)
    console.log(`✔ 聚合判据自检通过：失败子尺 2/2 判红、通过子尺 2/2 判绿（${SELF}）`);
  return fail;
}

function main() {
  const args = process.argv.slice(2);
  if (!existsSync('scripts')) {
    console.error('✗ 量具故障：不在仓库根（找不到 scripts/）');
    return 2;
  }
  const unknown = args.filter((a) => a !== '--self-test');
  if (unknown.length) {
    console.error(`✗ 未知参数 ${unknown.join(' ')}；本尺子只接受 --self-test`);
    return 2;
  }
  if (args.includes('--self-test')) return selfTest();

  const scripts = listGates();
  if (!scripts.length) {
    console.error('✗ 量具故障：scripts/ 下一把 check-*.mjs 都没枚举到');
    return 2;
  }
  const rows = aggregate(scripts);
  const bad = rows.filter((r) => r.rc !== 0);
  for (const r of rows) {
    if (r.rc !== 0) console.log(`  ✗ ${r.s} [${r.mode}] rc=${r.rc} — ${r.note}`);
  }
  console.log(
    bad.length
      ? `✗ 聚合门禁未通过：${bad.length}/${rows.length} 项非零（尺子清单由 scripts/check-*.mjs 枚举得出）`
      : `✔ 聚合门禁通过：${scripts.length} 把尺子的本体与自测全绿（共 ${rows.length} 项）`,
  );
  return bad.length ? 1 : 0;
}

process.exit(main());
