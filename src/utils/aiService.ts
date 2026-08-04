/**
 * AI 智能服务（W9）
 * - 规则引擎模拟 LLM 能力，无需真实 AI 接口
 * - 提供询价说明生成、报价异常分析、比价结论生成
 * - 所有方法返回 Promise<string>，模拟异步调用
 * - 文案经 i18n 国际化，随当前语言变化
 */
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

/** 模拟网络延迟 */
function delay(ms = 600): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ==================== 1. 询价说明生成 ==================== */

export interface InquiryDescriptionParams {
  subject: string;
  items: InquiryItem[];
  paymentTerms?: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
}

/** AI 生成询价说明 */
export async function generateInquiryDescription(params: InquiryDescriptionParams): Promise<string> {
  await delay();
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

/* ==================== 2. 报价异常分析 ==================== */

export interface AnomalyAnalysisResult {
  /** 分析摘要文本 */
  summary: string;
  /** 是否发现异常 */
  hasAnomaly: boolean;
  /** 异常数 */
  anomalyCount: number;
}

/** AI 分析报价异常 */
export async function analyzeQuotationAnomalies(
  inquiry: Inquiry,
  data: CompareData,
  // rows 保留用于未来扩展（如供应商维度异常），当前分析基于 data.submittedRows
  _rows?: SupplierQuoteRow[],
): Promise<AnomalyAnalysisResult> {
  await delay();
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

/* ==================== 3. 比价结论生成 ==================== */

/** AI 生成比价结论 */
export async function generateCompareConclusion(
  inquiry: Inquiry,
  data: CompareData,
  rows: SupplierQuoteRow[],
): Promise<string> {
  await delay();
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
