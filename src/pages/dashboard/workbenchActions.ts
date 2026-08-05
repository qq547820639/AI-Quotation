/**
 * 行动工作台（P2 Task 14）纯计算模块
 * 注：文件名避免与 ActionWorkbench.tsx 在大小写不敏感文件系统（macOS）上冲突，
 *    原 actionWorkbench.ts 因与 ActionWorkbench.tsx 仅大小写不同导致 tsc 报错，故更名。
 * - 从 store 数据（询价 / 报价）计算各行动卡片的数量
 * - 提供负责人 / 时间范围筛选
 * - 拆分为纯函数以支持可靠的单元测试
 */
import { InquiryStatus, LogType, QuotationStatus, type Inquiry, type Quotation } from '@/types';
import { getRemainingTime } from '@/utils/format';

/** 行动卡片 key */
export type ActionKey =
  | 'pendingSend' // 待发送询价
  | 'deadlineApproaching' // 即将截止询价
  | 'unquotedSuppliers' // 尚未报价供应商
  | 'failedDeliveries' // 发送失败邀请
  | 'abnormalQuotations' // 异常报价
  | 'pendingApproval' // 待审批事项
  | 'approvalTimeout' // 即将超时审批
  | 'pendingConfirm'; // 待确认定标

/** 行动卡片数量结果 */
export type ActionCounts = Record<ActionKey, number>;

/** 工作台筛选条件 */
export interface ActionWorkbenchFilter {
  /** 负责人姓名（空 = 全部） */
  owner?: string;
  /** 创建时间范围起点 YYYY-MM-DD */
  dateFrom?: string | null;
  /** 创建时间范围终点 YYYY-MM-DD */
  dateTo?: string | null;
}

/** 是否判定为投递失败结果（用于从日志识别发送失败邀请） */
export function isFailureResult(result?: string): boolean {
  if (!result) return false;
  return /失败|投递失败|delivery.?fail|bounced|error/i.test(result);
}

/** 统计发送失败邀请数：含 SEND_INQUIRY 日志且结果标记为失败的询价单，其受邀供应商均计为失败 */
export function countFailedDeliveries(inquiries: Inquiry[]): number {
  let total = 0;
  inquiries.forEach((i) => {
    const failedLog = i.logs.find(
      (l) => l.type === LogType.SEND_INQUIRY && isFailureResult(l.result),
    );
    if (failedLog) total += i.invitedSupplierIds.length;
  });
  return total;
}

/** 按负责人过滤 */
export function filterByOwner(inquiries: Inquiry[], owner?: string): Inquiry[] {
  if (!owner) return inquiries;
  return inquiries.filter((i) => i.ownerName === owner);
}

/** 按创建时间范围过滤（半开区间：from <= t <= to） */
export function filterByDate(
  inquiries: Inquiry[],
  dateFrom?: string | null,
  dateTo?: string | null,
): Inquiry[] {
  return inquiries.filter((i) => {
    const t = new Date(i.createdAt).getTime();
    if (dateFrom && t < new Date(dateFrom).getTime()) return false;
    if (dateTo && t > new Date(dateTo).getTime()) return false;
    return true;
  });
}

/** 应用工作台筛选 */
export function applyWorkbenchFilter(
  inquiries: Inquiry[],
  filter: ActionWorkbenchFilter,
): Inquiry[] {
  return filterByDate(filterByOwner(inquiries, filter.owner), filter.dateFrom, filter.dateTo);
}

/** 唯一负责人选项（按出现顺序） */
export function getOwnerOptions(inquiries: Inquiry[]): string[] {
  return [...new Set(inquiries.map((i) => i.ownerName).filter(Boolean))];
}

/**
 * 计算 8 个行动卡片数量。
 * @param inquiries 已按组织/负责人/时间范围过滤后的询价单
 * @param quotations 全部报价（用于统计未报价供应商与异常报价）
 */
export function computeDashboardActions(
  inquiries: Inquiry[],
  quotations: Quotation[],
): ActionCounts {
  const pendingSend = inquiries.filter((i) => i.status === InquiryStatus.PENDING_SEND).length;

  // 进行中（询价中 / 部分报价）用于"即将截止"与"尚未报价"
  const active = inquiries.filter(
    (i) => i.status === InquiryStatus.INQUIRING || i.status === InquiryStatus.PARTIAL_QUOTED,
  );
  const deadlineApproaching = active.filter((i) => getRemainingTime(i.deadline).urgent).length;

  // 尚未报价供应商：进行中询价中，被邀请但未提交报价的供应商槽位累计
  let unquotedSuppliers = 0;
  active.forEach((i) => {
    const submitted = new Set(
      quotations
        .filter((q) => q.inquiryId === i.id && q.status === QuotationStatus.SUBMITTED)
        .map((q) => q.supplierId),
    );
    i.invitedSupplierIds.forEach((sid) => {
      if (!submitted.has(sid)) unquotedSuppliers++;
    });
  });

  const failedDeliveries = countFailedDeliveries(inquiries);

  // 异常报价：已超时的报价单
  const abnormalQuotations = quotations.filter((q) => q.status === QuotationStatus.TIMEOUT).length;

  // 待审批 / 即将超时审批
  const pendingApprovals = inquiries.filter((i) => i.status === InquiryStatus.PENDING_APPROVAL);
  const pendingApproval = pendingApprovals.length;
  const approvalTimeout = pendingApprovals.filter(
    (i) => getRemainingTime(i.deadline).urgent,
  ).length;

  const pendingConfirm = inquiries.filter((i) => i.status === InquiryStatus.PENDING_CONFIRM).length;

  return {
    pendingSend,
    deadlineApproaching,
    unquotedSuppliers,
    failedDeliveries,
    abnormalQuotations,
    pendingApproval,
    approvalTimeout,
    pendingConfirm,
  };
}
