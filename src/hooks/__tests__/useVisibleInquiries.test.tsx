/**
 * useVisibleInquiries 回归测试。
 * 被守护的缺陷：页面曾写 useMemo(() => getVisibleInquiries(org), [getVisibleInquiries, org])，
 * 依赖里只有稳定的 store 方法引用；真实后端下 store 首帧为空、数据在之后才到达，
 * 于是 memo 永不重算，询价列表/工作台/审批在登录后恒为空表。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisibleInquiries } from '../useVisibleInquiries';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useUIStore } from '@/store/useUIStore';
import type { Inquiry } from '@/types';

function mkInquiry(id: string, organization: string): Inquiry {
  return { id, code: `INQ-${id}`, subject: `主题-${id}`, organization } as unknown as Inquiry;
}

const HQ = mkInquiry('a', '总部采购中心');
const EAST = mkInquiry('b', '华东分部');

beforeEach(() => {
  useInquiryStore.setState({ inquiries: [] });
  useUIStore.setState({ currentOrganization: '总部采购中心' });
});

describe('useVisibleInquiries', () => {
  it('数据在首帧之后到达时立即重算（回归：登录后列表恒为空）', () => {
    const { result } = renderHook(() => useVisibleInquiries());
    expect(result.current).toEqual([]);

    act(() => {
      useInquiryStore.setState({ inquiries: [HQ, EAST] });
    });
    expect(result.current.map((i) => i.id)).toEqual(['a']);
  });

  it('__ALL__ 可见全部，其他组织只可见本组织', () => {
    useInquiryStore.setState({ inquiries: [HQ, EAST] });

    const { result, rerender } = renderHook(() => useVisibleInquiries());
    expect(result.current.map((i) => i.id)).toEqual(['a']);

    act(() => {
      useUIStore.setState({ currentOrganization: '__ALL__' });
    });
    rerender();
    expect(result.current.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('切换组织上下文后重新过滤', () => {
    useInquiryStore.setState({ inquiries: [HQ, EAST] });
    const { result } = renderHook(() => useVisibleInquiries());
    expect(result.current.map((i) => i.id)).toEqual(['a']);

    act(() => {
      useUIStore.setState({ currentOrganization: '华东分部' });
    });
    expect(result.current.map((i) => i.id)).toEqual(['b']);
  });
});
