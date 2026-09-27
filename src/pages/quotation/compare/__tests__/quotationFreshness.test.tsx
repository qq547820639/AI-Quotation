/**
 * R64：报价对比页的"进入即补拉"契约。
 * 存在理由：本页 data 全来自 store，而 store.loaded 是"曾经加载成功过"的一次性旗标 ⇒
 * 供应商刚提交完、采购随即进入时，R30/R33 的 loading 守卫直接放行，
 * 页面把"本机还没同步到"渲染成"该询价单暂无已提交报价"（webkit 全链路 1/5 复现有现场）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/api', () => ({
  quotationApi: { list: vi.fn().mockResolvedValue([]) },
  inquiryApi: { list: vi.fn().mockResolvedValue([]) },
  supplierApi: { list: vi.fn().mockResolvedValue([]) },
  notificationApi: {
    list: vi.fn().mockResolvedValue([]),
    getUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
  },
}));

import { useQuotationStore } from '@/store/useQuotationStore';
import { quotationApi } from '@/api';
import { useQuotationFreshness } from '../useQuotationFreshness';

const listMock = vi.mocked(quotationApi.list);

beforeEach(() => {
  listMock.mockReset();
  // 关键前提：store 已经"加载完成"但内容是旧的——这正是 R64 的形状
  useQuotationStore.setState({ quotations: [], loading: false, loaded: true, loadError: false });
});

describe('useQuotationFreshness', () => {
  it('进入某条询价单的对比视图时补拉一次，并把服务端的新数据落进 store', async () => {
    const fresh = [{ id: 'q-1' }] as never;
    listMock.mockResolvedValue(fresh);
    renderHook(() => useQuotationFreshness('inq-1'));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useQuotationStore.getState().quotations).toHaveLength(1));
  });

  it('同一条询价单的重渲染不再重复拉（评语自动保存会造成大量重渲染）', () => {
    listMock.mockResolvedValue([] as never);
    const { rerender } = renderHook(({ id }) => useQuotationFreshness(id), {
      initialProps: { id: 'inq-1' },
    });
    rerender({ id: 'inq-1' });
    rerender({ id: 'inq-1' });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('切到另一条询价单 ⇒ 重新补拉一次', () => {
    listMock.mockResolvedValue([] as never);
    const { rerender } = renderHook(({ id }) => useQuotationFreshness(id), {
      initialProps: { id: 'inq-1' },
    });
    rerender({ id: 'inq-2' });
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('R67 更正：无 inquiryId 的首屏也要补拉一次（早退会让新单不在卡列表里）', async () => {
    listMock.mockResolvedValue([] as never);
    renderHook(() => useQuotationFreshness(undefined));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
  });

  it('无 id 时反复重渲染只拉一次（"进入即拉"不等于轮询——保证来自依赖数组）', () => {
    listMock.mockResolvedValue([] as never);
    const { rerender } = renderHook(({ id }) => useQuotationFreshness(id), {
      initialProps: { id: undefined as string | undefined },
    });
    rerender({ id: undefined });
    rerender({ id: undefined });
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
