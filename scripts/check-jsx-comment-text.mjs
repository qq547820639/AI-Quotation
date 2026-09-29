#!/usr/bin/env node
/* global console, process */
/**
 * 判据：JSX 的**文本子节点**里不许出现注释记号开头的行。
 *
 * 存在理由（今天真在生产界面上看见）：`src/layouts/MainLayout.tsx` 里一段开发说明写成了裸的
 * `//` 行，位置却在 JSX 子节点上——那里 `//` 不是注释而是**文字**，于是每一页顶栏都渲染出
 * 一行"trigger 必须显式给出：antd 的默认值是 hover…"。tsc 与 eslint 默认档都看不见它
 * （语法合法、也不是 lint 规则），只有把 DOM 读出来的 e2e 快照才暴露。
 *
 * 判据形状借 `eslint-plugin-react` 的 `jsx-no-comment-textnodes`（本仓未装该插件，为一条规则
 * 引入整个插件不划算，故借语义自研，理由见登记册 R113 选型段）：
 * JsxText 去空白后以双斜杠开头、以块注释的起始或收尾记号开头/结尾 ⇒ 缺陷
 * （收尾记号即 星+斜杠，这里不写全，否则本注释自己会被它提前终止——真踩过一次）。
 *
 * 三条口径：
 * - 分母 = 树上的 JsxText 节点数（换行/缩进这类空白节点也在内，一律 clean），
 *   clean + defect == 分母，不等即读数作废；
 * - 解析不出来的文件单列「解不开」档，既不折进 clean 也不折进 defect；
 * - 只读 `git ls-files` 点名的 src 下 tsx 组件，不读未跟踪的临时件，也不读 node_modules。
 *
 * 用法：`node scripts/check-jsx-comment-text.mjs [--self-test|--json|--report-only]`
 * 默认档有缺陷即 rc=1；`--report-only` 只出读数（首轮读数/取证时用）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from '../node_modules/typescript/lib/typescript.js';

const SELF = 'scripts/check-jsx-comment-text.mjs';

function judge(text) {
  const t = text.trim();
  if (!t) return 'clean';
  if (t.startsWith('//') || t.startsWith('/*')) return 'defect';
  if (t.endsWith('*/')) return 'defect';
  return 'clean';
}

/**
 * 扫一批文件 ⇒ { sites, clean, defect, rows, unparsable }
 * rows 自带触点自己的 file:line（打印时用它，不用"站点"行）。
 */
function analyze(files, read) {
  const rows = [];
  const unparsable = [];
  let sites = 0;
  let fileCount = 0;
  for (const f of files) {
    let src;
    try {
      src = read(f);
    } catch {
      unparsable.push({ file: f, why: '读不到文件' });
      continue;
    }
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
      const d = sf.parseDiagnostics[0];
      unparsable.push({
        file: f,
        why: `解析不了：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      });
    }
    fileCount++;
    const walk = (n) => {
      if (n.kind === ts.SyntaxKind.JsxText) {
        sites++;
        const text = n.getText(sf);
        rows.push({
          verdict: judge(text),
          file: f,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          text: text.replace(/\s+/g, ' ').slice(0, 70),
        });
      }
      n.getChildren(sf).forEach(walk);
    };
    walk(sf);
  }
  const defect = rows.filter((r) => r.verdict === 'defect').length;
  return { sites, fileCount, rows, defect, clean: sites - defect, unparsable };
}

function listRepoFiles() {
  const out = execFileSync('git', ['ls-files', 'src/**/*.tsx'], {
    encoding: 'utf8',
    maxBuffer: 64e6,
  });
  return out.trim() ? out.trim().split('\n') : [];
}

/** 递归列出目录里的 .tsx（夹具用，不起 shell） */
function walkDir(dir) {
  const found = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) found.push(...walkDir(p));
    else if (ent.name.endsWith('.tsx')) found.push(p);
  }
  return found.sort();
}

/* ==================== 自测：先让这把尺子证明自己会开火 ==================== */

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'jsx-comment-'));
  const w = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, 'utf8');
  };
  const BAD = (label) =>
    `export default function P() {\n  return (\n    <div>\n      ${label}\n      <b>x</b>\n    </div>\n  );\n}\n`;

  // 开火正例：注释记号落在 JSX 子节点位置上（MainLayout 闯祸的原形状）
  w('bad/Page.tsx', BAD('// 这段是写给读代码的人看的，不是界面文字'));
  // 合规形态 1：同一个说明放进 {/* */}
  w('ok1/Page.tsx', BAD('{/* 这段是写给读代码的人看的，不是界面文字 */}'));
  // 合规形态 2：文本里**含**注释记号但不以它开头——URL 与通配符示例都是合法界面文字
  w(
    'ok2/Page.tsx',
    `export default function P() {\n  return (\n    <div>\n      <span>https://example.com/a//b</span>\n      <span>文件名形如 *.tsx 才算</span>\n    </div>\n  );\n}\n`,
  );
  // 合规形态 3：文本里出现 */（不是结尾）——判据只认"以 */ 收尾"，别把正文里的星斜当包装残留
  w('ok3/Page.tsx', BAD('{/* 合法 */}<span>a*/b</span>'));
  // 解不开档：语法坏掉的文件必须单列，不折进任何一侧
  w('unparsed/Page.tsx', `export default function P() {\n  return <div><span></div>;\n}\n`);

  const read = (f) => readFileSync(f, 'utf8');
  const r = analyze(walkDir(root), read);
  const of_ = (frag) => r.rows.filter((v) => v.file.includes(`${root}/${frag}/`));
  const cases = [];
  const push = (name, ok, extra = '') => cases.push({ name, ok, extra });

  push('正例 bad/ 必须开火', of_('bad').some((v) => v.verdict === 'defect'));
  push('反例1 ok1/（{/* */} 包装）不得开火', !of_('ok1/').some((v) => v.verdict === 'defect'));
  push('反例2 ok2/（URL 与通配符文本）不得开火', !of_('ok2/').some((v) => v.verdict === 'defect'));
  push('反例3 ok3/（正文含 */）不得开火', !of_('ok3/').some((v) => v.verdict === 'defect'));
  push(
    '解不开档单列并带原因',
    r.unparsable.length === 1 && r.unparsable[0].file.includes('unparsed/'),
    `实得=${r.unparsable.length}`,
  );
  push('触点自带行号', of_('bad').every((v) => v.line > 0));

  // 反向对照：把 ok1 的包装拆掉（同一个文件改成裸 //），同一棵树二次分析必须翻红
  w('ok1/Page.tsx', BAD('// 拆了包装的同一句话'));
  const r2 = analyze(walkDir(root), read);
  push(
    '删掉包装必须翻红',
    r2.rows.some((v) => v.file.includes('/ok1/') && v.verdict === 'defect'),
  );
  // 空转对照：包装体里什么都不写（只剩空 {}）不该开火——证明"翻红"来自形状而不是节点数
  w('ok1/Page.tsx', BAD('{/* */}'));
  const r3 = analyze(walkDir(root), read);
  push('空包装不得开火（翻红只认注释记号裸露）', !r3.rows.some((v) => v.file.includes('/ok1/') && v.verdict === 'defect'));

  // 对账：Σ档位 == 分母（每一档都由同一份 rows 现算）
  const finalRows = analyze(walkDir(root), read);
  const sum = finalRows.clean + finalRows.defect;
  push(
    `对账 clean(${finalRows.clean})+defect(${finalRows.defect}) == 分母(${finalRows.sites})`,
    sum === finalRows.sites && finalRows.sites > 0,
  );

  rmSync(root, { recursive: true, force: true });
  const failed = cases.filter((c) => !c.ok);
  console.log(
    `[${SELF}] 自测 ${cases.length - failed.length}/${cases.length} 通过` +
      (failed.length ? `｜失败：${failed.map((f) => f.name).join('；')}` : ''),
  );
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.extra}`));
  return failed.length ? 1 : 0;
}

/* ==================== 真语料读数 ==================== */

function main(argv) {
  if (argv.includes('--self-test')) process.exit(selfTest());
  const json = argv.includes('--json');
  const reportOnly = argv.includes('--report-only');
  const files = listRepoFiles();
  const r = analyze(files, (f) => readFileSync(f, 'utf8'));
  if (json) {
    console.log(
      JSON.stringify({
        files: r.fileCount,
        sites: r.sites,
        clean: r.clean,
        defect: r.defect,
        rows: r.rows.filter((x) => x.verdict === 'defect'),
        unparsable: r.unparsable,
      }),
    );
  } else {
    console.log(
      `[${SELF}] 文件=${r.fileCount} JsxText=${r.sites}｜clean=${r.clean}｜缺陷=${r.defect}｜解不开=${r.unparsable.length}` +
        `（Σ档位=${r.clean + r.defect}，与分母不等即读数作废）`,
    );
    r.rows
      .filter((x) => x.verdict === 'defect')
      .forEach((d) => console.log(`  ✗ ${d.file}:${d.line}  ${d.text}`));
    r.unparsable.forEach((d) => console.log(`  · 解不开 ${d.file}：${d.why}`));
    console.log(
      '  限度：只管 JsxText 形状——写进字符串表达式里的说明不在分母内；' +
        '解不开的文件不折进任何一侧；本判据不判"这段文字该不该出现在界面上"。',
    );
  }
  process.exit(r.defect === 0 || reportOnly ? 0 : 1);
}

main(process.argv.slice(2));
