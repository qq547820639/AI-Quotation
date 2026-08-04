/**
 * useSupplierStore 测试（Task 2）
 * 覆盖写操作的成功/失败回滚/防重复提交/notFound 语义
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSupplierStore } from '../useSupplierStore';
import { CooperationStatus, SupplierLevel, type Supplier } from '@/types';

// mock API 层，避免真实网络请求（store 内写操作为 await 调用）
vi.mock('@/api', () => ({
  supplierApi: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    toggleStatus: vi.fn().mockResolvedValue({}),
  },
}));

import { supplierApi } from '@/api';
import { ApiError } from '@/api/errors';

/** 构造测试用 Supplier */
function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-test',
    code: 'SUP900',
    name: '测试供应商',
    region: '上海',
    contact: '张三',
    phone: '13800000000',
    email: 'a@b.com',
    mainCategories: ['五金件'],
    level: SupplierLevel.QUALIFIED,
    cooperationStatus: CooperationStatus.COOPERATING,
    qualified: true,
    historyResponseRate: 0.9,
    historyFulfillmentRate: 0.9,
    avgDeliveryDays: 7,
    historyCoopCount: 10,
    ...overrides,
  };
}

/** 重置 store 状态 */
function resetStore(suppliers: Supplier[] = []) {
  useSupplierStore.setState({ suppliers, loading: false });
}

beforeEach(() => {
  resetStore([]);
  vi.clearAllMocks();
});

describe('useSupplierStore', () => {
  describe('toggleSupplierStatus', () => {
    it('成功时切换状态并返回 { success:true }', async () => {
      resetStore([makeSupplier({ cooperationStatus: CooperationStatus.DISABLED })]);
      const res = await useSupplierStore.getState().toggleSupplierStatus('sup-test');
      expect(res.success).toBe(true);
      expect(useSupplierStore.getState().getSupplierById('sup-test')?.cooperationStatus).toBe(
        CooperationStatus.COOPERATING,
      );
    });

    it('API 失败时回滚本地状态并返回 { success:false, reason:error }', async () => {
      resetStore([makeSupplier({ cooperationStatus: CooperationStatus.COOPERATING })]);
      vi.mocked(supplierApi.update).mockRejectedValueOnce(new Error('boom'));
      const res = await useSupplierStore.getState().toggleSupplierStatus('sup-test');
      expect(res).toEqual(expect.objectContaining({ success: false, reason: 'error' }));
      expect(res.error).toBeInstanceOf(ApiError);
      // 回滚到操作前状态
      expect(useSupplierStore.getState().getSupplierById('sup-test')?.cooperationStatus).toBe(
        CooperationStatus.COOPERATING,
      );
    });
  });

  describe('updateSupplier', () => {
    it('成功时更新字段并返回 { success:true }', async () => {
      resetStore([makeSupplier({ name: '旧名' })]);
      const res = await useSupplierStore.getState().updateSupplier('sup-test', { name: '新名' });
      expect(res.success).toBe(true);
      expect(useSupplierStore.getState().getSupplierById('sup-test')?.name).toBe('新名');
    });

    it('API 失败时回滚本地状态并返回 { success:false, reason:error }', async () => {
      resetStore([makeSupplier({ name: '旧名' })]);
      vi.mocked(supplierApi.update).mockRejectedValueOnce(new Error('boom'));
      const res = await useSupplierStore.getState().updateSupplier('sup-test', { name: '新名' });
      expect(res).toEqual(expect.objectContaining({ success: false, reason: 'error' }));
      expect(res.error).toBeInstanceOf(ApiError);
      expect(useSupplierStore.getState().getSupplierById('sup-test')?.name).toBe('旧名');
    });

    it('目标不存在返回 { success:false, reason:not_found } 且不调 API', async () => {
      resetStore([]);
      const res = await useSupplierStore.getState().updateSupplier('missing', { name: 'x' });
      expect(res).toEqual({ success: false, reason: 'not_found' });
      expect(supplierApi.update).not.toHaveBeenCalled();
    });
  });

  describe('防重复提交', () => {
    it('同一实体 pending 期间再次调用返回 pending 且不重复调 API', async () => {
      resetStore([makeSupplier()]);
      let resolveFn: (v: unknown) => void = () => {};
      const gate = new Promise((resolve) => {
        resolveFn = resolve;
      });
      vi.mocked(supplierApi.update).mockImplementationOnce(() => gate as Promise<never>);
      const first = useSupplierStore.getState().updateSupplier('sup-test', { name: 'x' });
      const second = useSupplierStore.getState().updateSupplier('sup-test', { name: 'y' });
      expect(await second).toEqual({ success: false, reason: 'pending' });
      expect(supplierApi.update).toHaveBeenCalledTimes(1);
      resolveFn({});
      await first;
    });
  });

  describe('batchDisableSuppliers', () => {
    it('对已停用项跳过，不反向启用', async () => {
      resetStore([
        makeSupplier({ id: 'a', cooperationStatus: CooperationStatus.COOPERATING }),
        makeSupplier({ id: 'b', cooperationStatus: CooperationStatus.DISABLED }),
      ]);
      const res = await useSupplierStore.getState().batchDisableSuppliers(['a', 'b']);
      expect(res.total).toBe(2);
      expect(res.succeeded).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(0);
      // a 被停用
      expect(useSupplierStore.getState().getSupplierById('a')?.cooperationStatus).toBe(
        CooperationStatus.DISABLED,
      );
      // b 保持停用，未被反向启用
      expect(useSupplierStore.getState().getSupplierById('b')?.cooperationStatus).toBe(
        CooperationStatus.DISABLED,
      );
      const skipped = res.results.find((r) => r.id === 'b');
      expect(skipped?.skipped).toBe(true);
      expect(skipped?.reason).toBeTruthy();
    });

    it('部分成功/失败聚合正确', async () => {
      resetStore([
        makeSupplier({ id: 'a', cooperationStatus: CooperationStatus.COOPERATING }),
        makeSupplier({ id: 'b', cooperationStatus: CooperationStatus.COOPERATING }),
      ]);
      vi.mocked(supplierApi.update).mockRejectedValueOnce(new Error('boom'));
      const res = await useSupplierStore.getState().batchDisableSuppliers(['a', 'b']);
      expect(res.total).toBe(2);
      expect(res.succeeded).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.skipped).toBe(0);
      const failed = res.results.find((r) => r.id === 'a');
      expect(failed?.success).toBe(false);
      expect(failed?.reason).toBeTruthy();
    });
  });

  describe('batchEnableSuppliers', () => {
    it('对已启用项跳过，仅启用 DISABLED 项', async () => {
      resetStore([
        makeSupplier({ id: 'a', cooperationStatus: CooperationStatus.DISABLED }),
        makeSupplier({ id: 'b', cooperationStatus: CooperationStatus.COOPERATING }),
      ]);
      const res = await useSupplierStore.getState().batchEnableSuppliers(['a', 'b']);
      expect(res.total).toBe(2);
      expect(res.succeeded).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.failed).toBe(0);
      expect(useSupplierStore.getState().getSupplierById('a')?.cooperationStatus).toBe(
        CooperationStatus.COOPERATING,
      );
      // b 保持启用
      expect(useSupplierStore.getState().getSupplierById('b')?.cooperationStatus).toBe(
        CooperationStatus.COOPERATING,
      );
    });
  });
});