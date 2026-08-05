/**
 * 通知 store
 * - 询价 / 报价 / 审批等流程节点联动写入通知
 * - 持久化到 localStorage（key: notifications）
 * - 同 inquiryId + type 在 10 分钟内去重，最多保留 100 条
 * - W6：写入前检查 useSettingsStore.notifications 开关，关闭的类型不写入
 */
import { create } from 'zustand';
import dayjs from 'dayjs';
import {
  NotificationType,
  type Notification,
  type UserNotificationPreferencesSchema,
} from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { notificationApi } from '@/api';
import { useSettingsStore } from './useSettingsStore';
import { useConnectivityStore } from './useConnectivityStore';
import { MOCK_FALLBACK_ENABLED } from '@/config';
import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
import { ok, fail, type WriteResult } from './writeResult';

const STORAGE_KEY = 'notifications';
/** 去重窗口：同 inquiryId + type 10 分钟内不重复 */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
/** 最多保留通知条数 */
const MAX_NOTIFICATIONS = 100;

/** 通知类型 → 设置开关 key 映射（SYSTEM 始终写入） */
const TYPE_TO_SETTING_KEY: Partial<Record<NotificationType, string>> = {
  [NotificationType.INQUIRY_SENT]: 'inquirySent',
  [NotificationType.QUOTATION_SUBMITTED]: 'quotationSubmitted',
  [NotificationType.DEADLINE_APPROACHING]: 'timeoutAlert',
  [NotificationType.APPROVAL]: 'approval',
};

export interface NotificationPayload {
  inquiryId?: string;
  type: NotificationType;
  title: string;
  content: string;
  /** 统一事件 ID（邮件/站内通知共享，用于幂等去重） */
  eventId?: string;
}

interface NotificationState {
  notifications: Notification[];
  /** P1-8 Task 12：服务端未读数（按用户过滤） */
  unreadCount: number;
  /** P1-8 Task 12：用户级通知偏好 */
  preferences: UserNotificationPreferencesSchema;
  /** W7.4：从 API 加载（失败时降级到 localStorage） */
  loadFromApi: () => Promise<void>;
  addNotification: (payload: NotificationPayload) => Promise<WriteResult>;
  markRead: (id: string) => Promise<WriteResult>;
  markAllRead: () => Promise<WriteResult>;
  getUnreadCount: () => number;
  /** P1-8 Task 12：从服务端刷新未读数与偏好 */
  refreshUnreadCount: () => Promise<void>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (data: UserNotificationPreferencesSchema) => Promise<WriteResult>;
}

const DEFAULT_PREFERENCES: UserNotificationPreferencesSchema = {
  deadlineReminder: true,
  deadlineReminderHours: 24,
  quotationSubmitted: true,
  approvalResult: true,
  inquirySent: true,
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  // P1-10 Task 15：生产模式不预置本地兜底数据，仅演示模式允许（真实与 mock 隔离）
  notifications: MOCK_FALLBACK_ENABLED ? loadJSON<Notification[]>(STORAGE_KEY, []) : [],
  unreadCount: 0,
  preferences: DEFAULT_PREFERENCES,

  // W7.4 + P1-10 Task 15：从 API 加载，合并本地独有通知；生产模式失败不静默回退
  loadFromApi: async () => {
    try {
      const data = await notificationApi.list();
      set((state) => {
        const apiMap = new Map(data.map((n) => [n.id, n]));
        const localOnly = state.notifications.filter((n) => !apiMap.has(n.id));
        const merged = [...data, ...localOnly];
        saveJSON(STORAGE_KEY, merged);
        queryClient.setQueryData(QUERY_KEYS.notifications, merged);
        return { notifications: merged };
      });
      await get().refreshUnreadCount();
      useConnectivityStore.getState().markSynced();
    } catch {
      // 仅演示模式允许保留本地数据；生产模式禁止无提示回退，标记离线
      if (MOCK_FALLBACK_ENABLED) {
        set({ notifications: loadJSON<Notification[]>(STORAGE_KEY, []) });
      } else {
        useConnectivityStore.getState().markOffline();
      }
    }
  },

  // P1-8 Task 12：从服务端刷新未读数
  refreshUnreadCount: async () => {
    try {
      const { count } = await notificationApi.getUnreadCount();
      set({ unreadCount: count });
    } catch {
      // 生产模式标记离线，避免无提示展示过期未读数
      if (!MOCK_FALLBACK_ENABLED) useConnectivityStore.getState().markOffline();
    }
  },

  // P1-8 Task 12：加载用户级偏好
  loadPreferences: async () => {
    try {
      const prefs = await notificationApi.getPreferences();
      set({ preferences: prefs });
    } catch {
      // 忽略：保留默认值
    }
  },

  // P1-8 Task 12：更新用户级偏好
  updatePreferences: async (data) => {
    try {
      const prefs = await notificationApi.updatePreferences(data);
      set({ preferences: prefs });
      return ok();
    } catch (e) {
      return fail(e);
    }
  },

  // Task 4：本地持久化 + 服务端同步，失败返回 WriteResult（不静默吞掉）
  addNotification: async (payload) => {
    // W6：检查设置开关，关闭的类型不写入（SYSTEM 始终写入）
    const settingKey = TYPE_TO_SETTING_KEY[payload.type];
    if (settingKey) {
      const enabled = useSettingsStore.getState().notifications[settingKey];
      if (enabled === false) return ok();
    }
    let created: Notification | null = null;
    set((state) => {
      const now = dayjs();
      // 统一事件 ID 幂等去重：同一 eventId 只保留一条（邮件与站内通知共享该 ID）
      const nid =
        payload.eventId ?? `ntf-${now.valueOf()}-${Math.random().toString(36).slice(2, 6)}`;
      if (state.notifications.some((n) => n.id === nid)) return state;
      // 兼容旧流程：无 eventId 时按 inquiryId + type 在时间窗内去重
      if (!payload.eventId) {
        const dup = state.notifications.some(
          (n) =>
            n.type === payload.type &&
            n.inquiryId === payload.inquiryId &&
            now.diff(dayjs(n.time)) < DEDUP_WINDOW_MS,
        );
        if (dup) return state;
      }
      created = {
        id: nid,
        inquiryId: payload.inquiryId,
        type: payload.type,
        title: payload.title,
        content: payload.content,
        time: now.toISOString(),
        read: false,
      };
      const notifications = [created, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      saveJSON(STORAGE_KEY, notifications);
      return { notifications, unreadCount: state.unreadCount + 1 };
    });
    // 同步到 API，保证服务端也有该通知；失败返回其结果（本地已持久化）
    if (created) {
      try {
        await notificationApi.create(created);
        return ok();
      } catch (e) {
        return fail(e);
      }
    }
    return ok();
  },

  markRead: async (id) => {
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      saveJSON(STORAGE_KEY, notifications);
      return {
        notifications,
        unreadCount: Math.max(
          0,
          state.unreadCount - (state.notifications.find((n) => n.id === id && !n.read) ? 1 : 0),
        ),
      };
    });
    try {
      await notificationApi.markRead(id);
      return ok();
    } catch (e) {
      return fail(e);
    }
  },

  markAllRead: async () => {
    set((state) => {
      const notifications = state.notifications.map((n) => ({ ...n, read: true }));
      saveJSON(STORAGE_KEY, notifications);
      return { notifications, unreadCount: 0 };
    });
    try {
      await notificationApi.markAllRead();
      return ok();
    } catch (e) {
      return fail(e);
    }
  },

  getUnreadCount: () => get().notifications.filter((n) => !n.read).length,
}));
