/**
 * useNotificationStore 测试（P2 Task 20）
 * - 统一事件 ID 幂等去重（邮件/站内共享）
 * - 旧流程 inquiryId+type 时间窗去重
 * - 单条已读 / 全部已读
 * - 类型偏好开关关闭时不写入
 * - 未读数维护
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNotificationStore } from '../useNotificationStore';
import { useSettingsStore } from '../useSettingsStore';
import { NotificationType } from '@/types';
import { notificationApi } from '@/api';

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

/**
 * R62：服务端入库的那份每用户偏好此前**零消费者**（列写全了没人读）。
 * 这里量的就是它开始起作用，且两侧名字不同源的那两对必须各自钉住——
 * 靠名字对齐的写法会静默错配 DEADLINE_APPROACHING 与 APPROVAL 两类。
 */
const DEFAULT_PREFS_FOR_TEST = {
  deadlineReminder: true,
  deadlineReminderHours: 24,
  quotationSubmitted: true,
  approvalResult: true,
  inquirySent: true,
};

describe('通知抑制也读每用户偏好（R62，偏好侧与设置侧任一为关即抑制）', () => {
  const payload = (type: NotificationType, eventId: string) => ({
    eventId,
    type,
    title: 't',
    content: '',
  });
  const allOnSettings = {
    inquirySent: true,
    quotationSubmitted: true,
    timeoutAlert: true,
    todoReminder: false,
    approval: true,
  };

  afterEach(() => {
    useNotificationStore.setState({
      preferences: { ...DEFAULT_PREFS_FOR_TEST },
    });
    useSettingsStore.setState({ notifications: { ...allOnSettings } });
  });

  it('偏好侧 inquirySent=false ⇒ INQUIRY_SENT 不写入（改前这一格必红：偏好从来没被读）', async () => {
    useNotificationStore.setState({
      preferences: { ...DEFAULT_PREFS_FOR_TEST, inquirySent: false },
    });
    await useNotificationStore
      .getState()
      .addNotification(payload(NotificationType.INQUIRY_SENT, 'e-pref-1'));
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('别名映射：偏好侧关的是 deadlineReminder，抑制的必须是 DEADLINE_APPROACHING', async () => {
    useNotificationStore.setState({
      preferences: { ...DEFAULT_PREFS_FOR_TEST, deadlineReminder: false },
    });
    await useNotificationStore
      .getState()
      .addNotification(payload(NotificationType.DEADLINE_APPROACHING, 'e-pref-2'));
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('别名映射第二对：偏好侧 approvalResult=false 抑制 APPROVAL', async () => {
    useNotificationStore.setState({
      preferences: { ...DEFAULT_PREFS_FOR_TEST, approvalResult: false },
    });
    await useNotificationStore
      .getState()
      .addNotification(payload(NotificationType.APPROVAL, 'e-pref-3'));
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('两侧都开 ⇒ 照写（对照组，防"永远抑制"也能让上面三格绿）', async () => {
    await useNotificationStore
      .getState()
      .addNotification(payload(NotificationType.INQUIRY_SENT, 'e-pref-4'));
    expect(useNotificationStore.getState().notifications.map((n) => n.id)).toContain('e-pref-4');
  });

  it('本机设置侧关掉仍然抑制（既有行为不得因这次改动回退）', async () => {
    useSettingsStore.setState({ notifications: { ...allOnSettings, quotationSubmitted: false } });
    await useNotificationStore
      .getState()
      .addNotification(payload(NotificationType.QUOTATION_SUBMITTED, 'e-pref-5'));
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

  it('markRead 被服务端拒绝时回滚乐观状态（R40：调用方丢弃结果也不得让界面说谎）', async () => {
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-rb',
      type: NotificationType.SYSTEM,
      title: 'R',
      content: '',
    });
    expect(useNotificationStore.getState().unreadCount).toBe(1);

    const api = vi.mocked(notificationApi.markRead);
    api.mockRejectedValueOnce(new Error('500 boom'));
    const r = await useNotificationStore.getState().markRead('evt-rb');

    expect(r.success).toBe(false);
    // 关键面：界面不得保留"已读"。这条单独存在时可能是假的——若乐观写从没生效，
    // 它也会"通过"，所以下面同一份代码再验一次成功路径确实会置已读。
    expect(useNotificationStore.getState().notifications[0].read).toBe(false);
    expect(useNotificationStore.getState().unreadCount).toBe(1);

    // 正向对照：成功路径必须仍然落地
    api.mockResolvedValueOnce({} as never);
    const r2 = await useNotificationStore.getState().markRead('evt-rb');
    expect(r2.success).toBe(true);
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('addNotification 被服务端拒绝时撤回该条与其未读位（R42：幽灵行会被合并规则永久养着）', async () => {
    const api = vi.mocked(notificationApi.create);
    const ids = () => useNotificationStore.getState().notifications.map((n) => n.id);

    // 极性 A（不开火则下面全是空转）：成功路径必须真的写入
    api.mockResolvedValueOnce({} as never);
    const okRes = await useNotificationStore.getState().addNotification({
      eventId: 'evt-keep',
      type: NotificationType.SYSTEM,
      title: 'K',
      content: '',
    });
    expect(okRes.success).toBe(true);
    expect(ids()).toEqual(['evt-keep']);
    expect(useNotificationStore.getState().unreadCount).toBe(1);

    // 极性 B：服务端 500 ⇒ 该条连同它占的未读位一起撤回，localStorage 也要跟着撤
    api.mockRejectedValueOnce(new Error('500 boom'));
    const badRes = await useNotificationStore.getState().addNotification({
      eventId: 'evt-ghost',
      type: NotificationType.SYSTEM,
      title: 'G',
      content: '',
    });
    expect(badRes.success).toBe(false);
    expect(ids()).toEqual(['evt-keep']);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    // localStorage 侧：saveJSON 的键带 procurement_ 前缀、值带 {v:2,data} 信封
    // （`src/utils/storage.ts:4,36-39`）。按裸键名读会得到 null，断言就退化成"两个空数组相等"。
    const stored = JSON.parse(localStorage.getItem('procurement_notifications') ?? 'null') as {
      v: number;
      data: { id: string }[];
    } | null;
    expect(stored).not.toBeNull();
    expect(stored!.v).toBe(2);
    expect(stored!.data.map((n) => n.id)).toEqual(['evt-keep']);
  });

  it('R42 撤回只撤失败的那一条，不得连带丢掉等待期间的并发写入', async () => {
    const api = vi.mocked(notificationApi.create);
    let rejectSlow: (e: unknown) => void = () => {};
    api.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSlow = reject;
        }),
    );

    const inflight = useNotificationStore.getState().addNotification({
      eventId: 'evt-slow',
      type: NotificationType.SYSTEM,
      title: 'S',
      content: '',
    });
    api.mockResolvedValueOnce({} as never);
    await useNotificationStore.getState().addNotification({
      eventId: 'evt-fast',
      type: NotificationType.SYSTEM,
      title: 'F',
      content: '',
    });
    // 慢的那条此刻仍在飞，快的已经落地：两条都在列表里、未读位为 2
    expect(useNotificationStore.getState().notifications.map((n) => n.id)).toEqual([
      'evt-fast',
      'evt-slow',
    ]);
    expect(useNotificationStore.getState().unreadCount).toBe(2);

    rejectSlow(new Error('500 boom'));
    expect((await inflight).success).toBe(false);
    expect(useNotificationStore.getState().notifications.map((n) => n.id)).toEqual(['evt-fast']);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
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
