/**
 * R62 步骤一：本机旧开关的一次性迁移。
 * 断言的形状来自它的两条边界——「只降不升」与「没搬成就不许解除抑制」；
 * 顺序上必须先有这一层，才谈得上把 addNotification 的并集收回成"只认偏好侧"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  getUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
  create: vi.fn(),
}));
vi.mock('@/api', () => ({ notificationApi: api }));

import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { NotificationType } from '@/types';
import type { UserNotificationPreferencesSchema } from '@/types';
import { saveJSON, loadJSON, removeKey } from '@/utils/storage';

const SERVER_ON = {
  deadlineReminder: true,
  deadlineReminderHours: 24,
  quotationSubmitted: true,
  approvalResult: true,
  inquirySent: true,
};
const FLAG = 'notify_pref_migrated_v1';
const PREFS_CACHE = 'user_notification_prefs';

beforeEach(() => {
  api.getPreferences.mockReset();
  api.updatePreferences.mockReset();
  expect(removeKey(FLAG).success).toBe(true);
  useNotificationStore.setState({ preferences: SERVER_ON, preferencesLoaded: false });
  useSettingsStore.setState({
    notifications: {
      inquirySent: true,
      quotationSubmitted: true,
      timeoutAlert: true,
      approval: true,
      todoReminder: false,
    },
  });
});

describe('本机通知开关的一次性迁移（R62 步骤一）', () => {
  it('① 本地关着、服务端开着 ⇒ 迁移把它推到服务端 false', async () => {
    api.getPreferences.mockResolvedValueOnce(SERVER_ON);
    api.updatePreferences.mockResolvedValueOnce({ ...SERVER_ON, inquirySent: false });
    useSettingsStore.setState((s) => ({
      notifications: { ...s.notifications, inquirySent: false },
    }));

    await useNotificationStore.getState().loadPreferences();

    expect(api.updatePreferences).toHaveBeenCalledTimes(1);
    expect(api.updatePreferences.mock.calls[0][0]).toMatchObject({ inquirySent: false });
    expect(loadJSON<boolean>(FLAG, false)).toBe(true);
  });

  it('② 服务端已经是 false ⇒ 绝不翻回 true（不许覆盖别的设备的真实关闭）', async () => {
    api.getPreferences.mockResolvedValueOnce({ ...SERVER_ON, quotationSubmitted: false });
    await useNotificationStore.getState().loadPreferences();
    expect(api.updatePreferences).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().preferences.quotationSubmitted).toBe(false);
  });

  it('③ 迁移 PUT 失败 ⇒ 不打标记、下次仍会试、也不许提前解除抑制', async () => {
    api.getPreferences.mockResolvedValueOnce(SERVER_ON);
    api.updatePreferences.mockResolvedValueOnce(undefined as never); // reject 分支靠 mockRejected
    api.updatePreferences.mockReset();
    api.updatePreferences.mockRejectedValueOnce(new Error('boom'));
    useSettingsStore.setState((s) => ({ notifications: { ...s.notifications, approval: false } }));

    await useNotificationStore.getState().loadPreferences();

    expect(loadJSON<boolean>(FLAG, false)).toBe(false);
    // 并集仍生效：设置侧的 false 依旧能抑制（这一格就是"搬家没搬成不许拆旧房子"的证据）
    const before = useNotificationStore.getState().notifications.length;
    await useNotificationStore.getState().addNotification({
      eventId: 'e-mig-1',
      type: NotificationType.APPROVAL,
      title: 't',
      content: '',
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(before);
  });

  it('⑤ 迁移被拒 ⇒ preferencesLoaded 收回假（"拿到了偏好"不等于"可以只认偏好侧"）', async () => {
    api.getPreferences.mockResolvedValueOnce({ ...SERVER_ON, deadlineReminderHours: 9 });
    api.updatePreferences.mockRejectedValueOnce(new Error('boom'));
    useSettingsStore.setState((s) => ({ notifications: { ...s.notifications, approval: false } }));
    await useNotificationStore.getState().loadPreferences();

    expect(loadJSON<boolean>(FLAG, false)).toBe(false);
    expect(useNotificationStore.getState().preferencesLoaded).toBe(false);
  });

  it('⑥ 成功取回偏好即写本机缓存（供离线启动当基线）', async () => {
    api.getPreferences.mockResolvedValueOnce({ ...SERVER_ON, inquirySent: false });
    await useNotificationStore.getState().loadPreferences();
    expect(
      loadJSON<UserNotificationPreferencesSchema>(PREFS_CACHE, { ...SERVER_ON }).inquirySent,
    ).toBe(false);
  });

  it('⑦ 缓存里有上次的真值时，store 初值用它是而不是全 true 默认（离线首启动）', async () => {
    expect(
      saveJSON<UserNotificationPreferencesSchema>(PREFS_CACHE, {
        ...SERVER_ON,
        approvalResult: false,
      }).success,
    ).toBe(true);
    vi.resetModules();
    const mod = await import('../useNotificationStore');
    expect(mod.useNotificationStore.getState().preferences.approvalResult).toBe(false);
  });

  it('④ 迁移只发生一次：标记已存在时不再发 PUT', async () => {
    expect(saveJSON(FLAG, true).success).toBe(true);
    api.getPreferences.mockResolvedValueOnce(SERVER_ON);
    useSettingsStore.setState((s) => ({
      notifications: { ...s.notifications, inquirySent: false },
    }));
    await useNotificationStore.getState().loadPreferences();
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });
});
