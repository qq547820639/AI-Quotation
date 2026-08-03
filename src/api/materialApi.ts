/**
 * 物料 API（W7.2）
 */
import { client } from './client';
import type { Material } from '@/types';

export const materialApi = {
  list: () => client.get<Material[]>('/materials').then((r) => r.data),
  get: (id: string) => client.get<Material>(`/materials/${id}`).then((r) => r.data),
  create: (data: Partial<Material>) =>
    client.post<Material>('/materials', data).then((r) => r.data),
  update: (id: string, data: Partial<Material>) =>
    client.put<Material>(`/materials/${id}`, data).then((r) => r.data),
  delete: (id: string) => client.delete(`/materials/${id}`),
  batchImport: (items: Partial<Material>[]) =>
    client.post<{ success: number }>('/materials/batch', { items }).then((r) => r.data),
};
