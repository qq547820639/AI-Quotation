/**
 * useInquiryDraft hook 测试（Task 15）
 * 验证：自动保存状态流转、模板保存/加载/清除、并发冲突 storage 事件
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInquiryDraft } from '../useInquiryDraft';
import { useConnectivityStore } from '@/store/useConnectivityStore';
import { DRAFT_STORAGE_KEY, type DraftMeta } from '@/pages/inquiry/create/draft';
import {
  makeLocalStorageWritesThrow,
  assertWriteInjectionLanded,
  type WriteFailureInjection,
} from '@/test/writeFailures';

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

  // ===== R50：写失败必须被 hook 看见 =====
  // 上面"成功 → true"那两条在改之前是恒真的：saveJSON 内部吞掉异常、返回 void，
  // hook 的 try/catch 结构上到不了 catch 分支，所以 `expect(ok).toBe(true)` 与实现是否正确无关。
  // 这两条补的是失败极性——只有让 setItem 真抛，才能区分"接了回执"与"仍在猜"。
  describe('写入失败（配额/隐私模式）时的可见性', () => {
    /**
     * 让 localStorage 的写真的抛出去，并先证明抛得出去（否则失败断言可能是别的原因）
     *
     * 旧写法是对 localStorage 的写方法做 `vi.spyOn` + `mockImplementation`：它靠给实例**赋值**装钩子，
     * 而 Node 24 的 localStorage 实例上没有自有 setItem，赋值被 `[Storage]` 命名属性 setter 吃掉，
     * 于是注入在 CI 上静默空转（本机 Node 26 却"恰好"生效）。现在统一走 src/test/writeFailures.ts
     * 的按形状选层注入（方法在实例上就注实例、在原型上就注原型），两档形状都抛得出去；
     * 而"往实例上 defineProperty 就能盖住原型"这句在本机成立、在 CI 的 [Storage] 上不成立，
     * 原因与实测数据写在那份文件顶部。
     */
    function makeWritesFail(boom: Error): WriteFailureInjection {
      const inj = makeLocalStorageWritesThrow(boom, { methods: ['setItem'] });
      assertWriteInjectionLanded(inj, boom); // 探测那一次由它自己从配额里扣掉
      return inj;
    }

    it('saveNow 在写失败时返回 false、status 落 failed 并记录 lastError', () => {
      const boom = new Error('QuotaExceededError');
      const inj = makeWritesFail(boom);
      try {
        const { result } = renderHook(() => useInquiryDraft());
        let ok: boolean | undefined;
        act(() => {
          ok = result.current.saveNow({ subject: '测试' });
        });
        expect(inj.calls()).toBe(1);
        expect(ok).toBe(false);
        expect(result.current.status).toBe('failed');
        expect(result.current.savedAt).toBeNull();
        // 错误原文只进 lastError 供排查，UI 侧另有 i18n 文案
        expect(result.current.lastError).toBe('QuotaExceededError');
      } finally {
        inj.restore();
      }
    });

    it('saveAsTemplate 在写失败时返回 false，失败分支不是死代码', () => {
      const boom = new Error('SecurityError');
      const inj = makeWritesFail(boom);
      try {
        const { result } = renderHook(() => useInquiryDraft());
        let ok: boolean | undefined;
        act(() => {
          ok = result.current.saveAsTemplate('服务器模板', {
            name: '服务器模板',
            subject: '服务器采购',
            items: [],
            selectedSupplierIds: [],
            createdAt: new Date().toISOString(),
          });
        });
        expect(inj.calls()).toBe(1);
        expect(ok).toBe(false);
        expect(result.current.lastError).toBe('SecurityError');
        expect(result.current.loadTemplate()).toBeNull();
      } finally {
        inj.restore();
      }
    });

    it('写失败后再次写成功会清掉 lastError', () => {
      const { result } = renderHook(() => useInquiryDraft());
      // times: 1 = 只有第一次写抛，之后的写要照常成功（原 mockImplementationOnce 的语义）
      const boom = new Error('QuotaExceededError');
      const inj = makeLocalStorageWritesThrow(boom, { methods: ['setItem'], times: 1 });
      // 这条也要前提断言：否则"第一次写没抛"会被读成"实现把失败吞了"，而其实是注入没落地
      assertWriteInjectionLanded(inj, boom);
      act(() => {
        expect(result.current.saveNow({ subject: 'a' })).toBe(false);
      });
      expect(result.current.lastError).toBe('QuotaExceededError');
      inj.restore();
      act(() => {
        expect(result.current.saveNow({ subject: 'b' })).toBe(true);
      });
      expect(result.current.lastError).toBeNull();
      expect(result.current.status).toBe('saved');
    });

    it('overwrite 把写失败传出去（冲突弹窗那条"已用本地内容覆盖"要有凭据）', () => {
      // R51-A：改前 overwrite 返回 void 且把 saveNow 的布尔丢掉，
      // 于是 create/index.tsx 的覆盖分支无论落没落地都报成功。
      const boom = new Error('QuotaExceededError');
      const inj = makeWritesFail(boom);
      try {
        const { result } = renderHook(() => useInquiryDraft());
        let ok: boolean | undefined;
        act(() => {
          ok = result.current.overwrite({ subject: '覆盖' });
        });
        expect(ok).toBe(false);
        expect(result.current.conflict).toBe(false); // 冲突标记仍按原语义清掉
        expect(result.current.status).toBe('failed');
        expect(result.current.lastError).toBe(boom.message);
      } finally {
        inj.restore();
      }
    });
  });
});
