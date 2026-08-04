/**
 * 报价对比：数据准备与综合评分计算
 * 评分规则（0-100）：
 *   报价金额 50% + 交货周期 20% + 供应商等级 15% + 历史履约 15%
 */
import {
  CooperationStatus,
  QuotationStatus,
  SupplierLevel,
  type Inquiry,
  type InquiryItem,
  type Quotation,
  type QuotationItem,
  type Supplier,
} from '@/types';
import { loadJSON, saveJSON } from '@/utils/storage';

/** 供应商等级基础分 */
export const SUPPLIER_LEVEL_SCORE: Record<SupplierLevel, number> = {
  [SupplierLevel.STRATEGIC]: 95,
  [SupplierLevel.PREMIUM]: 85,
  [SupplierLevel.QUALIFIED]: 70,
  [SupplierLevel.PENDING]: 60,
};

/** 评分维度权重 */
export const SCORE_WEIGHTS = {
  price: 0.5,
  delivery: 0.2,
  level: 0.15,
  fulfillment: 0.15,
} as const;

/** 可调整的评分维度权重（与 SCORE_WEIGHTS 结构一致但可写） */
export interface ScoreWeights {
  price: number;
  delivery: number;
  level: number;
  fulfillment: number;
}

const SCORE_WEIGHTS_KEY = 'scoreWeights';

/** 读取用户自定义评分权重（localStorage，未配置时回退默认）。用于评分明细 Modal 的权重调整并持久化 */
export function loadScoreWeights(): ScoreWeights {
  const saved = loadJSON<Partial<ScoreWeights>>(SCORE_WEIGHTS_KEY, {});
  return { ...SCORE_WEIGHTS, ...saved };
}

/** 持久化用户自定义评分权重 */
export function saveScoreWeights(weights: ScoreWeights): void {
  saveJSON(SCORE_WEIGHTS_KEY, weights);
}

/** 单项评分明细 */
export interface ScoreBreakdown {
  /** 报价金额得分（0-50） */
  price: number;
  /** 交货周期得分（0-20） */
  delivery: number;
  /** 供应商等级得分（0-15） */
  level: number;
  /** 历史履约得分（0-15） */
  fulfillment: number;
  /** 总分（0-100） */
  total: number;
}

/** 单个供应商在该询价下的对比行数据 */
export interface SupplierQuoteRow {
  supplier: Supplier;
  quotation: Quotation;
  /** 该供应商对该询价所有明细的报价（已按 inquiryItemId 索引） */
  items: QuotationItem[];
  status: QuotationStatus;
  isSubmitted: boolean;
  totalAmount: number;
  /** 平均交货周期（天） */
  avgDeliveryDays: number;
  /** 最早可交货日期 */
  earliestDeliveryDate?: string;
  /** 平均质保期（月） */
  avgWarrantyMonths?: number;
  /** 付款条件（取首个明细，缺失则取询价单默认） */
  paymentTerms?: string;
  /** 技术偏离汇总（非空） */
  techDeviations: string[];
  /** 商务偏离汇总（非空） */
  commercialDeviations: string[];
}

/** 对比数据集合 */
export interface CompareData {
  items: InquiryItem[];
  /** 全部对比行（含 TIMEOUT） */
  rows: SupplierQuoteRow[];
  /** 已提交报价的对比行 */
  submittedRows: SupplierQuoteRow[];
  scores: Record<string, ScoreBreakdown>;
  /** 最低总额 */
  minTotal: number;
  /** 最快平均交货周期 */
  fastestAvgDelivery: number;
  /** 最低总价供应商 id */
  lowestTotalSupplierId?: string;
  /** 最快交货供应商 id */
  fastestDeliverySupplierId?: string;
  /** 综合评分最高供应商 id */
  topScoreSupplierId?: string;
}

/** 按 inquiryItemId 取该供应商的报价明细 */
export function getQuotationItem(row: SupplierQuoteRow, inquiryItemId: string): QuotationItem | undefined {
  return row.items.find((qi) => qi.inquiryItemId === inquiryItemId);
}

/** 取某物料在各已提交供应商中的最低含税单价 */
export function getMinUnitPrice(rows: SupplierQuoteRow[], inquiryItemId: string): number | undefined {
  const prices = rows
    .filter((r) => r.isSubmitted)
    .map((r) => getQuotationItem(r, inquiryItemId)?.unitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  return prices.length ? Math.min(...prices) : undefined;
}

/** 取某物料在各已提交供应商中的最快交货周期 */
export function getFastestDelivery(rows: SupplierQuoteRow[], inquiryItemId: string): number | undefined {
  const days = rows
    .filter((r) => r.isSubmitted)
    .map((r) => getQuotationItem(r, inquiryItemId)?.deliveryDays)
    .filter((d): d is number => typeof d === 'number' && d > 0);
  return days.length ? Math.min(...days) : undefined;
}

/** 取某物料在各已提交供应商中的平均含税单价（用于异常判定） */
export function getAvgUnitPrice(rows: SupplierQuoteRow[], inquiryItemId: string): number | undefined {
  const prices = rows
    .filter((r) => r.isSubmitted)
    .map((r) => getQuotationItem(r, inquiryItemId)?.unitPrice)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  if (!prices.length) return undefined;
  return prices.reduce((s, p) => s + p, 0) / prices.length;
}

/** 报价偏高：比平均高 50%+ */
export function isHighPrice(unitPrice: number, avg: number): boolean {
  return avg > 0 && unitPrice >= avg * 1.5;
}

/** 报价偏低：比平均低 50%+ */
export function isLowPrice(unitPrice: number, avg: number): boolean {
  return avg > 0 && unitPrice <= avg * 0.5;
}

/** 构造单个供应商对比行 */
function buildRow(supplier: Supplier, quotation: Quotation): SupplierQuoteRow {
  const items = quotation.items ?? [];
  const isSubmitted = quotation.status === QuotationStatus.SUBMITTED;
  const deliveryDays = items.map((i) => i.deliveryDays).filter((d) => typeof d === 'number');
  const warranties = items.map((i) => i.warrantyMonths).filter((w): w is number => typeof w === 'number');
  const deliveryDates = items.map((i) => i.deliveryDate).filter((d): d is string => !!d);
  const techDeviations = items.map((i) => i.techDeviation).filter((d): d is string => !!d?.trim());
  const commercialDeviations = items
    .map((i) => i.commercialDeviation)
    .filter((d): d is string => !!d?.trim());
  const avgDeliveryDays = deliveryDays.length
    ? deliveryDays.reduce((s, d) => s + d, 0) / deliveryDays.length
    : 0;
  const earliestDeliveryDate = deliveryDates.length
    ? deliveryDates.sort()[0]
    : undefined;
  const avgWarrantyMonths = warranties.length
    ? warranties.reduce((s, w) => s + w, 0) / warranties.length
    : undefined;
  return {
    supplier,
    quotation,
    items,
    status: quotation.status,
    isSubmitted,
    totalAmount: quotation.totalAmount ?? 0,
    avgDeliveryDays,
    earliestDeliveryDate,
    avgWarrantyMonths,
    paymentTerms: items[0]?.paymentTerms,
    techDeviations,
    commercialDeviations,
  };
}

/** 计算综合评分（默认权重） */
function calcScore(
  row: SupplierQuoteRow,
  minTotal: number,
  fastestAvgDelivery: number,
): ScoreBreakdown {
  return calcScoreWithWeights(row, minTotal, fastestAvgDelivery, SCORE_WEIGHTS);
}

/** 按自定义权重计算综合评分（用于评分明细 Modal 的权重调整实时重算） */
export function calcScoreWithWeights(
  row: SupplierQuoteRow,
  minTotal: number,
  fastestAvgDelivery: number,
  weights: ScoreWeights,
): ScoreBreakdown {
  const price =
    row.totalAmount > 0 && minTotal > 0 ? (minTotal / row.totalAmount) * 100 * weights.price : 0;
  const delivery =
    row.avgDeliveryDays > 0 && fastestAvgDelivery > 0
      ? (fastestAvgDelivery / row.avgDeliveryDays) * 100 * weights.delivery
      : 0;
  const level = SUPPLIER_LEVEL_SCORE[row.supplier.level] * weights.level;
  const fulfillment = (row.supplier.historyFulfillmentRate ?? 0) * 100 * weights.fulfillment;
  return {
    price: Number(price.toFixed(2)),
    delivery: Number(delivery.toFixed(2)),
    level: Number(level.toFixed(2)),
    fulfillment: Number(fulfillment.toFixed(2)),
    total: Number((price + delivery + level + fulfillment).toFixed(2)),
  };
}

/** 准备对比数据 */
export function prepareCompareData(
  inquiry: Inquiry,
  suppliers: Supplier[],
  quotations: Quotation[],
): CompareData {
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  // 仅参与对比的报价：SUBMITTED 或 TIMEOUT（TIMEOUT 仍展示但标记）
  const compareQuotations = quotations.filter(
    (q) =>
      q.inquiryId === inquiry.id &&
      (q.status === QuotationStatus.SUBMITTED || q.status === QuotationStatus.TIMEOUT),
  );

  const rows: SupplierQuoteRow[] = [];
  for (const q of compareQuotations) {
    const supplier = supplierMap.get(q.supplierId);
    if (!supplier) {
      // 兜底：用报价单内联的供应商名构造一个最小 Supplier
      rows.push(
        buildRow(
          {
            id: q.supplierId,
            code: q.supplierId,
            name: q.supplierName,
            region: '-',
            contact: '-',
            phone: '-',
            email: '-',
            mainCategories: [],
            level: SupplierLevel.PENDING,
            cooperationStatus: CooperationStatus.QUALIFIED,
            qualified: false,
            historyResponseRate: 0,
            historyFulfillmentRate: 0,
            avgDeliveryDays: 0,
            historyCoopCount: 0,
          },
          q,
        ),
      );
    } else {
      rows.push(buildRow(supplier, q));
    }
  }

  const submittedRows = rows.filter((r) => r.isSubmitted && r.totalAmount > 0);
  const totals = submittedRows.map((r) => r.totalAmount);
  const minTotal = totals.length ? Math.min(...totals) : 0;
  const avgDeliveries = submittedRows.map((r) => r.avgDeliveryDays).filter((d) => d > 0);
  const fastestAvgDelivery = avgDeliveries.length ? Math.min(...avgDeliveries) : 0;

  const scores: Record<string, ScoreBreakdown> = {};
  for (const r of submittedRows) {
    scores[r.supplier.id] = calcScore(r, minTotal, fastestAvgDelivery);
  }

  let lowestTotalSupplierId: string | undefined;
  if (submittedRows.length) {
    lowestTotalSupplierId = submittedRows.reduce((min, r) =>
      r.totalAmount < min.totalAmount ? r : min,
    ).supplier.id;
  }
  let fastestDeliverySupplierId: string | undefined;
  if (submittedRows.length) {
    const candidates = submittedRows.filter((r) => r.avgDeliveryDays > 0);
    if (candidates.length) {
      fastestDeliverySupplierId = candidates.reduce((min, r) =>
        r.avgDeliveryDays < min.avgDeliveryDays ? r : min,
      ).supplier.id;
    }
  }
  let topScoreSupplierId: string | undefined;
  const scoreEntries = Object.entries(scores);
  if (scoreEntries.length) {
    topScoreSupplierId = scoreEntries.reduce((max, [id, s]) =>
      s.total > max[1].total ? [id, s] : max,
    )[0];
  }

  return {
    items: inquiry.items,
    rows,
    submittedRows,
    scores,
    minTotal,
    fastestAvgDelivery,
    lowestTotalSupplierId,
    fastestDeliverySupplierId,
    topScoreSupplierId,
  };
}

/** 排序方式 */
export type SortMode = 'totalAsc' | 'deliveryAsc' | 'scoreDesc';

/** 按排序方式对对比行排序（仅对已提交行排序，TIMEOUT 行置后） */
export function sortRows(rows: SupplierQuoteRow[], mode: SortMode, scores: Record<string, ScoreBreakdown>): SupplierQuoteRow[] {
  const submitted = rows.filter((r) => r.isSubmitted);
  const others = rows.filter((r) => !r.isSubmitted);
  const sorted = [...submitted].sort((a, b) => {
    if (mode === 'totalAsc') return a.totalAmount - b.totalAmount;
    if (mode === 'deliveryAsc') return a.avgDeliveryDays - b.avgDeliveryDays;
    // scoreDesc
    const sa = scores[a.supplier.id]?.total ?? 0;
    const sb = scores[b.supplier.id]?.total ?? 0;
    return sb - sa;
  });
  return [...sorted, ...others];
}

/** 拼接偏离汇总文本 */
export function joinDeviations(deviations: string[]): string {
  if (!deviations.length) return '无';
  return deviations.join('；');
}
