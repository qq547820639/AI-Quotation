// 本文件跑在 vitest 的 jsdom 环境里，`expect` 由 vitest 显式导入（与同目录其它测试件一致）
import { expect } from 'vitest';

/**
 * 让 `localStorage` 的写真的抛出去——并在两种宿主下都抛得出去。
 *
 * 为什么需要这个文件：三处测试（storage / useInquiryDraft / useSavedViews）各自写了同一段注入，
 * 都用 `vi.spyOn(localStorage, 'setItem').mockImplementation(...)`。2026-09-27 在真实 runner 上
 * 这条注入静默失效，8 格红 `expected function to throw an error, but it didn't`，而本机 503 全绿。
 * 差值在 Node 版本，实测两极（同一份 jsdom@25.0.1，只差宿主 Node）：
 *
 *   Node v26.5.1（本机）  instanceOwnSetItem=true   protoOwnSetItem=false  → 给实例赋值能盖住
 *   Node v24.21.0（CI）   instanceOwnSetItem=false  protoOwnSetItem=true   → 给实例赋值**盖不住**
 *
 * 原因是 `[Storage]` 的命名属性语义：`setItem` 不在实例上时，`localStorage.setItem = fn`
 * 被命名属性 setter 吃掉，等于往存储里写了个键名叫 "setItem" 的值，方法本体没动
 * （`vi.spyOn` 内部就是赋值），所以注入空转。`Object.defineProperty` 走 defineProperty  trap，
 * 两版都盖得住（实测 `instPatchThrew` 在两版都是 true）。
 *
 * 这里不猜哪一版是"对的"：注入落在哪一层由 `getOwnPropertyDescriptor` 决定，
 * 调用方保留自己那条前提断言（"先证明抛得出去，再谈回执"），所以将来再换宿主也是响亮地红，
 * 不会又变成"看起来在测失败分支、其实失败分支从没被触发"。
 */

const WRITE_METHODS = ['setItem', 'removeItem', 'clear'] as const;

export interface WriteFailureInjection {
  /** 交还原状；调用方放进 try/finally */
  restore: () => void;
  /** 被打断的写被调了几次（对应原来 spy.mockClear() 的那一层用途） */
  calls: () => number;
  /** 清零计数——前提断言自己会算一次，所以它必须在前提断言之后调一次 */
  reset: () => void;
}

export type WriteMethod = (typeof WRITE_METHODS)[number];

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
  const target = globalThis.localStorage;
  const saved: Array<{ key: WriteMethod; desc: PropertyDescriptor | undefined }> = [];
  // times 有限时要在"用完配额"之后把原实现叫回来，所以先把原型上的原方法抓住
  const originals: Partial<Record<WriteMethod, unknown>> = {};
  for (const key of methods) originals[key] = (target as Record<string, unknown>)[key];
  let hits = 0;

  for (const key of methods) {
    const own = Object.getOwnPropertyDescriptor(target, key);
    // 方法在实例上（jsdom 形状）→ 直接盖实例；不在（Node 内置 Web Storage）→ 也盖实例，
    // 因为 defineProperty 在实例上造一个自有属性就能遮住原型方法，而赋值不行。
    saved.push({ key, desc: own });
    Object.defineProperty(target, key, {
      value: (...args: unknown[]) => {
        if (hits >= times) {
          const orig = originals[key] as (...a: unknown[]) => unknown;
          return orig.apply(target, args);
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
    restore: () => {
      for (const { key, desc } of saved.reverse()) {
        if (desc) Object.defineProperty(target, key, desc);
        else Reflect.deleteProperty(target, key);
      }
    },
  };
}

/** 只在"注入确实落地了"之后才继续测失败分支；没落地就点名是谁的锅 */
export function assertWriteInjectionLanded(boom: Error, method: WriteMethod = 'setItem'): void {
  let caught: unknown = null;
  try {
    (localStorage as unknown as Record<string, (...a: string[]) => unknown>)[method](
      '__probe__',
      '1',
    );
  } catch (e) {
    caught = e;
  }
  expect(caught, '注入没落地：这条红是夹具的锅（宿主/Storage 形状变了），不是实现的锅').toBe(boom);
}
