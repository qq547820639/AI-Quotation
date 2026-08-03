/**
 * 报价单 API（W7.2）
 */
import { client } from './client';
import type { Quotation } from '@/types';

export const quotationApi = {
  list: () => client.get<Quotation[]>('/quotations').then((r) => r.data),
  listByInquiry: (inquiryId: string) =>
    client.get<Quotation[]>(`/inquiries/${inquiryId}/quotations`).then((r) => r.data),
  get: (id: string) => client.get<Quotation>(`/quotations/${id}`).then((r) => r.data),
  create: (data: Partial<Quotation>) =>
    client.post<Quotation>('/quotations', data).then((r) => r.data),
  saveDraft: (id: string, data: Partial<Quotation>) =>
    client.put<Quotation>(`/quotations/${id}/draft`, data).then((r) => r.data),
  submit: (id: string) => client.post<Quotation>(`/quotations/${id}/submit`).then((r) => r.data),
};
