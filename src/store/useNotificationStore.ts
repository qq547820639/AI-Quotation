/**
 * 通知 store
 * - 询价 / 报价 / 审批等流程节点联动写入通知
 * - 持久化到 localStorage（key: notifications）
 * - 同 inquiryId + type 在 10 分钟内去重，最多保留 100 条
 * - W6：写入前检查 useSettingsStore.notifications 开关，关闭的类型不写入
 */
import { create } from 'zustand';
import dayjs from 'dayjs';
import { NotificationType, type Notification } from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';
import { notificationApi } from '@/api';
import { useSettingsStore } from './useSettingsStore';
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
}

interface NotificationState {
  notifications: Notification[];
  /** W7.4：从 API 加载（失败时降级到 localStorage） */
  loadFromApi: () => Promise<void>;
  addNotification: (payload: NotificationPayload) => Promise<WriteResult>;
  markRead: (id: string) => Promise<WriteResult>;
  markAllRead: () => Promise<WriteResult>;
  getUnreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: loadJSON<Notification[]>(STORAGE_KEY, []),

  // W7.4：从 API 加载，合并本地独有通知（API 优先同 id），失败降级到 localStorage
  loadFromApi: async () => {
    try {
      const data = await notificationApi.list();
      set((state) => {
        const apiMap = new Map(data.map((n) => [n.id, n]));
        const localOnly = state.notifications.filter((n) => !apiMap.has(n.id));
        const merged = [...data, ...localOnly];
        saveJSON(STORAGE_KEY, merged);
        return { notifications: merged };
      });
    } catch {
      // API 不可用时保留 localStorage 数据
      set({ notifications: loadJSON<Notification[]>(STORAGE_KEY, []) });
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
      // 去重：同 inquiryId + type 在窗口内不重复
      const dup = state.notifications.some(
        (n) =>
          n.type === payload.type &&
          n.inquiryId === payload.inquiryId &&
          now.diff(dayjs(n.time)) < DEDUP_WINDOW_MS,
      );
      if (dup) return state;
      created = {
        id: `ntf-${now.valueOf()}-${Math.random().toString(36).slice(2, 6)}`,
        inquiryId: payload.inquiryId,
        type: payload.type,
        title: payload.title,
        content: payload.content,
        time: now.toISOString(),
        read: false,
      };
      const notifications = [created, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      saveJSON(STORAGE_KEY, notifications);
      return { notifications };
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
      return { notifications };
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
      return { notifications };
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
