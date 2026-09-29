/**
 * R62 前置：写穿必须以"真的取回过偏好"为条件。
 * 没有这层旗标时，"合并当前 preferences 再 PUT"会在加载未完成/失败时
 * 拿前端默认值当基线，把服务端整份偏好刷成默认，而页面还弹"设置已保存"。
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

const SERVER_PREFS = {
  deadlineReminder: true,
  deadlineReminderHours: 24,
  quotationSubmitted: true,
  approvalResult: true,
  inquirySent: true,
};

beforeEach(() => {
  api.getPreferences.mockReset();
  api.updatePreferences.mockReset();
  useNotificationStore.setState({ preferences: SERVER_PREFS, preferencesLoaded: false });
});

describe('写穿的加载前置（R62）', () => {
  it('④ 偏好未取回时保存 ⇒ 拒绝、不发 PUT、preferences 不被默认值覆盖', async () => {
    const r = await useNotificationStore.getState().mergePreferences({ inquirySent: false });
    expect(r.success).toBe(false);
    expect(api.updatePreferences).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().preferences.inquirySent).toBe(true);
    expect(r.error?.message).toMatch(/尚未取到/);
  });

  it('⑤ 加载失败 ⇒ 旗标为假且调用方可观察（不再 catch{} 静默）', async () => {
    api.getPreferences.mockRejectedValueOnce(new Error('boom'));
    await useNotificationStore.getState().loadPreferences();
    expect(useNotificationStore.getState().preferencesLoaded).toBe(false);
  });

  it('正向对照：加载成功后写穿真的 PUT，且带的是合并结果', async () => {
    api.getPreferences.mockResolvedValueOnce({ ...SERVER_PREFS, deadlineReminderHours: 6 });
    await useNotificationStore.getState().loadPreferences();
    expect(useNotificationStore.getState().preferencesLoaded).toBe(true);
    api.updatePreferences.mockResolvedValueOnce({
      ...SERVER_PREFS,
      deadlineReminderHours: 6,
      inquirySent: false,
    });
    const r = await useNotificationStore.getState().mergePreferences({ inquirySent: false });
    expect(r.success).toBe(true);
    expect(api.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ deadlineReminderHours: 6, inquirySent: false }),
    );
  });
});
