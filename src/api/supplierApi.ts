/**
 * 供应商 API（W7.2）
 */
import { client } from './client';
import type { Supplier } from '@/types';

export const supplierApi = {
  list: () => client.get<Supplier[]>('/suppliers').then((r) => r.data),
  get: (id: string) => client.get<Supplier>(`/suppliers/${id}`).then((r) => r.data),
  create: (data: Partial<Supplier>) =>
    client.post<Supplier>('/suppliers', data).then((r) => r.data),
  update: (id: string, data: Partial<Supplier>) =>
    client.put<Supplier>(`/suppliers/${id}`, data).then((r) => r.data),
  delete: (id: string) => client.delete(`/suppliers/${id}`),
  toggleStatus: (id: string) =>
    client.post<Supplier>(`/suppliers/${id}/toggle-status`).then((r) => r.data),
};
