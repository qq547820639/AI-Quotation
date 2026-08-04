/**
 * AI 智能服务（W9 + Task 15）
 * - 通过统一的 AIBackend 接口抽象 AI 能力
 * - LocalRuleBackend：本地规则引擎（离线/演示/降级兜底），不产生人为延迟
 * - RemoteAIBackend：调用远程 HTTP 端点（需通过环境变量显式开启，默认关闭）
 * - 对外保持原有函数签名不变（generateInquiryDescription / analyzeQuotationAnomalies / generateCompareConclusion）
 * - 文案经 i18n 国际化，随当前语言变化
 */
import { client } from '@/api/client';
import i18n from '@/i18n';
import {
  type Inquiry,
  type InquiryItem,
} from '@/types';
import {
  type CompareData,
  type SupplierQuoteRow,
  getAvgUnitPrice,
  getMinUnitPrice,
  getQuotationItem,
  isHighPrice,
  isLowPrice,
} from '@/components/quotation/scoreUtils';
import { formatCurrency } from './format';

/* ==================== 类型定义 ==================== */

export interface InquiryDescriptionParams {
  subject: string;
  items: InquiryItem[];
  paymentTerms?: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
}

export interface AnomalyAnalysisResult {
  /** 分析摘要文本 */
  summary: string;
  /** 是否发现异常 */
  hasAnomaly: boolean;
  /** 异常数 */
  anomalyCount: number;
}

/** AI 后端模式：local=本地规则（默认），remote=远程 AI */
export type AIBackendMode = 'local' | 'remote';

/** AI 后端健康状态 */
export type AIBackendHealth = 'ok' | 'degraded';

/** 对外展示的运行状态：local / remote / degraded / unavailable */
export type AIBackendStatus = 'local' | 'remote' | 'degraded' | 'unavailable';

/** AI 后端统一接口 */
export interface AIBackend {
  generateInquiryDescription(params: InquiryDescriptionParams): Promise<string>;
  analyzeQuotationAnomalies(
    inquiry: Inquiry,
    data: CompareData,
    rows?: SupplierQuoteRow[],
  ): Promise<AnomalyAnalysisResult>;
  generateCompareConclusion(
    inquiry: Inquiry,
    data: CompareData,
    rows: SupplierQuoteRow[],
  ): Promise<string>;
}

/* ==================== 输出结构校验（Task 15.4） ==================== */

/** 校验异常分析结果结构（必须含 summary/hasAnomaly/anomalyCount） */
export function isValidAnomalyResult(value: unknown): value is AnomalyAnalysisResult {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.summary === 'string' &&
    o.summary.length > 0 &&
    typeof o.hasAnomaly === 'boolean' &&
    typeof o.anomalyCount === 'number' &&
    Number.isInteger(o.anomalyCount) &&
    o.anomalyCount >= 0
  );
}

/** 校验生成的文本结果（非空字符串） */
export function isValidText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/* ==================== 1. LocalRuleBackend（本地规则引擎） ==================== */

/**
 * 本地规则引擎：离线/演示/降级兜底实现。
 * 同步计算逻辑，不包含人为延迟（不产生虚假的"AI 思考中"等待）。
 */
export class LocalRuleBackend implements AIBackend {
  async generateInquiryDescription(params: InquiryDescriptionParams): Promise<string> {
    const { subject, items, paymentTerms, deliveryAddress, expectedDeliveryDate } = params;
    const lines: string[] = [];
    const sep = i18n.t('ai.separator');

    lines.push(i18n.t('ai.desc.overviewTitle'));
    lines.push(i18n.t('ai.desc.overviewIntro', { subject, count: items.length }));

    // 物料品类汇总
    const categories = [...new Set(items.map((i) => i.category))].filter(Boolean);
    if (categories.length) {
      lines.push(``);
      lines.push(i18n.t('ai.desc.categoryTitle'));
      lines.push(i18n.t('ai.desc.categoryIntro', { categories: categories.join(sep) }));
    }

    // 关键物料
    const keyItems = items.slice(0, 3);
    if (keyItems.length) {
      lines.push(``);
      lines.push(i18n.t('ai.desc.keyItemsTitle'));
      keyItems.forEach((item, idx) => {
        const parts = [`${item.name}（${item.code}）`];
        if (item.brand) parts.push(i18n.t('ai.desc.brandPart', { brand: item.brand }));
        if (item.spec) parts.push(i18n.t('ai.desc.specPart', { spec: item.spec }));
        parts.push(i18n.t('ai.desc.qtyPart', { quantity: item.quantity, unit: item.unit }));
        if (item.targetPrice) parts.push(i18n.t('ai.desc.targetPricePart', { price: formatCurrency(item.targetPrice) }));
        lines.push(i18n.t('ai.desc.itemLine', { index: idx + 1, parts: parts.join(sep) }));
      });
      if (items.length > 3) {
        lines.push(i18n.t('ai.desc.moreItems', { count: items.length }));
      }
    }

    // 交付要求
    lines.push(``);
    lines.push(i18n.t('ai.desc.deliveryTitle'));
    if (expectedDeliveryDate) {
      lines.push(i18n.t('ai.desc.expectedDelivery', { date: expectedDeliveryDate }));
    }
    if (deliveryAddress) {
      lines.push(i18n.t('ai.desc.deliveryAddress', { address: deliveryAddress }));
    }
    lines.push(i18n.t('ai.desc.genuineRequirement'));

    // 商务要求
    if (paymentTerms) {
      lines.push(``);
      lines.push(i18n.t('ai.desc.commercialTitle'));
      lines.push(i18n.t('ai.desc.paymentTerms', { terms: paymentTerms }));
    }

    lines.push(``);
    lines.push(i18n.t('ai.desc.quoteTitle'));
    lines.push(i18n.t('ai.desc.quoteReq1'));
    lines.push(i18n.t('ai.desc.quoteReq2'));
    lines.push(i18n.t('ai.desc.quoteReq3'));

    return lines.join('\n');
  }

  async analyzeQuotationAnomalies(
    inquiry: Inquiry,
    data: CompareData,
    // rows 保留用于未来扩展（如供应商维度异常），当前分析基于 data.submittedRows
    _rows?: SupplierQuoteRow[],
  ): Promise<AnomalyAnalysisResult> {
    const anomalies: string[] = [];

    // 1. 单价异常（偏高/偏低）
    for (const item of inquiry.items) {
      const avg = getAvgUnitPrice(data.submittedRows, item.id);
      if (avg === undefined) continue;
      for (const r of data.submittedRows) {
        const qi = getQuotationItem(r, item.id);
        if (!qi) continue;
        if (isHighPrice(qi.unitPrice, avg)) {
          anomalies.push(
            i18n.t('ai.anomaly.highPrice', {
              item: item.name,
              supplier: r.supplier.name,
              price: formatCurrency(qi.unitPrice, inquiry.currency),
              avg: formatCurrency(avg, inquiry.currency),
            }),
          );
        } else if (isLowPrice(qi.unitPrice, avg)) {
          anomalies.push(
            i18n.t('ai.anomaly.lowPrice', {
              item: item.name,
              supplier: r.supplier.name,
              price: formatCurrency(qi.unitPrice, inquiry.currency),
              avg: formatCurrency(avg, inquiry.currency),
            }),
          );
        }
      }
    }

    // 2. 总价离散度分析
    if (data.submittedRows.length >= 3) {
      const totals = data.submittedRows.map((r) => r.totalAmount);
      const max = Math.max(...totals);
      const min = Math.min(...totals);
      if (min > 0) {
        const spread = ((max - min) / min) * 100;
        if (spread > 40) {
          anomalies.push(
            i18n.t('ai.anomaly.spread', { spread: spread.toFixed(1) }),
          );
        }
      }
    }

    // 3. 交货周期异常
    if (data.submittedRows.length >= 2) {
      const deliveries = data.submittedRows.map((r) => r.avgDeliveryDays).filter((d) => d > 0);
      if (deliveries.length >= 2) {
        const maxD = Math.max(...deliveries);
        const minD = Math.min(...deliveries);
        if (minD > 0 && maxD / minD > 2) {
          anomalies.push(
            i18n.t('ai.anomaly.delivery', { fastest: minD.toFixed(0), slowest: maxD.toFixed(0) }),
          );
        }
      }
    }

    // 4. 技术偏离提示
    const techDeviations = data.submittedRows.filter((r) => r.techDeviations.length > 0);
    if (techDeviations.length) {
      anomalies.push(
        i18n.t('ai.anomaly.techDeviation', { count: techDeviations.length }),
      );
    }

    // 5. 超目标价/预算提示（Task 11.4：即便最低报价也超过目标价时应提示）
    for (const item of inquiry.items) {
      if (item.targetPrice == null) continue;
      const minPrice = getMinUnitPrice(data.submittedRows, item.id);
      if (minPrice !== undefined && minPrice > item.targetPrice) {
        anomalies.push(
          i18n.t('ai.anomaly.overBudget', {
            item: item.name,
            price: formatCurrency(minPrice, inquiry.currency),
            budget: formatCurrency(item.targetPrice, inquiry.currency),
          }),
        );
      }
    }

    const hasAnomaly = anomalies.length > 0;
    const summary = hasAnomaly
      ? i18n.t('ai.anomaly.summaryWithAnomaly', {
          count: anomalies.length,
          items: anomalies.map((a) => `· ${a}`).join('\n'),
        })
      : i18n.t('ai.anomaly.summaryNoAnomaly');

    return {
      summary,
      hasAnomaly,
      anomalyCount: anomalies.length,
    };
  }

  async generateCompareConclusion(
    inquiry: Inquiry,
    data: CompareData,
    rows: SupplierQuoteRow[],
  ): Promise<string> {
    const lines: string[] = [];
    const submittedCount = data.submittedRows.length;
    const invitedCount = inquiry.invitedSupplierIds.length;

    lines.push(i18n.t('ai.conclusion.title'));
    lines.push(``);

    // 1. 报价回收情况
    lines.push(i18n.t('ai.conclusion.recovery', {
      invited: invitedCount,
      submitted: submittedCount,
      rate: invitedCount > 0 ? Math.round((submittedCount / invitedCount) * 100) : 0,
    }));

    // 2. 价格分析
    if (data.lowestTotalSupplierId) {
      const r = rows.find((x) => x.supplier.id === data.lowestTotalSupplierId);
      if (r) {
        lines.push(``);
        lines.push(i18n.t('ai.conclusion.priceAnalysis', {
          supplier: r.supplier.name,
          amount: formatCurrency(r.totalAmount, inquiry.currency),
        }));
        if (data.submittedRows.length >= 2) {
          const sorted = [...data.submittedRows].sort((a, b) => a.totalAmount - b.totalAmount);
          const second = sorted[1];
          const diff = second.totalAmount - r.totalAmount;
          const diffPct = r.totalAmount > 0 ? (diff / r.totalAmount) * 100 : 0;
          lines.push(i18n.t('ai.conclusion.diffToSecond', {
            amount: formatCurrency(diff, inquiry.currency),
            pct: diffPct.toFixed(1),
          }));
        }
      }
    }

    // 3. 综合评分
    if (data.topScoreSupplierId) {
      const r = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
      const s = data.scores[data.topScoreSupplierId];
      if (r && s) {
        lines.push(``);
        lines.push(i18n.t('ai.conclusion.scoreAnalysis', {
          supplier: r.supplier.name,
          total: s.total.toFixed(2),
        }));
        lines.push(i18n.t('ai.conclusion.scoreBreakdown', {
          price: s.price.toFixed(1),
          delivery: s.delivery.toFixed(1),
          level: s.level.toFixed(1),
          fulfillment: s.fulfillment.toFixed(1),
        }));
        lines.push(i18n.t('ai.conclusion.supplierLevel', {
          level: i18n.t(`enum.supplierLevel.${r.supplier.level}`),
          rate: (r.supplier.historyFulfillmentRate * 100).toFixed(1),
        }));
      }
    }

    // 4. 交货能力
    if (data.fastestDeliverySupplierId) {
      const r = rows.find((x) => x.supplier.id === data.fastestDeliverySupplierId);
      if (r) {
        lines.push(``);
        lines.push(i18n.t('ai.conclusion.deliveryAbility', {
          supplier: r.supplier.name,
          days: r.avgDeliveryDays.toFixed(1),
        }));
      }
    }

    // 5. 定标建议
    lines.push(``);
    lines.push(i18n.t('ai.conclusion.awardTitle'));
    if (data.topScoreSupplierId) {
      const topRow = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
      const lowRow = data.lowestTotalSupplierId
        ? rows.find((x) => x.supplier.id === data.lowestTotalSupplierId)
        : undefined;
      const topScore = data.scores[data.topScoreSupplierId]?.total ?? 0;
      const lowScore = lowRow ? (data.scores[lowRow.supplier.id]?.total ?? 0) : 0;
      if (topRow) {
        if (topRow.supplier.id === data.lowestTotalSupplierId) {
          lines.push(i18n.t('ai.conclusion.recommendBest', { supplier: topRow.supplier.name }));
        } else if (lowRow) {
          const scoreDiff = topScore - lowScore;
          const priceDiff = topRow.totalAmount - lowRow.totalAmount;
          lines.push(i18n.t('ai.conclusion.scoreLead', {
            supplierA: topRow.supplier.name,
            supplierB: lowRow.supplier.name,
            diff: scoreDiff.toFixed(1),
            amount: formatCurrency(priceDiff, inquiry.currency),
          }));
          lines.push(i18n.t('ai.conclusion.budgetOrQuality', {
            budgetSupplier: lowRow.supplier.name,
            qualitySupplier: topRow.supplier.name,
          }));
        }
      }
    } else {
      lines.push(i18n.t('ai.conclusion.noData'));
    }

    lines.push(``);
    lines.push(i18n.t('ai.conclusion.disclaimer'));

    return lines.join('\n');
  }
}

/* ==================== 2. RemoteAIBackend（远程 AI 后端） ==================== */

/** 远程 AI 请求因未获用户确认的前提错误 */
export class RemoteAIConfirmationError extends Error {
  constructor() {
    super('Remote AI backend requires user confirmation before sending data.');
    this.name = 'RemoteAIConfirmationError';
  }
}

export interface RemoteAIBackendOptions {
  /** 远程端点基础路径（如 /api/ai），经由 client 的 baseURL 拼接 */
  baseUrl: string;
  /** 单次请求超时（毫秒） */
  timeoutMs: number;
  /** 客户端限流：每分钟最大请求数 */
  maxRequestsPerMinute: number;
  /** 客户端限流：最小请求间隔（毫秒） */
  minIntervalMs: number;
}

const SENSITIVE_KEY_RE =
  /password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|credential|access[_-]?key|private[_-]?key/i;

/** 深度拷贝并剔除敏感字段（密码/token/密钥等），避免发送到远程 */
function sanitizePayload(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sanitizePayload(v, key));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) continue; // 剔除敏感字段
      out[k] = sanitizePayload(v, k);
    }
    return out;
  }
  return value;
}

/**
 * 远程 AI 后端：调用真实 HTTP 端点。
 * 内置：超时、AbortController 取消、错误处理、客户端限流、敏感信息过滤、
 * 受控日志、以及发送前用户确认机制（confirmRiskFields）。
 * 仅在通过环境变量显式配置（VITE_AI_BACKEND=remote）且用户确认后才会真正发送请求。
 */
export class RemoteAIBackend implements AIBackend {
  /** 发送前用户确认标志：false 时拒绝发送并抛 RemoteAIConfirmationError */
  confirmRiskFields = false;

  private callTimestamps: number[] = [];
  private lastCallAt = 0;

  constructor(private readonly opts: RemoteAIBackendOptions) {}

  /** 用户确认后可发送风险数据（调用方在获得用户同意后调用） */
  setConfirmed(confirmed: boolean): void {
    this.confirmRiskFields = confirmed;
  }

  /** 客户端限流：超过每分钟上限或最小间隔则抛出错误 */
  private assertRateLimit(): void {
    const now = Date.now();
    const windowMs = 60_000;
    this.callTimestamps = this.callTimestamps.filter((ts) => now - ts < windowMs);
    if (this.callTimestamps.length >= this.opts.maxRequestsPerMinute) {
      throw new Error('Remote AI rate limit exceeded.');
    }
    if (this.lastCallAt > 0 && now - this.lastCallAt < this.opts.minIntervalMs) {
      throw new Error('Remote AI request interval too short.');
    }
    this.callTimestamps.push(now);
    this.lastCallAt = now;
  }

  /** 受控日志：仅记录请求路径与负载大小，不记录敏感内容 */
  private log(level: 'info' | 'error', message: string, meta: Record<string, unknown>): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console[level](`[RemoteAI] ${message}`, meta);
    }
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    if (!this.confirmRiskFields) {
      throw new RemoteAIConfirmationError();
    }
    this.assertRateLimit();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const safe = sanitizePayload(payload);
      this.log('info', `${path}`, { size: JSON.stringify(safe).length });
      const res = await client.post<T>(path, safe, { signal: controller.signal });
      return res.data;
    } catch (error) {
      this.log('error', `${path} failed`, {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateInquiryDescription(params: InquiryDescriptionParams): Promise<string> {
    const body = await this.post<{ description?: unknown }>(`${this.opts.baseUrl}/inquiry-description`, { params });
    const description = body?.description;
    if (!isValidText(description)) {
      throw new Error('Remote AI returned an invalid description shape.');
    }
    return description;
  }

  async analyzeQuotationAnomalies(
    inquiry: Inquiry,
    data: CompareData,
    rows?: SupplierQuoteRow[],
  ): Promise<AnomalyAnalysisResult> {
    const body = await this.post<AnomalyAnalysisResult>(`${this.opts.baseUrl}/quotation-anomalies`, {
      inquiry,
      data,
      rows,
    });
    if (!isValidAnomalyResult(body)) {
      throw new Error('Remote AI returned an invalid anomaly result shape.');
    }
    return body;
  }

  async generateCompareConclusion(
    inquiry: Inquiry,
    data: CompareData,
    rows: SupplierQuoteRow[],
  ): Promise<string> {
    const body = await this.post<{ conclusion?: unknown }>(`${this.opts.baseUrl}/compare-conclusion`, {
      inquiry,
      data,
      rows,
    });
    const conclusion = body?.conclusion;
    if (!isValidText(conclusion)) {
      throw new Error('Remote AI returned an invalid conclusion shape.');
    }
    return conclusion;
  }
}

/* ==================== 3. 后端选择与对外 API（保持向后兼容） ==================== */

const AI_BACKEND_MODE: AIBackendMode =
  import.meta.env.VITE_AI_BACKEND === 'remote' ? 'remote' : 'local';

/** 远程失败时是否允许回退到本地规则（默认允许；设为 false 时远程失败即判定为不可用并抛错） */
const ALLOW_LOCAL_FALLBACK = import.meta.env.VITE_AI_FALLBACK_LOCAL !== 'false';

const localBackend = new LocalRuleBackend();
const remoteBackend = new RemoteAIBackend({
  baseUrl: import.meta.env.VITE_AI_BACKEND_URL || '/ai',
  timeoutMs: Number(import.meta.env.VITE_AI_TIMEOUT_MS) || 15_000,
  maxRequestsPerMinute: Number(import.meta.env.VITE_AI_RATE_LIMIT) || 30,
  minIntervalMs: 100,
});

let health: AIBackendHealth = 'ok';
let degradedReason: string | null = null;

/** 当前 AI 后端模式 */
export function getAIBackendMode(): AIBackendMode {
  return AI_BACKEND_MODE;
}

/** 当前 AI 后端健康状态 */
export function getAIBackendHealth(): AIBackendHealth {
  return health;
}

/** 当前 AI 后端对外状态（local / remote / degraded / unavailable） */
export function getAIBackendStatus(): {
  mode: AIBackendMode;
  status: AIBackendStatus;
  health: AIBackendHealth;
  degradedReason: string | null;
  confirmRequired: boolean;
} {
  const confirmRequired = AI_BACKEND_MODE === 'remote' && !remoteBackend.confirmRiskFields;
  let status: AIBackendStatus;
  if (AI_BACKEND_MODE === 'local') {
    status = 'local';
  } else if (health === 'ok') {
    status = 'remote';
  } else if (ALLOW_LOCAL_FALLBACK) {
    status = 'degraded';
  } else {
    status = 'unavailable';
  }
  return { mode: AI_BACKEND_MODE, status, health, degradedReason, confirmRequired };
}

/** 用户确认后允许远程 AI 发送数据（调用方在获得用户同意后调用） */
export function setRemoteAIConfirmed(confirmed: boolean): void {
  remoteBackend.setConfirmed(confirmed);
}

/** 远程优先调用，失败时兜底本地（Task 15.3/15.4） */
async function runRemote<T>(
  invoke: () => Promise<T>,
  validate: (value: unknown) => value is T,
  fallback: () => Promise<T>,
): Promise<T> {
  if (AI_BACKEND_MODE !== 'remote') return fallback();
  try {
    const result = await invoke();
    if (!validate(result)) {
      throw new Error('Remote AI returned an invalid response shape.');
    }
    health = 'ok';
    degradedReason = null;
    return result;
  } catch (error) {
    health = 'degraded';
    degradedReason =
      error instanceof RemoteAIConfirmationError ? 'confirmation-required' : 'remote-error';
    if (ALLOW_LOCAL_FALLBACK) return fallback();
    throw error;
  }
}

/** （向后兼容）AI 生成询价说明 */
export async function generateInquiryDescription(params: InquiryDescriptionParams): Promise<string> {
  return runRemote(
    () => remoteBackend.generateInquiryDescription(params),
    isValidText,
    () => localBackend.generateInquiryDescription(params),
  );
}

/** （向后兼容）AI 分析报价异常 */
export async function analyzeQuotationAnomalies(
  inquiry: Inquiry,
  data: CompareData,
  rows?: SupplierQuoteRow[],
): Promise<AnomalyAnalysisResult> {
  return runRemote(
    () => remoteBackend.analyzeQuotationAnomalies(inquiry, data, rows),
    isValidAnomalyResult,
    () => localBackend.analyzeQuotationAnomalies(inquiry, data, rows),
  );
}

/** （向后兼容）AI 生成比价结论 */
export async function generateCompareConclusion(
  inquiry: Inquiry,
  data: CompareData,
  rows: SupplierQuoteRow[],
): Promise<string> {
  return runRemote(
    () => remoteBackend.generateCompareConclusion(inquiry, data, rows),
    isValidText,
    () => localBackend.generateCompareConclusion(inquiry, data, rows),
  );
}
