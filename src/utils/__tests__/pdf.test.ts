// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `exportPDFWithFallback` 的返回通道（R48）。
 *
 * 为什么这一格值得常驻：改之前它 `Promise<void>` 且**三条分支全都不 reject**，
 * 而调用方写的是 `.then(报"PDF 导出成功").catch(报"PDF 导出失败")`
 * ⇒ catch 是死代码，且"只打开了打印框"这种情况也在被宣布成导出成功。
 * 现在函数把"走了哪条通道"交回去，文案才有依据；三条分支各配一条断言，
 * 任何人把回退改成 reject、或把通道返回值改回 void，这里都会红。
 */
const mocks = vi.hoisted(() => ({
  html2canvas: vi.fn(),
  save: vi.fn(),
}));

vi.mock('html2canvas', () => ({ default: (...args: unknown[]) => mocks.html2canvas(...args) }));
vi.mock('jspdf', () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addImage = vi.fn();
    addPage = vi.fn();
    save = mocks.save;
  },
}));

import { exportPDFWithFallback } from '../pdf';

const CANVAS = {
  width: 800,
  height: 1000,
  toDataURL: () => 'data:image/jpeg;base64,AAAA',
};

describe('exportPDFWithFallback 的通道返回值', () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    printSpy = vi.fn();
    window.print = printSpy;
    mocks.html2canvas.mockReset();
    mocks.save.mockReset();
  });

  afterEach(() => {
    delete (window as unknown as { print?: unknown }).print;
  });

  it('拿不到元素时走打印通道，且不假装生成了 PDF', async () => {
    await expect(exportPDFWithFallback(null, { filename: 'a' })).resolves.toBe('print');
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('html2canvas 成功时走 pdf 通道，文件名补上 .pdf', async () => {
    mocks.html2canvas.mockResolvedValue(CANVAS);
    const el = document.createElement('div');
    await expect(exportPDFWithFallback(el, { filename: '询价单-INQ1' })).resolves.toBe('pdf');
    expect(mocks.save).toHaveBeenCalledWith('询价单-INQ1.pdf');
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('html2canvas 失败时回退到打印：仍然 resolve（不是 reject），但通道是 print', async () => {
    mocks.html2canvas.mockRejectedValue(new Error('canvas boom'));
    const el = document.createElement('div');
    // 关键极性：这条同时钉住"不 reject"与"不是 pdf"。
    // 只钉前者的话，实现改成"reject 后由调用方报失败"也能过；只钉后者则丢了回退语义。
    const how = await exportPDFWithFallback(el, { filename: 'b' });
    expect(how).toBe('print');
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
