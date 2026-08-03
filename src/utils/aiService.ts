/**
 * AI 智能服务（W9）
 * - 规则引擎模拟 LLM 能力，无需真实 AI 接口
 * - 提供询价说明生成、报价异常分析、比价结论生成
 * - 所有方法返回 Promise<string>，模拟异步调用
 */
import {
  SUPPLIER_LEVEL_LABEL,
  type Inquiry,
  type InquiryItem,
} from '@/types';
import {
  type CompareData,
  type SupplierQuoteRow,
  getAvgUnitPrice,
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

  lines.push(`一、采购需求概述`);
  lines.push(`本次采购项目「${subject}」，共涉及 ${items.length} 项物料，欢迎合格供应商参与报价。`);

  // 物料品类汇总
  const categories = [...new Set(items.map((i) => i.category))].filter(Boolean);
  if (categories.length) {
    lines.push(``);
    lines.push(`二、采购品类`);
    lines.push(`本次采购涵盖以下品类：${categories.join('、')}。`);
  }

  // 关键物料
  const keyItems = items.slice(0, 3);
  if (keyItems.length) {
    lines.push(``);
    lines.push(`三、关键物料明细`);
    keyItems.forEach((item, idx) => {
      const parts = [`${item.name}（${item.code}）`];
      if (item.brand) parts.push(`品牌：${item.brand}`);
      if (item.spec) parts.push(`规格：${item.spec}`);
      parts.push(`数量：${item.quantity}${item.unit}`);
      if (item.targetPrice) parts.push(`目标价：${formatCurrency(item.targetPrice)}`);
      lines.push(`  ${idx + 1}. ${parts.join('，')}。`);
    });
    if (items.length > 3) {
      lines.push(`  等共 ${items.length} 项物料，详见附件清单。`);
    }
  }

  // 交付要求
  lines.push(``);
  lines.push(`四、交付与验收要求`);
  if (expectedDeliveryDate) {
    lines.push(`期望交货日期：${expectedDeliveryDate}。`);
  }
  if (deliveryAddress) {
    lines.push(`交货地点：${deliveryAddress}。`);
  }
  lines.push(`供应商需保证所供物料为原厂正品，提供完整的出厂检验报告及合格证。`);

  // 商务要求
  if (paymentTerms) {
    lines.push(``);
    lines.push(`五、商务条款`);
    lines.push(`付款条件：${paymentTerms}。`);
  }

  lines.push(``);
  lines.push(`六、报价要求`);
  lines.push(`1. 报价需包含含税单价、总价、交货周期、质保期等信息；`);
  lines.push(`2. 如有技术或商务偏离，请在报价中明确标注；`);
  lines.push(`3. 报价有效期不少于 30 天。`);

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
          `${item.name}：${r.supplier.name} 报价 ${formatCurrency(qi.unitPrice, inquiry.currency)}，高于均价 ${formatCurrency(avg, inquiry.currency)} 50%+，可能存在虚高风险`,
        );
      } else if (isLowPrice(qi.unitPrice, avg)) {
        anomalies.push(
          `${item.name}：${r.supplier.name} 报价 ${formatCurrency(qi.unitPrice, inquiry.currency)}，低于均价 ${formatCurrency(avg, inquiry.currency)} 50%+，需核实是否满足技术要求`,
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
          `报价总价离散度较大（最高与最低相差 ${spread.toFixed(1)}%），建议核实各家报价口径是否一致`,
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
          `交货周期差异显著（最快 ${minD.toFixed(0)} 天 vs 最慢 ${maxD.toFixed(0)} 天），需关注供应链稳定性`,
        );
      }
    }
  }

  // 4. 技术偏离提示
  const techDeviations = data.submittedRows.filter((r) => r.techDeviations.length > 0);
  if (techDeviations.length) {
    anomalies.push(
      `${techDeviations.length} 家供应商存在技术偏离，建议技术部门重点评审`,
    );
  }

  const hasAnomaly = anomalies.length > 0;
  const summary = hasAnomaly
    ? `检测到 ${anomalies.length} 项需要关注的问题：\n${anomalies.map((a) => `· ${a}`).join('\n')}`
    : '各供应商报价整体正常，未发现明显异常。单价、总价离散度、交货周期均在合理范围内。';

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

  lines.push(`【比价结论】`);
  lines.push(``);

  // 1. 报价回收情况
  lines.push(`1. 报价回收：共邀请 ${invitedCount} 家供应商，收到有效报价 ${submittedCount} 家，回收率 ${invitedCount > 0 ? Math.round((submittedCount / invitedCount) * 100) : 0}%。`);

  // 2. 价格分析
  if (data.lowestTotalSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.lowestTotalSupplierId);
    if (r) {
      lines.push(``);
      lines.push(`2. 价格分析：${r.supplier.name} 报价总额最低（${formatCurrency(r.totalAmount, inquiry.currency)}）。`);
      if (data.submittedRows.length >= 2) {
        const sorted = [...data.submittedRows].sort((a, b) => a.totalAmount - b.totalAmount);
        const second = sorted[1];
        const diff = second.totalAmount - r.totalAmount;
        const diffPct = r.totalAmount > 0 ? (diff / r.totalAmount) * 100 : 0;
        lines.push(`   较次低报价低 ${formatCurrency(diff, inquiry.currency)}（${diffPct.toFixed(1)}%）。`);
      }
    }
  }

  // 3. 综合评分
  if (data.topScoreSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
    const s = data.scores[data.topScoreSupplierId];
    if (r && s) {
      lines.push(``);
      lines.push(`3. 综合评估：${r.supplier.name} 综合评分最高（${s.total.toFixed(2)} 分），`);
      lines.push(`   其中金额得分 ${s.price.toFixed(1)}、交货得分 ${s.delivery.toFixed(1)}、等级得分 ${s.level.toFixed(1)}、履约得分 ${s.fulfillment.toFixed(1)}。`);
      lines.push(`   供应商等级：${SUPPLIER_LEVEL_LABEL[r.supplier.level]}，历史履约率 ${(r.supplier.historyFulfillmentRate * 100).toFixed(1)}%。`);
    }
  }

  // 4. 交货能力
  if (data.fastestDeliverySupplierId) {
    const r = rows.find((x) => x.supplier.id === data.fastestDeliverySupplierId);
    if (r) {
      lines.push(``);
      lines.push(`4. 交货能力：${r.supplier.name} 交货最快（平均 ${r.avgDeliveryDays.toFixed(1)} 天）。`);
    }
  }

  // 5. 定标建议
  lines.push(``);
  lines.push(`5. 定标建议：`);
  if (data.topScoreSupplierId) {
    const topRow = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
    const lowRow = data.lowestTotalSupplierId
      ? rows.find((x) => x.supplier.id === data.lowestTotalSupplierId)
      : undefined;
    const topScore = data.scores[data.topScoreSupplierId]?.total ?? 0;
    const lowScore = lowRow ? (data.scores[lowRow.supplier.id]?.total ?? 0) : 0;
    if (topRow) {
      if (topRow.supplier.id === data.lowestTotalSupplierId) {
        lines.push(`   推荐 ${topRow.supplier.name}：综合评分最高且报价最低，性价比最优。`);
      } else if (lowRow) {
        const scoreDiff = topScore - lowScore;
        const priceDiff = topRow.totalAmount - lowRow.totalAmount;
        lines.push(`   ${topRow.supplier.name} 综合评分领先 ${lowRow.supplier.name} ${scoreDiff.toFixed(1)} 分，但报价高出 ${formatCurrency(priceDiff, inquiry.currency)}。`);
        lines.push(`   若预算优先，可选 ${lowRow.supplier.name}；若综合质量优先，推荐 ${topRow.supplier.name}。`);
      }
    }
  } else {
    lines.push(`   暂无足够数据进行推荐，请人工评估。`);
  }

  lines.push(``);
  lines.push(`（本结论由系统智能分析生成，仅供决策参考，最终定标请结合实际业务需求。）`);

  return lines.join('\n');
}
