/**
 * 通知 API（W7.2）
 */
import { client } from './client';
import type { Notification } from '@/types';

export const notificationApi = {
  list: () => client.get<Notification[]>('/notifications').then((r) => r.data),
  create: (data: Partial<Notification>) =>
    client.post<Notification>('/notifications', data).then((r) => r.data),
  markRead: (id: string) =>
    client.post<Notification>(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),
};
