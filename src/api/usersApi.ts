/**
 * 用户 API（P2-12 Task 17）
 * - 用户级表格偏好持久化（GET/PUT /api/users/table-preferences/{pageKey}）
 */
import { client } from './client';
import type { TablePreferencesPayload } from '@/types';

export const usersApi = {
  getTablePreference: (pageKey: string) =>
    client.get<TablePreferencesPayload>(`/users/table-preferences/${pageKey}`).then((r) => r.data),
  saveTablePreference: (pageKey: string, data: Record<string, unknown>) =>
    client
      .put<TablePreferencesPayload>(`/users/table-preferences/${pageKey}`, { pageKey, data })
      .then((r) => r.data),
};
