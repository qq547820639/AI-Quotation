/**
 * 询价单 API（W7.2 + P1-8 Task 12 + P2-12 Task 17）
 */
import { client } from './client';
import type {
  Inquiry,
  InquiryListParams,
  PaginatedInquiries,
  QuotationSnapshot,
  ExportRequest,
} from '@/types';
import type { DeliveryRecord, DeliverySummary } from '@/types';

export const inquiryApi = {
  list: () => client.get<Inquiry[]>('/inquiries').then((r) => r.data),
  /** P2-12 Task 17：服务端分页/筛选/搜索/排序列表 */
  listPage: (params: InquiryListParams) =>
    client.get<PaginatedInquiries>('/inquiries', { params }).then((r) => r.data),
  /** P2-12 Task 17：服务端生成 PDF/Excel 导出，返回文件流并触发下载 */
  export: async (id: string, body: ExportRequest): Promise<void> => {
    const resp = await client.post(`/inquiries/${id}/export`, body, { responseType: 'blob' });
    const disposition = resp.headers['content-disposition'] ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const filename = match?.[1] ?? `inquiry-${id}.${body.format}`;
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** P2-12 Task 17：报价快照列表（定标确认后冻结，不可变） */
  snapshots: (id: string) =>
    client.get<QuotationSnapshot[]>(`/inquiries/${id}/snapshots`).then((r) => r.data),
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
  getDeliveries: (id: string) =>
    client
      .get<{ suppliers: DeliveryRecord[]; summary: DeliverySummary }>(`/inquiries/${id}/deliveries`)
      .then((r) => r.data),
  resendDelivery: (inquiryId: string, supplierId: string) =>
    client
      .post<DeliveryRecord>(`/inquiries/${inquiryId}/deliveries/${supplierId}/resend`)
      .then((r) => r.data),
  previewTemplate: (variables: Record<string, string>, lang?: string) =>
    client
      .get<{ subject: string; body: string; missingVariables: string[] }>(
        '/inquiries/templates/preview',
        { params: { variables, lang } },
      )
      .then((r) => r.data),
  triggerDeadlineReminders: () =>
    client.post<{ created: number }>('/inquiries/reminders/deadline').then((r) => r.data),
};
