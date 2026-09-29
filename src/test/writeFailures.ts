// 本文件跑在 vitest 的 jsdom 环境里，`expect` 由 vitest 显式导入（与同目录其它测试件一致）
import { expect } from 'vitest';

/**
 * 让 `localStorage` 的写真的抛出去——并在两种存储形状下都抛得出去。
 *
 * 为什么需要这个文件：三处测试（storage / useInquiryDraft / useSavedViews）原先各自写了同一段注入，
 * 都用 `vi.spyOn(localStorage, 'setItem').mockImplementation(...)`。2026-09-27 在 CI 上这条注入
 * 静默空转，8 格红 `expected function to throw an error, but it didn't`，而本机 503 全绿。
 *
 * 根因不是 Node 版本号本身，而是"vitest 最后把哪个对象当作 localStorage"。同一份 jsdom@25.0.1 +
 * vitest@2.1.9、只换宿主跑探针的两档形状（完整读数与命令登记在
 * `.trae/documents/仓库运行风险评估与修复计划.md` 的 R71 一节）：
 *
 *   Node v22.23.2 / v24.21.0（CI 档位）：globalThis 上没有 localStorage 属性（描述符 ABSENT）
 *     → vitest 的 jsdom 环境把 jsdom 的 window.localStorage 搬上来
 *     → `ctor=Storage`、ownSetItem=false、protoSetItem=true
 *   Node v26.5.1（本机）：globalThis 上那个存取器在（不给 --localstorage-file 时取回 undefined）
 *     → vitest 搬不动它，src/test/setup.ts:11 的 `typeof === 'undefined'` 兜底成立，装内存版
 *     → `ctor=Object`、ownSetItem=true、protoSetItem=false
 *
 * 为什么"往实例上写方法"只在后者成立：`[Storage]` 的命名属性语义下，往实例上定义 setItem
 * （赋值也好、`Object.defineProperty` 也好）都按"定义一个名为 setItem 的存储条目"处理，方法本体不动。
 * 探针实测 Node 24 档：`instDefineThrows=false`，且注入后 `localStorage.length` 由 0 变 2
 * ——真的写出了一条键名叫 setItem 的条目。所以这里按"哪一层拦得住调用"选注入位点：
 * 方法在实例上就改实例，在原型链上就改那一层原型（两档实测三方法都抛得出去，restore 都还原得干净）。
 *
 * 不猜哪一档是"对的"：调用方保留那条前提断言（先证明抛得出去，再谈回执），
 * 将来出第三种形状就是响亮地红，不会又变成"看起来在测失败分支、其实失败分支从没被触发"。
 */

const WRITE_METHODS = ['setItem', 'removeItem', 'clear'] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];

export interface WriteFailureInjection {
  /** 交还原状；调用方放进 try/finally */
  restore: () => void;
  /** 被打断的写被调了几次（对应原来 spy.mockClear() 的那一层用途） */
  calls: () => number;
  /** 清零计数；前提断言内部会替探测那一次调用掉，常规用例不必手调 */
  reset: () => void;
  /** 实际注到了哪几层，例如 `setItem@Storage.prototype.setItem`；失败信息拿它点名形状 */
  layers: () => string;
}

type Holder = Record<string, unknown>;

/**
 * 找该键真正被解析到的那一层：实例自有就注实例，否则沿原型链找第一个自有者。
 * 两处都找不到 ⇒ 量具故障，报出来，而不是静默注到拦不住调用的层上。
 */
function resolveLayer(key: WriteMethod): { layer: Holder; where: string } {
  const target = globalThis.localStorage as unknown;
  if (typeof target !== 'object' || target === null) {
    throw new Error('夹具故障：这个宿主上 globalThis.localStorage 不是一个对象');
  }
  const obj = target as Holder;
  const ctorName = (Object.getPrototypeOf(obj) as { constructor?: { name?: string } } | null)
    ?.constructor?.name;
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return { layer: obj, where: `${ctorName ?? 'instance'}.${key}(own)` };
  }
  for (
    let o = Object.getPrototypeOf(obj) as Holder | null;
    o !== null;
    o = Object.getPrototypeOf(o) as Holder | null
  ) {
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      const name = (o as { constructor?: { name?: string } }).constructor?.name ?? 'proto';
      return { layer: o, where: `${name}.${key}` };
    }
  }
  throw new Error(
    `夹具故障：'${key}' 既不在 localStorage 实例上、也不在其原型链上，注入位点无法确定（第三种宿主形状？先量形再改夹具）`,
  );
}

/**
 * 把 `localStorage` 的写方法换成抛 `boom` 的函数。
 * @param methods 默认三个都断；只断其中一个时（如"removeItem 失败但 setItem 仍要成功"）显式传
 * @param times 前 N 次调用抛，之后放行；默认无限次。`times:1` 对应原来 mockImplementationOnce 的语义
 * @returns restore 交还原状；调用方应放在 try/finally 里
 */
export function makeLocalStorageWritesThrow(
  boom: Error,
  opts: { methods?: readonly WriteMethod[]; times?: number } = {},
): WriteFailureInjection {
  const { methods = WRITE_METHODS, times = Infinity } = opts;
  let hits = 0;
  const patched: Array<{
    layer: Holder;
    key: WriteMethod;
    desc: PropertyDescriptor | undefined;
    where: string;
  }> = [];
  const originals: Partial<Record<WriteMethod, unknown>> = {};

  for (const key of methods) {
    const { layer, where } = resolveLayer(key);
    // 配额用完之后要把原实现叫回来，所以先把这一层上的原方法抓住
    originals[key] = layer[key];
    patched.push({ layer, key, desc: Object.getOwnPropertyDescriptor(layer, key), where });
    Object.defineProperty(layer, key, {
      value: (...args: unknown[]) => {
        if (hits >= times) {
          const orig = originals[key] as (...a: unknown[]) => unknown;
          return orig.apply(layer, args);
        }
        hits += 1;
        throw boom;
      },
      configurable: true,
      writable: true,
    });
  }

  return {
    calls: () => hits,
    reset: () => {
      hits = 0;
    },
    layers: () => patched.map((p) => `${p.key}@${p.where}`).join(' '),
    restore: () => {
      for (const { layer, key, desc } of patched.slice().reverse()) {
        if (desc) Object.defineProperty(layer, key, desc);
        else Reflect.deleteProperty(layer, key);
      }
    },
  };
}

/**
 * 只在"注入确实落地了"之后才继续测失败分支；没落地就点名是谁的锅、注到了哪一层。
 * 探测那一次会把 `times` 的配额吃掉，所以它在断言通过后顺手 reset——
 * `times:1` 那种"只许第一次写抛"的用例因此也能用这条前提断言。
 */
export function assertWriteInjectionLanded(
  inj: WriteFailureInjection,
  boom: Error,
  method: WriteMethod = 'setItem',
): void {
  let caught: unknown = null;
  try {
    (localStorage as unknown as Record<string, (...a: string[]) => unknown>)[method](
      '__probe__',
      '1',
    );
  } catch (e) {
    caught = e;
  }
  expect(
    caught,
    `注入没落地：这条红是夹具的锅（宿主/存储形状变了），不是实现的锅。注入位点=${inj.layers()}`,
  ).toBe(boom);
  inj.reset();
}
