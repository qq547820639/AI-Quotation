/**
 * useInquiryDraft hook 测试（Task 15）
 * 验证：自动保存状态流转、模板保存/加载/清除、并发冲突 storage 事件
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInquiryDraft } from '../useInquiryDraft';
import { useConnectivityStore } from '@/store/useConnectivityStore';
import { DRAFT_STORAGE_KEY, type DraftMeta } from '@/pages/inquiry/create/draft';

beforeEach(() => {
  localStorage.clear();
  useConnectivityStore.setState({ isOnline: true, lastSyncAt: null, stale: false });
});

afterEach(() => {
  localStorage.clear();
});

describe('useInquiryDraft', () => {
  it('在线保存成功 → status 变为 saved 并记录 savedAt', () => {
    const { result } = renderHook(() => useInquiryDraft());
    expect(result.current.status).toBe('idle');
    act(() => {
      const ok = result.current.saveNow({ subject: '测试' }, undefined);
      expect(ok).toBe(true);
    });
    expect(result.current.status).toBe('saved');
    expect(result.current.savedAt).toBeTruthy();
  });

  it('离线保存 → status 为 offline（不谎报已保存）', () => {
    useConnectivityStore.setState({ isOnline: false });
    const { result } = renderHook(() => useInquiryDraft());
    act(() => {
      result.current.saveNow({ subject: '测试' }, undefined);
    });
    expect(result.current.status).toBe('offline');
  });

  it('模板保存/加载/清除 往返', () => {
    const { result } = renderHook(() => useInquiryDraft());
    const template = {
      name: '服务器模板',
      subject: '服务器采购',
      items: [
        {
          id: '',
          inquiryId: '',
          name: '机架式服务器',
          code: 'SRV-001',
          category: '服务器',
          brand: '',
          spec: '',
          techParams: '',
          unit: '台',
          quantity: 8,
          attachments: [],
        },
      ],
      selectedSupplierIds: ['sup-1'],
      createdAt: new Date().toISOString(),
    };
    act(() => {
      expect(result.current.saveAsTemplate('服务器模板', template)).toBe(true);
    });
    expect(result.current.loadTemplate()?.name).toBe('服务器模板');
    expect(result.current.loadTemplate()?.items[0].quantity).toBe(8);
    act(() => {
      result.current.clearTemplate();
    });
    expect(result.current.loadTemplate()).toBeNull();
  });

  it('并发冲突：storage 事件触发后 conflict=true，reload 可清除', () => {
    const { result } = renderHook(() => useInquiryDraft());
    // 模拟另一标签页写入草稿（写入一段 JSON，含对方 clientId）
    act(() => {
      const remote = {
        clientId: 'tab-other',
        savedAt: 'x',
        updatedAt: Date.now() - 500,
        payload: {},
      } as DraftMeta;
      const serialized = JSON.stringify({ v: 2, data: remote });
      localStorage.setItem(`procurement_${DRAFT_STORAGE_KEY}`, serialized);
      // 必须携带 newValue，storage 事件处理器（hook）才会读取并做并发冲突判断
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: `procurement_${DRAFT_STORAGE_KEY}`,
          newValue: serialized,
        }),
      );
    });
    expect(result.current.conflict).toBe(true);
    act(() => {
      result.current.reload();
    });
    expect(result.current.conflict).toBe(false);
  });
});
