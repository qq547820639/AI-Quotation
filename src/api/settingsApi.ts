/**
 * 系统设置 API（W7.2）
 */
import { client } from './client';

export interface AISettings {
  /** local=本地规则 / demo=内置演示密钥开箱即用 / remote=自填密钥远程大模型 */
  provider: 'local' | 'demo' | 'remote';
  baseUrl: string;
  model: string;
  /** 脱敏回显（尾 4 位）；提交时为空或含 * 视为保持不变 */
  apiKey: string;
  hasApiKey: boolean;
  structuredOutput: boolean;
}

export interface BasicSettings {
  /** 系统名称：驱动浏览器标签标题（src/App.tsx） */
  systemName: string;
  /** 默认币种：新建询价单的默认值（create/shared.ts 的 defaultBasicInfo） */
  currency: string;
  /** 报价截止提前天数：同上，决定默认 deadline */
  deadlineLeadDays: number;
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
  basic: BasicSettings;
}

export const settingsApi = {
  get: () => client.get<AppSettings>('/settings').then((r) => r.data),
  update: (data: Partial<AppSettings>) =>
    client.put<AppSettings>('/settings', data).then((r) => r.data),
};
