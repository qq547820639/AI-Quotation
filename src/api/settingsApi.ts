/**
 * 系统设置 API（W7.2）
 */
import { client } from './client';

export interface AppSettings {
  approval: {
    enabled: boolean;
    amountThreshold: number;
    approverId: string;
  };
  notification: {
    deadlineReminder: boolean;
    deadlineReminderHours: number;
    quotationSubmitted: boolean;
    approvalResult: boolean;
  };
}

export const settingsApi = {
  get: () => client.get<AppSettings>('/settings').then((r) => r.data),
  update: (data: Partial<AppSettings>) =>
    client.put<AppSettings>('/settings', data).then((r) => r.data),
};
