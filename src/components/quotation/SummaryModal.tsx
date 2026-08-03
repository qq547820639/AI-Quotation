/**
 * 对比摘要 Modal：自动生成可复制的文本摘要
 * W9.5：新增 AI 生成结论按钮，调用规则引擎生成更自然的结论
 */
import { useState } from 'react';
import { Button, Modal, Space, Spin, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { type Inquiry } from '@/types';
import { formatCurrency } from '@/utils/format';
import { generateCompareConclusion } from '@/utils/aiService';
import { notifyWarning } from '@/utils/confirm';
import { useIsMobile } from '@/utils/useIsMobile';
import {
  type CompareData,
  type SupplierQuoteRow,
  getAvgUnitPrice,
  getQuotationItem,
  isHighPrice,
  isLowPrice,
} from './scoreUtils';

const { Paragraph, Text } = Typography;

interface SummaryModalProps {
  open: boolean;
  inquiry: Inquiry;
  data: CompareData;
  rows: SupplierQuoteRow[];
  onClose: () => void;
}

/** 生成纯文本摘要 */
function buildSummary(inquiry: Inquiry, data: CompareData, rows: SupplierQuoteRow[], t: TFunction): string {
  const lines: string[] = [];
  lines.push(t('quotation.compare.summary.inquiryLine', { subject: inquiry.subject, code: inquiry.code }));
  lines.push(t('quotation.compare.summary.basicInfo', { currency: inquiry.currency, items: inquiry.items.length, suppliers: rows.length }));
  lines.push('');

  // 最低总价
  if (data.lowestTotalSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.lowestTotalSupplierId);
    if (r) {
      lines.push(t('quotation.compare.summary.lowestTotal', { name: r.supplier.name, amount: formatCurrency(r.totalAmount, inquiry.currency) }));
    }
  }
  // 最快交货
  if (data.fastestDeliverySupplierId) {
    const r = rows.find((x) => x.supplier.id === data.fastestDeliverySupplierId);
    if (r) {
      lines.push(t('quotation.compare.summary.fastestDelivery', { name: r.supplier.name, days: r.avgDeliveryDays.toFixed(1) }));
    }
  }
  // 综合评分最高
  if (data.topScoreSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
    const s = data.scores[data.topScoreSupplierId];
    if (r && s) {
      lines.push(t('quotation.compare.summary.topScore', { name: r.supplier.name, total: s.total.toFixed(2), price: s.price.toFixed(1), delivery: s.delivery.toFixed(1), level: s.level.toFixed(1), fulfillment: s.fulfillment.toFixed(1) }));
    }
  }
  lines.push('');

  // 异常报价
  const anomalies: string[] = [];
  for (const item of inquiry.items) {
    const avg = getAvgUnitPrice(data.submittedRows, item.id);
    if (avg === undefined) continue;
    for (const r of data.submittedRows) {
      const qi = getQuotationItem(r, item.id);
      if (!qi) continue;
      if (isHighPrice(qi.unitPrice, avg)) {
        anomalies.push(t('quotation.compare.summary.anomalyHigh', { material: item.name, supplier: r.supplier.name, price: formatCurrency(qi.unitPrice, inquiry.currency), avg: formatCurrency(avg, inquiry.currency) }));
      } else if (isLowPrice(qi.unitPrice, avg)) {
        anomalies.push(t('quotation.compare.summary.anomalyLow', { material: item.name, supplier: r.supplier.name, price: formatCurrency(qi.unitPrice, inquiry.currency), avg: formatCurrency(avg, inquiry.currency) }));
      }
    }
  }
  lines.push(t('quotation.compare.summary.anomalyTitle'));
  if (anomalies.length) {
    lines.push(...anomalies);
  } else {
    lines.push(t('quotation.compare.summary.noAnomaly'));
  }
  lines.push('');

  // 已选推荐供应商
  const selected = Object.entries(inquiry.selectedSupplierMap);
  lines.push(t('quotation.compare.summary.selectedTitle'));
  if (selected.length) {
    for (const [itemId, supplierId] of selected) {
      const item = inquiry.items.find((it) => it.id === itemId);
      const supplier = rows.find((r) => r.supplier.id === supplierId)?.supplier;
      lines.push(t('quotation.compare.summary.selectedItem', { material: item?.name ?? itemId, supplier: supplier?.name ?? supplierId }));
    }
  } else {
    lines.push(t('quotation.compare.summary.noSelection'));
  }

  return lines.join('\n');
}

export default function SummaryModal({ open, inquiry, data, rows, onClose }: SummaryModalProps) {
  const { t } = useTranslation();
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const isMobile = useIsMobile();
  const templateSummary = buildSummary(inquiry, data, rows, t);
  const displayText = aiText || templateSummary;

  const handleAiGenerate = async () => {
    setAiLoading(true);
    try {
      const text = await generateCompareConclusion(inquiry, data, rows);
      setAiText(text);
    } catch {
      notifyWarning(t('quotation.compare.summary.aiFailed'));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <span>{t('quotation.compare.summary.title')}</span>
          {aiText && <Tag color="purple">{t('quotation.compare.aiGenerated')}</Tag>}
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText={t('quotation.compare.summary.closeBtn')}
      cancelButtonProps={{ style: { display: 'none' } }}
      width={isMobile ? '92vw' : 680}
      style={isMobile ? { top: 20 } : undefined}
    >
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('quotation.compare.summary.desc')}
        </Text>
        <Button
          size="small"
          icon={<RobotOutlined />}
          loading={aiLoading}
          onClick={handleAiGenerate}
        >
          {aiText ? t('quotation.compare.summary.regenerateAi') : t('quotation.compare.summary.generateAi')}
        </Button>
      </Space>
      <Spin spinning={aiLoading}>
        <Paragraph
          copyable={{ text: displayText }}
          style={{
            whiteSpace: 'pre-wrap',
            background: 'var(--color-bg)',
            padding: 16,
            borderRadius: 8,
            margin: 0,
            fontSize: 13,
            lineHeight: 1.8,
            border: '1px solid var(--color-border)',
          }}
        >
          {displayText}
        </Paragraph>
      </Spin>
    </Modal>
  );
}
