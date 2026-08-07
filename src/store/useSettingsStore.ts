/**
 * 系统设置 store
 * - 基本信息 / 询价规则 / 通知设置
 * - 持久化到 localStorage（key: settings），随 storage.ts 的 SCHEMA_VERSION 升级
 * - W7.4：loadFromApi 同步审批配置，写操作走 API + 降级
 */
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/utils/storage';
import { Currency, type ApprovalConfig } from '@/types';
import { supervisorUser } from '@/mock/users';
import { settingsApi, type AppSettings, type AISettings } from '@/api/settingsApi';
import { ok, fail, type WriteResult } from './writeResult';

const STORAGE_KEY = 'settings';

/** 演示模式默认指向火山引擎百炼 Ark 端点（OpenAI 兼容） */
const AI_DEFAULTS: AISettings = {
  provider: 'local',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seed-2-1-pro-260628',
  apiKey: '',
  hasApiKey: false,
  structuredOutput: true,
};

/** 将 store 的 Settings 映射为 API 的 AppSettings */
function toAppSettings(s: Settings): AppSettings {
  return {
    approval: s.approval,
    notification: {
      deadlineReminder: s.notifications.timeoutAlert ?? true,
      deadlineReminderHours: s.timeoutThresholdHours,
      quotationSubmitted: s.notifications.quotationSubmitted ?? true,
      approvalResult: s.notifications.approval ?? true,
    },
    ai: s.ai,
  };
}

export interface Settings {
  /** 采购组织（系统展示用默认值，数据过滤仍以 useUIStore.currentOrganization 为准） */
  organization: string;
  /** 系统名称 */
  systemName: string;
  /** 默认币种 */
  currency: Currency;
  /** 默认报价有效期（天） */
  validDays: number;
  /** 默认报价截止提前天数 */
  deadlineLeadDays: number;
  /** 即将超时阈值（小时） */
  timeoutThresholdHours: number;
  /** 通知开关 */
  notifications: Record<string, boolean>;
  /** 审批配置（W5） */
  approval: ApprovalConfig;
  /** AI 服务配置（P2-15，设置页可配置） */
  ai: AISettings;
}

const DEFAULTS: Settings = {
  organization: '总部采购中心',
  systemName: '采购询价系统',
  currency: Currency.CNY,
  validDays: 7,
  deadlineLeadDays: 3,
  timeoutThresholdHours: 24,
  notifications: {
    inquirySent: true,
    quotationSubmitted: true,
    timeoutAlert: true,
    todoReminder: false,
    approval: true,
  },
  approval: {
    enabled: true,
    amountThreshold: 50000,
    approverId: supervisorUser.id,
  },
  ai: { ...AI_DEFAULTS },
};

interface SettingsState extends Settings {
  /** W7.4：从 API 同步审批配置（失败时降级到本地） */
  loadFromApi: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<WriteResult>;
  resetSettings: () => Promise<WriteResult>;
}

function loadSettings(): Settings {
  const saved = loadJSON<Settings>(STORAGE_KEY, DEFAULTS);
  return {
    ...DEFAULTS,
    ...saved,
    notifications: { ...DEFAULTS.notifications, ...(saved.notifications ?? {}) },
    approval: { ...DEFAULTS.approval, ...(saved.approval ?? {}) },
    ai: { ...AI_DEFAULTS, ...(saved.ai ?? {}) },
  };
}

/** 仅持久化业务字段（剥离 store 方法） */
function persist(next: Settings) {
  saveJSON(STORAGE_KEY, next);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),

  // W7.4：从 API 同步审批配置，失败时降级到本地
  loadFromApi: async () => {
    try {
      const remote = await settingsApi.get();
      // 仅覆盖 approval / ai 部分，notifications/基本配置保留本地
      set({ approval: remote.approval, ai: remote.ai });
      persist({ ...get(), approval: remote.approval, ai: remote.ai });
    } catch {
      /* API 不可用时使用本地设置 */
    }
  },

  // Task 4：本地持久化 + 服务端同步，失败返回 WriteResult（不静默吞掉）
  updateSettings: async (patch) => {
    const state = get();
    const next: Settings = {
      organization: patch.organization ?? state.organization,
      systemName: patch.systemName ?? state.systemName,
      currency: patch.currency ?? state.currency,
      validDays: patch.validDays ?? state.validDays,
      deadlineLeadDays: patch.deadlineLeadDays ?? state.deadlineLeadDays,
      timeoutThresholdHours: patch.timeoutThresholdHours ?? state.timeoutThresholdHours,
      notifications: patch.notifications ?? state.notifications,
      approval: patch.approval ?? state.approval,
      ai: patch.ai ?? state.ai,
    };
    set(next);
    persist(next);
    try {
      await settingsApi.update(toAppSettings(next));
      return ok();
    } catch (e) {
      return fail(e);
    }
  },

  resetSettings: async () => {
    set(DEFAULTS);
    persist(DEFAULTS);
    try {
      await settingsApi.update(toAppSettings(DEFAULTS));
      return ok();
    } catch (e) {
      return fail(e);
    }
  },
}));
