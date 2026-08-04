/**
 * 通知 API（W7.2 + P1-8 Task 12）
 */
import { client } from './client';
import type { Notification } from '@/types';
import type { UserNotificationPreferencesSchema } from '@/types';

export const notificationApi = {
  list: () => client.get<Notification[]>('/notifications').then((r) => r.data),
  create: (data: Partial<Notification>) =>
    client.post<Notification>('/notifications', data).then((r) => r.data),
  markRead: (id: string) =>
    client.post<Notification>(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),
  getUnreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  getPreferences: () =>
    client.get<UserNotificationPreferencesSchema>('/notifications/preferences').then((r) => r.data),
  updatePreferences: (data: UserNotificationPreferencesSchema) =>
    client
      .put<UserNotificationPreferencesSchema>('/notifications/preferences', data)
      .then((r) => r.data),
};
