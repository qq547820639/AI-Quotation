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
/** R62：一次性迁移标记（成功搬完才置真；搬失败保持假，下次仍会重试） */
const MIGRATION_FLAG = 'notify_pref_migrated_v1';
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

/**
 * 通知类型 → 每用户偏好字段（R62）。
 * 这张表存在的理由是**两侧名字不同源**：设置侧叫 `timeoutAlert`/`approval`，
 * 偏好侧（服务端 `user_notification_preferences` 的真列）叫 `deadlineReminder`/`approvalResult`。
 * 用名字对名字会静默错配两类，所以按语义逐条写死，并由用例分别钉住。
 */
const TYPE_TO_PREF_KEY: Partial<Record<NotificationType, keyof UserNotificationPreferencesSchema>> =
  {
    [NotificationType.INQUIRY_SENT]: 'inquirySent',
    [NotificationType.QUOTATION_SUBMITTED]: 'quotationSubmitted',
    [NotificationType.DEADLINE_APPROACHING]: 'deadlineReminder',
    [NotificationType.APPROVAL]: 'approvalResult',
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
  /** R62 前置：`preferences` 是否真从服务端取回来过。没有这层旗标，
   *  任何"合并当前偏好再 PUT"的写路径都会拿前端默认值当基线，把服务端整份刷成默认。 */
  preferencesLoaded: boolean;
  /** R62：设置页通知卡的写穿入口；未加载成功时**拒绝**而不是拿默认值合并 */
  mergePreferences: (patch: Partial<UserNotificationPreferencesSchema>) => Promise<WriteResult>;
  /** R62 步骤一：本机旧开关的一次性迁移（只降不升；失败不打标记） */
  migrateLocalNotificationToggles: (
    current: UserNotificationPreferencesSchema,
  ) => Promise<WriteResult>;
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
  preferencesLoaded: false,

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
      set({ preferences: prefs, preferencesLoaded: true });
      // R62 步骤①（只改这一件事）：`preferencesLoaded` 的含义是"可以只认偏好侧"，
      // 而本机已关的位还没搬成功时它并不成立 ⇒ 迁移没确认完成就把旗标收回假。
      // 注意：这一步**不**改变抑制行为（并集仍在），所以现有用例不该因此变动。
      // 先落这一行、单独跑测，再谈"不挪 set""加缓存"，避免一次改两件事。
      // R62 步骤一：先搬家，再拆旧房子。
      // 设置页那张卡在 fda48eb 之前只把开关写进 localStorage，服务端对应位仍是 true；
      // 若此刻就收回并集（只认偏好侧），这些用户已关的抑制会无声消失——又是一次"主张与凭据脱钩"。
      // 因此：只降不升（把本地显式 false 推到服务端），成功才打一次性标记，失败不打标记、下次再试。
      const migrated = await get().migrateLocalNotificationToggles(prefs);
      if (!migrated.success) set({ preferencesLoaded: false });
    } catch {
      // 保留默认值，但**不再静默**：旗标留假，写穿路径据此拒绝保存（R62 前置）。
      set({ preferencesLoaded: false });
    }
  },

  /**
   * R62 步骤一：把"只存在于本机"的关闭动作一次性搬到每用户偏好。
   * 三条边界：只 true→false（绝不把服务端的 false 翻回 true，那会覆盖别的设备的真实关闭）；
   * 成功后才写标记（标记 = `notify_pref_migrated_v1`），失败不写 ⇒ 下次还会试，抑制不会提前解除；
   * 本地没有任何显式关闭时也要打标记（否则每次都白跑一趟）。
   */
  migrateLocalNotificationToggles: async (current) => {
    const done = loadJSON<boolean>(MIGRATION_FLAG, false);
    if (done) return ok();
    const local = useSettingsStore.getState().notifications;
    const patch: Partial<UserNotificationPreferencesSchema> = {};
    if (local.inquirySent === false && current.inquirySent) patch.inquirySent = false;
    if (local.quotationSubmitted === false && current.quotationSubmitted)
      patch.quotationSubmitted = false;
    if (local.approval === false && current.approvalResult) patch.approvalResult = false;
    if (local.timeoutAlert === false && current.deadlineReminder) patch.deadlineReminder = false;
    if (Object.keys(patch).length) {
      const r = await get().updatePreferences({ ...current, ...patch });
      if (!r.success) return r; // 没搬成就不打标记：并集判断继续兜着，不许静默解除抑制
    }
    saveJSON(MIGRATION_FLAG, true);
    return ok();
  },

  // R62：设置页那张卡改成写穿到每用户偏好（同一概念此前有两处入口，且服务端那侧从没被真正写过）。
  mergePreferences: async (patch) => {
    if (!get().preferencesLoaded) return fail(new Error('尚未取到服务端的偏好，请稍后重试'));
    return get().updatePreferences({ ...get().preferences, ...patch });
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
    // W6 + R62：抑制取两处的"任一为关即关"——每用户偏好（服务端入库那侧）与设置页开关（本机那侧）。
    // 为什么不一次把权威搬走：搬走 = 用户在设置页关过的开关静默失效（本机值不再被读），
    // 而偏好侧那几位在此之前从来没被读过；两边都不是用户此刻理解的"我关过的那个"。
    // 先让入库的值真的有消费者（R61 的第一层缺陷），UI 合并留作单独一片。
    const settingKey = TYPE_TO_SETTING_KEY[payload.type];
    if (settingKey && useSettingsStore.getState().notifications[settingKey] === false) return ok();
    const prefKey = TYPE_TO_PREF_KEY[payload.type];
    if (prefKey && get().preferences[prefKey] === false) return ok();
    let created: Notification | null = null;
    let createdId: string | undefined;
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
      createdId = nid;
      const notifications = [created, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      saveJSON(STORAGE_KEY, notifications);
      return { notifications, unreadCount: state.unreadCount + 1 };
    });
    // 同步到 API，保证服务端也有该通知
    if (created) {
      try {
        await notificationApi.create(created);
        return ok();
      } catch (e) {
        // R42：服务端没接受这条，就得把它占的未读位一起撤回。留在原地会造出一个
        // "幽灵行"——loadFromApi 的合并规则（localOnly 原样保留）会把它永久养着，
        // 而 refreshUnreadCount 又按服务端计数 ⇒ 角标与列表自相矛盾。
        // 只撤这一条、不整体回滚数组：并发的别条写入不该被这次失败连带丢掉。
        const id = createdId;
        set((state) => {
          const target = state.notifications.find((n) => n.id === id);
          if (!target) return state;
          const notifications = state.notifications.filter((n) => n.id !== id);
          saveJSON(STORAGE_KEY, notifications);
          return {
            notifications,
            unreadCount: target.read ? state.unreadCount : Math.max(0, state.unreadCount - 1),
          };
        });
        return fail(e);
      }
    }
    return ok();
  },

  markRead: async (id) => {
    // 乐观置已读之前的快照：服务端拒绝时要按它回滚（R40）
    const prevNotifications = get().notifications;
    const prevUnread = get().unreadCount;
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
      // 服务端没接受这次已读 ⇒ 界面不得继续声称"已读"。
      // 回滚放在被调用方而不是三个调用点：调用方一律丢弃 WriteResult，
      // 只在调用点补提示等于留两处会忘；放在这里，丢弃结果的调用点也自动不再说谎。
      set({ notifications: prevNotifications, unreadCount: prevUnread });
      saveJSON(STORAGE_KEY, prevNotifications);
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
