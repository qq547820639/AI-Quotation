/**
 * Task 15.6：远程 AI 后端测试（mock HTTP 层）
 * 覆盖：发送前确认、敏感信息过滤、输出结构校验、客户端限流、AbortSignal 传递、
 * 以及 LocalRuleBackend 直接调用（无人为延迟）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { client } from '@/api/client';
import {
  LocalRuleBackend,
  RemoteAIBackend,
  RemoteAIConfirmationError,
  type RemoteAIBackendOptions,
  isValidAnomalyResult,
  isValidText,
} from '../aiService';

vi.mock('@/api/client', () => ({
  client: { post: vi.fn() },
}));

const post = vi.mocked(client.post);

function makeBackend(overrides: Partial<RemoteAIBackendOptions> = {}) {
  return new RemoteAIBackend({
    baseUrl: '/ai',
    timeoutMs: 1000,
    maxRequestsPerMinute: 1000,
    minIntervalMs: 0,
    ...overrides,
  });
}

describe('RemoteAIBackend', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('未获用户确认时拒绝发送数据并抛 RemoteAIConfirmationError', async () => {
    const backend = makeBackend();
    await expect(
      backend.analyzeQuotationAnomalies({} as never, {} as never),
    ).rejects.toBeInstanceOf(RemoteAIConfirmationError);
    expect(post).not.toHaveBeenCalled();
  });

  it('确认后发送脱敏负载并返回校验通过的异常结果', async () => {
    const backend = makeBackend();
    backend.setConfirmed(true);
    post.mockResolvedValue({ data: { summary: 'ok', hasAnomaly: false, anomalyCount: 0 } });

    const inquiry = {
      id: 'inq-1',
      items: [],
      password: 'secret',
      apiKey: 'key-123',
      contact: { password: 'x', phone: '13800000000' },
    } as never;
    const result = await backend.analyzeQuotationAnomalies(inquiry, {} as never);

    expect(result.hasAnomaly).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    const [path, payload] = post.mock.calls[0];
    expect(path).toBe('/ai/quotation-anomalies');
    expect((payload as { inquiry: Record<string, unknown> }).inquiry.password).toBeUndefined();
    expect((payload as { inquiry: Record<string, unknown> }).inquiry.apiKey).toBeUndefined();
    expect((payload as { inquiry: { contact: Record<string, unknown> } }).inquiry.contact.password).toBeUndefined();
    expect((payload as { inquiry: { contact: Record<string, unknown> } }).inquiry.contact.phone).toBe('13800000000');
  });

  it('异常结果结构非法时抛出错误', async () => {
    const backend = makeBackend();
    backend.setConfirmed(true);
    post.mockResolvedValue({ data: { some: 'garbage' } });
    await expect(
      backend.analyzeQuotationAnomalies({} as never, {} as never),
    ).rejects.toThrow();
  });

  it('超过每分钟限流阈值时抛出错误', async () => {
    const backend = makeBackend({ maxRequestsPerMinute: 1 });
    backend.setConfirmed(true);
    post.mockResolvedValue({ data: { summary: 'ok', hasAnomaly: false, anomalyCount: 0 } });

    await backend.analyzeQuotationAnomalies({} as never, {} as never);
    await expect(
      backend.analyzeQuotationAnomalies({} as never, {} as never),
    ).rejects.toThrow('rate limit');
  });

  it('向客户端传递 AbortSignal 以支持取消', async () => {
    const backend = makeBackend();
    backend.setConfirmed(true);
    post.mockResolvedValue({ data: { description: 'ok' } });

    await backend.generateInquiryDescription({ subject: 's', items: [] });
    const config = post.mock.calls[0][2] as { signal?: AbortSignal };
    expect(config.signal).toBeInstanceOf(AbortSignal);
  });

  it('结论生成返回校验通过的文本', async () => {
    const backend = makeBackend();
    backend.setConfirmed(true);
    post.mockResolvedValue({ data: { conclusion: 'recommend supplier A' } });

    const text = await backend.generateCompareConclusion({} as never, {} as never, []);
    expect(text).toBe('recommend supplier A');
  });
});

describe('LocalRuleBackend', () => {
  it('直接生成询价说明且无人为延迟', async () => {
    const backend = new LocalRuleBackend();
    const text = await backend.generateInquiryDescription({
      subject: '测试采购',
      items: [{ id: 'i1', inquiryId: 'q', name: '物料A', code: 'M1' } as never],
    });
    expect(text).toContain('测试采购');
    expect(text).toContain('物料A');
  });
});

describe('输出结构校验', () => {
  it('isValidAnomalyResult：合法结构通过', () => {
    expect(isValidAnomalyResult({ summary: 's', hasAnomaly: true, anomalyCount: 1 })).toBe(true);
  });

  it('isValidAnomalyResult：缺字段/类型错误时拒绝', () => {
    expect(isValidAnomalyResult({ summary: 's', hasAnomaly: true })).toBe(false);
    expect(isValidAnomalyResult({ summary: 's', hasAnomaly: 'yes', anomalyCount: 1 })).toBe(false);
    expect(isValidAnomalyResult({ summary: '', hasAnomaly: false, anomalyCount: 0 })).toBe(false);
    expect(isValidAnomalyResult(null)).toBe(false);
  });

  it('isValidText：非空字符串通过，否则拒绝', () => {
    expect(isValidText('ok')).toBe(true);
    expect(isValidText('')).toBe(false);
    expect(isValidText(123)).toBe(false);
    expect(isValidText(null)).toBe(false);
  });
});