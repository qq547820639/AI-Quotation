/**
 * 系统设置 API（W7.2）
 */
import { client } from './client';

export interface AISettings {
  provider: 'local' | 'remote';
  baseUrl: string;
  model: string;
  /** 脱敏回显（尾 4 位）；提交时为空或含 * 视为保持不变 */
  apiKey: string;
  hasApiKey: boolean;
  structuredOutput: boolean;
}

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
  ai: AISettings;
}

export const settingsApi = {
  get: () => client.get<AppSettings>('/settings').then((r) => r.data),
  update: (data: Partial<AppSettings>) =>
    client.put<AppSettings>('/settings', data).then((r) => r.data),
};
