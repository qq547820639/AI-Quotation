import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEnterRefresh } from '../useEnterRefresh';

describe('useEnterRefresh（R69）', () => {
  it('挂载时恰好补拉一次', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useEnterRefresh(fn));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('反复重渲染不再补拉——包括换了函数身份也不行（"每次进入一次"不是"每次渲染一次"）', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const swapped = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ f }) => useEnterRefresh(f), { initialProps: { f: fn } });
    rerender({ f: fn });
    // 关键：第二次重渲染故意传一个新函数。若 hook 把 refresh 放进依赖数组，
    // 这就会再拉一次——而且拉的是 swapped，只数 fn 的话永远看不出问题（我上一版就是这样瞎的）。
    rerender({ f: swapped });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(swapped).not.toHaveBeenCalled();
  });

  it('换一次挂载（新页面进入）会再拉一次——它钉的是"每次进入"，不是"每次会话一次"', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const a = renderHook(() => useEnterRefresh(fn));
    a.unmount();
    renderHook(() => useEnterRefresh(fn));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
