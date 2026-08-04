/**
 * MSW 请求处理器（W7.3）
 * 拦截 API 请求并返回 mock 数据
 * 复用 src/mock/* 中的静态数据
 * W7.6：移除 as never，显式类型注解；inquiry 写操作补齐服务端状态更新
 */
import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';
import { inquiries as mockInquiries } from '@/mock/inquiries';
import { suppliers as mockSuppliers } from '@/mock/suppliers';
import { materials as mockMaterials } from '@/mock/materials';
import { quotations as mockQuotations } from '@/mock/quotations';
import { users, currentUser, supervisorUser } from '@/mock/users';
import {
  ApprovalNodeStatus,
  CooperationStatus,
  InquiryStatus,
  LogType,
  QuotationStatus,
  type ApprovalNode,
  type Inquiry,
  type Material,
  type Notification,
  type Quotation,
  type Supplier,
} from '@/types';

// 内存中的数据副本（模拟服务端数据，支持增删改）
let inquiries: Inquiry[] = [...mockInquiries];
let suppliers: Supplier[] = [...mockSuppliers];
let materials: Material[] = [...mockMaterials];
let quotations: Quotation[] = [...mockQuotations];
// 通知：运行时由客户端 POST 写入，初始为空（与真实后端一致：服务端存储通知）
let notifications: Notification[] = [];
// 用户级表格偏好（P2-12 Task 17）：按 pageKey 持久化，模拟服务端存储
const tablePreferences: Record<string, Record<string, unknown>> = {};
// 报价快照（P2-12 Task 17）：定标确认时冻结，不可变
const quotationSnapshots: Record<string, Array<Record<string, unknown>>> = {};

// 设置：内存持久化（与真实后端 AppSettings 单行表对齐）
let settingsState = {
  approval: {
    enabled: true,
    amountThreshold: 50000,
    approverId: supervisorUser.id,
  },
  notification: {
    deadlineReminder: true,
    deadlineReminderHours: 24,
    quotationSubmitted: true,
    approvalResult: true,
  },
};

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

/** 生成服务端日志条目 */
function serverLog(
  inquiryId: string,
  type: LogType,
  content: string,
  result?: string,
): {
  id: string;
  inquiryId: string;
  time: string;
  operator: string;
  operatorRole: string;
  type: LogType;
  content: string;
  result?: string;
} {
  return {
    id: `log-${inquiryId}-${dayjs().valueOf()}`,
    inquiryId,
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    operator: currentUser.name,
    operatorRole: currentUser.role,
    type,
    content,
    result,
  };
}

// ===== 供应商门户 portal API（邀请令牌模式）=====
// 预定义的测试邀请（根据任务描述种子）
const portalInvitations: Record<
  string,
  {
    status: 'valid' | 'submitted' | 'revoked' | 'expired';
    invitationId: string;
    inquiryId: string;
    inquiryCode: string;
    supplierId: string;
    supplierName: string;
    deadline: string;
    expiresAt: string;
  }
> = {
  'inv-token-inq3-sup2-000000000000000000000000000000000000000000000000': {
    status: 'valid',
    invitationId: 'inv-inq3-sup2',
    inquiryId: 'inq-3',
    inquiryCode: 'INQ20260801003',
    supplierId: 'sup-2',
    supplierName: '华为技术有限公司',
    deadline: dayjs().add(7, 'day').format('YYYY-MM-DD 18:00:00'),
    expiresAt: dayjs().add(14, 'day').format('YYYY-MM-DD 18:00:00'),
  },
  'inv-token-inq3-sup5-000000000000000000000000000000000000000000000000': {
    status: 'submitted',
    invitationId: 'inv-inq3-sup5',
    inquiryId: 'inq-3',
    inquiryCode: 'INQ20260801003',
    supplierId: 'sup-5',
    supplierName: '中兴通讯股份有限公司',
    deadline: dayjs().add(7, 'day').format('YYYY-MM-DD 18:00:00'),
    expiresAt: dayjs().add(14, 'day').format('YYYY-MM-DD 18:00:00'),
  },
  'inv-token-inq7-sup2-000000000000000000000000000000000000000000000000': {
    status: 'valid',
    invitationId: 'inv-inq7-sup2',
    inquiryId: 'inq-7',
    inquiryCode: 'INQ20260803001',
    supplierId: 'sup-2',
    supplierName: '华为技术有限公司',
    deadline: dayjs().subtract(1, 'day').format('YYYY-MM-DD 18:00:00'),
    expiresAt: dayjs().subtract(1, 'day').format('YYYY-MM-DD 18:00:00'),
  },
};

// 内存草稿（每个邀请令牌一个草稿）
interface PortalDraftItem {
  id: string;
  inquiryItemId: string;
  quotationId: string;
  name?: string;
  unitPrice?: number;
  quantity?: number;
  taxRate?: number;
  taxIncludedTotal: number;
  [key: string]: unknown;
}

interface PortalDraft {
  id: string;
  inquiryId: string;
  supplierId: string;
  supplierName: string;
  status: 'DRAFT' | 'SUBMITTED';
  submittedAt: string | null;
  totalAmount: number;
  remark?: string;
  items: PortalDraftItem[];
  attachments: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface PortalDraftBody {
  remark?: string;
  items: Array<{
    inquiryItemId: string;
    unitPrice?: number;
    [key: string]: unknown;
  }>;
}

const portalDrafts: Record<string, PortalDraft> = {};

export const handlers = [
  // ===== 认证 =====
  http.post(`${baseUrl}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { userId: string };
    const user = users.find((u) => u.id === body.userId) ?? currentUser;
    return HttpResponse.json({ user, token: 'mock-token-' + user.id });
  }),

  http.post(`${baseUrl}/auth/logout`, () => HttpResponse.json({ success: true })),

  http.get(`${baseUrl}/auth/me`, () => HttpResponse.json(currentUser)),

  // ===== 询价单 =====
  http.get(`${baseUrl}/inquiries`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '');
    const keyword = url.searchParams.get('keyword');
    const statusStr = url.searchParams.get('status');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const sort = url.searchParams.get('sort');

    // P2-12 Task 17：无分页参数时向后兼容返回全量列表
    if (!page || !pageSize) {
      return HttpResponse.json(inquiries);
    }

    // 筛选
    let list = [...inquiries];
    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter(
        (i) =>
          i.code.toLowerCase().includes(kw) ||
          i.subject.toLowerCase().includes(kw) ||
          (i.ownerName ?? '').toLowerCase().includes(kw),
      );
    }
    if (statusStr) {
      const statuses = statusStr.split(',');
      list = list.filter((i) => statuses.includes(i.status));
    }
    if (dateFrom) {
      list = list.filter((i) => (i.createdAt ?? '').slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((i) => (i.createdAt ?? '').slice(0, 10) <= dateTo);
    }

    // 排序（仅支持 createdAt/updatedAt 的 asc/desc）
    if (sort) {
      const [field, dir] = sort.split(':');
      const desc = dir === 'desc';
      list.sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[field] ?? '';
        const bv = (b as unknown as Record<string, unknown>)[field] ?? '';
        if (typeof av === 'string' && typeof bv === 'string') {
          return desc ? bv.localeCompare(av) : av.localeCompare(bv);
        }
        return desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
      });
    }

    const total = list.length;
    const items = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ items, total, page, pageSize });
  }),

  http.get(`${baseUrl}/inquiries/:id`, ({ params }) => {
    const inquiry = inquiries.find((i) => i.id === params.id);
    if (!inquiry) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(inquiry);
  }),

  http.post(`${baseUrl}/inquiries`, async ({ request }) => {
    const body = (await request.json()) as Inquiry;
    inquiries = [body, ...inquiries];
    return HttpResponse.json(body);
  }),

  http.put(`${baseUrl}/inquiries/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<Inquiry>;
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    inquiries[idx] = {
      ...inquiries[idx],
      ...body,
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  http.delete(`${baseUrl}/inquiries/:id`, ({ params }) => {
    inquiries = inquiries.filter((i) => i.id !== params.id);
    return HttpResponse.json({ success: true });
  }),

  http.post(`${baseUrl}/inquiries/:id/submit-approval`, ({ params }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const node: ApprovalNode = {
      id: `apv-${inquiries[idx].id}-${dayjs().valueOf()}`,
      inquiryId: inquiries[idx].id,
      nodeOrder: 1,
      approverId: supervisorUser.id,
      approverName: supervisorUser.name,
      approverRole: supervisorUser.role,
      status: ApprovalNodeStatus.PENDING,
    };
    inquiries[idx] = {
      ...inquiries[idx],
      status: InquiryStatus.PENDING_APPROVAL,
      approvalNodes: [...inquiries[idx].approvalNodes, node],
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      logs: [
        ...inquiries[idx].logs,
        serverLog(
          inquiries[idx].id,
          LogType.SUBMIT_APPROVAL,
          `提交审批，审批人：${supervisorUser.name}`,
        ),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  http.post(`${baseUrl}/inquiries/:id/approve`, async ({ params, request }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    inquiries[idx] = {
      ...inquiries[idx],
      status: InquiryStatus.PENDING_CONFIRM,
      approvalNodes: inquiries[idx].approvalNodes.map((n) =>
        n.status === ApprovalNodeStatus.PENDING
          ? { ...n, status: ApprovalNodeStatus.APPROVED, comment: body.comment, time: nowStr }
          : n,
      ),
      updatedAt: nowStr,
      logs: [
        ...inquiries[idx].logs,
        serverLog(
          inquiries[idx].id,
          LogType.APPROVE,
          `审批通过${body.comment ? `：${body.comment}` : ''}`,
          '已通过',
        ),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  http.post(`${baseUrl}/inquiries/:id/reject`, async ({ params, request }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    inquiries[idx] = {
      ...inquiries[idx],
      status: InquiryStatus.PENDING_CONFIRM,
      approvalNodes: inquiries[idx].approvalNodes.map((n) =>
        n.status === ApprovalNodeStatus.PENDING
          ? { ...n, status: ApprovalNodeStatus.REJECTED, comment: body.comment, time: nowStr }
          : n,
      ),
      updatedAt: nowStr,
      logs: [
        ...inquiries[idx].logs,
        serverLog(
          inquiries[idx].id,
          LogType.REJECT,
          `审批驳回${body.comment ? `：${body.comment}` : ''}`,
          '已驳回',
        ),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  http.post(`${baseUrl}/inquiries/:id/confirm`, ({ params }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    // P2-12 Task 17：定标确认时冻结报价快照（不可变）
    const inquiry = inquiries[idx];
    quotationSnapshots[inquiry.id] = [
      {
        id: `snap-${inquiry.id}-${dayjs().valueOf()}`,
        inquiryId: inquiry.id,
        inquiryCode: inquiry.code,
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        createdBy: currentUser.id,
        createdByName: currentUser.name,
        snapshot: {
          status: inquiry.status,
          quotationCount: quotations.filter(
            (q) => q.inquiryId === inquiry.id && q.status === QuotationStatus.SUBMITTED,
          ).length,
          frozenAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        },
      },
      ...(quotationSnapshots[inquiry.id] ?? []),
    ];
    inquiries[idx] = {
      ...inquiry,
      status: InquiryStatus.COMPLETED,
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      logs: [
        ...inquiry.logs,
        serverLog(inquiry.id, LogType.CONFIRM_RESULT, '确认定标结果', '已完成'),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  // P2-12 Task 17：报价不可变快照列表
  http.get(`${baseUrl}/inquiries/:id/snapshots`, ({ params }) => {
    return HttpResponse.json(quotationSnapshots[params.id as string] ?? []);
  }),

  // P2-12 Task 17：服务端导出（模拟返回文件流，前端据此触发下载）
  http.post(`${baseUrl}/inquiries/:id/export`, async ({ params, request }) => {
    const inquiry = inquiries.find((i) => i.id === params.id);
    if (!inquiry) return new HttpResponse(null, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { format?: string };
    const format = body.format === 'xlsx' ? 'xlsx' : 'pdf';
    const filename = `${inquiry.code}.${format}`;
    const blob = new Blob([`${inquiry.code} ${inquiry.subject} - ${format}`, 'utf-8'], {
      type:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
    });
    return new HttpResponse(blob, {
      headers: {
        'Content-Type': blob.type,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }),

  http.post(`${baseUrl}/inquiries/:id/cancel`, ({ params }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    inquiries[idx] = {
      ...inquiries[idx],
      status: InquiryStatus.CANCELLED,
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      logs: [
        ...inquiries[idx].logs,
        serverLog(inquiries[idx].id, LogType.CANCEL, '取消询价单', '已取消'),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  http.post(`${baseUrl}/inquiries/:id/send`, ({ params }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const count = inquiries[idx].invitedSupplierIds.length;
    inquiries[idx] = {
      ...inquiries[idx],
      status: InquiryStatus.INQUIRING,
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      logs: [
        ...inquiries[idx].logs,
        serverLog(
          inquiries[idx].id,
          LogType.SEND_INQUIRY,
          `向 ${count} 家供应商发送询价`,
          '询价中',
        ),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  // ===== 供应商 =====
  http.get(`${baseUrl}/suppliers`, () => HttpResponse.json(suppliers)),

  http.get(`${baseUrl}/suppliers/:id`, ({ params }) => {
    const supplier = suppliers.find((s) => s.id === params.id);
    if (!supplier) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(supplier);
  }),

  http.post(`${baseUrl}/suppliers`, async ({ request }) => {
    const body = (await request.json()) as Supplier;
    const newSupplier: Supplier = { ...body, id: `sup-${Date.now()}` };
    suppliers = [newSupplier, ...suppliers];
    return HttpResponse.json(newSupplier);
  }),

  http.put(`${baseUrl}/suppliers/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<Supplier>;
    const idx = suppliers.findIndex((s) => s.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    suppliers[idx] = { ...suppliers[idx], ...body };
    return HttpResponse.json(suppliers[idx]);
  }),

  http.delete(`${baseUrl}/suppliers/:id`, ({ params }) => {
    suppliers = suppliers.filter((s) => s.id !== params.id);
    return HttpResponse.json({ success: true });
  }),

  http.post(`${baseUrl}/suppliers/:id/toggle-status`, ({ params }) => {
    const idx = suppliers.findIndex((s) => s.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const isDisabled = suppliers[idx].cooperationStatus === CooperationStatus.DISABLED;
    suppliers[idx] = {
      ...suppliers[idx],
      cooperationStatus: isDisabled ? CooperationStatus.COOPERATING : CooperationStatus.DISABLED,
    };
    return HttpResponse.json(suppliers[idx]);
  }),

  // ===== 物料 =====
  http.get(`${baseUrl}/materials`, () => HttpResponse.json(materials)),

  http.get(`${baseUrl}/materials/:id`, ({ params }) => {
    const material = materials.find((m) => m.id === params.id);
    if (!material) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(material);
  }),

  http.post(`${baseUrl}/materials`, async ({ request }) => {
    const body = (await request.json()) as Material;
    const newMaterial: Material = { ...body, id: `mat-${Date.now()}` };
    materials = [newMaterial, ...materials];
    return HttpResponse.json(newMaterial);
  }),

  http.put(`${baseUrl}/materials/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<Material>;
    const idx = materials.findIndex((m) => m.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    materials[idx] = { ...materials[idx], ...body };
    return HttpResponse.json(materials[idx]);
  }),

  http.delete(`${baseUrl}/materials/:id`, ({ params }) => {
    materials = materials.filter((m) => m.id !== params.id);
    return HttpResponse.json({ success: true });
  }),

  http.post(`${baseUrl}/materials/batch`, async ({ request }) => {
    const body = (await request.json()) as { items: Material[] };
    let count = 0;
    for (const item of body.items) {
      const existIdx = materials.findIndex((m) => m.code === item.code);
      if (existIdx !== -1) {
        // upsert：按 code 覆盖
        materials[existIdx] = { ...materials[existIdx], ...item };
      } else {
        materials = [{ ...item, id: `mat-${Date.now()}-${count}` }, ...materials];
      }
      count++;
    }
    return HttpResponse.json({ success: count });
  }),

  // ===== 报价单 =====
  http.get(`${baseUrl}/quotations`, () => HttpResponse.json(quotations)),

  http.get(`${baseUrl}/inquiries/:inquiryId/quotations`, ({ params }) => {
    const list = quotations.filter((q) => q.inquiryId === params.inquiryId);
    return HttpResponse.json(list);
  }),

  http.get(`${baseUrl}/quotations/:id`, ({ params }) => {
    const quotation = quotations.find((q) => q.id === params.id);
    if (!quotation) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(quotation);
  }),

  http.post(`${baseUrl}/quotations`, async ({ request }) => {
    const body = (await request.json()) as Quotation;
    const newQuotation: Quotation = { ...body, id: body.id ?? `q-${Date.now()}` };
    quotations = [newQuotation, ...quotations];
    return HttpResponse.json(newQuotation);
  }),

  http.put(`${baseUrl}/quotations/:id/draft`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<Quotation>;
    const idx = quotations.findIndex((q) => q.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    quotations[idx] = { ...quotations[idx], ...body };
    return HttpResponse.json(quotations[idx]);
  }),

  http.post(`${baseUrl}/quotations/:id/submit`, ({ params }) => {
    const idx = quotations.findIndex((q) => q.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    quotations[idx] = {
      ...quotations[idx],
      status: QuotationStatus.SUBMITTED,
      submittedAt: nowStr,
      updatedAt: nowStr,
    };
    return HttpResponse.json(quotations[idx]);
  }),

  // ===== 通知 =====
  http.get(`${baseUrl}/notifications`, () => HttpResponse.json(notifications)),

  http.post(`${baseUrl}/notifications`, async ({ request }) => {
    const body = (await request.json()) as Partial<Notification>;
    const notification: Notification = {
      id: body.id ?? `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      inquiryId: body.inquiryId,
      type: body.type!,
      title: body.title ?? '',
      content: body.content ?? '',
      time: body.time ?? new Date().toISOString(),
      read: false,
    };
    notifications = [notification, ...notifications].slice(0, 100);
    return HttpResponse.json(notification);
  }),

  http.post(`${baseUrl}/notifications/:id/read`, ({ params }) => {
    notifications = notifications.map((n) => (n.id === params.id ? { ...n, read: true } : n));
    return HttpResponse.json({ success: true });
  }),

  http.post(`${baseUrl}/notifications/read-all`, () => {
    notifications = notifications.map((n) => ({ ...n, read: true }));
    return HttpResponse.json({ success: true });
  }),

  // ===== 设置 =====
  http.get(`${baseUrl}/settings`, () => HttpResponse.json(settingsState)),

  http.post(`${baseUrl}/settings`, async ({ request }) => {
    const body = (await request.json()) as typeof settingsState;
    settingsState = { ...body };
    return HttpResponse.json(settingsState);
  }),

  // ===== 用户表格偏好（P2-12 Task 17）=====
  http.get(`${baseUrl}/users/table-preferences/:pageKey`, ({ params }) => {
    const data = tablePreferences[params.pageKey as string];
    return HttpResponse.json({ pageKey: params.pageKey, data: data ?? null });
  }),

  http.put(`${baseUrl}/users/table-preferences/:pageKey`, async ({ params, request }) => {
    const body = (await request.json()) as { pageKey: string; data: Record<string, unknown> };
    tablePreferences[body.pageKey || (params.pageKey as string)] = body.data ?? {};
    return HttpResponse.json({
      pageKey: body.pageKey || (params.pageKey as string),
      data: tablePreferences[body.pageKey || (params.pageKey as string)],
    });
  }),

  http.get(`${baseUrl}/portal/invitations/validate`, ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token || !portalInvitations[token]) {
      return new HttpResponse(null, { status: 401 });
    }
    return HttpResponse.json(portalInvitations[token]);
  }),

  http.get(`${baseUrl}/portal/inquiries`, ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token) return new HttpResponse(null, { status: 401 });
    const inv = token ? portalInvitations[token] : null;
    if (!inv) return new HttpResponse(null, { status: 401 });

    // 返回模拟询价（不包含 targetPrice）
    const mockInquiry = {
      id: inv.inquiryId,
      code: inv.inquiryCode,
      subject: '服务器设备采购询价',
      organization: '总部数据中心',
      currency: 'CNY',
      deadline: inv.deadline,
      expectedDeliveryDate: dayjs().add(30, 'day').format('YYYY-MM-DD'),
      deliveryAddress: '上海市浦东新区张江高科技园区',
      contact: '张经理',
      paymentTerms: '货到验收后 30 天付款',
      invoiceRequirement: '增值税专用发票',
      description: '本次采购为数据中心扩容项目，请按要求报价',
      status: 'INQUIRING',
      items: [
        {
          id: 'item-1',
          inquiryItemId: 'item-1',
          name: '机架式服务器',
          code: 'SRV-001',
          category: '服务器',
          brand: '',
          spec: '2U 机架式，双路 CPU',
          techParams: '32核 2.5GHz，128GB DDR4，2*4TB SATA',
          unit: '台',
          quantity: 8,
          expectedDeliveryDate: dayjs().add(30, 'day').format('YYYY-MM-DD'),
          remark: '',
          attachments: [],
        },
        {
          id: 'item-2',
          inquiryItemId: 'item-2',
          name: '网络交换机',
          code: 'SW-001',
          category: '网络设备',
          brand: '',
          spec: '48口万兆交换机',
          techParams: 'L3 交换，支持 VLAN',
          unit: '台',
          quantity: 2,
          expectedDeliveryDate: dayjs().add(30, 'day').format('YYYY-MM-DD'),
          remark: '',
          attachments: [],
        },
      ],
      attachments: [],
    };
    return HttpResponse.json(mockInquiry);
  }),

  http.get(`${baseUrl}/portal/quotations/current`, ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token) return new HttpResponse(null, { status: 401 });
    const inv = token ? portalInvitations[token] : null;
    if (!inv) return new HttpResponse(null, { status: 401 });
    const draft = portalDrafts[token];
    return HttpResponse.json(draft || null);
  }),

  http.put(`${baseUrl}/portal/quotations/draft`, async ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token) return new HttpResponse(null, { status: 401 });
    const inv = token ? portalInvitations[token] : null;
    if (!inv) return new HttpResponse(null, { status: 401 });
    const body = (await request.json()) as PortalDraftBody;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    // 计算总价（服务器端 recompute）
    let totalAmount = 0;
    const items = body.items.map((item) => {
      const qty = inv.inquiryId === 'inq-3' && item.inquiryItemId === 'item-1' ? 8 : 2;
      const total = (item.unitPrice || 0) * qty;
      totalAmount += total;
      return {
        id: `qi-${inv.inquiryId}-${inv.supplierId}-${item.inquiryItemId}`,
        quotationId: `quo-${token}`,
        ...item,
        taxIncludedTotal: total,
      };
    });
    const draft: PortalDraft = {
      id: `quo-${token}`,
      inquiryId: inv.inquiryId,
      supplierId: inv.supplierId,
      supplierName: inv.supplierName,
      status: 'DRAFT',
      submittedAt: null,
      totalAmount: Number(totalAmount.toFixed(2)),
      remark: body.remark,
      items,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
    portalDrafts[token] = draft;
    return HttpResponse.json(draft);
  }),

  http.post(`${baseUrl}/portal/quotations/submit`, async ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token) return new HttpResponse(null, { status: 401 });
    const inv = token ? portalInvitations[token] : null;
    if (!inv) return new HttpResponse(null, { status: 401 });
    const body = (await request.json()) as PortalDraftBody;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    // 计算总价
    let totalAmount = 0;
    body.items.forEach((item) => {
      const qty = inv.inquiryId === 'inq-3' && item.inquiryItemId === 'item-1' ? 8 : 2;
      totalAmount += (item.unitPrice || 0) * qty;
    });
    totalAmount = Number(totalAmount.toFixed(2));
    // 更新邀请状态为已提交
    if (portalInvitations[token]) {
      portalInvitations[token].status = 'submitted';
    }
    const receipt = {
      quotationId: `quo-${token}`,
      inquiryId: inv.inquiryId,
      supplierId: inv.supplierId,
      supplierName: inv.supplierName,
      submittedAt: now,
      totalAmount,
      receiptCode: `RCP-${inv.inquiryCode}-${inv.supplierId}`,
      status: 'SUBMITTED' as const,
    };
    // 保存为已提交
    const draft = portalDrafts[token];
    portalDrafts[token] = {
      ...draft,
      status: 'SUBMITTED',
      submittedAt: now,
      totalAmount,
      items: body.items.map((item) => {
        const qty = inv.inquiryId === 'inq-3' && item.inquiryItemId === 'item-1' ? 8 : 2;
        return {
          id: `qi-${inv.inquiryId}-${inv.supplierId}-${item.inquiryItemId}`,
          quotationId: `quo-${token}`,
          ...item,
          taxIncludedTotal: (item.unitPrice || 0) * qty,
        };
      }),
      remark: body.remark,
      updatedAt: now,
    };
    return HttpResponse.json(receipt);
  }),

  http.post(`${baseUrl}/portal/quotations/revise`, ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token) return new HttpResponse(null, { status: 401 });
    const inv = token ? portalInvitations[token] : null;
    if (!inv) return new HttpResponse(null, { status: 401 });
    const draft = portalDrafts[token];
    if (!draft) return new HttpResponse(null, { status: 404 });
    // 允许重新报价：改回 DRAFT
    draft.status = 'DRAFT';
    portalDrafts[token] = draft;
    portalInvitations[token].status = 'valid';
    return HttpResponse.json(draft);
  }),

  http.get(`${baseUrl}/portal/quotations/receipt`, ({ request }) => {
    const token = request.headers.get('X-Invitation-Token');
    if (!token) return new HttpResponse(null, { status: 401 });
    const inv = token ? portalInvitations[token] : null;
    if (!inv) return new HttpResponse(null, { status: 401 });
    const draft = portalDrafts[token];
    if (!draft || draft.status !== 'SUBMITTED') return new HttpResponse(null, { status: 404 });
    const receipt = {
      quotationId: draft.id,
      inquiryId: draft.inquiryId,
      supplierId: draft.supplierId,
      supplierName: draft.supplierName,
      submittedAt: draft.submittedAt || dayjs().format('YYYY-MM-DD HH:mm:ss'),
      totalAmount: draft.totalAmount,
      receiptCode: `RCP-${inv.inquiryCode}-${inv.supplierId}`,
      status: 'SUBMITTED' as const,
    };
    return HttpResponse.json(receipt);
  }),

  http.post(`${baseUrl}/portal/attachments`, async () => {
    // MSW 不支持 multipart 轻松解析，模拟上传成功
    const attachmentId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return HttpResponse.json({
      id: attachmentId,
      name: 'uploaded-file.pdf',
      url: `${baseUrl}/portal/attachments/${attachmentId}/download`,
      size: 1024 * 1024,
      uploadTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
  }),

  http.delete(`${baseUrl}/portal/attachments/:attachmentId`, () => {
    return HttpResponse.json({ success: true });
  }),
];
