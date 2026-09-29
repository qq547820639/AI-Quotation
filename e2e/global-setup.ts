import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 与 `playwright.config.ts` 的 `use.baseURL` 同一来源：两处各写一份默认值就会漂移。 */
const targetBase = () => process.env.E2E_BASE_URL || 'http://localhost:80';

/** 从一张 HTML 里取入口 chunk 名（`assets/index-<hash>.js`）；取不到返回 null。 */
function entryChunk(html: string): string | null {
  return html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
}

/**
 * 被测前端身份核验：URL 稳定不代表背后那份 build 是当前的树。
 *
 * 2026-09-27 的实际事故：`:80` 背后那套栈的前端镜像构建于 11:16，而 R61 把
 * `loadPreferences()` 接进启动序列的提交 `c413c9a` 是 13:34 —— 于是"等 boot 那次
 * GET /notifications/preferences"的三格 E2E 红，报的是 20 s 超时，
 * 真因却是被测 build 里根本没有那一行（一手指纹：`:80` 的入口 chunk 里
 * `.loadPreferences(` 出现 0 次、`:18090` 出现 1 次）。
 * 更糟的是同一批红之前"全绿"过一次：那段时间 URL 背后换过栈。
 * 所以这里把"看中的是哪个 build"变成起跑前的硬前提，而不是事后靠猜。
 *
 * 本机有 `dist/`（`npm run build` 的产物）时按入口 chunk 名比对；不一致就 abort，
 * 因为红会读成产品回归。`dist/` 不存在时只声明"未核"（CI 的 docker-e2e 走镜像构建，
 * 树上没有本机 dist，拿它判红是把环境问题报成代码问题）。
 * 明知要测别的 build 时用 `E2E_ALLOW_STALE_BUNDLE=1` 放行——放行也要把两枚 chunk 名打出来。
 */
async function assertServedBundleMatchesTree(): Promise<void> {
  const base = targetBase();
  const localDist = join(process.cwd(), 'dist', 'index.html');
  let served: Response;
  try {
    served = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    throw new Error(
      `E2E 目标 ${base}/ 取不到（${(e as Error).message}）。` +
        `先确认那台栈在跑：URL 稳定不等于背后有人服务。`,
    );
  }
  const servedHtml = await served.text();
  const servedEntry = entryChunk(servedHtml);
  if (!servedEntry) {
    process.stdout.write(`[e2e 身份核验] ${base}/ 的 HTML 里没找到入口 chunk 名，未核。\n`);
    return;
  }
  if (!existsSync(localDist)) {
    process.stdout.write(
      `[e2e 身份核验] 服务方入口=${servedEntry}；本机无 dist/，未核（跳过不是通过）。\n`,
    );
    return;
  }
  const localEntry = entryChunk(readFileSync(localDist, 'utf8'));
  if (localEntry === servedEntry) {
    process.stdout.write(`[e2e 身份核验] 入口 chunk 一致：${servedEntry}\n`);
    return;
  }
  const msg =
    `E2E 目标与被测树不是同一份 build：${base} 服务的是 ${servedEntry}，` +
    `本机 dist/ 构建出的是 ${localEntry ?? '(取不到)'}。\n` +
    `在这种错配下，红会读成产品回归（2026-09-27 的三格 20 s 超时就是这么来的：` +
    `URL 背后是 11:16 的旧镜像，被测代码 13:34 才接上那一行）。\n` +
    `要么把 ${base} 换指到当前 build，要么明知故测时带 E2E_ALLOW_STALE_BUNDLE=1。`;
  if (process.env.E2E_ALLOW_STALE_BUNDLE === '1') {
    process.stdout.write(`[e2e 身份核验] 明知错配仍继续：${msg.split('\n')[0]}\n`);
    return;
  }
  throw new Error(msg);
}

/**
 * Playwright 的 globalSetup 钩子：跑用例之前先验两件事——
 * ① 装树 == 锁文件（`check-e2e-install`）；② URL 背后那份前端 build 就是当前树构建出来的。
 *
 * 为什么挂在 globalSetup 而不是只挂 npm 的 `pree2e`：这次事故里我实际敲的是
 * `npx playwright test`，它**不走 npm 生命周期**，`pree2e` 那道拦不到。
 * globalSetup 是 Playwright 自己的启动序列，`npx` / `npm run` / CI 三条路都会过。
 *
 * `E2E_INSTALL_CHECK_ROOT`：把判据指向**另一棵树**，仅用于反证控制——
 * 事故留档的漂移树是现成的边界对象，指过来必须让整轮起跑前就 abort；
 * 不设它就是对当前工作树取证（正常路径）。
 */
export default async function globalSetup(): Promise<void> {
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
  await assertServedBundleMatchesTree();
}
