/**
 * useBatchInquiries 测试（Task 19 批量操作）
 * 覆盖：执行前预览（可执行/跳过）、批量发送/提醒/导出/负责人调整、
 *       批量部分失败（逐条结果聚合）、权限由调用方控制（本 hook 不伪造成功）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchInquiries, aggregateBatchResults } from '../useBatchInquiries';
import { InquiryStatus, type Inquiry } from '@/types';

// vi.mock 会被提升，使用 vi.hoisted 确保 mock 函数在工厂内可用
const { sendMock, remindMock, exportMock, assignMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  remindMock: vi.fn(),
  exportMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock('@/api', () => ({
  inquiryApi: {
    batchSend: (...args: unknown[]) => sendMock(...args),
    batchRemind: (...args: unknown[]) => remindMock(...args),
    batchExport: (...args: unknown[]) => exportMock(...args),
    batchAssign: (...args: unknown[]) => assignMock(...args),
  },
}));

function makeInquiry(id: string, code: string, status: InquiryStatus): Inquiry {
  return {
    id,
    code,
    subject: `主题-${code}`,
    organization: 'org-1',
    ownerName: '张三',
    ownerId: 'u-1',
    currency: 'CNY' as Inquiry['currency'],
    deadline: '2026-08-10 00:00:00',
    deliveryAddress: '',
    contact: '',
    paymentTerms: '',
    attachments: [],
    items: [],
    invitedSupplierIds: [],
    quotations: [],
    logs: [],
    status,
    createdById: 'u-1',
    createdByName: '张三',
    createdAt: '2026-08-01 10:00:00',
    updatedAt: '2026-08-01 10:00:00',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBatchInquiries.preview（执行前预览）', () => {
  it('发送预览：DRAFT 可执行，非 DRAFT 跳过并给出原因', () => {
    const { result } = renderHook(() => useBatchInquiries());
    const source = [
      makeInquiry('a', 'INQ001', InquiryStatus.DRAFT),
      makeInquiry('b', 'INQ002', InquiryStatus.INQUIRING),
    ];
    const items = result.current.preview(['a', 'b'], 'send', source);
    expect(items[0]).toMatchObject({ id: 'a', executable: true });
    expect(items[1]).toMatchObject({ id: 'b', executable: false, reason: 'status_not_sendable' });
  });

  it('提醒/导出/负责人调整：存在即视为可执行', () => {
    const { result } = renderHook(() => useBatchInquiries());
    const source = [makeInquiry('a', 'INQ001', InquiryStatus.INQUIRING)];
    expect(result.current.preview(['a'], 'remind', source)[0].executable).toBe(true);
    expect(result.current.preview(['a'], 'export', source)[0].executable).toBe(true);
    expect(result.current.preview(['a'], 'assign', source)[0].executable).toBe(true);
  });

  it('不存在 id 预览为不可执行', () => {
    const { result } = renderHook(() => useBatchInquiries());
    const items = result.current.preview(['missing'], 'send', []);
    expect(items[0]).toMatchObject({ id: 'missing', executable: false, reason: 'not_found' });
  });
});

describe('useBatchInquiries 批量发送', () => {
  it('全成功：返回聚合结果并写入 lastResult', async () => {
    sendMock.mockResolvedValue({
      total: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
      results: [
        { id: 'a', success: true },
        { id: 'b', success: true },
      ],
    });
    const { result } = renderHook(() => useBatchInquiries());
    let out: Awaited<ReturnType<typeof result.current.batchSend>> | undefined;
    await act(async () => {
      out = await result.current.batchSend(['a', 'b']);
    });
    expect(out?.succeeded).toBe(2);
    expect(result.current.lastResult?.succeeded).toBe(2);
    expect(result.current.running).toBe(false);
  });

  it('批量部分失败：逐条结果保留失败原因，不伪造成功', async () => {
    sendMock.mockResolvedValue({
      total: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      results: [
        { id: 'a', success: true },
        { id: 'b', success: false, reason: 'status_not_sendable' },
        { id: 'c', success: false, skipped: true, reason: 'status_not_sendable' },
      ],
    });
    const { result } = renderHook(() => useBatchInquiries());
    await act(async () => {
      await result.current.batchSend(['a', 'b', 'c']);
    });
    const r = result.current.lastResult!;
    expect(r.succeeded).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.results.find((i) => i.id === 'b')?.reason).toBe('status_not_sendable');
  });

  it('API 抛错：running 复位且不写入 lastResult', async () => {
    sendMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useBatchInquiries());
    await act(async () => {
      await expect(result.current.batchSend(['a'])).rejects.toThrow('network down');
    });
    expect(result.current.running).toBe(false);
    expect(result.current.lastResult).toBeNull();
  });
});

describe('批量提醒 / 导出（后台队列）/ 负责人调整', () => {
  it('导出返回后台队列任务信息', async () => {
    exportMock.mockResolvedValue({
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [{ id: 'a', success: true, exportUrl: '/export?a' }],
      taskId: 'task-1',
      queued: true,
    });
    const { result } = renderHook(() => useBatchInquiries());
    await act(async () => {
      await result.current.batchExport(['a'], 'pdf');
    });
    expect(exportMock).toHaveBeenCalledWith(['a'], 'pdf');
    expect(result.current.lastResult?.queued).toBe(true);
    expect(result.current.lastResult?.taskId).toBe('task-1');
  });

  it('负责人调整与提醒正常调用', async () => {
    remindMock.mockResolvedValue({
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [{ id: 'a', success: true }],
    });
    assignMock.mockResolvedValue({
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [{ id: 'a', success: true }],
    });
    const { result } = renderHook(() => useBatchInquiries());
    await act(async () => {
      await result.current.batchRemind(['a']);
      await result.current.batchAssign(['a'], 'u-9', '李四');
    });
    expect(remindMock).toHaveBeenCalledWith(['a']);
    expect(assignMock).toHaveBeenCalledWith(['a'], 'u-9', '李四');
  });
});

describe('aggregateBatchResults（逐条结果聚合）', () => {
  it('正确统计成功/失败/跳过', () => {
    const stats = aggregateBatchResults([
      { id: 'a', success: true },
      { id: 'b', success: false, reason: 'x' },
      { id: 'c', success: false, skipped: true, reason: 'y' },
    ]);
    expect(stats).toEqual({ total: 3, succeeded: 1, failed: 1, skipped: 1 });
  });
});
