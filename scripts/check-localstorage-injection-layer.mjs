#!/usr/bin/env node
/* global console, process */
/**
 * 「localStorage 的写方法槽只许共享夹具去动」判据（R71 一族）
 *
 * 存在理由（2026-09-27 的八格假绿）：三个单测各自手写过同一段注入
 *   vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw boom })
 * 它在 CI 上**静默空转**：那 8 格声称在测失败分支，其实从没进过那个分支
 * （`expected function to throw an error, but it didn't`），而本机 503 全绿。
 *
 * 机制（一手读数登记在 src/test/writeFailures.ts 顶部注释与登记册 R71）：
 * 病根不是 Node 版本号，而是"vitest 最后把哪个对象当作 localStorage"。
 *   · Node 22/24（CI 档位）：globalThis 上没有 localStorage 描述符 ⇒ vitest 的 jsdom 环境
 *     把 jsdom 的真 [Storage] 搬上来 ⇒ ctor=Storage、ownSetItem=false、protoSetItem=true
 *   · Node 26（本机）：那个存取器在 ⇒ src/test/setup.ts:11 的 `typeof === 'undefined'` 兜底成立，
 *     装的是内存版普通对象 ⇒ ctor=Object、ownSetItem=true、protoSetItem=false
 * 而 `[Storage]` 的命名属性语义下，**往实例上定义 setItem（赋值也好、Object.defineProperty 也好）
 * 都按"定义一条名为 setItem 的存储条目"处理**，方法本体不动（实测 instDefineThrows=false 且
 * localStorage.length 由 0 变 2）。于是"往实例上写方法"这一形状在一档上正确、在另一档上 inert。
 * 合规形状只剩共享夹具 src/test/writeFailures.ts：它运行时用 resolveLayer 现选拦得住调用的那一层，
 * 调用方再跑 assertWriteInjectionLanded —— 注入若会 inert 就点名是哪一层、响亮地红。
 *
 * 判据（**AST 面，不读文本**）：分母 = `git ls-files --cached --others --exclude-standard -- src` 里
 * .ts/.tsx（剔 .d.ts）的文件；一个"候选站点"是下面任一形状：
 *   1) `X.spyOn(<localStorage 实例>, <写方法>)`        —— 接收者叫什么都在靶内：病是"槽被重定义"，不是库名
 *   2) `Object.defineProperty/defineProperties/Reflect.defineProperty/Object.assign(<实例>, <写方法>…)`
 *   3) 任意赋值（含 `+=`/`||=`/解构赋值目标）打到 `<实例>.<写方法>` 这个槽上
 *   4) 读/正常调用 `<实例>.<写方法>`、在原型层重定义 `<写方法>`、重定义非写方法槽 —— 看见并归档，不判
 * `<localStorage 实例>` 认：`localStorage`、`globalThis.localStorage`、`window.localStorage`、
 * 同文件内 `const 别 = localStorage` 的别名（一跳）。写方法 = setItem | removeItem | clear。
 * 档位六张：violation / undecidable / write-call / slot-read / proto-redefine / nonwrite-slot，
 * Σ档位 == 候选站点数是硬断言，不等即读数作废退 2。
 *
 * 豁免（**不是抄来的路径名单**）：语料里唯一"导出 SANCTIONED_EXPORT 且被别的语料文件 import"的文件
 * 才拿到豁免位点——它自己就是被豁免的那段实现的定义点，动原型层正是它的职责。
 * 什么时候该删掉这条豁免：夹具改名、被搬走、或调用方不再 import 它——那时 resolveExemption 会算出
 * 0 个导出方或 0 个调用方，本尺当场退 2 点名，而不是悄悄把豁免留在一篇过期的路径上继续放行。
 *
 * 已知看不见的一面（写在脸上，不假装全覆盖）：
 *   1) 目标解不开的重定义（`const 别 = 拿回来的某存储; Object.defineProperty(别, 'setItem', …)`）
 *      不在分母里——静态不知 `别` 是不是 localStorage。方法名解不开的那一类**是**候选站点，落 undecidable。
 *   2) `delete localStorage.setItem` 只算读槽（它删的是条目，不是方法定义）。
 *   3) 语料取 git 视角：被 .gitignore 挡在树外的临时脚本看不见。
 *   4) 跨文件的 `const ls = localStorage` 别名不追（只认同文件一跳声明）。
 *
 * 用法：node scripts/check-localstorage-injection-layer.mjs [--self-test|--print-sites|--json]
 *      未识别的参数 ⇒ 退 2（量具故障），绝不折算成"通过"（R58：打错字的参数被静默忽略、默认档退 0，
 *      "这一臂不存在"与"这一臂跑了且过了"在退出码上完全同形）
 * 退码：0=语料干净 / 1=真实产品违规（实例层重定义写方法槽）/ 2=量具故障
 *      （解析失败、豁免位点算不出、方法名解不开、参数打错——"看不见"一律不折算成 0 或 1）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS = ['--self-test', '--print-sites', '--json'];
const USAGE = `node scripts/check-localstorage-injection-layer.mjs [${FLAGS.join('|')}]`;
const SELF = fileURLToPath(import.meta.url);

/** 会被"失败分支注入"打断的三个写方法槽。读方法（getItem/key/length）不在内。 */
const WRITE_METHODS = new Set(['setItem', 'removeItem', 'clear']);

/**
 * 合规实现的导出名。豁免位点由它算出（见 resolveExemption），本尺不写死任何文件路径。
 * 什么时候这行该跟着改：夹具改名 → 一起改；夹具被拆成两份 → 不改这里，让"0/多个导出方"的红去逼你收口。
 */
const SANCTIONED_EXPORT = 'makeLocalStorageWritesThrow';

/** 全局对象上那几个"就是 localStorage 本身"的写法；jsdom 与 Node 档都可能出现其中之一。 */
const GLOBAL_OBJECTS = new Set(['globalThis', 'window']);

// ------------------------------------------------------------------ 语料

/** 分母：git 眼里 src 下需要判的 .ts/.tsx（含未跟踪但未忽略的——那正是本尺要拦的新代码） */
export function trackedSources(zList) {
  return zList
    .split('\0')
    .map((s) => s.trim())
    .filter((s) => /\.(ts|tsx)$/.test(s) && !s.endsWith('.d.ts') && s.startsWith('src/'))
    .sort();
}

function readCorpus() {
  let out;
  try {
    out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (e) {
    throw new Error(`git ls-files 失败：${e.message}`);
  }
  const list = trackedSources(out);
  // 空分母不判为"全覆盖"：任何判据在 0 个文件上都恒绿（R58 一族）
  if (!list.length) throw new Error('语料为空：src 下一个 .ts/.tsx 都没枚举到，空分母不算绿');
  const files = {};
  for (const rel of list) {
    try {
      files[rel] = readFileSync(join(ROOT, rel), 'utf8');
    } catch (e) {
      throw new Error(`读不到 ${rel}：${e.message}`);
    }
  }
  return files;
}

// ---------------------------------------------------------------- AST 小工具

/** 剥掉类型断言与括号：`(localStorage as any).setItem` 的靶子仍是 localStorage */
function unwrap(node) {
  let n = node;
  while (n) {
    if (
      ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isTypeAssertionExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isSatisfiesExpression?.(n)
    ) {
      n = n.expression;
      continue;
    }
    break;
  }
  return n;
}

/** 字符串字面量（含无插值模板串）的内容；不是字面量 ⇒ undefined */
function literalText(node) {
  const n = unwrap(node);
  if (!n) return undefined;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isIdentifier(n)) return undefined;
  return undefined;
}

/** 属性/元素访问的键名；解不开（计算名、变量、模板插值）⇒ undefined */
function accessedKey(node) {
  const n = unwrap(node);
  if (!n) return undefined;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n)) return literalText(n.argumentExpression);
  return undefined;
}

function isGlobalObjIdentifier(node) {
  const n = unwrap(node);
  return ts.isIdentifier(n) && GLOBAL_OBJECTS.has(n.text);
}

/** 这个表达式是不是"就是 localStorage 那个实例"（含同文件一跳别名） */
function isLocalStorageInstance(node, aliases) {
  const n = unwrap(node);
  if (!n) return false;
  if (ts.isIdentifier(n)) return n.text === 'localStorage' || aliases.has(n.text);
  if (ts.isPropertyAccessExpression(n))
    return n.name.text === 'localStorage' && isGlobalObjIdentifier(n.expression);
  if (ts.isElementAccessExpression(n))
    return (
      literalText(n.argumentExpression) === 'localStorage' && isGlobalObjIdentifier(n.expression)
    );
  return false;
}

/** 这个表达式是不是"原型层"——夹具 resolveLayer 用的就是这一层，所以本尺不判它 */
function isPrototypeLayer(node) {
  const n = unwrap(node);
  if (!n) return false;
  if (ts.isPropertyAccessExpression(n) && n.name.text === 'prototype') return true;
  if (ts.isCallExpression(n)) {
    const c = n.expression;
    if (ts.isPropertyAccessExpression(c) && c.name.text === 'getPrototypeOf') {
      const owner = unwrap(c.expression);
      if (ts.isIdentifier(owner) && (owner.text === 'Object' || owner.text === 'Reflect'))
        return true;
    }
  }
  return false;
}

/** 槽所在的那一层；两个都不是 ⇒ 不在本尺的靶内 */
function layerOf(node, aliases) {
  if (isLocalStorageInstance(node, aliases)) return 'instance';
  if (isPrototypeLayer(node)) return 'prototype';
  return null;
}

/**
 * 赋值运算符集合：按 typescript 自己声明的枚举区间取，而不是手抄成员名。
 * （手抄过一次：`LeftShiftEqualsToken` / `DoubleBarEqualsToken` 这类名字在本版枚举里其实叫
 * `LessThanLessThanEqualsToken` / `BarBarEqualsToken`，抄错的那几项会解析成 undefined，
 * Set 里静默少一格 ⇒ 那几种赋值写法**永远不判**，而读数看起来照样是"没有违规"。
 * 区间的两端与成员数都由运行时自检，任一不成立当场抛——闸门形状见 --self-test 的臂24。）
 */
const FIRST_ASSIGN = ts.SyntaxKind.FirstAssignment;
const LAST_ASSIGN = ts.SyntaxKind.LastAssignment;
const ASSIGN_OPERATORS = new Set();
if (
  typeof FIRST_ASSIGN !== 'number' ||
  typeof LAST_ASSIGN !== 'number' ||
  LAST_ASSIGN <= FIRST_ASSIGN
)
  throw new Error('量具故障：typescript 的 SyntaxKind 没有可读的赋值区间端点');
for (let k = FIRST_ASSIGN; k <= LAST_ASSIGN; k++) ASSIGN_OPERATORS.add(k);
if (
  ASSIGN_OPERATORS.size < 10 ||
  !ASSIGN_OPERATORS.has(ts.SyntaxKind.EqualsToken) ||
  !ASSIGN_OPERATORS.has(ts.SyntaxKind.QuestionQuestionEqualsToken)
) {
  throw new Error(
    `量具故障：赋值运算符集合算出来只有 ${ASSIGN_OPERATORS.size} 格（应 ≥10 且含 = 与 ??=）⇒ 不敢用半张名单判据`,
  );
}
const isAssignmentKind = (kind) => ASSIGN_OPERATORS.has(kind);

/** `<实例>.<写方法>` 这种"槽访问"本身（读、调用、被赋值都从它出发） */
function slotAccess(node, aliases) {
  const n = unwrap(node);
  if (!n || (!ts.isPropertyAccessExpression(n) && !ts.isElementAccessExpression(n))) return null;
  const layer = layerOf(n.expression, aliases);
  if (!layer) return null;
  return { node: n, layer, key: accessedKey(n) };
}

/** 解构赋值左边里的全部写入目标：`[localStorage.setItem] = fns`、`({k: localStorage.clear} = o)` */
function collectWriteTargets(node, out, aliases) {
  const n = unwrap(node);
  if (!n) return out;
  if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
    if (slotAccess(n, aliases)) out.push(n);
    return out;
  }
  if (ts.isArrayLiteralExpression(n)) {
    for (const el of n.elements) {
      if (ts.isSpreadElement(el)) continue;
      collectWriteTargets(el, out, aliases);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(n)) {
    for (const p of n.properties) {
      if (ts.isPropertyAssignment(p)) collectWriteTargets(p.initializer, out, aliases);
      else if (ts.isSpreadAssignment(p)) collectWriteTargets(p.expression, out, aliases);
      // ShorthandPropertyAssignment（`{setItem}`）写的是同名局部变量，不是槽
    }
  }
  return out;
}

/** 被重定义的槽有哪几个方法名：解不开的记 undefined（由调用方落 undecidable 档，不折算） */
function redefinedKeys(args, shape, constStrings) {
  if (shape === 'defineProperties' || shape === 'assign') {
    const holder = unwrap(args[1]);
    if (holder && ts.isObjectLiteralExpression(holder)) {
      const keys = [];
      for (const p of holder.properties) {
        if (ts.isSpreadAssignment(p))
          keys.push(undefined); // 展开进来的键看不见
        else if (p.name && ts.isComputedPropertyName(p.name))
          keys.push(resolveKey(p.name.expression, constStrings));
        else if (p.name) keys.push(ts.isIdentifier(p.name) ? p.name.text : literalText(p.name));
      }
      return keys;
    }
    return [undefined]; // 第二个实参不是对象字面量 ⇒ 整档解不开
  }
  return [args[1] === undefined ? undefined : resolveKey(args[1], constStrings)];
}

/** 方法名实参 → 字符串：字面量直接用；标识符沿同文件的 `const X = 'setItem'` 一跳解析 */
function resolveKey(node, constStrings) {
  const n = unwrap(node);
  if (!n) return undefined;
  const lit = literalText(n);
  if (lit !== undefined) return lit;
  if (ts.isIdentifier(n)) return constStrings.get(n.text);
  return undefined;
}

// ------------------------------------------------------------- 判据本体

/**
 * @param {Record<string,string>} files 相对路径 → 源码
 * @returns {{sites:object[], exempt:string[], preExcluded:string[], exemptionProblems:string[], parseProblems:string[]}}
 */
export function analyze(files) {
  const parsed = [];
  const parseProblems = [];
  for (const [file, source] of Object.entries(files)) {
    if (typeof source !== 'string') {
      parseProblems.push(`${file}: 内容读不到（不是字符串）`);
      continue;
    }
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const d of sf.parseDiagnostics ?? []) {
      parseProblems.push(
        `${file}:${sf.getLineAndCharacterOfPosition(d.start).line + 1} 解析失败：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      );
    }
    parsed.push({ file, source, sf });
  }

  const ex = resolveExemption(parsed);
  const sites = [];
  for (const p of parsed) {
    if (ex.exempt.has(p.file)) continue;
    scanFile(p, sites);
  }
  return {
    sites,
    exempt: [...ex.exempt],
    preExcluded: parsed.map((p) => p.file),
    exemptionProblems: ex.problems,
    parseProblems,
    exporters: ex.exporters,
    consumers: ex.consumers,
  };
}

/** 同文件一跳常量/别名表：`const M = 'setItem'`、`const ls = localStorage` */
function collectBindings(sf, aliases, constStrings) {
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      const lit = literalText(init);
      if (lit !== undefined && !constStrings.has(n.name.text)) {
        constStrings.set(n.name.text, lit);
      } else if (isLocalStorageInstance(init, aliases)) {
        aliases.add(n.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
}

function scanFile({ file, source, sf }, sites) {
  const aliases = new Set();
  const constStrings = new Map();
  collectBindings(sf, aliases, constStrings);

  const seen = new Set();
  const ownerStart = new Map(); // node → 记它的那一站点，用于"一个槽访问只归一档一次"
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const statementText = (n) => {
    let s = n;
    while (s.parent && !ts.isStatement(s) && !ts.isSourceFile(s.parent)) s = s.parent;
    return (s.getText ? s.getText(sf) : source).replace(/\s+/g, ' ').trim().slice(0, 120);
  };

  const push = (bucket, node, shape, key, why) => {
    const start = node.getStart(sf);
    const id = `${start}:${bucket}:${key ?? '?'}`;
    if (seen.has(id)) return;
    seen.add(id);
    sites.push({
      file,
      bucket,
      shape,
      key: key ?? null,
      line: lineOf(node),
      code: statementText(node),
      why,
    });
  };

  /** 重定义类的四个入口（spyOn / defineProperty / defineProperties / Object.assign）共用 */
  const classifyRedefinedSlot = (siteNode, targetNode, keys, shape) => {
    const layer = layerOf(targetNode, aliases);
    if (!layer) return;
    for (const key of keys) {
      if (key === undefined) {
        push('undecidable', siteNode, shape, null, `${shape} 的方法名静态解不开，本尺不猜`);
      } else if (!WRITE_METHODS.has(key)) {
        push(
          'nonwrite-slot',
          siteNode,
          shape,
          key,
          '重定义的不是写方法槽（getItem/key/length 一类）',
        );
      } else if (layer === 'instance') {
        push(
          'violation',
          siteNode,
          shape,
          key,
          `往 localStorage 实例上定义写方法：[Storage] 语义下这会被当成"写一条名为 ${key} 的条目"，` +
            '注入静默空转（CI 的 Node 22/24 档实测如此）',
        );
      } else {
        push(
          'proto-redefine',
          siteNode,
          shape,
          key,
          '原型层重定义——夹具 resolveLayer 用的正是这一层，合规',
        );
      }
    }
  };

  const calleeText = (node) => {
    const e = unwrap(node.expression);
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    if (ts.isElementAccessExpression(e)) return literalText(e.argumentExpression);
    if (ts.isIdentifier(e)) return e.text;
    return undefined;
  };
  const ownerOfCallee = (node) => {
    const e = unwrap(node.expression);
    if (ts.isPropertyAccessExpression(e)) return unwrap(e.expression);
    if (ts.isElementAccessExpression(e)) return unwrap(e.expression);
    return null;
  };
  const ownerNamed = (node, names) => {
    const o = ownerOfCallee(node);
    return !!o && ts.isIdentifier(o) && names.has(o.text);
  };

  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const fn = calleeText(n);
      const target = n.arguments[0];
      if (fn === 'spyOn') {
        // 接收者（vi / 别的 spy 对象）不参与判断：病在"实例上的写方法槽被重定义"，不是库名
        if (target)
          classifyRedefinedSlot(
            n,
            target,
            redefinedKeys(n.arguments, 'spyOn', constStrings),
            'spyOn',
          );
      } else if (
        (fn === 'defineProperty' || fn === 'defineProperties') &&
        ownerNamed(n, new Set(['Object', 'Reflect']))
      ) {
        if (target)
          classifyRedefinedSlot(n, target, redefinedKeys(n.arguments, fn, constStrings), fn);
      } else if (fn === 'assign' && ownerNamed(n, new Set(['Object']))) {
        if (target)
          classifyRedefinedSlot(
            n,
            target,
            redefinedKeys(n.arguments, 'assign', constStrings),
            'assign',
          );
      } else {
        // 正常调用写方法：`localStorage.setItem('a','b')`、`localStorage.clear()` —— 不是在重定义槽
        const acc = slotAccess(n.expression, aliases);
        if (acc && acc.layer === 'instance' && !ownerStart.has(acc.node)) {
          ownerStart.set(acc.node, true);
          if (acc.key === undefined) {
            push('undecidable', acc.node, 'call', null, '按下标取的槽，键名静态解不开');
          } else if (WRITE_METHODS.has(acc.key)) {
            push('write-call', acc.node, 'call', acc.key, '通过写方法正常写入（不是在重定义槽）');
          }
          // 读方法的调用（getItem/key/length）不是本尺的候选站点
        }
      }
    }

    if (ts.isBinaryExpression(n) && isAssignmentKind(n.operatorToken.kind)) {
      const shape =
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ? 'assignment'
          : `assignment(${n.operatorToken.getText(sf)})`;
      for (const t of collectWriteTargets(n.left, [], aliases)) {
        const acc = slotAccess(t, aliases);
        if (!acc) continue;
        ownerStart.set(acc.node, true);
        if (acc.key === undefined) {
          push('undecidable', acc.node, shape, null, '赋值目标的槽名静态解不开');
        } else if (!WRITE_METHODS.has(acc.key)) {
          push('nonwrite-slot', acc.node, shape, acc.key, '赋的是非写方法槽');
        } else if (acc.layer === 'instance') {
          push(
            'violation',
            acc.node,
            shape,
            acc.key,
            '给实例上的写方法槽赋值：形状盲，只有"方法本来就在实例上"的那一档成立（本机 Node 26 档），' +
              'CI 的 Node 22/24 档上它只是写了一条同名条目',
          );
        } else {
          push('proto-redefine', acc.node, shape, acc.key, '赋到原型层的写方法槽上（夹具那一层）');
        }
      }
    }

    // 槽访问但既不是重定义也不是赋值目标 ⇒ 读（含 delete）
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const acc = slotAccess(n, aliases);
      if (acc && acc.layer === 'instance' && !ownerStart.has(acc.node)) {
        const shape = ts.isDeleteExpression(acc.node.parent) ? 'delete' : 'read';
        if (acc.key === undefined) {
          push('undecidable', acc.node, shape, null, '读的下标静态解不开');
        } else if (WRITE_METHODS.has(acc.key)) {
          push('slot-read', acc.node, shape, acc.key, '读槽（把方法当值取出来），不重定义 ⇒ 不判');
        }
      }
    }

    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
}

// ------------------------------------------------------------- 豁免位点

/** `export function NAME` / `export const NAME` / `export { NAME }`（不含 `export … from` 的转发） */
function definesExport(sf, name) {
  let found = false;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && hasExportModifier(n)) found = true;
    if (ts.isClassDeclaration(n) && n.name?.text === name && hasExportModifier(n)) found = true;
    if (ts.isVariableStatement(n) && hasExportModifier(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) found = true;
      }
    }
    if (
      ts.isExportDeclaration(n) &&
      !n.moduleSpecifier &&
      n.exportClause &&
      ts.isNamedExports(n.exportClause)
    ) {
      for (const s of n.exportClause.elements) {
        if (s.name.text === name) found = true;
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

function hasExportModifier(node) {
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** `import { NAME } from '…'`，以及 `export { NAME } from '…'` 这种转发（转发的文件仍是消费方） */
function importsSymbol(sf, name) {
  let found = false;
  const visit = (n) => {
    if (
      ts.isImportDeclaration(n) &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    ) {
      for (const s of n.importClause.namedBindings.elements) {
        if ((s.propertyName ?? s.name).text === name) found = true;
      }
    }
    if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      n.exportClause &&
      ts.isNamedExports(n.exportClause)
    ) {
      for (const s of n.exportClause.elements) {
        if ((s.propertyName ?? s.name).text === name) found = true;
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/**
 * 豁免位点是**算**出来的：唯一导出方 + 至少一个调用方。任一半不成立就报 problems，
 * 由 verdict 退 2——把豁免从"抄在名单里的一行路径"变成"树当前必须真有的一个结构事实"。
 */
export function resolveExemption(parsed) {
  const exporters = [];
  const consumers = [];
  for (const p of parsed) {
    const defines = definesExport(p.sf, SANCTIONED_EXPORT);
    const uses = importsSymbol(p.sf, SANCTIONED_EXPORT);
    if (defines && !uses) exporters.push(p.file);
    if (uses) consumers.push(p.file);
  }
  const problems = [];
  if (exporters.length === 0)
    problems.push(
      `语料里没有导出 ${SANCTIONED_EXPORT} 的文件 ⇒ 豁免位点算不出（夹具改名/被删/搬出 src？）——不猜，读数作废`,
    );
  if (exporters.length > 1)
    problems.push(
      `导出 ${SANCTIONED_EXPORT} 的文件有 ${exporters.length} 个：${exporters.join(', ')} ⇒ 共享夹具不唯一，豁免该给谁算不出`,
    );
  if (exporters.length >= 1 && consumers.length === 0)
    problems.push(
      `没有任何语料文件 import ${SANCTIONED_EXPORT} ⇒ 这条豁免已失去依据：调用方不再经夹具，` +
        `就把 SANCTIONED_EXPORT 常量连同豁免一起删掉，别留一行过期名单`,
    );
  const exempt = exporters.length === 1 && consumers.length > 0 ? new Set(exporters) : new Set();
  return { exempt, problems, exporters, consumers };
}

// ---------------------------------------------------------------- 判决

export function verdict(an) {
  const tally = {};
  for (const s of an.sites) tally[s.bucket] = (tally[s.bucket] ?? 0) + 1;
  const sum = Object.values(tally).reduce((a, b) => a + b, 0);
  const faults = [];
  if (sum !== an.sites.length)
    faults.push(`Σ档位 ${sum} != 候选站点数 ${an.sites.length} ⇒ 有档位没被计入，读数作废`);
  faults.push(...an.exemptionProblems);
  for (const p of an.parseProblems.slice(0, 5)) faults.push(p);
  if (an.parseProblems.length > 5)
    faults.push(`……另有 ${an.parseProblems.length - 5} 个解析失败文件`);
  const violations = an.sites.filter((s) => s.bucket === 'violation');
  const undecidable = an.sites.filter((s) => s.bucket === 'undecidable');
  for (const u of undecidable)
    faults.push(
      `${u.file}:${u.line} 解不开（${u.shape}）：${u.why} ⇒ 既不折算成通过也不折算成违规`,
    );
  let rc = 0;
  if (violations.length) rc = 1;
  if (faults.length) rc = 2;
  return {
    rc,
    tally,
    sum,
    violations,
    undecidable,
    faults,
    sites: an.sites,
    exempt: an.exempt,
    preExcluded: an.preExcluded,
    // 故障的**来源**要能分得清：rc 2 到底是"解不开"、"解析失败"还是"豁免算不出"，臂按这三格各自断言
    exemptionProblems: an.exemptionProblems,
    parseProblems: an.parseProblems,
  };
}

const HOWTO =
  '改法：用 src/test/writeFailures.ts 的 makeLocalStorageWritesThrow(boom, {methods:[…]}) 注到' +
  '真拦得住调用的那一层，并在用例里跑 assertWriteInjectionLanded(inj, boom) 先证明抛得出去。';

function formatLines(v, { printSites = false } = {}) {
  const out = [];
  const t = Object.entries(v.tally)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  for (const f of v.violations)
    out.push(`  ✗ ${f.file}:${f.line} [${f.shape}] ${f.code}\n      ${f.why}\n      ${HOWTO}`);
  for (const f of v.faults) out.push(`  ⚠ 量具故障：${f}`);
  if (printSites)
    for (const s of v.sites)
      out.push(`  ${s.bucket.padEnd(14)} ${s.file}:${s.line} ${s.shape} ${s.code}`);
  out.push(
    `语料 ${v.preExcluded.length} 个 src/.ts(x)（豁免 ${v.exempt.length}：${v.exempt.join(',') || '—'}）｜` +
      `候选站点 ${v.sites.length}（Σ档位 ${v.sum}）｜${t || '无站点'}`,
  );
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const badArg = argFault(args);
  if (badArg) {
    console.error(`✗ ${badArg}`);
    console.error(`  用法：${USAGE}`);
    return 2;
  }
  if (args.includes('--self-test')) return selfTest();
  const v = verdict(analyze(readCorpus()));
  if (args.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    return v.rc;
  }
  for (const l of formatLines(v, { printSites: args.includes('--print-sites') })) console.log(l);
  if (v.rc === 2) {
    console.log(
      `✗ 量具故障：localStorage 写方法槽判据读数作废（${v.faults.length} 项），未折算成通过或违规`,
    );
    return 2;
  }
  if (v.rc === 1) {
    console.log(
      `✗ localStorage 写方法槽判据未通过：${v.violations.length} 处在实例上重定义写方法（形状盲，一档上会静默空转）`,
    );
    return 1;
  }
  console.log(`✔ localStorage 写方法槽判据通过：0 处实例层重定义、0 处解不开`);
  return 0;
}

function argFault(argv) {
  const bad = argv.filter((a) => !FLAGS.includes(a));
  if (!bad.length) return null;
  return (
    `未识别的参数 ${bad.map((b) => `'${b}'`).join(' ')} ⇒ 量具故障，不折算成通过。` +
    `本门禁只认：${FLAGS.join(' / ')}`
  );
}

// ------------------------------------------------------------------ 自测

/** 合规夹具的导出点（豁免位点由它算出，与真树同一套算法） */
const SANCTION_ONLY = {
  'src/test/writeFailures.ts': `export function ${SANCTIONED_EXPORT}(boom: Error) { void boom; return { restore: () => {} }; }\n`,
};
/** 再加一个纯调用方：让"豁免算得出"这件事不干扰各臂对 rc 的断言（否则 rc 2 可能是豁免的锅） */
const FIX_SANCTION = {
  ...SANCTION_ONLY,
  'src/consumer.test.ts':
    `import { ${SANCTIONED_EXPORT} } from '@/test/writeFailures';\n` +
    `export const useIt = (e: Error) => ${SANCTIONED_EXPORT}(e);\n`,
};

const FIX = {
  spySetItem: `
import { describe, it, vi } from 'vitest';
describe('x', () => {
  it('y', () => {
    const boom = new Error('QuotaExceededError');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw boom; });
  });
});
`,
  spyGlobalClear: `
import { vi } from 'vitest';
vi.spyOn(globalThis.localStorage, 'clear').mockImplementation(() => { throw new Error('x'); });
`,
  spyAliasedReceiver: `
const spy = { spyOn: (_o: unknown, _k: string) => ({ mockImplementation: () => {} }) };
spy.spyOn(localStorage, 'removeItem');
`,
  defineProperty: `
Object.defineProperty(localStorage, 'setItem', { value: () => { throw new Error('x'); }, configurable: true });
`,
  assign: `
const boom = () => { throw new Error('x'); };
localStorage.setItem = boom;
localStorage.removeItem ??= boom;
`,
  aliasedInstance: `
const ls = localStorage;
ls.clear = () => {};
`,
  definePropertiesAndAssign: `
Object.defineProperties(localStorage, { removeItem: { value: () => {} } });
Object.assign(localStorage, { clear: () => {} });
`,
  compliant: `
import { it, expect } from 'vitest';
import { ${SANCTIONED_EXPORT}, assertWriteInjectionLanded } from '@/test/writeFailures';
it('写失败要给回执', () => {
  localStorage.clear();                       // 正常调用，不是重定义
  const boom = new Error('quota');
  const inj = ${SANCTIONED_EXPORT}(boom, { methods: ['setItem'] });
  assertWriteInjectionLanded(inj, boom);
  expect(typeof localStorage.setItem).toBe('function');
});
`,
  plainCall: `
localStorage.setItem('a', 'b');
localStorage.removeItem('a');
`,
  readSlot: `
const f = localStorage.setItem;
const g = localStorage['clear'];
export const both = [f, g];
`,
  wholeObjectDefine: `
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: {}, configurable: true });
}
`,
  protoLayer: `
import { vi } from 'vitest';
vi.spyOn(Storage.prototype, 'setItem');
Object.defineProperty(Object.getPrototypeOf(localStorage), 'clear', { value: () => {} });
`,
  nonWriteSlot: `
import { vi } from 'vitest';
vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
`,
  unresolvedMethod: `
import { vi } from 'vitest';
const which: string = pick();
vi.spyOn(localStorage, which);
declare function pick(): string;
`,
  // 与上一臂只差一行：方法名写成 `const which = 'setItem'` ⇒ 一跳常量折叠必须把它翻成违规
  resolvedMethod: `
import { vi } from 'vitest';
const which = 'setItem';
vi.spyOn(localStorage, which);
`,
  inComments: `
// 旧写法是 vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw boom });
/* 同样 inert 的还有 Object.defineProperty(localStorage, 'clear', {}) 与 localStorage.setItem = fn */
export const ok = 1;
`,
  uncommented: `
vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw boom });
Object.defineProperty(localStorage, 'clear', {});
export const ok = 1;
`,
  inStrings: `
export const doc = "vi.spyOn(localStorage, 'setItem') 是旧写法";
export const tpl = \`Object.defineProperty(localStorage, 'removeItem', {})\`;
export const alias = \`localStorage.clear = boom\`;
`,
  outOfStrings: `
vi.spyOn(localStorage, 'setItem');
Object.defineProperty(localStorage, 'removeItem', {});
localStorage.clear = boom;
`,
};

/** 真语料读一次，多个臂共用（自测不许把真实 src 改半个字节） */
function realCorpus() {
  return readCorpus();
}

const tallyOf = (v) => v.tally;
const count = (v, bucket) => tallyOf(v)[bucket] ?? 0;

/** 只关心判决用的档位，不关心档位名拼写：违规数 + 各档加总必须自洽 */
function judge(files) {
  const v = verdict(analyze(files));
  return { v, n: v.violations.length };
}

const ARMS = [
  "臂1 必开火：vi.spyOn(localStorage, 'setItem')",
  "臂2 必开火：vi.spyOn(globalThis.localStorage, 'clear')",
  "臂3 必开火：接收者不叫 vi 的 spyOn(localStorage, 'removeItem')",
  "臂4 必开火：Object.defineProperty(localStorage, 'setItem', {})",
  '臂5 必开火：localStorage.setItem = fn 与 localStorage.removeItem ??= fn',
  '臂6 必开火：同文件别名 const ls = localStorage 之后的 ls.clear = fn',
  '臂7 必开火：Object.defineProperties / Object.assign 打到实例写方法槽',
  '臂8 不许开火：合规夹具调用（并看见 localStorage.clear() 落 write-call 档）',
  "臂9 不许开火：localStorage.setItem('a','b') 正常调用落 write-call 档",
  '臂10 不许开火：const f = localStorage.setItem 这类读槽落 slot-read 档',
  "臂11 不许开火：Object.defineProperty(globalThis, 'localStorage', {}) 整机兜底形状",
  '臂12 不许开火：原型层重定义（Storage.prototype / getPrototypeOf）落 proto-redefine 档',
  "臂13 不许开火：vi.spyOn(localStorage, 'getItem') 非写方法槽落 nonwrite-slot 档",
  '臂14 三态：方法名解不开 ⇒ undecidable 档，violation 仍 0、rc 判 2 不判 1',
  "臂14b 与臂14 成对：同一个变量名写成 const which = 'setItem' 必须翻成 violation",
  '臂15 不许开火：坏形状只出现在注释里（AST 而非文本）',
  '臂16 与臂15 成对：同一段文本去掉注释前缀必须开火 2 处',
  '臂17 不许开火：坏形状只出现在字符串/模板字面量里',
  '臂18 与臂17 成对：把字面量换成真代码（同一批文本）必须开火 3 处',
  '臂19 夹具落盘在仓库外：从 tmpdir 真读文件再判，开火读数与内存语料一致',
  '臂20 分母：真语料文件数 > 100 且豁免文件在剔除前清单里（0 命中不等于没解析）',
  '臂21 豁免是算出来的：0 导出方 / 2 导出方 / 无调用方 三种都必须报故障',
  '臂22 真语料当前 0 违规，且 Σ档位 == 候选站点数',
  '臂23 反向对照：真语料 + 注入一处坏形状 ⇒ 恰好 1 处违规且在我改的文件',
  '臂23b 真语料回退成历史写法：把夹具调用机械换成旧注入 ⇒ 违规数必须等于被换掉的处数',
  '臂24 语法坏文件不得伪装成"0 命中"：解析失败要落进量具故障（rc 2）',
  "臂25 参数闸门开火：真实 CLI 收到 '--self-tset' ⇒ 退 2 且点名该参数、列出接受集",
  "臂26 参数闸门反极性：无参数与在册参数都不被拒，'--self-test' 真抵达自测档",
];

function selfTest() {
  const rows = [];
  const push = (name, ok, want, got) => {
    if (!ARMS.includes(name)) throw new Error(`自测臂没登记进 ARMS：${name}`);
    rows.push({ name, ok, want, got: String(got) });
  };
  const dir = mkdtempSync(join(tmpdir(), 'qi-lsinj-selftest-'));
  try {
    // ---- 必开火轴
    for (const [name, src, want] of [
      ["臂1 必开火：vi.spyOn(localStorage, 'setItem')", FIX.spySetItem, 1],
      ["臂2 必开火：vi.spyOn(globalThis.localStorage, 'clear')", FIX.spyGlobalClear, 1],
      ["臂3 必开火：接收者不叫 vi 的 spyOn(localStorage, 'removeItem')", FIX.spyAliasedReceiver, 1],
      ["臂4 必开火：Object.defineProperty(localStorage, 'setItem', {})", FIX.defineProperty, 1],
      ['臂5 必开火：localStorage.setItem = fn 与 localStorage.removeItem ??= fn', FIX.assign, 2],
      [
        '臂6 必开火：同文件别名 const ls = localStorage 之后的 ls.clear = fn',
        FIX.aliasedInstance,
        1,
      ],
      [
        '臂7 必开火：Object.defineProperties / Object.assign 打到实例写方法槽',
        FIX.definePropertiesAndAssign,
        2,
      ],
    ]) {
      const n = judge({ ...FIX_SANCTION, 'src/a.test.ts': src }).n;
      push(name, n === want, `违规 ${want}`, `违规 ${n}`);
    }

    // ---- 不许开火轴：合规形状各自还要落到指定档位（只断"不红"看不见东西被折进哪一档）
    const okCompliant = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.compliant }));
    push(
      '臂8 不许开火：合规夹具调用（并看见 localStorage.clear() 落 write-call 档）',
      okCompliant.violations.length === 0 && count(okCompliant, 'write-call') === 1,
      '违规 0 / write-call 1',
      `违规 ${okCompliant.violations.length} / write-call ${count(okCompliant, 'write-call')}`,
    );
    const okCall = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.plainCall }));
    push(
      "臂9 不许开火：localStorage.setItem('a','b') 正常调用落 write-call 档",
      okCall.violations.length === 0 && count(okCall, 'write-call') === 2,
      '违规 0 / write-call 2',
      `违规 ${okCall.violations.length} / write-call ${count(okCall, 'write-call')}`,
    );
    const okRead = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.readSlot }));
    push(
      '臂10 不许开火：const f = localStorage.setItem 这类读槽落 slot-read 档',
      okRead.violations.length === 0 && count(okRead, 'slot-read') === 2,
      '违规 0 / slot-read 2',
      `违规 ${okRead.violations.length} / slot-read ${count(okRead, 'slot-read')}`,
    );
    const okWhole = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.wholeObjectDefine }));
    push(
      "臂11 不许开火：Object.defineProperty(globalThis, 'localStorage', {}) 整机兜底形状",
      okWhole.violations.length === 0 && okWhole.sites.length === 0,
      '违规 0 / 站点 0',
      `违规 ${okWhole.violations.length} / 站点 ${okWhole.sites.length}`,
    );
    const okProto = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.protoLayer }));
    push(
      '臂12 不许开火：原型层重定义（Storage.prototype / getPrototypeOf）落 proto-redefine 档',
      okProto.violations.length === 0 && count(okProto, 'proto-redefine') === 2,
      '违规 0 / proto-redefine 2',
      `违规 ${okProto.violations.length} / proto-redefine ${count(okProto, 'proto-redefine')}`,
    );
    const okNon = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.nonWriteSlot }));
    push(
      "臂13 不许开火：vi.spyOn(localStorage, 'getItem') 非写方法槽落 nonwrite-slot 档",
      okNon.violations.length === 0 &&
        count(okNon, 'nonwrite-slot') === 1 &&
        okNon.exemptionProblems.length === 0 &&
        okNon.rc === 0,
      '违规 0 / nonwrite-slot 1 / rc 0',
      `违规 ${okNon.violations.length} / nonwrite-slot ${count(okNon, 'nonwrite-slot')}`,
    );
    const un = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.unresolvedMethod }));
    push(
      '臂14 三态：方法名解不开 ⇒ undecidable 档，violation 仍 0、rc 判 2 不判 1',
      un.violations.length === 0 &&
        count(un, 'undecidable') === 1 &&
        un.rc === 2 &&
        un.exemptionProblems.length === 0 &&
        un.faults.some((f) => f.includes('解不开')),
      '违规 0 / undecidable 1 / rc 2 且故障点名"解不开"（非豁免的锅）',
      `违规 ${un.violations.length} / undecidable ${count(un, 'undecidable')} / rc ${un.rc} / 豁免故障 ${un.exemptionProblems.length}`,
    );
    const folded = verdict(analyze({ ...FIX_SANCTION, 'src/a.test.ts': FIX.resolvedMethod }));
    push(
      "臂14b 与臂14 成对：同一个变量名写成 const which = 'setItem' 必须翻成 violation",
      folded.violations.length === 1 && count(folded, 'undecidable') === 0 && folded.rc === 1,
      '违规 1 / undecidable 0 / rc 1',
      `违规 ${folded.violations.length} / undecidable ${count(folded, 'undecidable')} / rc ${folded.rc}`,
    );

    // ---- AST 而非文本：注释与字面量两对单变量对照
    const cmt = judge({ ...FIX_SANCTION, 'src/a.test.ts': FIX.inComments }).n;
    const unc = judge({ ...FIX_SANCTION, 'src/a.test.ts': FIX.uncommented }).n;
    push('臂15 不许开火：坏形状只出现在注释里（AST 而非文本）', cmt === 0, '违规 0', `违规 ${cmt}`);
    push(
      '臂16 与臂15 成对：同一段文本去掉注释前缀必须开火 2 处',
      unc === 2,
      '违规 2',
      `违规 ${unc}`,
    );
    const str = judge({ ...FIX_SANCTION, 'src/a.test.ts': FIX.inStrings }).n;
    const outStr = judge({ ...FIX_SANCTION, 'src/a.test.ts': FIX.outOfStrings }).n;
    push('臂17 不许开火：坏形状只出现在字符串/模板字面量里', str === 0, '违规 0', `违规 ${str}`);
    push(
      '臂18 与臂17 成对：把字面量换成真代码（同一批文本）必须开火 3 处',
      outStr === 3,
      '违规 3',
      `违规 ${outStr}`,
    );

    // ---- 夹具落盘（仓库外）：证明读盘路径本身工作，而不是只在内存字符串上自证
    const sub = join(dir, 'src', 'a.test.ts');
    mkdirSync(dirname(sub), { recursive: true });
    writeFileSync(sub, FIX.spySetItem);
    const readBack = readFileSync(sub, 'utf8');
    const diskN = judge({ 'src/a.test.ts': readBack }).n;
    push(
      '臂19 夹具落盘在仓库外：从 tmpdir 真读文件再判，开火读数与内存语料一致',
      !dir.startsWith(ROOT) && readBack === FIX.spySetItem && diskN === 1,
      '仓库外 + 违规 1',
      `dir=${dir.startsWith(ROOT) ? '仓库内(错)' : '仓库外'} 违规 ${diskN}`,
    );

    // ---- 真语料：分母、当前判决、反向对照
    const real = realCorpus();
    const realAn = analyze(real);
    const realV = verdict(realAn);
    push(
      '臂20 分母：真语料文件数 > 100 且豁免文件在剔除前清单里（0 命中不等于没解析）',
      realAn.preExcluded.length > 100 &&
        realAn.preExcluded.includes('src/test/writeFailures.ts') &&
        !realV.sites.some((s) => s.file === 'src/test/writeFailures.ts') &&
        realV.exempt.length === 1,
      '>100 文件 / 豁免 1 / 语料内不含豁免文件站点',
      `${realAn.preExcluded.length} 文件 / 豁免 ${realV.exempt.join(',')} / ${realV.sites.length} 站点`,
    );
    const noExporter = analyze({ 'src/a.test.ts': FIX.spySetItem });
    const twoExporters = analyze({
      ...FIX_SANCTION,
      'src/test/other.ts': `export const ${SANCTIONED_EXPORT} = 1;\n`,
      'src/a.test.ts': FIX.compliant,
    });
    const noConsumer = analyze({ ...SANCTION_ONLY, 'src/a.test.ts': FIX.plainCall });
    push(
      '臂21 豁免是算出来的：0 导出方 / 2 导出方 / 无调用方 三种都必须报故障',
      noExporter.exemptionProblems.length === 1 &&
        twoExporters.exemptionProblems.length === 1 &&
        noConsumer.exemptionProblems.length === 1 &&
        realAn.exemptionProblems.length === 0,
      '各 1 条故障、真语料 0 条',
      `无导出方 ${noExporter.exemptionProblems.length} / 两导出方 ${twoExporters.exemptionProblems.length} / 无调用方 ${noConsumer.exemptionProblems.length} / 真 ${realAn.exemptionProblems.length}`,
    );
    push(
      '臂22 真语料当前 0 违规，且 Σ档位 == 候选站点数',
      realV.violations.length === 0 && realV.sum === realV.sites.length && realV.rc === 0,
      '违规 0 / Σ==站点 / rc 0',
      `违规 ${realV.violations.length} / Σ ${realV.sum} 站点 ${realV.sites.length} / rc ${realV.rc}`,
    );
    const touched =
      realV.preExcluded.find((f) => f.endsWith('/storage.test.ts')) ??
      'src/utils/__tests__/storage.test.ts';
    const injected = {
      ...real,
      [touched]: `${real[touched]}\nlocalStorage.setItem = function () { throw new Error('注入'); };\n`,
    };
    const injV = verdict(analyze(injected));
    const fresh = injV.violations.filter(
      (f) => !realV.violations.some((b) => b.file === f.file && b.line === f.line),
    );
    push(
      '臂23 反向对照：真语料 + 注入一处坏形状 ⇒ 恰好 1 处违规且在我改的文件',
      realV.violations.length === 0 &&
        fresh.length === 1 &&
        fresh[0].file === touched &&
        injV.sum === injV.sites.length,
      '新增违规恰好 1 处且在该文件',
      `新增 ${fresh.length} 处 / 命中 ${fresh[0]?.file ?? '—'}`,
    );
    // 臂23b：把**真文件里**的夹具调用机械换成 2026-09-27 那批旧注入（只在内存里，不落盘），
    // 违规数必须等于被换掉的处数。这一臂钉的是"判据抓得住当初那八格假绿的真实形状"，
    // 而不是只抓我自己写的玩具夹具；夹具调用数由语料现算，加调用点不需要改这条臂。
    const CALL_RE = new RegExp(
      `${SANCTIONED_EXPORT}\\((\\w+), \\{ methods: \\['(\\w+)'\\][^}]*\\}\\)`,
      'g',
    );
    const rolled = { ...real };
    let rewrote = 0;
    for (const [f, src] of Object.entries(real)) {
      const hits = src.match(CALL_RE) ?? [];
      if (!hits.length) continue;
      rewrote += hits.length;
      rolled[f] = src.replace(
        CALL_RE,
        (_m, varName, key) =>
          `vi.spyOn(localStorage, '${key}').mockImplementation(() => { throw ${varName}; })`,
      );
    }
    const rolledV = verdict(analyze(rolled));
    const rolledFresh = rolledV.violations.filter(
      (f) => !realV.violations.some((b) => b.file === f.file && b.line === f.line),
    );
    push(
      '臂23b 真语料回退成历史写法：把夹具调用机械换成旧注入 ⇒ 违规数必须等于被换掉的处数',
      rewrote >= 3 &&
        rolledV.violations.length === rewrote &&
        rolledFresh.length === rewrote &&
        new Set(rolledFresh.map((f) => f.file)).size === 3 &&
        rolledV.exemptionProblems.length === 0 &&
        rolledV.rc === 1,
      `违规 = 换掉的处数 ${rewrote}、分布在 3 个文件、rc 1（豁免还在，锅不在尺子）`,
      `换掉 ${rewrote} 处 → 违规 ${rolledV.violations.length}（新增 ${rolledFresh.length}）/ 分布 ${new Set(rolledFresh.map((f) => f.file)).size} 文件 / 豁免故障 ${rolledV.exemptionProblems.length} / rc ${rolledV.rc}`,
    );
    const broken = analyze({ ...FIX_SANCTION, 'src/broken.test.ts': 'export const x = ;' });
    push(
      '臂24 语法坏文件不得伪装成"0 命中"：解析失败要落进量具故障（rc 2）',
      broken.sites.length === 0 && broken.parseProblems.length > 0 && verdict(broken).rc === 2,
      '站点 0 但 parseProblems>0 且 rc 2',
      `站点 ${broken.sites.length} / 解析故障 ${broken.parseProblems.length} / rc ${verdict(broken).rc}`,
    );

    // ---- 参数闸门两极性（R58）：由子进程打真实 CLI，臂不重抄判据
    const typo = spawnSync(process.execPath, [SELF, '--self-tset'], { encoding: 'utf8' });
    const typoMsg = `${typo.stderr ?? ''}\n${typo.stdout ?? ''}`;
    push(
      "臂25 参数闸门开火：真实 CLI 收到 '--self-tset' ⇒ 退 2 且点名该参数、列出接受集",
      typo.status === 2 &&
        typoMsg.includes('--self-tset') &&
        FLAGS.every((f) => typoMsg.includes(f)),
      'rc 2 + 点名 + 列接受集',
      `rc=${typo.status} ${(typo.stderr ?? '').trim().slice(0, 60)}`,
    );
    const json = spawnSync(process.execPath, [SELF, '--json'], { encoding: 'utf8' });
    if (process.env.GATE_ARG_NO_SPAWN) {
      push(
        "臂26 参数闸门反极性：无参数与在册参数都不被拒，'--self-test' 真抵达自测档",
        json.status !== 2 && argFault([]) === null && FLAGS.every((f) => argFault([f]) === null),
        '在册参数全被接受（端到端那一半本轮由父进程关掉）',
        `--json rc=${json.status}（GATE_ARG_NO_SPAWN=1，端到端臂 SKIP）`,
      );
    } else {
      const good = spawnSync(process.execPath, [SELF, '--self-test'], {
        encoding: 'utf8',
        env: { ...process.env, GATE_ARG_NO_SPAWN: '1' },
      });
      const goodOut = `${good.stdout ?? ''}\n${good.stderr ?? ''}`;
      push(
        "臂26 参数闸门反极性：无参数与在册参数都不被拒，'--self-test' 真抵达自测档",
        json.status !== 2 &&
          argFault([]) === null &&
          FLAGS.every((f) => argFault([f]) === null) &&
          good.status !== 2 &&
          goodOut.includes('Σ臂'),
        '在册参数全被接受 + --self-test 端到端 rc≠2 且有自测档收尾读数',
        `--json rc=${json.status} / --self-test rc=${good.status}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const r of rows)
    console.log(`  ${r.ok ? '✔' : '✗'} ${r.name} — 期望 ${r.want}｜实得 ${r.got}`);
  const failed = rows.filter((r) => !r.ok);
  // 对账：报告出来的臂数必须 == 名单里的臂数（漏臂/重臂都当场红，不接受"看起来全绿"）
  const dup = rows.length !== new Set(rows.map((r) => r.name)).size;
  const missing = ARMS.filter((a) => !rows.some((r) => r.name === a));
  console.log(
    `Σ臂 reported ${rows.length} == defined ${ARMS.length} ？ ${rows.length === ARMS.length && !dup && !missing.length ? '是' : `否（重复 ${dup}，缺席 ${missing.join(', ') || '无'}）`}`,
  );
  console.log(
    failed.length === 0 && rows.length === ARMS.length && !dup && !missing.length
      ? `✔ localStorage 写方法槽判据自测通过：${rows.length}/${ARMS.length} 臂全绿` +
          `（必开火／不许开火成对、真语料分母与反向对照、豁免是算出来的、语法坏与解不开不折算、参数闸门两极性）`
      : `✗ localStorage 写方法槽判据自测未通过：${failed.length}/${rows.length} 臂不绿，臂数对账 ${rows.length}/${ARMS.length}`,
  );
  return failed.length === 0 && rows.length === ARMS.length && !dup && !missing.length ? 0 : 1;
}

/** 崩溃不得冒充产品判红：未捕获异常一律按量具故障退 2（沿用 check-settings-inert.mjs 的约定）。 */
function toolFault(e) {
  console.error(
    '✗ 量具故障（未捕获异常，不得当成产品判红）：',
    e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e,
  );
  return 2;
}

try {
  process.exit(main());
} catch (e) {
  process.exit(toolFault(e));
}
