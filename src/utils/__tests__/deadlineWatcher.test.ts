/**
 * deadlineWatcher 测试（阶段 1.5）
 * 覆盖 scanDeadlines 的阈值过滤、状态过滤、通知触发
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import dayjs from 'dayjs';
import { scanDeadlines } from '../deadlineWatcher';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { InquiryStatus, NotificationType, type Inquiry } from '@/types';

/** 生成相对当前时间偏移 hours 小时的本地时间字符串（与 dayjs 解析口径一致） */
function futureStr(hours: number): string {
  return dayjs().add(hours, 'hour').format('YYYY-MM-DD HH:mm:ss');
}

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ20260801001',
    subject: '测试',
    organization: '总部',
    ownerName: '采购员',
    ownerId: 'u-1',
    currency: 'CNY' as never,
    deadline: '',
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [],
    invitedSupplierIds: [],
    quotations: [],
    logs: [],
    status: InquiryStatus.INQUIRING,
    createdById: 'u-1',
    createdByName: '采购员',
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
    ...overrides,
  };
}

beforeEach(() => {
  // 重置 settings：启用 timeoutAlert，阈值 24h
  useSettingsStore.setState({
    timeoutThresholdHours: 24,
    notifications: { timeoutAlert: true },
  });
  useInquiryStore.setState({ inquiries: [], loaded: true });
});

describe('scanDeadlines', () => {
  it('设置关闭 timeoutAlert 时不发送通知', () => {
    useSettingsStore.setState({ notifications: { timeoutAlert: false } });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('INQUIRING 状态 + 剩余 < 阈值 → 发送 DEADLINE_APPROACHING 通知', () => {
    // 截止时间设为 10 小时后（< 24h 阈值）
    const future = futureStr(10);
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'inq-soon', status: InquiryStatus.INQUIRING, deadline: future })],
    });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        inquiryId: 'inq-soon',
        type: NotificationType.DEADLINE_APPROACHING,
      }),
    );
  });

  it('PARTIAL_QUOTED 状态也参与扫描', () => {
    const future = futureStr(5);
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({ id: 'inq-partial', status: InquiryStatus.PARTIAL_QUOTED, deadline: future }),
      ],
    });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).toHaveBeenCalled();
  });

  it('DRAFT/COMPLETED 等非进行中状态不扫描', () => {
    const future = futureStr(5);
    useInquiryStore.setState({
      inquiries: [
        makeInquiry({ id: 'inq-draft', status: InquiryStatus.DRAFT, deadline: future }),
        makeInquiry({ id: 'inq-done', status: InquiryStatus.COMPLETED, deadline: future }),
      ],
    });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('剩余时间 > 阈值不发送通知', () => {
    // 截止时间设为 48 小时后（> 24h 阈值）
    const future = futureStr(48);
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'inq-far', status: InquiryStatus.INQUIRING, deadline: future })],
    });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('已过期（diffHours <= 0）不发送通知', () => {
    // 截止时间设为过去
    const past = futureStr(-1);
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'inq-expired', status: InquiryStatus.INQUIRING, deadline: past })],
    });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('无效截止时间跳过', () => {
    useInquiryStore.setState({
      inquiries: [makeInquiry({ id: 'inq-invalid', status: InquiryStatus.INQUIRING, deadline: 'not-a-date' })],
    });
    const addNotification = vi
      .spyOn(useNotificationStore.getState(), 'addNotification')
      .mockImplementation(() => {});
    scanDeadlines();
    expect(addNotification).not.toHaveBeenCalled();
  });
});
