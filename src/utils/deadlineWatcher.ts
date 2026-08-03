/**
 * 截止时间监听器（W6）
 * - 扫描询价中/部分已报价的询价单，对即将截止的生成通知
 * - 在 App 挂载时执行一次，并每 5 分钟轮询一次
 * - 通知去重由 useNotificationStore 的 10 分钟窗口保证
 */
import dayjs from 'dayjs';
import { InquiryStatus, NotificationType } from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

/** 扫描一次即将截止的询价单并写入通知 */
export function scanDeadlines(): void {
  const { notifications } = useSettingsStore.getState();
  if (notifications.timeoutAlert === false) return;

  const thresholdHours = useSettingsStore.getState().timeoutThresholdHours;
  const inquiries = useInquiryStore.getState().inquiries;
  const addNotification = useNotificationStore.getState().addNotification;
  const now = dayjs();

  for (const inq of inquiries) {
    if (inq.status !== InquiryStatus.INQUIRING && inq.status !== InquiryStatus.PARTIAL_QUOTED) {
      continue;
    }
    const end = dayjs(inq.deadline);
    if (!end.isValid()) continue;
    const diffHours = end.diff(now, 'hour', true);
    // 已过期或超出阈值，跳过
    if (diffHours <= 0 || diffHours > thresholdHours) continue;

    addNotification({
      inquiryId: inq.id,
      type: NotificationType.DEADLINE_APPROACHING,
      title: `询价单 ${inq.code} 即将截止`,
      content: `${inq.subject}（剩余 ${Math.ceil(diffHours)} 小时）`,
    });
  }
}

/** 启动截止监听（App 挂载时调用） */
export function startDeadlineWatcher(): () => void {
  // 首次延迟 3 秒执行，避免与初始化竞争
  const initialTimer = setTimeout(scanDeadlines, 3000);
  timer = setInterval(scanDeadlines, POLL_INTERVAL_MS);
  return () => {
    clearTimeout(initialTimer);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
