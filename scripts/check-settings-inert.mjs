#!/usr/bin/env node
/* global console, process */
/**
 * 设置项「零读者 × 零上行」普查判据（R49 续 → 本轮 R56）
 *
 * 存在理由：R49 把设置页的缺陷记成"7 个字段从不上行，却共用『设置已保存』"，
 * 并按"值留在 localStorage，换设备就丢"估了严重度。本轮逐字段重开读者后，那个前提**只对一半**：
 * 上不上行只是两根轴之一，另一根是"有没有任何生产代码读它"。
 * 既不上行也没读者的开关，问题不是"换设备会丢"，而是它压根不改变任何行为——
 * 给这种字段补持久化，等于把假承诺做实。所以这条尺子量的是两根轴的积，不是一根。
 *
 * 分母：`Settings` 接口的每个顶层字段 + `DEFAULTS.notifications` 的每个键。
 * 通知开关在类型上是 `Record<string, boolean>`，整对象只有一个读者，逐键才看得出谁在骗人。
 *
 * 两根轴的判法：
 *   上行轴 = 解析 `toAppSettings` 体内读了哪些本地单位。服务端列名与本地名不同源
 *     （`deadlineReminder: s.notifications.timeoutAlert` ⇒ 上行的是 timeoutAlert），
 *     所以按"本地哪个单位的值上了行"记，不按服务端列名记。
 *   读者轴 = 类型解析（ts.createProgram + checker），只认**声明在 interface Settings 上**的成员访问与解构。
 *     为什么不用文本：同名不同物实测一大堆（`currency` 在 34 个文件里出现，绝大多数是 `Inquiry.currency`；
 *     `organization` 同理），文本匹配的清单一定假绿或假红。
 *     编辑面（store 自身 + `src/pages/settings/index.tsx`）不算读者——那是写侧与表单绑定。
 *   宽面（沿用 R55 的规矩：**只减不增，且逐条打位点供人否证**）：`notifications.<键>` 走计算下标时静态拿不到键
 *     （`useSettingsStore.getState().notifications[settingKey]`），于是"非编辑面出现同名对象键/字符串字面量"
 *     记为一次宽读，把该键从 inert 里救出来。宽面永不参与判红之外的用途。
 *
 * 四档：
 *   live            上行 且 有读者
 *   local-only      不上行 但 有读者 ⇒ 本机生效、跨设备漂移（R49 原本在说的那一类）
 *   uploaded-only   上行 但 无读者 ⇒ 存进库没人用（判红：它是对运维的假承诺）
 *   inert           不上行 且 无读者 ⇒ 必须在下面的台账里逐条声明理由，否则判红
 * 反向对账：台账里声明了 inert 而尺子读到读者 ⇒ "清单已过期"判红。单向白名单等于没有门禁。
 *
 * 用法：node scripts/check-settings-inert.mjs [--self-test|--json|--print-sites]
 * 退码：0 通过 / 1 真违规 / 2 量具故障（分母取不到、找不到 store 文件、类型解析没跑起来）
 *       —— 崩溃不得冒充判红，否则"尺子坏了"会被读成"产品违规"。
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE_FILE = 'src/store/useSettingsStore.ts';
/** 编辑面：写侧与表单绑定，不算"这个设置有人用"的证据 */
const EDIT_SURFACE = new Set([STORE_FILE, 'src/pages/settings/index.tsx']);

/**
 * 惰性台账：每条 = 一个既不上行也没读者的单位 + 它为什么可以暂时这样留着 + 接上它缺什么。
 * 新增条目必须写清"缺什么"，否则这条尺子就退化成橡皮章。
 */
const INERT_DECLARED = {
  organization:
    '数据过滤的权威是 useUIStore.currentOrganization（store 内注释自证），本字段是同一概念的第二个入口；接它=先决定谁是权威',
  validDays:
    '报价有效期的数据槽是供应商自填的 validUntil（types/index.ts:405），采购侧没有承载位；接它=先有"随邀请下发的有效期列"',
  'notifications.todoReminder':
    'TYPE_TO_SETTING_KEY（store/useNotificationStore.ts:30）里没有这个键，也没有待办通知生成器；接它=先有"每日待办汇总"事件',
};

/**
 * 跨侧读者台账：`uploaded-only` 档说的是"前端这侧没人读"，但有些单位的读者在另一条线上
 * （AI 配置由后端 ai.py 读）。TS Program 结构上看不见 Python，所以这一格只能靠**带出处的声明**，
 * 并且出处必须被本尺子重新打开验一次（引不到=判红）——否则它就是一张会过期的空头台账。
 */
const CROSS_SIDE_READERS = {
  ai: {
    file: 'backend/app/routers/ai.py',
    mustContain: 'ai_provider',
    why: 'AI 调用参数由后端读 AppSettings 的 ai_* 列',
  },
};

const norm = (p) => p.split(sep).join('/');
const toRel = (p) => {
  const n = norm(p);
  const i = n.lastIndexOf('/src/');
  return i >= 0 ? n.slice(i + 1) : relative(ROOT, n).split(sep).join('/');
};
const isTestFile = (rel) => rel.includes('__tests__/') || /\.test\.tsx?$/.test(rel);

function collectUnits(sf) {
  let iface = null;
  let defaults = null;
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'Settings') iface = n;
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.name.text === 'DEFAULTS' &&
          ts.isObjectLiteralExpression(d.initializer)
        ) {
          defaults = d.initializer;
        }
      }
    }
  });
  if (!iface || !defaults)
    throw new ToolFault(`分母取不到：未识别 interface Settings 或 const DEFAULTS`);
  const top = iface.members
    .filter((m) => ts.isPropertySignature(m) && ts.isIdentifier(m.name))
    .map((m) => m.name.text);
  const np = defaults.properties.find(
    (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'notifications',
  );
  if (!np || !ts.isPropertyAssignment(np) || !ts.isObjectLiteralExpression(np.initializer)) {
    throw new ToolFault('分母取不到：DEFAULTS.notifications 不是对象字面量');
  }
  const notifKeys = np.initializer.properties
    .filter((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name))
    .map((p) => `notifications.${p.name.text}`);
  return { top, notifKeys, all: [...top, ...notifKeys] };
}

function analyze(prog) {
  const checker = prog.getTypeChecker();
  const storeSf = prog.getSourceFiles().find((f) => toRel(f.fileName) === STORE_FILE);
  if (!storeSf) throw new ToolFault(`Program 里没有 ${STORE_FILE}`);
  const units = collectUnits(storeSf);
  const fieldSet = new Set(units.top);
  const notifSet = new Set(units.notifKeys.map((k) => k.split('.')[1]));

  const narrow = new Map();
  const wide = new Map();
  const testOnly = new Map();
  const uploaded = new Set();
  const push = (m, k, site) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(site);
  };
  const declaredInSettings = (prop) =>
    (prop.declarations ?? []).some(
      (d) => d.parent && ts.isInterfaceDeclaration(d.parent) && d.parent.name.text === 'Settings',
    );
  /** 这个节点解析到的是 Settings 的哪个单位？解析不到返回 null */
  function unitOf(node) {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      // 两级：x.notifications.key
      if (
        notifSet.has(name) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'notifications'
      ) {
        const inner = unitOfNotifications(node.expression);
        if (inner) return `notifications.${name}`;
      }
      if (name === 'notifications') return unitOfNotifications(node) ? 'notifications' : null;
      if (!fieldSet.has(name)) return null;
      const t = checker.getTypeAtLocation(node.expression);
      const p = t && t.getProperty && t.getProperty(name);
      return p && declaredInSettings(p) ? name : null;
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const vd = node.parent && node.parent.parent;
      const init = vd && ts.isVariableDeclaration(vd) ? vd.initializer : null;
      if (!init) return null;
      const t = checker.getTypeAtLocation(init);
      const p = t && t.getProperty && t.getProperty(name);
      if (!p || !declaredInSettings(p)) return null;
      if (fieldSet.has(name)) return name;
      if (name === 'notifications') return 'notifications';
      return null;
    }
    return null;
  }
  function unitOfNotifications(accessNode) {
    const holder = accessNode.expression;
    const t = checker.getTypeAtLocation(holder);
    const p = t && t.getProperty && t.getProperty('notifications');
    return p && declaredInSettings(p) ? true : null;
  }
  const line = (sf, node) =>
    `${toRel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  for (const sf of prog.getSourceFiles()) {
    const rel = toRel(sf.fileName);
    // 语料面必须只有 TS/TSX：tsconfig 的 resolveJsonModule 会把 src/locales/*.json 也放进 Program，
    // 而 locale 里的 "todoReminder" 是展示文案不是读者——本轮第一跑就是被它污染出 4 条假"清单已过期"的。
    if (!rel.startsWith('src/') || !/\.tsx?$/.test(rel) || /\.d\.ts$/.test(rel)) continue;
    const isEdit = EDIT_SURFACE.has(rel);
    const walk = (node) => {
      if (
        isEdit &&
        rel === STORE_FILE &&
        !isTestFile(rel) &&
        enclosingFn(node) === 'toAppSettings'
      ) {
        const u = unitOf(node);
        // 容器单位不参与上行轴：toAppSettings 读 `s.notifications.timeoutAlert` 时，
        // 内层 `s.notifications` 也会解析成一次访问——若把它算作"整个 notifications 已上行"，
        // 一个"每个键都惰性"的容器就能被读成 live。上行只记到具体键与顶层字段。
        if (u && u !== 'notifications') uploaded.add(u);
      }
      if (!isEdit) {
        const u = unitOf(node);
        if (u) {
          if (isTestFile(rel)) push(testOnly, u, line(sf, node));
          else push(narrow, u, line(sf, node));
        }
        // 宽面：通知键以字符串字面量或对象键出现在非编辑面
        const key =
          ts.isStringLiteral(node) && notifSet.has(node.text)
            ? node.text
            : ts.isPropertyAssignment(node) &&
                ts.isIdentifier(node.name) &&
                notifSet.has(node.name.text)
              ? node.name.text
              : null;
        if (key) push(wide, `notifications.${key}`, line(sf, node));
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }

  const rows = units.all.map((unit) => {
    const readSites = narrow.get(unit) ?? [];
    const wideSites = wide.get(unit) ?? [];
    const up = uploaded.has(unit);
    let bucket;
    if (readSites.length || wideSites.length) bucket = up ? 'live' : 'local-only';
    else if (up) bucket = 'uploaded-only';
    else bucket = 'inert';
    return { unit, bucket, up, readSites, wideSites, testSites: testOnly.get(unit) ?? [] };
  });
  const tally = {};
  for (const r of rows) tally[r.bucket] = (tally[r.bucket] ?? 0) + 1;
  return { rows, tally, denominator: units.all.length, inertDeclared: INERT_DECLARED };
}

function enclosingFn(node) {
  let n = node.parent;
  while (n) {
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) && n.name) return n.name.text;
    n = n.parent;
  }
  return null;
}

/** 判红规则：未声明的惰性、过期的声明、uploaded-only、Σ≠分母、台账里出现了不存在的单位 */
function judge({ rows, denominator }, inertDeclared, label, crossSide = {}, root = ROOT) {
  const errors = [];
  if (rows.length !== denominator) {
    errors.push(`整仓：Σ行数(${rows.length}) != 分母(${denominator}) ⇒ 语料被漏扫`);
  }
  const seen = new Map(rows.map((r) => [r.unit, r]));
  for (const declared of Object.keys(inertDeclared)) {
    const row = seen.get(declared);
    if (!row) {
      errors.push(
        `台账：${label} 声明惰性 ${declared}，但该单位不在分母里 ⇒ 清单已过期（字段可能已被删）`,
      );
      continue;
    }
    if (row.bucket !== 'inert') {
      const how = row.readSites.length
        ? `类型解析到读者 ${row.readSites[0]}`
        : `宽面读到 ${row.wideSites[0]}`;
      errors.push(`台账：${label} 声明惰性 ${declared}，但${how} ⇒ 清单已过期，删掉这条`);
    }
  }
  for (const row of rows) {
    if (row.bucket === 'inert' && !(row.unit in inertDeclared)) {
      const t = row.testSites.length
        ? `（只有测试读者 ${row.testSites[0]}，测试在重述写侧，不算行为读者）`
        : '';
      errors.push(
        `${label}：${row.unit} 既不上行也没有读者${t} ⇒ 要么接上它，要么写明理由挂进惰性台账`,
      );
    }
    if (row.bucket === 'uploaded-only') {
      const cs = crossSide[row.unit];
      if (!cs) {
        errors.push(`${label}：${row.unit} 已上行到服务端却零读者 ⇒ 假承诺，接上读者或删掉上行`);
      } else {
        const cited = join(root, cs.file);
        let text = null;
        try {
          text = readFileSync(cited, 'utf8');
        } catch {
          text = null;
        }
        if (text === null) {
          errors.push(`${label}：${row.unit} 声明跨侧读者，但出处 ${cs.file} 打不开 ⇒ 引用已失效`);
        } else if (!text.includes(cs.mustContain)) {
          errors.push(
            `${label}：${row.unit} 声明跨侧读者 ${cs.file}，但那文件里已没有 ${cs.mustContain} ⇒ 引用已过期，重开它`,
          );
        }
      }
    }
  }
  return errors;
}

class ToolFault extends Error {}

function realProgram() {
  const cfg = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  if (cfg.error)
    throw new ToolFault(
      `tsconfig.json 读不到：${ts.flattenDiagnosticMessageText(cfg.error.messageText, ' ')}`,
    );
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const prog = ts.createProgram(parsed.fileNames, parsed.options);
  const n = prog.getSourceFiles().filter((f) => toRel(f.fileName).startsWith('src/')).length;
  if (n < 50) throw new ToolFault(`真实 Program 只含 ${n} 个 src 文件 ⇒ 量具故障，不以此为读数`);
  return prog;
}

/** 自检：夹具落 TMPDIR 的真文件（不在仓库里，也不软链回真树），用默认 host 正常解析相对 import */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'qqi-settings-inert-'));
  const W = (rel, text) => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  };
  try {
    W(
      STORE_FILE,
      `export interface Settings {
  readNarrow: string;
  viaSelector: string;
  inertPlain: string;
  dupNameUnrelated: string;
  uploadedNoReader: string;
  notifications: Record<string, boolean>;
}
export declare const useSettingsStore: { getState: () => Settings };
export function toAppSettings(s: Settings) {
  return { server: { name: s.notifications.timeoutAlert, blob: s.uploadedNoReader }, misc: s.readNarrow };
}
const DEFAULTS: Settings = {
  readNarrow: 'a', viaSelector: 'b', inertPlain: 'c', dupNameUnrelated: 'd', uploadedNoReader: 'e',
  notifications: { timeoutAlert: true, inertKey: true },
};
export default DEFAULTS;
`,
    );
    W(
      'src/pages/settings/index.tsx',
      `import { useSettingsStore } from '../../store/useSettingsStore';
const s = useSettingsStore.getState();
export const form = { inertPlain: s.inertPlain, dup: s.dupNameUnrelated, key: s.notifications.inertKey };
`,
    );
    W(
      'src/consumer.ts',
      `import { useSettingsStore } from './store/useSettingsStore';
const { readNarrow } = useSettingsStore.getState();
export const a = readNarrow;
export const b = useSettingsStore.getState().viaSelector;
export const t = useSettingsStore.getState().notifications.timeoutAlert;
const cfg = useSettingsStore.getState().notifications;
const KEYS = ['inertKey'];
export const c = cfg[KEYS[0]];
`,
    );
    W(
      'src/other.ts',
      `interface Inquiry { dupNameUnrelated: string }
export function use(i: Inquiry) { return i.dupNameUnrelated; }
`,
    );
    const parsed = ts.parseJsonConfigFileContent(
      {
        compilerOptions: {
          target: 'es2020',
          strict: true,
          noEmit: true,
          moduleResolution: 'bundler',
        },
      },
      ts.sys,
      dir,
    );
    const prog = ts.createProgram(
      [
        join(dir, STORE_FILE),
        join(dir, 'src/pages/settings/index.tsx'),
        join(dir, 'src/consumer.ts'),
        join(dir, 'src/other.ts'),
      ],
      { ...parsed.options, noEmit: true },
    );
    const leaked = prog
      .getSourceFiles()
      .filter(
        (f) =>
          /\.tsx?$/.test(f.fileName) &&
          !/node_modules/.test(f.fileName) &&
          !toRel(f.fileName).startsWith('src/'),
      );
    if (leaked.length) {
      return fault(
        `自检夹具语料里混进了非 src 下的 TS 文件（${leaked.length} 个）⇒ 相对路径假设不成立，读数作废`,
      );
    }
    const foreign = prog
      .getSourceFiles()
      .filter(
        (f) =>
          /\.tsx?$/.test(f.fileName) &&
          !/node_modules/.test(f.fileName) &&
          toRel(f.fileName).startsWith('src/') &&
          !norm(f.fileName).startsWith(norm(dir) + '/'),
      );
    if (foreign.length) {
      return fault(
        `夹具 Program 里有 ${foreign.length} 个不在 ${dir} 下的 src 文件 ⇒ 混进了真实仓库，读数作废`,
      );
    }
    const res = analyze(prog);
    const want = {
      readNarrow: 'live',
      viaSelector: 'local-only',
      'notifications.timeoutAlert': 'live',
      inertPlain: 'inert',
      dupNameUnrelated: 'inert',
      'notifications.inertKey': 'local-only',
      notifications: 'local-only',
      uploadedNoReader: 'uploaded-only',
    };
    const bad = [];
    for (const [unit, expect] of Object.entries(want)) {
      const row = res.rows.find((r) => r.unit === unit);
      if (!row) bad.push(`分母里没有 ${unit} ⇒ 夹具没被扫到`);
      else if (row.bucket !== expect) {
        bad.push(
          `${unit} 期望 ${expect}，实际 ${row.bucket}（read=${row.readSites.join(',')} wide=${row.wideSites.join(',')}）`,
        );
      }
    }
    if (res.denominator !== 8)
      bad.push(`分母期望 8（6 顶层含 notifications 容器 + 2 通知键），实际 ${res.denominator}`);
    // 必开火 ①：未声明的惰性单位 ⇒ 判红
    const missing = judge(
      { rows: res.rows, denominator: res.denominator },
      { 'notifications.inertKey': 'x' },
      '夹具',
    );
    if (!missing.some((e) => e.includes('inertPlain'))) {
      bad.push('必开火失败：无人读且未声明的 inertPlain 没判红 ⇒ 尺子不会开火');
    }
    // 必开火 ②：谎报惰性（它其实有读者）⇒ 判"清单已过期"
    const lie = judge(
      { rows: res.rows, denominator: res.denominator },
      { ...INERT_DECLARED, readNarrow: '谎报' },
      '夹具',
    );
    if (!lie.some((e) => e.includes('readNarrow') && e.includes('清单已过期'))) {
      bad.push('必开火失败：把有读者的单位声明为惰性没被判红 ⇒ 台账可以单向撒谎');
    }
    // 不开火：合规侧全部声明到位 ⇒ 零红
    const okLedger = judge(
      { rows: res.rows, denominator: res.denominator },
      { inertPlain: '夹具', dupNameUnrelated: '夹具' },
      '夹具',
      {
        uploadedNoReader: {
          file: 'backend/app/routers/ai.py',
          mustContain: 'ai_provider',
          why: '夹具借用真出处',
        },
      },
    );
    if (okLedger.length) bad.push('不该开火却判红：' + okLedger.join(' / '));
    // 同名不同物必须没被算成读者（否则文本匹配冒充类型解析）
    const dup = res.rows.find((r) => r.unit === 'dupNameUnrelated');
    if (dup && dup.readSites.length) bad.push(`同名不同物被误判为读者：${dup.readSites.join(',')}`);
    // 编辑面不算读者
    if (res.rows.find((r) => r.unit === 'inertPlain')?.readSites.length) {
      bad.push('编辑面被当成了读者面：inertPlain 只在 store/settings 页出现却有读者');
    }
    // 夹具断言的收口：bad 必须先被消费，否则上面 13 条 push 全是死码
    // （本尺子第一版就是这么绿的——变异 M3 关掉"谎报惰性"判红后自测仍 rc=0，才暴露这里漏了收口）
    if (bad.length) {
      console.error('✗ 自检失败（夹具臂）：');
      for (const b of bad) console.error('   ', b);
      return 1;
    }
    // 真实树必须干净，且尺子不能是瞎的：live 档必须 > 0
    const real = analyze(realProgram());
    const realErrors = judge(real, real.inertDeclared, '真树', CROSS_SIDE_READERS);
    if (realErrors.length) {
      console.error('✗ 自检失败：真实仓库未过门禁（先修产品或更正台账，再谈尺子）');
      for (const e of realErrors) console.error('   ', e);
      return 1;
    }
    // 跨侧读者台账的三极性：没台账必须红、引用对不上必须红、引用真实存在必须不红
    const upOnly = res.rows.find((r) => r.bucket === 'uploaded-only');
    if (!upOnly) {
      bad.push('夹具里没有 uploaded-only 单位 ⇒ 跨侧台账这一臂没被走到');
    } else {
      const noLedger = judge({ rows: res.rows, denominator: res.denominator }, {}, '夹具');
      if (!noLedger.some((e) => e.includes(upOnly.unit))) {
        bad.push(`必开火失败：${upOnly.unit} 上行却无读者且没声明跨侧出处，却没判红`);
      }
      const staleCite = judge({ rows: res.rows, denominator: res.denominator }, {}, '夹具', {
        [upOnly.unit]: {
          file: 'backend/app/routers/ai.py',
          mustContain: 'zz_NoSuchToken_zz',
          why: 'x',
        },
      });
      if (!staleCite.some((e) => e.includes(upOnly.unit) && e.includes('过期'))) {
        bad.push('必开火失败：跨侧引用的出处里已没有那个标记，却没判"引用已过期"');
      }
      const goodCite = judge({ rows: res.rows, denominator: res.denominator }, {}, '夹具', {
        [upOnly.unit]: { file: 'backend/app/routers/ai.py', mustContain: 'ai_provider', why: 'x' },
      });
      if (goodCite.some((e) => e.includes(upOnly.unit))) {
        bad.push(`不该开火却判红：真实存在的跨侧引用被判红（${upOnly.unit}）`);
      }
      // 不存在的出处文件也必须判红（否则台账可以引一个根本没的路径）
      const ghost = judge({ rows: res.rows, denominator: res.denominator }, {}, '夹具', {
        [upOnly.unit]: { file: 'backend/app/routers/zz_no_such.py', mustContain: 'x', why: 'x' },
      });
      if (!ghost.some((e) => e.includes(upOnly.unit) && e.includes('打不开'))) {
        bad.push('必开火失败：跨侧引用指向不存在的文件，却没判红');
      }
    }
    if (!(real.tally.live > 0) || !(real.tally.inert > 0)) {
      return fault(
        `真实树档位异常：live=${real.tally.live} inert=${real.tally.inert} ⇒ 尺子可能失明`,
      );
    }
    const t = Object.entries(real.tally)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(
      `✔ 自检通过：夹具 ${res.denominator} 单位四档全对（含"同名不同物不算读者""编辑面不算读者""计算下标靠宽面救回"三极性）、` +
        `两向必开火（未声明的惰性 / 谎报惰性 / 跨侧引用三态）各开一次、合规侧零红；` +
        `真实仓库 ${real.denominator} 单位（${t}）与台账一致`,
    );
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fault(msg) {
  console.error(`✘ 量具故障：${msg}`);
  return 2;
}

function main() {
  const args = process.argv.slice(2);
  if (!existsSync(join(ROOT, STORE_FILE))) return fault(`找不到 ${STORE_FILE}，分母无从取得`);
  if (args.includes('--self-test')) return selfTest();
  const res = analyze(realProgram());
  const errors = judge(res, res.inertDeclared, '真树', CROSS_SIDE_READERS);
  if (args.includes('--print-sites')) {
    for (const r of res.rows) {
      const sites = [...r.readSites, ...r.wideSites].slice(0, 2).join(' ');
      console.log(`${r.bucket.padEnd(14)} ${r.unit.padEnd(30)} up=${r.up ? 1 : 0} ${sites}`);
    }
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({ rows: res.rows, tally: res.tally, errors }));
    return errors.length ? 1 : 0;
  }
  if (errors.length) {
    console.error('✘ 设置项惰性判据未通过：');
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  const t = Object.entries(res.tally)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(
    `✔ 设置项惰性判据通过：单位 ${res.denominator}（${t}）｜惰性已声明 ${Object.keys(res.inertDeclared).length} 条`,
  );
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  if (e instanceof ToolFault) process.exit(fault(e.message));
  console.error(
    '✘ 量具故障（未捕获异常，不得当成产品判红）：',
    e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e,
  );
  process.exit(2);
}
