import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadJSON, saveJSON, removeKey, clearAll, SCHEMA_VERSION } from '../storage';

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saveJSON / loadJSON 往返', () => {
    saveJSON('test', { a: 1, b: 'x' });
    expect(loadJSON('test', null)).toEqual({ a: 1, b: 'x' });
  });

  it('loadJSON 不存在的 key 返回 fallback', () => {
    expect(loadJSON('not-exist', { default: true })).toEqual({ default: true });
  });

  it('loadJSON 损坏 JSON 返回 fallback', () => {
    localStorage.setItem('procurement_bad', '{not json');
    expect(loadJSON('bad', { fallback: 1 })).toEqual({ fallback: 1 });
  });

  it('loadJSON 版本不匹配返回 fallback', () => {
    localStorage.setItem(
      'procurement_old',
      JSON.stringify({ v: SCHEMA_VERSION - 1, data: { old: true } }),
    );
    expect(loadJSON('old', { new: true })).toEqual({ new: true });
  });

  it('saveJSON 携带版本号', () => {
    saveJSON('test', { x: 1 });
    const raw = JSON.parse(localStorage.getItem('procurement_test') as string);
    expect(raw.v).toBe(SCHEMA_VERSION);
    expect(raw.data).toEqual({ x: 1 });
  });

  it('removeKey 移除指定 key', () => {
    saveJSON('test', { x: 1 });
    removeKey('test');
    expect(localStorage.getItem('procurement_test')).toBeNull();
  });

  // ===== R50：写回执 =====
  // 这三条钉的是"失败要能被调用方看见"。改之前这三个函数把异常就地吞掉、返回 undefined，
  // 于是 UI 在 QuotaExceededError 之后照样能报"已保存"——判据 check-storage-receipt 的红就来自这里。
  it('saveJSON 成功时回执带 key 且 success=true', () => {
    expect(saveJSON('ok-key', { a: 1 })).toEqual({ success: true, key: 'ok-key' });
  });

  it('saveJSON 在 setItem 抛错时不抛、但回执 success=false 并带原始异常', () => {
    const boom = new Error('QuotaExceededError');
    // 注：改 Storage.prototype 不生效——jsdom 的 localStorage 把方法挂在实例上，
    // 那样注入是空转的（第一版就这么假红过一次：receipt 仍 true）。必须 spy 实例本身。
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw boom;
    });
    // 前提断言：先证明注入真能从这里抛出去，再谈回执——否则"回执 false"可能是别的原因
    expect(() => localStorage.setItem('probe', '1')).toThrow(boom);
    spy.mockClear(); // 上面那次前提断言自己也算一次调用
    try {
      const receipt = saveJSON('quota', { a: 1 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(receipt.success).toBe(false);
      expect(receipt.key).toBe('quota');
      // error 只给 console 用：断言它确实是原对象，UI 才不会拿它当文案
      expect(receipt.error).toBe(boom);
    } finally {
      spy.mockRestore();
    }
  });

  it('removeKey 与 clearAll 同样给出回执；clearAll 还报告实际移除条数', () => {
    saveJSON('c1', { x: 1 });
    expect(removeKey('c1')).toEqual({ success: true, key: 'c1' });
    saveJSON('c2', { x: 2 });
    const r = clearAll();
    expect(r.success).toBe(true);
    expect(r.removed).toBe(1); // 只剩 c2 带 procurement_ 前缀
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => localStorage.removeItem('probe')).toThrow();
    try {
      saveJSON('c3', { x: 3 }); // setItem 未被 spy，仍会成功
      const failed = clearAll();
      expect(failed.success).toBe(false);
      expect(failed.key).toBe('*');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('clearAll 清除所有前缀 key 但保留其他', () => {
    saveJSON('a', { x: 1 });
    saveJSON('b', { y: 2 });
    localStorage.setItem('other_key', 'keep');
    clearAll();
    expect(localStorage.getItem('procurement_a')).toBeNull();
    expect(localStorage.getItem('procurement_b')).toBeNull();
    expect(localStorage.getItem('other_key')).toBe('keep');
  });
});
