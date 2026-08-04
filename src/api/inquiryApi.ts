/**
 * 询价单 API（W7.2）
 */
import { client } from './client';
import type { Inquiry } from '@/types';

export const inquiryApi = {
  list: () => client.get<Inquiry[]>('/inquiries').then((r) => r.data),
  get: (id: string) => client.get<Inquiry>(`/inquiries/${id}`).then((r) => r.data),
  create: (data: Partial<Inquiry>) => client.post<Inquiry>('/inquiries', data).then((r) => r.data),
  update: (id: string, data: Partial<Inquiry>) =>
    client.put<Inquiry>(`/inquiries/${id}`, data).then((r) => r.data),
  delete: (id: string) => client.delete(`/inquiries/${id}`),
  submitApproval: (id: string, version?: number) =>
    client.post<Inquiry>(`/inquiries/${id}/submit-approval`, { version }).then((r) => r.data),
  approve: (id: string, comment?: string, version?: number) =>
    client.post<Inquiry>(`/inquiries/${id}/approve`, { comment, version }).then((r) => r.data),
  reject: (id: string, comment?: string, version?: number) =>
    client.post<Inquiry>(`/inquiries/${id}/reject`, { comment, version }).then((r) => r.data),
  confirm: (id: string, version?: number) =>
    client.post<Inquiry>(`/inquiries/${id}/confirm`, { version }).then((r) => r.data),
  cancel: (id: string, version?: number) =>
    client.post<Inquiry>(`/inquiries/${id}/cancel`, { version }).then((r) => r.data),
  send: (id: string, version?: number) =>
    client.post<Inquiry>(`/inquiries/${id}/send`, { version }).then((r) => r.data),
};
