/**
 * R41 的常驻契约：`src/utils/excel.ts` 必须把"生成完成/失败"交给调用方。
 *
 * 为什么钉在这里而不是钉在页面上：页面侧那 5 个调用点的正确形状是
 * `await exportAOA(...)` 之后才 `notifySuccess`。只要 `exportAOA` 还返回 Promise，
 * `no-floating-promises` 就会替我们盯着"有没有人 await"；
 * 而一旦有人把它改回 fire-and-forget（返回 void），那 5 个 `await` 会**静默变成装饰性代码**——
 * `await voidExpr` 在 TS 里合法（80007 只是 suggestion，`tsc --noEmit` 不打印），
 * 门禁一条都不会红。本文件就是把这条回归唯一还能开火的地方。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { writeBuffer } = vi.hoisted(() => ({ writeBuffer: vi.fn() }));

vi.mock('exceljs', () => ({
  default: {
    Workbook: class {
      xlsx = { writeBuffer };
      addWorksheet() {
        return { addRow: () => {}, getColumn: () => ({ set width(_v: number) {} }) };
      }
    },
  },
}));

import { exportAOA, exportMultiSheet } from '../excel';

/** 让 URL.createObjectURL 在 jsdom 里可用（jsdom 不实现它） */
let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeBuffer.mockReset();
  createSpy = vi.fn(() => 'blob:stub');
  revokeSpy = vi.fn();
  (globalThis as unknown as { URL: { createObjectURL?: unknown; revokeObjectURL?: unknown } }).URL =
    {
      ...(globalThis as unknown as { URL: object }).URL,
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 不要写成 `as const` 的元组：那会让 rows 变成 readonly，
// 传给 exportAOA(rows: (string|number)[][]) 时 tsc 报 TS4104（vitest 不吃类型，只有 tsc 看得见）
const AOA_NAME = 'f';
const AOA_HEADER = ['列'];
const AOA_ROWS = [['1']];
const SHEETS = [{ name: 's1', header: ['列'], rows: [['1']] }];

describe('exportAOA / exportMultiSheet 的 Promise 契约（R41）', () => {
  it('必须是异步函数：返回 Promise 而不是 undefined', () => {
    writeBuffer.mockResolvedValue(new Uint8Array([1]));
    const p = exportAOA(AOA_NAME, AOA_HEADER, AOA_ROWS);
    expect(p).toBeInstanceOf(Promise);
    expect(exportMultiSheet('f', SHEETS)).toBeInstanceOf(Promise);
  });

  it('生成未完成前不得 resolve：调用方的成功提示因此不可能早于文件生成', async () => {
    let settle: (v: Uint8Array) => void = () => {};
    writeBuffer.mockReturnValue(
      new Promise<Uint8Array>((res) => {
        settle = res;
      }),
    );
    let done = false;
    const p = exportAOA(AOA_NAME, AOA_HEADER, AOA_ROWS).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();

    settle(new Uint8Array([1]));
    await p;
    expect(done).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('生成失败必须 reject 给调用方（否则页面的 catch 是装饰性的）', async () => {
    writeBuffer.mockRejectedValue(new Error('boom'));
    await expect(exportAOA(AOA_NAME, AOA_HEADER, AOA_ROWS)).rejects.toThrow('boom');
    await expect(exportMultiSheet('f', SHEETS)).rejects.toThrow('boom');
    // 失败时不得触发下载
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('成功路径也要把 object URL 释放掉（不 pin 住就没人看见泄漏）', async () => {
    writeBuffer.mockResolvedValue(new Uint8Array([1, 2]));
    await exportAOA(AOA_NAME, AOA_HEADER, AOA_ROWS);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
