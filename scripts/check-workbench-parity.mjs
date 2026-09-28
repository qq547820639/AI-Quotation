#!/usr/bin/env node
/**
 * 差分闸：行动工作台的 8 个计数——TS 参考实现 vs 真端点实现（R107）
 *
 * 存在理由：R107 把"前端在全量数组上算 8 个数"换成后端 SQL 聚合。
 * 语义参考实现留在 `src/pages/dashboard/workbenchActions.ts`（演示模式的 MSW 处理器仍在用它），
 * 生产读数来自 `backend/app/routers/dashboard.py`。两份实现各写一遍，
 * 一旦漂移（紧急窗口、失败投递的乘子、未报价槽位、异常报价不按范围过滤、日期闭区间），
 * 真后端与演示模式就会给出不同数字，而任何单边单测都看不见。
 *
 * 判法：同一份随机夹具 → Node 侧 esbuild 把真实 TS 模块打包后跑一遍；
 * Python 侧 `scripts/lib/workbench-endpoint.py` 直接 import `workbench_summary` 本尊跑一遍；
 * 逐轴 diff。不复制 SQL、不重抄判据——两侧都是被检对象的本尊。
 *
 * 档位（Σ档位 == 分母，不等即读数作废）：
 *   agree   两侧读数一致
 *   drift   两侧读数不一致（真红）
 *   unverifiable 有一侧压根没跑成（夹具或依赖问题，绝不折算成 agree）
 *
 * 退出码：0 = 全 agree；1 = 有 drift 或档位对不上分母；2 = 未覆盖（Python/依赖不可用，量具故障）。
 *
 * 限度（引用本尺读数时必须带上）：
 * - 时间基准：夹具的 deadline/createdAt 相对 Node 侧的 now 生成，端点用 Python 侧的 now，
 *   两次时钟之间隔了子进程启动；故夹具刻意避开 48 h 边界 ±10 min（不是"证明了两边时钟一致"）。
 * - 只核 /dashboard/workbench 的聚合语义；HTTP 层参数解析与鉴权在
 *   backend/tests/test_dashboard_workbench.py。
 * - 夹具里 created_at/deadline 一律规范形状；畸形时间串的日期界判定不在本尺覆盖内。
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const AXES = [
  'pendingSend',
  'deadlineApproaching',
  'unquotedSuppliers',
  'failedDeliveries',
  'abnormalQuotations',
  'pendingApproval',
  'approvalTimeout',
  'pendingConfirm',
];
const OWNERS = '总部采购中心';
const OTHER_ORG = '华东采购中心';

const ROOT = resolve(import.meta.dirname, '..');

/** 确定性 PRNG：同一 seed 复现同一夹具，红了能按夹具逐行读 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
};

const OWNERS_NAMES = ['李明辉', '王志强', '周大海', '陈晓燕'];
const STATUSES = [
  'DRAFT',
  'PENDING_SEND',
  'INQUIRING',
  'PARTIAL_QUOTED',
  'PENDING_APPROVAL',
  'PENDING_CONFIRM',
  'COMPLETED',
];
// 刻意远离 48 h 判定边界：45 h 稳在窗口内、60 h 稳在窗口外
const DEADLINE_OFFSET_H = [3, 12, 20, 45, 60, 100, 720, -5, -240, 0];
const RESULTS = ['投递失败', '已投递', 'Error: SMTP', 'bounced', 'success', '投递失败: 550', ''];

/**
 * 生成夹具：rows 条询价 + 关联的报价/日志/受邀槽位。
 * 端点与参考实现读的是同一份数据，字段命名按各自的存储形状分别给（DB 用 snake_case，
 * TS 用 camelCase），由同一次循环同时产出，杜绝"两份夹具不同步"。
 */
function buildFixture(seed, rows, params) {
  const rng = mulberry32(seed);
  const now = Date.now();
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];

  const inquiries = [];
  const dbInquiries = [];
  const quotations = [];
  const dbQuotations = [];
  const logs = [];
  const dbLogs = [];
  const invited = [];

  for (let k = 0; k < rows; k++) {
    const id = `inq-${seed}-${k}`;
    const ownerName = pick(OWNERS_NAMES);
    const organization = k % 7 === 3 ? OTHER_ORG : OWNERS;
    const status = pick(STATUSES);
    const deadline = stamp(now + pick(DEADLINE_OFFSET_H) * 3600_000);
    // 创建日刻意铺在"今天 / 昨天 / 一个月前"三天上，配合 dateFrom/dateTo 边界用例
    const createdAt = stamp(now - pick([0, 0, 24, 48, 720]) * 3600_000);
    const suppliers = [];
    const slots = Math.floor(rng() * 4);
    for (let s = 0; s < slots; s++) {
      const sid = `sup-${id}-${s}`;
      suppliers.push(sid);
      invited.push({ inquiry_id: id, supplier_id: sid });
      if (rng() < 0.45) {
        const qstatus = rng() < 0.6 ? 'SUBMITTED' : rng() < 0.7 ? 'DRAFT' : 'TIMEOUT';
        const q = {
          id: `q-${id}-${s}`,
          inquiryId: id,
          supplierId: sid,
          supplierName: `供应商${sid}`,
          status: qstatus,
          totalAmount: 100,
          items: [],
          attachments: [],
          createdAt,
          updatedAt: createdAt,
        };
        quotations.push(q);
        dbQuotations.push({
          id: q.id,
          inquiry_id: id,
          supplier_id: sid,
          supplier_name: q.supplierName,
          status: qstatus,
          total_amount: 100,
          created_at: createdAt,
          updated_at: createdAt,
        });
      }
    }
    const logList = [];
    if (rng() < 0.5) {
      const result = pick(RESULTS);
      const type = rng() < 0.8 ? 'SEND_INQUIRY' : 'SUBMIT_QUOTATION';
      const log = {
        id: `log-${id}`,
        inquiryId: id,
        type,
        time: createdAt,
        operator: ownerName,
        content: '测试日志',
        result,
      };
      logList.push(log);
      dbLogs.push({
        id: log.id,
        inquiry_id: id,
        type,
        time: createdAt,
        operator: ownerName,
        content: '测试日志',
        result,
      });
    }
    const inq = {
      id,
      code: `INQ${String(k).padStart(4, '0')}`,
      subject: `夹具 ${id}`,
      organization,
      ownerName,
      ownerId: ownerName === '李明辉' ? 'u-1' : 'u-2',
      currency: 'CNY',
      deadline,
      deliveryAddress: '上海',
      contact: '李四',
      paymentTerms: '款到发货',
      attachments: [],
      items: [],
      invitedSupplierIds: suppliers,
      quotations: quotations.filter((q) => q.inquiryId === id),
      logs: logList,
      status,
      createdById: 'u-1',
      createdByName: '李明辉',
      createdAt,
      updatedAt: createdAt,
      selectedSupplierMap: {},
      purchaserComments: {},
      approvalNodes: [],
    };
    inquiries.push(inq);
    dbInquiries.push({
      id,
      code: inq.code,
      subject: inq.subject,
      organization,
      owner_name: ownerName,
      owner_id: inq.ownerId,
      currency: 'CNY',
      deadline,
      delivery_address: '上海',
      contact: '李四',
      payment_terms: '款到发货',
      status,
      created_by_id: 'u-1',
      created_by_name: '李明辉',
      created_at: createdAt,
      updated_at: createdAt,
      selected_supplier_map: {},
      purchaser_comments: {},
      version: 1,
    });
  }

  const users = [
    {
      id: 'u-1',
      name: '李明辉',
      role: '采购人员',
      department: '采购部',
      organization: OWNERS,
      permissions: ['INQUIRY_CREATE', 'INQUIRY_SEND'],
    },
    {
      id: 'u-2',
      name: '王志强',
      role: '采购主管',
      department: '采购部',
      organization: OWNERS,
      permissions: [],
    },
    {
      id: 'u-6',
      name: '管理员',
      role: '管理员',
      department: '管理部',
      organization: OWNERS,
      permissions: [],
    },
  ];
  return { users, inquiries, dbInquiries, quotations, dbQuotations, logs, dbLogs, invited, params };
}

/** 夹具的落盘形状：只给驱动需要的 snake_case 表数据 + 查询参数 */
function driverFixture(fx) {
  return {
    users: fx.users,
    inquiries: fx.dbInquiries,
    quotations: fx.dbQuotations,
    logs: fx.dbLogs,
    invited: fx.invited,
    params: { ...fx.params },
  };
}

/** 把 dateFrom/dateTo 收成"今天"：让闭区间与开区间这两种判法必然翻面（变异臂要用） */
function todayBounds(fx) {
  const day = stamp(Date.now()).slice(0, 10);
  fx.params.dateFrom = day;
  fx.params.dateTo = day;
  return fx;
}

async function loadReference() {
  const esbuild = await import('esbuild');
  const aliasDir = mkdtempSync(join(tmpdir(), 'qi-parity-alias-'));
  const i18nStub = join(aliasDir, 'i18n.js');
  // 只桩掉文案层：getRemainingTime 的 urgent/expired 走的是 dayjs 数学，不受影响
  writeFileSync(i18nStub, 'export default { t: (k) => k };\n');
  // 打包产物落在 node_modules/.cache：从那里往上找得到 dayjs，且不会污染被扫描的树
  const outDir = join(ROOT, 'node_modules', '.cache', 'qi-parity');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'workbenchActions.ref.mjs');
  await esbuild.build({
    entryPoints: [join(ROOT, 'src/pages/dashboard/workbenchActions.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile,
    external: ['dayjs'],
    alias: { '@/i18n': i18nStub },
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  return mod;
}

function runDriver(fixtureObj, backendDir, user) {
  const dir = mkdtempSync(join(tmpdir(), 'qi-parity-fx-'));
  const fxPath = join(dir, 'fixture.json');
  writeFileSync(fxPath, JSON.stringify(fixtureObj), 'utf8');
  const script = join(ROOT, 'scripts/lib/workbench-endpoint.py');
  const candidates = [
    join(ROOT, 'backend/.venv/bin/python'),
    process.env.QI_PYTHON || 'python3',
    'python',
  ];
  let last = null;
  for (const py of candidates) {
    const r = spawnSync(
      py,
      [script, '--fixture', fxPath, '--backend-dir', backendDir, '--user', user],
      { encoding: 'utf8', cwd: ROOT },
    );
    const finish = (out) => {
      rmSync(dir, { recursive: true, force: true });
      return out;
    };
    if (r.error) continue; // 解释器压根不存在，试下一个候选
    if (r.status === 0) {
      try {
        return finish({ ok: true, data: JSON.parse(r.stdout), py });
      } catch (e) {
        return finish({
          ok: false,
          reason: `驱动输出不是 JSON：${e.message}`,
          detail: r.stdout.slice(0, 400),
          py,
        });
      }
    }
    if (r.status === 3) {
      return finish({
        ok: false,
        reason: `后端依赖不可用：${(r.stderr || '').trim().split('\n').pop()}`,
        py,
      });
    }
    last = { py, r };
  }
  return {
    ok: false,
    reason: `Python 驱动未跑成（rc=${last?.r?.status}）：${(last?.r?.stderr || '')
      .trim()
      .split('\n')
      .slice(-2)
      .join(' / ')}`,
    py: last?.py,
  };
}

/** 逐轴比较：返回 {drift:[{axis,ref,ep}], unverifiable:[...]}  */
function diffCounts(refCounts, epCounts, inserted, expectInserted) {
  const drift = [];
  const unverifiable = [];
  for (const axis of AXES) {
    if (typeof refCounts[axis] !== 'number' || Number.isNaN(refCounts[axis])) {
      unverifiable.push(`${axis}: 参考实现没给出数（打包或夹具问题）`);
      continue;
    }
    if (typeof epCounts[axis] !== 'number') {
      unverifiable.push(`${axis}: 端点没给出数`);
      continue;
    }
    if (refCounts[axis] !== epCounts[axis]) {
      drift.push({ axis, ref: refCounts[axis], ep: epCounts[axis] });
    }
  }
  for (const [tbl, want] of Object.entries(expectInserted)) {
    if (inserted[tbl] !== want) {
      unverifiable.push(`夹具没整份落进库：${tbl} 期望 ${want} 实得 ${inserted[tbl]}`);
    }
  }
  return { drift, unverifiable };
}

/** 跑一臂：同一份夹具分别喂给 TS 参考实现与真端点 */
async function runArm(ref, fx, backendDir, user = 'u-1') {
  const visible = fx.inquiries.filter(
    (i) => !fx.params.organization || fx.params.organization === '__ALL__'
      ? true
      : i.organization === fx.params.organization,
  );
  const filtered = ref.applyWorkbenchFilter(visible, {
    owner: fx.params.owner,
    dateFrom: fx.params.dateFrom ?? null,
    dateTo: fx.params.dateTo ?? null,
  });
  const refCounts = ref.computeDashboardActions(filtered, fx.quotations);
  const drv = runDriver(driverFixture(fx), backendDir, user);
  if (!drv.ok) return { unverifiable: [drv.reason], drift: [], detail: drv.detail };
  const { drift, unverifiable } = diffCounts(refCounts, drv.data.counts, drv.data.inserted, {
    users: fx.users.length,
    inquiries: fx.dbInquiries.length,
    quotations: fx.dbQuotations.length,
    logs: fx.dbLogs.length,
    invited: fx.invited.length,
  });
  // owners 只比集合（端点按 updated_at 排序、参考实现按数组首次出现顺序，序不是语义）
  const refOwners = [...new Set(ref.getOwnerOptions(visible))].sort().join('|');
  const epOwners = [...(drv.data.counts.owners ?? [])].sort().join('|');
  if (refOwners !== epOwners) {
    drift.push({ axis: 'owners', ref: refOwners, ep: epOwners });
  }
  if (drv.data.counts.total !== filtered.length) {
    drift.push({ axis: 'total', ref: filtered.length, ep: drv.data.counts.total });
  }
  return { drift, unverifiable, refCounts, epCounts: drv.data.counts };
}

function makeMutatedCopy(srcAppDir, replacements) {
  const dir = mkdtempSync(join(tmpdir(), 'qi-parity-mut-'));
  const dstApp = join(dir, 'app');
  cpSync(srcAppDir, dstApp, { recursive: true });
  const target = join(dstApp, 'routers/dashboard.py');
  let text = readFileSync(target, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) return { ok: false, reason: `变异没落地：找不到锚点 ${from}` };
    text = text.replace(from, to);
  }
  writeFileSync(target, text, 'utf8');
  for (const [from] of replacements) {
    if (readFileSync(target, 'utf8').includes(from)) {
      return { ok: false, reason: `变异没落地：替换后仍能找到 ${from}` };
    }
  }
  return { ok: true, backendDir: dir };
}

/**
 * 追加一条"由构造给出答案"的行：同时写进 TS 形状与 DB 形状，杜绝两份夹具不同步。
 * 变异臂的牙齿必须靠这种确定性行，而不是靠随机样本碰巧覆盖到边界。
 */
function pushRow(fx, o) {
  const createdAt = stamp(o.createdAtMs ?? Date.now());
  const deadline = stamp(Date.now() + o.deadlineOffsetH * 3600_000);
  const suppliers = o.suppliers ?? [];
  const log = o.logResult
    ? [
        {
          id: `log-${o.id}`,
          inquiryId: o.id,
          type: 'SEND_INQUIRY',
          time: createdAt,
          operator: o.ownerName,
          content: '测试日志',
          result: o.logResult,
        },
      ]
    : [];
  fx.inquiries.push({
    id: o.id,
    code: `INQ-${o.id}`,
    subject: `边界行 ${o.id}`,
    organization: o.organization,
    ownerName: o.ownerName,
    ownerId: o.ownerId ?? 'u-1',
    currency: 'CNY',
    deadline,
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [],
    invitedSupplierIds: suppliers,
    quotations: [],
    logs: log,
    status: o.status,
    createdById: 'u-1',
    createdByName: '李明辉',
    createdAt,
    updatedAt: createdAt,
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
  });
  fx.dbInquiries.push({
    id: o.id,
    code: `INQ-${o.id}`,
    subject: `边界行 ${o.id}`,
    organization: o.organization,
    owner_name: o.ownerName,
    owner_id: o.ownerId ?? 'u-1',
    currency: 'CNY',
    deadline,
    delivery_address: '上海',
    contact: '李四',
    payment_terms: '款到发货',
    status: o.status,
    created_by_id: 'u-1',
    created_by_name: '李明辉',
    created_at: createdAt,
    updated_at: createdAt,
    selected_supplier_map: {},
    purchaser_comments: {},
    version: 1,
  });
  for (const sid of suppliers) fx.invited.push({ inquiry_id: o.id, supplier_id: sid });
  for (const q of o.quotes ?? []) {
    const qid = `q-${o.id}-${q.supplier}`;
    fx.quotations.push({
      id: qid,
      inquiryId: o.id,
      supplierId: q.supplier,
      supplierName: `供应商${q.supplier}`,
      status: q.status,
      totalAmount: 1,
      items: [],
      attachments: [],
      createdAt,
      updatedAt: createdAt,
    });
    fx.dbQuotations.push({
      id: qid,
      inquiry_id: o.id,
      supplier_id: q.supplier,
      supplier_name: `供应商${q.supplier}`,
      status: q.status,
      total_amount: 1,
      created_at: createdAt,
      updated_at: createdAt,
    });
  }
  for (const l of log) {
    fx.logs.push(l);
    fx.dbLogs.push({
      id: l.id,
      inquiry_id: o.id,
      type: l.type,
      time: l.time,
      operator: l.operator,
      content: l.content,
      result: l.result,
    });
  }
  return fx;
}

/** 给变异臂用的确定性边界行：紧急窗口(45 h)、日期闭区间(今天)、全表口径(TIMEOUT 报价) 各一条 */
function withBoundaryRows(fx) {
  pushRow(fx, {
    id: 'mut-near',
    status: 'INQUIRING',
    deadlineOffsetH: 45,
    organization: OWNERS,
    ownerName: '王志强',
    suppliers: ['a', 'b', 'c'],
    quotes: [{ supplier: 'a', status: 'SUBMITTED' }, { supplier: 'b', status: 'TIMEOUT' }],
  });
  pushRow(fx, {
    id: 'mut-far',
    status: 'PENDING_APPROVAL',
    deadlineOffsetH: 100,
    organization: OWNERS,
    ownerName: '王志强',
    logResult: 'Error: SMTP',
  });
  return fx;
}

const PARAM_SETS = [
  { owner: undefined, dateFrom: null, dateTo: null, organization: OWNERS },
  { owner: '李明辉', dateFrom: null, dateTo: null, organization: OWNERS },
  { owner: undefined, dateFrom: '2026-01-01', dateTo: '2099-12-31', organization: OWNERS },
  { owner: undefined, dateFrom: undefined, dateTo: undefined, organization: '__ALL__' },
  { owner: '王志强', dateFrom: null, dateTo: null, organization: OWNERS, todayBounds: true, boundary: true },
];

async function body() {
  let ref;
  try {
    ref = await loadReference();
  } catch (e) {
    console.log(`✗ 量具故障：TS 参考实现打包/导入失败（${e.message}）`);
    return 2;
  }
  const backendDir = join(ROOT, 'backend');
  if (!existsSync(join(backendDir, 'app/routers/dashboard.py'))) {
    console.log('✗ 量具故障：backend/app/routers/dashboard.py 不在位，无从对比');
    return 2;
  }
  let sites = 0;
  let driftRows = [];
  let unverifiable = [];
  for (let i = 0; i < PARAM_SETS.length; i++) {
    const fx = buildFixture(1000 + i * 7, 40, PARAM_SETS[i]);
    if (PARAM_SETS[i].todayBounds) todayBounds(fx);
    if (PARAM_SETS[i].boundary) withBoundaryRows(fx);
    sites += 1;
    const arm = await runArm(ref, fx, backendDir, i % 2 === 0 ? 'u-1' : 'u-6');
    driftRows = driftRows.concat(arm.drift.map((d) => ({ ...d, site: `参数档 ${i + 1}` })));
    unverifiable = unverifiable.concat(arm.unverifiable.map((u) => `参数档 ${i + 1}: ${u}`));
  }
  if (unverifiable.length) {
    console.log(`⚠ 未覆盖 ${unverifiable.length} 项（不折算成一致）：\n  ${unverifiable.join('\n  ')}`);
    return 2;
  }
  const grade = { agree: PARAM_SETS.length - driftRows.length, drift: driftRows.length, unverifiable: 0 };
  if (grade.agree < 0) {
    console.log(`✗ Σ档位(${Object.values(grade).join('+')}) != 分母 ${sites} ⇒ 读数作废`);
    return 1;
  }
  if (driftRows.length) {
    console.log(`✗ 差分不一致 ${driftRows.length} 处（TS 参考实现 vs 真端点）：`);
    for (const d of driftRows) {
      console.log(`  ${d.site} ${d.axis}: 参考=${d.ref} 端点=${d.ep}`);
    }
    console.log('限度：紧急窗口按"deadline < now + 2 天"，两侧时钟跨进程相隔一次启动，夹具已刻意避开边界 ±10 min。');
    return 1;
  }
  console.log(
    `✔ 差分一致：${AXES.length} 个计数 × ${sites} 档参数 + owners 集合 + total 全等（Σ档位 ${grade.agree}+${grade.drift}+${grade.unverifiable} == 分母 ${sites}）`,
  );
  return 0;
}

async function selfTest() {
  const cases = [];
  const push = (name, ok, extra = '') => cases.push({ name, ok, extra });
  let ref;
  try {
    ref = await loadReference();
  } catch (e) {
    console.log(`✗ 自测未跑：TS 参考实现不可加载（${e.message}）`);
    return 2;
  }

  // 对照 0：手搓一条"答案由构造给出"的行，钉参考实现与端点各自不是空转
  {
    const fx = buildFixture(7, 0, PARAM_SETS[0]);
    pushRow(fx, {
      id: 'hand-near',
      status: 'INQUIRING',
      deadlineOffsetH: 3,
      organization: OWNERS,
      ownerName: '李明辉',
      suppliers: ['a', 'b', 'c'],
      quotes: [{ supplier: 'a', status: 'SUBMITTED' }],
      logResult: 'bounced',
    });
    const arm = await runArm(ref, fx, join(ROOT, 'backend'), 'u-6');
    const got = arm.epCounts;
    push(
      '正例：3 受邀 / 1 已提交 / deadline 3h ⇒ 端点读 unquoted=2、approaching=1、abnormal=0、total=1',
      !!got &&
        got.unquotedSuppliers === 2 &&
        got.deadlineApproaching === 1 &&
        got.abnormalQuotations === 0 &&
        got.failedDeliveries === 3 &&
        got.total === 1,
      got
        ? `实读 unquoted=${got.unquotedSuppliers} approaching=${got.deadlineApproaching} abnormal=${got.abnormalQuotations} failed=${got.failedDeliveries} total=${got.total}`
        : '端点没跑成',
    );
    push(
      '反例：同一夹具两侧差分应为 0（干净对照必须绿）',
      arm.drift.length === 0 && arm.unverifiable.length === 0,
      `${arm.drift.map((d) => `${d.axis}:${d.ref}/${d.ep}`).join(', ')}${arm.unverifiable.join('; ')}`,
    );
  }

  // 变异臂：改一处端点常量/谓词 ⇒ 必须报出该轴漂移（证明这把闸有牙，不是两边一起瞎）
  const mutations = [
    {
      name: '变异 A：紧急窗口 2 天 → 1 天',
      pairs: [['URGENT_WINDOW = timedelta(days=2)', 'URGENT_WINDOW = timedelta(days=1)']],
      axis: 'deadlineApproaching',
    },
    {
      name: '变异 B：日期上界闭区间 → 开区间',
      pairs: [['<= date_to', '< date_to']],
      axis: 'total',
    },
    {
      name: '变异 C：异常报价不再筛 TIMEOUT（把全表当异常）',
      pairs: [
        ['filter(Quotation.status == Q_TIMEOUT).scalar()', 'scalar()'],
      ],
      axis: 'abnormalQuotations',
    },
  ];
  const fxMut = todayBounds(withBoundaryRows(buildFixture(31, 40, PARAM_SETS[0])));
  for (const m of mutations) {
    const copy = makeMutatedCopy(join(ROOT, 'backend/app'), m.pairs);
    if (!copy.ok) {
      push(m.name, false, copy.reason);
      continue;
    }
    const arm = await runArm(ref, fxMut, copy.backendDir, 'u-6');
    const hit = arm.drift.some((d) => d.axis === m.axis) || arm.drift.some((d) => d.axis === 'total');
    push(
      m.name,
      arm.drift.length > 0 && hit,
      `漂移轴：${arm.drift.map((d) => d.axis).join(',') || '（一个都没有 ⇒ 这条变异看不见）'}`,
    );
    rmSync(copy.backendDir, { recursive: true, force: true });
  }

  // 量具自己的极性：把两侧读数强行改成不同 ⇒ 比较函数必须判红（防止 diffCounts 恒真）
  {
    const d = diffCounts(
      Object.fromEntries(AXES.map((a) => [a, 1])),
      { ...Object.fromEntries(AXES.map((a) => [a, 1])), pendingSend: 9 },
      { users: 3, inquiries: 5, quotations: 2, logs: 1, invited: 4 },
      { users: 3, inquiries: 5, quotations: 2, logs: 1, invited: 4 },
    );
    push('极性 1：人为造一处不同 ⇒ 必须报 drift', d.drift.length === 1 && d.drift[0].axis === 'pendingSend');
    const clean = diffCounts(
      Object.fromEntries(AXES.map((a) => [a, 2])),
      Object.fromEntries(AXES.map((a) => [a, 2])),
      { users: 3, inquiries: 5, quotations: 2, logs: 1, invited: 4 },
      { users: 3, inquiries: 5, quotations: 2, logs: 1, invited: 4 },
    );
    push('极性 2：两侧完全相同 ⇒ 不得报 drift', clean.drift.length === 0 && clean.unverifiable.length === 0);
    const missing = diffCounts(
      Object.fromEntries(AXES.map((a) => [a, 0])),
      { ...Object.fromEntries(AXES.filter((a) => a !== 'pendingSend').map((a) => [a, 0])), pendingSend: undefined },
      { users: 1, inquiries: 1, quotations: 0, logs: 0, invited: 0 },
      { users: 1, inquiries: 1, quotations: 0, logs: 0, invited: 0 },
    );
    push('极性 3：一侧没给出数 ⇒ 必须进"未覆盖"而不是判一致', missing.unverifiable.length === 1 && missing.drift.length === 0);
    const short = diffCounts(
      Object.fromEntries(AXES.map((a) => [a, 0])),
      Object.fromEntries(AXES.map((a) => [a, 0])),
      { users: 1, inquiries: 0, quotations: 0, logs: 0, invited: 0 },
      { users: 1, inquiries: 1, quotations: 0, logs: 0, invited: 0 },
    );
    push('极性 4：夹具没整份落进库 ⇒ 必须进"未覆盖"', short.unverifiable.length === 1);
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) {
    console.log(`${c.ok ? '✔' : '✗'} ${c.name}${c.extra ? ` — ${c.extra}` : ''}`);
  }
  console.log(
    `差分闸自测：${cases.length - failed.length}/${cases.length}（夹具档 ${PARAM_SETS.length}、轴 ${AXES.length}）`,
  );
  return failed.length ? 1 : 0;
}

const argv = process.argv.slice(2);
const unknown = argv.filter((a) => a !== '--self-test');
if (unknown.length) {
  console.error(`✗ 未知参数 ${unknown.join(' ')}；本尺子只接受 --self-test`);
  process.exit(2);
}
const rc = argv.includes('--self-test') ? await selfTest() : await body();
process.exit(rc);
