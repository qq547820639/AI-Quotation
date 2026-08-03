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
): { id: string; inquiryId: string; time: string; operator: string; operatorRole: string; type: LogType; content: string; result?: string } {
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
  http.get(`${baseUrl}/inquiries`, () => HttpResponse.json(inquiries)),

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
        serverLog(inquiries[idx].id, LogType.SUBMIT_APPROVAL, `提交审批，审批人：${supervisorUser.name}`),
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
        serverLog(inquiries[idx].id, LogType.APPROVE, `审批通过${body.comment ? `：${body.comment}` : ''}`, '已通过'),
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
        serverLog(inquiries[idx].id, LogType.REJECT, `审批驳回${body.comment ? `：${body.comment}` : ''}`, '已驳回'),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
  }),

  http.post(`${baseUrl}/inquiries/:id/confirm`, ({ params }) => {
    const idx = inquiries.findIndex((i) => i.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    inquiries[idx] = {
      ...inquiries[idx],
      status: InquiryStatus.COMPLETED,
      updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      logs: [
        ...inquiries[idx].logs,
        serverLog(inquiries[idx].id, LogType.CONFIRM_RESULT, '确认定标结果', '已完成'),
      ],
    };
    return HttpResponse.json(inquiries[idx]);
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
        serverLog(inquiries[idx].id, LogType.SEND_INQUIRY, `向 ${count} 家供应商发送询价`, '询价中'),
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
    notifications = notifications.map((n) =>
      n.id === params.id ? { ...n, read: true } : n,
    );
    return HttpResponse.json({ success: true });
  }),

  http.post(`${baseUrl}/notifications/read-all`, () => {
    notifications = notifications.map((n) => ({ ...n, read: true }));
    return HttpResponse.json({ success: true });
  }),

  // ===== 设置 =====
  http.get(`${baseUrl}/settings`, () => HttpResponse.json(settingsState)),

  http.put(`${baseUrl}/settings`, async ({ request }) => {
    const body = (await request.json()) as typeof settingsState;
    settingsState = { ...body };
    return HttpResponse.json(settingsState);
  }),
];
