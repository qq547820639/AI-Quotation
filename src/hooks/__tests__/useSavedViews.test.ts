/**
 * useSavedViews 测试（Task 19 保存筛选视图 + 默认视图）
 * 覆盖：保存/覆盖同名、设为默认/取消其它默认、删除、获取默认视图、清空、localStorage 持久化与恢复
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedViews, generateViewId, normalizeViewName } from '../useSavedViews';
import type { WriteReceipt } from '@/utils/storage';

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
    act(() => {
      result.current.saveView(' 我的草稿 ', { keyword: '服务器', status: ['DRAFT'] });
    });
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('我的草稿'); // trim 后
    expect(result.current.views[0].isDefault).toBe(true);
    expect(result.current.getDefaultView()?.filter.keyword).toBe('服务器');
  });

  it('同名保存覆盖而不新增', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => {
      result.current.saveView('A', { keyword: 'x', status: [] });
    });
    act(() => {
      result.current.saveView('A', { keyword: 'y', status: ['INQUIRING'] });
    });
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].filter.keyword).toBe('y');
  });

  it('设置默认视图会取消其它默认', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => {
      result.current.saveView('A', { keyword: 'a', status: [] });
    });
    act(() => {
      result.current.saveView('B', { keyword: 'b', status: [] });
    });
    const idA = result.current.views[0].id;
    const idB = result.current.views[1].id;
    act(() => {
      result.current.setDefaultView(idB);
    });
    expect(result.current.views.map((v) => v.isDefault)).toEqual([false, true]);
    act(() => {
      result.current.setDefaultView(idA);
    });
    expect(result.current.views.map((v) => v.isDefault)).toEqual([true, false]);
  });

  it('删除视图', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => {
      result.current.saveView('A', { keyword: 'a', status: [] });
    });
    act(() => {
      result.current.saveView('B', { keyword: 'b', status: [] });
    });
    const id = result.current.views[0].id;
    act(() => {
      result.current.removeView(id);
    });
    expect(result.current.views).toHaveLength(1);
    expect(result.current.getView(id)).toBeUndefined();
  });

  it('持久化到 localStorage 并可在重挂载后恢复', () => {
    const { result, unmount } = renderHook(() => useSavedViews<F>());
    act(() => {
      result.current.saveView('P', { keyword: '持久', status: ['DRAFT'] });
    });
    act(() => {
      result.current.setDefaultView(result.current.views[0].id);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    unmount();
    const { result: r2 } = renderHook(() => useSavedViews<F>());
    expect(r2.current.views).toHaveLength(1);
    expect(r2.current.views[0].name).toBe('P');
    expect(r2.current.views[0].isDefault).toBe(true);
  });

  it('resetViews 清空所有视图', () => {
    const { result } = renderHook(() => useSavedViews<F>());
    act(() => {
      result.current.saveView('A', { keyword: 'a', status: [] });
    });
    act(() => {
      result.current.resetViews();
    });
    expect(result.current.views).toEqual([]);
    expect(result.current.getDefaultView()).toBeUndefined();
  });

  // ===== R51-A：本机写就是唯一权威 ⇒ 三个变更方法必须把写回执传出去 =====
  // 改前持久化只在 useEffect 里（写发生在 toast 之后的一帧），且三个方法一律返回 void，
  // 于是 list 页的"视图已保存／已设为默认／已删除"三条宣称没有任何凭据。
  describe('写回执（本机存储是唯一副本）', () => {
    /** 让本机写真的抛出去，并先证明抛得出去——否则"回执 false"可能是别的原因 */
    function makeWritesFail(boom: Error) {
      const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw boom;
      });
      expect(() => localStorage.setItem('probe', '1')).toThrow(boom);
      spy.mockClear(); // 上面那次前提断言自己也算一次调用
      return spy;
    }

    it('saveView 成功时给出 success=true 的回执，key 就是它写的那个', () => {
      const { result } = renderHook(() => useSavedViews<F>());
      let receipt!: WriteReceipt;
      act(() => {
        receipt = result.current.saveView('A', { keyword: 'a', status: [] });
      });
      expect(receipt).toEqual({ success: true, key: 'savedViews' });
    });

    it('本机写失败：saveView 报 false，而视图仍留在当前页面（失败只关于持久化）', () => {
      const spy = makeWritesFail(new Error('QuotaExceededError'));
      try {
        const { result } = renderHook(() => useSavedViews<F>());
        let receipt!: WriteReceipt;
        act(() => {
          receipt = result.current.saveView('A', { keyword: 'a', status: [] });
        });
        expect(receipt.success).toBe(false);
        expect(receipt.error).toBeInstanceOf(Error);
        expect(result.current.views).toHaveLength(1);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('setDefaultView 与 removeView 同样给出回执（成功、失败两极各一次）', () => {
      const { result } = renderHook(() => useSavedViews<F>());
      act(() => {
        result.current.saveView('A', { keyword: 'a', status: [] });
      });
      let ok!: WriteReceipt;
      act(() => {
        ok = result.current.setDefaultView(result.current.views[0].id);
      });
      expect(ok.success).toBe(true);
      const spy = makeWritesFail(new Error('SecurityError'));
      try {
        let bad!: WriteReceipt;
        act(() => {
          bad = result.current.removeView(result.current.views[0].id);
        });
        expect(bad.success).toBe(false);
        expect(result.current.views).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    it('同一 tick 连点两次保存：状态与本机镜像最终仍一致（effect 是兜底镜像）', () => {
      // commit 用"最近一次已知的完整值"算下一份，所以正常情况下同步写与 React 提交值同源；
      // 这条守的是设计里最弱的一环——万一两者分叉，effect 必须把镜像纠正回来。
      const { result } = renderHook(() => useSavedViews<F>());
      act(() => {
        result.current.saveView('X', { keyword: 'x', status: [] });
        result.current.saveView('Y', { keyword: 'y', status: [] });
      });
      expect(result.current.views.map((v) => v.name)).toEqual(['X', 'Y']);
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
        data: { name: string }[];
      } | null;
      expect(raw?.data.map((v) => v.name)).toEqual(['X', 'Y']);
    });
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
