import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadJSON,
  saveJSON,
  removeKey,
  clearAll,
  SCHEMA_VERSION,
} from '../storage';

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
