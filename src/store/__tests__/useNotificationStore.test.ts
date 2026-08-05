/**
 * useNotificationStore 测试（P2 Task 20）
 * - 统一事件 ID 幂等去重（邮件/站内共享）
 * - 旧流程 inquiryId+type 时间窗去重
 * - 单条已读 / 全部已读
 * - 类型偏好开关关闭时不写入
 * - 未读数维护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from '../useNotificationStore';
import { useSettingsStore } from '../useSettingsStore';
import { NotificationType } from '@/types';

vi.mock('@/api', () => ({
  notificationApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    markRead: vi.fn().mockResolvedValue({}),
    markAllRead: vi.fn().mockResolvedValue({}),
    getUnreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    getPreferences: vi.fn().mockResolvedValue({}),
    updatePreferences: vi.fn().mockResolvedValue({}),
  },
}));

function reset() {
  useNotificationStore.setState({ notifications: [], unreadCount: 0 });
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  // 恢复默认偏好
  useSettingsStore.setState({
    notifications: {
      inquirySent: true,
      quotationSubmitted: true,
      timeoutAlert: true,
      approval: true,
    },
  });
});

describe('addNotification 统一事件 ID 去重（Task 20）', () => {
  it('相同 eventId 只保留一条，避免重复通知', async () => {
    const payload = {
      eventId: 'evt-1',
      inquiryId: 'inq-1',
      type: NotificationType.QUOTATION_SUBMITTED,
      title: '报价已提交',
      content: '供应商A已报价',
    };
    await useNotificationStore.getState().addNotification(payload);
    await useNotificationStore.getState().addNotification(payload);
    const list = useNotificationStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('evt-1');
  });

  it('不同 eventId 各保留一条', async () => {
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-1',
      type: NotificationType.SYSTEM,
      title: 'A',
      content: '',
    });
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-2',
      type: NotificationType.SYSTEM,
      title: 'B',
      content: '',
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  });
});

describe('addNotification 旧流程时间窗去重', () => {
  it('无 eventId 时按 inquiryId+type 在时间窗内去重', async () => {
    const payload = {
      inquiryId: 'inq-1',
      type: NotificationType.INQUIRY_SENT,
      title: '询价已发送',
      content: '',
    };
    await useNotificationStore.getState().addNotification(payload);
    await useNotificationStore.getState().addNotification(payload);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('类型偏好开关关闭时不再写入（SYSTEM 除外）', async () => {
    useSettingsStore.setState({
      notifications: {
        inquirySent: false,
        quotationSubmitted: true,
        timeoutAlert: true,
        approval: true,
      },
    });
    await useNotificationStore.getState().addNotification({
      inquiryId: 'inq-1',
      type: NotificationType.INQUIRY_SENT,
      title: '询价已发送',
      content: '',
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});

describe('已读操作', () => {
  it('markRead 将指定通知置为已读并减少未读数', async () => {
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-1',
      type: NotificationType.SYSTEM,
      title: 'A',
      content: '',
    });
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    await useNotificationStore.getState().markRead('evt-1');
    const n = useNotificationStore.getState().notifications[0];
    expect(n.read).toBe(true);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('markAllRead 将全部置为已读', async () => {
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-1',
      type: NotificationType.SYSTEM,
      title: 'A',
      content: '',
    });
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-2',
      type: NotificationType.SYSTEM,
      title: 'B',
      content: '',
    });
    await useNotificationStore.getState().markAllRead();
    expect(useNotificationStore.getState().notifications.every((n) => n.read)).toBe(true);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});

describe('getUnreadCount', () => {
  it('返回未读通知数量', async () => {
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-1',
      type: NotificationType.SYSTEM,
      title: 'A',
      content: '',
    });
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-2',
      type: NotificationType.SYSTEM,
      title: 'B',
      content: '',
    });
    await useNotificationStore.getState().markRead('evt-1');
    expect(useNotificationStore.getState().getUnreadCount()).toBe(1);
  });
});
