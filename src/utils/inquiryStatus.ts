/**
 * 询价单状态判断工具（W10.3.1 抽取）
 * 从 inquiry/list 和 inquiry/detail 中提取的重复逻辑
 */
import { InquiryStatus } from '@/types';

/** 仅草稿/待发送状态可编辑 */
export function isEditable(status: InquiryStatus): boolean {
  return status === InquiryStatus.DRAFT || status === InquiryStatus.PENDING_SEND;
}

/** 非草稿/已完成/已取消状态可取消 */
export function isCancelable(status: InquiryStatus): boolean {
  return (
    status !== InquiryStatus.DRAFT &&
    status !== InquiryStatus.COMPLETED &&
    status !== InquiryStatus.CANCELLED
  );
}

/** 询价中状态（已发送/部分报价/全部报价） */
export function isInProgress(status: InquiryStatus): boolean {
  return (
    status === InquiryStatus.INQUIRING ||
    status === InquiryStatus.PARTIAL_QUOTED ||
    status === InquiryStatus.ALL_QUOTED
  );
}
