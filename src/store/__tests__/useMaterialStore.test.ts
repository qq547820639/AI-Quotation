/**
 * useMaterialStore 测试（Task 4）
 * 覆盖写操作成功/失败回滚/防重复提交/notFound 语义
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMaterialStore } from '../useMaterialStore';
import type { Material } from '@/types';

// mock API 层，避免真实网络请求（store 内写操作为 await 调用）
vi.mock('@/api', () => ({
  materialApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
}));

import { materialApi } from '@/api';

/** 构造测试用 Material */
function makeMaterial(overrides: Partial<Material> = {}): Material {
  return {
    id: 'mat-test',
    code: 'MAT900',
    name: '测试物料',
    category: '五金件',
    brand: '',
    spec: '',
    techParams: '',
    unit: '个',
    ...overrides,
  };
}

/** 重置 store 状态 */
function resetStore(materials: Material[] = []) {
  useMaterialStore.setState({ materials });
}

beforeEach(() => {
  resetStore([]);
  vi.clearAllMocks();
});

describe('useMaterialStore', () => {
  describe('addMaterial', () => {
    it('成功时返回 { success:true } 并写入本地', async () => {
      vi.mocked(materialApi.create).mockResolvedValueOnce({} as Material);
      const res = await useMaterialStore.getState().addMaterial(makeMaterial());
      expect(res.success).toBe(true);
      expect(useMaterialStore.getState().materials).toHaveLength(1);
    });

    it('失败时回滚乐观更新并返回 error', async () => {
      vi.mocked(materialApi.create).mockRejectedValueOnce(new Error('boom'));
      const res = await useMaterialStore.getState().addMaterial(makeMaterial());
      expect(res.success).toBe(false);
      expect(res.reason).toBe('error');
      // 乐观更新已回滚，列表恢复为空
      expect(useMaterialStore.getState().materials).toHaveLength(0);
    });

    it('重复提交被拦截（pending 语义）', async () => {
      const m = makeMaterial();
      let resolveCreate!: (v: Material | PromiseLike<Material>) => void;
      vi.mocked(materialApi.create).mockImplementationOnce(
        () => new Promise((r) => (resolveCreate = r)),
      );
      useMaterialStore.getState().addMaterial(m);
      const second = await useMaterialStore.getState().addMaterial(m);
      expect(second.success).toBe(false);
      expect(second.reason).toBe('pending');
      resolveCreate(m);
      await Promise.resolve();
    });
  });

  describe('updateMaterial', () => {
    it('成功时更新并返回 ok', async () => {
      resetStore([makeMaterial({ name: '旧名' })]);
      vi.mocked(materialApi.update).mockResolvedValueOnce({} as Material);
      const res = await useMaterialStore.getState().updateMaterial('mat-test', { name: '新名' });
      expect(res.success).toBe(true);
      expect(useMaterialStore.getState().materials[0].name).toBe('新名');
    });

    it('API 失败时回滚到快照', async () => {
      resetStore([makeMaterial({ name: '旧名' })]);
      vi.mocked(materialApi.update).mockRejectedValueOnce(new Error('boom'));
      const res = await useMaterialStore.getState().updateMaterial('mat-test', { name: '新名' });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('error');
      expect(useMaterialStore.getState().materials[0].name).toBe('旧名');
    });

    it('目标不存在返回 not_found', async () => {
      const res = await useMaterialStore.getState().updateMaterial('missing', { name: 'x' });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('not_found');
    });
  });

  describe('deleteMaterial', () => {
    it('API 失败时回滚已删除的物料', async () => {
      resetStore([makeMaterial()]);
      vi.mocked(materialApi.delete).mockRejectedValueOnce(new Error('boom'));
      const res = await useMaterialStore.getState().deleteMaterial('mat-test');
      expect(res.success).toBe(false);
      expect(res.reason).toBe('error');
      expect(useMaterialStore.getState().materials).toHaveLength(1);
    });
  });
});