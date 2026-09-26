import { execFileSync } from 'node:child_process';

/**
 * Playwright 的 globalSetup 钩子：跑用例之前先验"装树 == 锁文件"。
 *
 * 为什么挂在 globalSetup 而不是只挂 npm 的 `pree2e`：这次事故里我实际敲的是
 * `npx playwright test`，它**不走 npm 生命周期**，`pree2e` 那道拦不到。
 * globalSetup 是 Playwright 自己的启动序列，`npx` / `npm run` / CI 三条路都会过。
 *
 * `E2E_INSTALL_CHECK_ROOT`：把判据指向**另一棵树**，仅用于反证控制——
 * 事故留档的漂移树是现成的边界对象，指过来必须让整轮起跑前就 abort；
 * 不设它就是对当前工作树取证（正常路径）。
 */
export default function globalSetup(): void {
  const root = process.env.E2E_INSTALL_CHECK_ROOT;
  const args = ['scripts/check-e2e-install.mjs', ...(root ? ['--root', root] : [])];
  try {
    const out = execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const body = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `装树与锁文件不一致（门禁 rc=${e.status}），已阻止本轮 E2E 起跑。\n` +
        `这类漂移会让最后起跑的那个 project 整批红、先跑完的照旧绿，` +
        `读起来像产品回归而实际是被测环境被换过。\n${body}`,
    );
  }
}
