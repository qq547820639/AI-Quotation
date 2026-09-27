import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEnterRefresh } from '../useEnterRefresh';

describe('useEnterRefresh（R69）', () => {
  it('挂载时恰好补拉一次', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useEnterRefresh(fn));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('反复重渲染不再补拉（调用方可安全通行内箭头函数）', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ f }) => useEnterRefresh(f), { initialProps: { f: fn } });
    rerender({ f: fn });
    rerender({ f: vi.fn() });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('换一次挂载（新页面进入）会再拉一次——它钉的是"每次进入"，不是"每次会话一次"', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const a = renderHook(() => useEnterRefresh(fn));
    a.unmount();
    renderHook(() => useEnterRefresh(fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
