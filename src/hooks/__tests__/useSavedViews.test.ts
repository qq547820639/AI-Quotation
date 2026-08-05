/**
 * useSavedViews 测试（Task 19 保存筛选视图 + 默认视图）
 * 覆盖：保存/覆盖同名、设为默认/取消其它默认、删除、获取默认视图、清空、localStorage 持久化与恢复
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedViews, generateViewId, normalizeViewName } from '../useSavedViews';

interface F {
  keyword: string;
  status: string[];
}

const STORAGE_KEY = 'procurement_savedViews';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useSavedViews', () => {
  it('初始为空视图列表', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    expect(result.current.views).toEqual([]);
    expect(result.current.getDefaultView()).toBeUndefined();
  });

  it('保存视图，第一个自动设为默认', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => result.current.saveView(' 我的草稿 ', { keyword: '服务器', status: ['DRAFT'] }));
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('我的草稿'); // trim 后
    expect(result.current.views[0].isDefault).toBe(true);
    expect(result.current.getDefaultView()?.filter.keyword).toBe('服务器');
  });

  it('同名保存覆盖而不新增', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => result.current.saveView('A', { keyword: 'x', status: [] }));
    act(() => result.current.saveView('A', { keyword: 'y', status: ['INQUIRING'] }));
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].filter.keyword).toBe('y');
  });

  it('设置默认视图会取消其它默认', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => result.current.saveView('A', { keyword: 'a', status: [] }));
    act(() => result.current.saveView('B', { keyword: 'b', status: [] }));
    const idA = result.current.views[0].id;
    const idB = result.current.views[1].id;
    act(() => result.current.setDefaultView(idB));
    expect(result.current.views.map((v) => v.isDefault)).toEqual([false, true]);
    act(() => result.current.setDefaultView(idA));
    expect(result.current.views.map((v) => v.isDefault)).toEqual([true, false]);
  });

  it('删除视图', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => result.current.saveView('A', { keyword: 'a', status: [] }));
    act(() => result.current.saveView('B', { keyword: 'b', status: [] }));
    const id = result.current.views[0].id;
    act(() => result.current.removeView(id));
    expect(result.current.views).toHaveLength(1);
    expect(result.current.getView(id)).toBeUndefined();
  });

  it('持久化到 localStorage 并可在重挂载后恢复', () => {
    const { result, unmount } = renderHook(() => useSavedViews<F>());
    act(() => result.current.saveView('P', { keyword: '持久', status: ['DRAFT'] }));
    act(() => result.current.setDefaultView(result.current.views[0].id));
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    unmount();
    const { result: r2 } = renderHook(() => useSavedViews<F>());
    expect(r2.current.views).toHaveLength(1);
    expect(r2.current.views[0].name).toBe('P');
    expect(r2.current.views[0].isDefault).toBe(true);
  });

  it('resetViews 清空所有视图', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => result.current.saveView('A', { keyword: 'a', status: [] }));
    act(() => result.current.resetViews());
    expect(result.current.views).toEqual([]);
    expect(result.current.getDefaultView()).toBeUndefined();
  });
});

describe('generateViewId / normalizeViewName', () => {
  it('生成唯一 id', () => {
    expect(generateViewId()).toMatch(/^view-/);
    expect(generateViewId()).not.toBe(generateViewId());
  });

  it('空名回退为「未命名视图」', () => {
    expect(normalizeViewName('   ')).toBe('未命名视图');
    expect(normalizeViewName(' 我的 ')).toBe('我的');
  });
});
