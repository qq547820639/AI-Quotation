/**
 * 仪表盘聚合 API（R107）
 *
 * 存在理由：行动工作台的 8 个卡片计数原来由前端在两份全量集合上算
 * （`GET /api/inquiries` 无参 + `GET /api/quotations` 无参）。脏库实测
 * 那条全量列表自己就占 2.6 s（R105 四），首张卡片延迟被推到 3.3 s 级。
 * 这里改成一次聚合请求：只回 8 个整数、负责人选项与总数。
 */
import { client } from './client';

/** 与 backend/app/schemas.py 的 DashboardWorkbenchSchema 对应 */
export interface WorkbenchSummary {
  pendingSend: number;
  deadlineApproaching: number;
  unquotedSuppliers: number;
  failedDeliveries: number;
  abnormalQuotations: number;
  pendingApproval: number;
  approvalTimeout: number;
  pendingConfirm: number;
  /** 该用户可见范围内的负责人选项（不随 owner/日期参数收窄） */
  owners: string[];
  /** 范围内的询价单条数，用于空态判定 */
  total: number;
}

export interface WorkbenchQuery {
  owner?: string;
  dateFrom?: string;
  dateTo?: string;
  organization?: string;
}

export const dashboardApi = {
  workbench: (query: WorkbenchQuery = {}): Promise<WorkbenchSummary> =>
    client.get<WorkbenchSummary>('/dashboard/workbench', { params: query }).then((r) => r.data),
};
