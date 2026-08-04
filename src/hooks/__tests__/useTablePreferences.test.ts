/**
 * useTablePreferences 测试（Task 7）
 * 覆盖列可见性切换、顺序调整、固定方向、密度切换、重置、localStorage 持久化与恢复
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTablePreferences, DENSITY_TO_SIZE } from '../useTablePreferences';

const initial = {
  columns: [
    { key: 'a', title: 'A', visible: true, order: 0 },
    { key: 'b', title: 'B', visible: true, order: 1 },
    { key: 'c', title: 'C', visible: true, order: 2 },
  ],
  density: 'default' as const,
};

describe('useTablePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('返回初始偏好', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    expect(result.current.prefs.density).toBe('default');
    expect(result.current.prefs.columns).toHaveLength(3);
    expect(result.current.prefs.columns.map((c) => c.key)).toEqual(['a', 'b', 'c']);
  });

  it('切换列可见性', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setColumnVisible('a', false));
    expect(result.current.prefs.columns[0].visible).toBe(false);
  });

  it('调整列顺序（下移）', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setColumnOrder('a', 'down'));
    expect(result.current.prefs.columns.map((c) => c.key)).toEqual(['b', 'a', 'c']);
    // 顺序号同步更新
    expect(result.current.prefs.columns.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it('调整列顺序（上移）', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setColumnOrder('c', 'up'));
    expect(result.current.prefs.columns.map((c) => c.key)).toEqual(['a', 'c', 'b']);
  });

  it('设置固定方向', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setColumnFixed('a', 'left'));
    expect(result.current.prefs.columns[0].fixed).toBe('left');
    act(() => result.current.setColumnFixed('a', undefined));
    expect(result.current.prefs.columns[0].fixed).toBeUndefined();
  });

  it('切换密度', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setDensity('compact'));
    expect(result.current.prefs.density).toBe('compact');
    expect(DENSITY_TO_SIZE.compact).toBe('small');
    expect(DENSITY_TO_SIZE.default).toBe('middle');
    expect(DENSITY_TO_SIZE.comfortable).toBe('large');
  });

  it('重置为默认', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setColumnVisible('a', false));
    act(() => result.current.setColumnOrder('a', 'down'));
    act(() => result.current.setDensity('compact'));
    act(() => result.current.reset());
    expect(result.current.prefs.density).toBe('default');
    expect(result.current.prefs.columns.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(result.current.prefs.columns[0].visible).toBe(true);
  });

  it('持久化到 localStorage', () => {
    const { result } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setDensity('comfortable'));
    expect(localStorage.getItem('procurement_tablePref:test')).toBeTruthy();
  });

  it('重挂载时从 localStorage 恢复', () => {
    const { result, unmount } = renderHook(() => useTablePreferences('test', initial));
    act(() => result.current.setColumnVisible('b', false));
    act(() => result.current.setDensity('compact'));
    unmount();

    const { result: result2 } = renderHook(() => useTablePreferences('test', initial));
    expect(result2.current.prefs.density).toBe('compact');
    expect(result2.current.prefs.columns.find((c) => c.key === 'b')?.visible).toBe(false);
  });
});