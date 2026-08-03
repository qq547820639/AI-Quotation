/**
 * 对比摘要 Modal：自动生成可复制的文本摘要
 * W9.5：新增 AI 生成结论按钮，调用规则引擎生成更自然的结论
 */
import { useState } from 'react';
import { Button, Modal, Space, Spin, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
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
function buildSummary(inquiry: Inquiry, data: CompareData, rows: SupplierQuoteRow[]): string {
  const lines: string[] = [];
  lines.push(`询价单：${inquiry.subject}（${inquiry.code}）`);
  lines.push(`币种：${inquiry.currency} 物料行数：${inquiry.items.length} 参与对比供应商：${rows.length}`);
  lines.push('');

  // 最低总价
  if (data.lowestTotalSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.lowestTotalSupplierId);
    if (r) {
      lines.push(`【最低总价供应商】${r.supplier.name}，报价总额 ${formatCurrency(r.totalAmount, inquiry.currency)}`);
    }
  }
  // 最快交货
  if (data.fastestDeliverySupplierId) {
    const r = rows.find((x) => x.supplier.id === data.fastestDeliverySupplierId);
    if (r) {
      lines.push(`【最快交货供应商】${r.supplier.name}，平均交货 ${r.avgDeliveryDays.toFixed(1)} 天`);
    }
  }
  // 综合评分最高
  if (data.topScoreSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
    const s = data.scores[data.topScoreSupplierId];
    if (r && s) {
      lines.push(`【综合评分最高】${r.supplier.name}，总分 ${s.total.toFixed(2)}（金额 ${s.price.toFixed(1)}/交货 ${s.delivery.toFixed(1)}/等级 ${s.level.toFixed(1)}/履约 ${s.fulfillment.toFixed(1)}）`);
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
        anomalies.push(`  · ${item.name} - ${r.supplier.name}：单价 ${formatCurrency(qi.unitPrice, inquiry.currency)}（高于平均 ${formatCurrency(avg, inquiry.currency)} 50%+，报价偏高）`);
      } else if (isLowPrice(qi.unitPrice, avg)) {
        anomalies.push(`  · ${item.name} - ${r.supplier.name}：单价 ${formatCurrency(qi.unitPrice, inquiry.currency)}（低于平均 ${formatCurrency(avg, inquiry.currency)} 50%+，报价偏低，请核实）`);
      }
    }
  }
  lines.push('【异常报价提示】');
  if (anomalies.length) {
    lines.push(...anomalies);
  } else {
    lines.push('  · 未发现明显异常报价');
  }
  lines.push('');

  // 已选推荐供应商
  const selected = Object.entries(inquiry.selectedSupplierMap);
  lines.push('【已选推荐供应商】');
  if (selected.length) {
    for (const [itemId, supplierId] of selected) {
      const item = inquiry.items.find((it) => it.id === itemId);
      const supplier = rows.find((r) => r.supplier.id === supplierId)?.supplier;
      lines.push(`  · ${item?.name ?? itemId} → ${supplier?.name ?? supplierId}`);
    }
  } else {
    lines.push('  · 暂未选择推荐供应商');
  }

  return lines.join('\n');
}

export default function SummaryModal({ open, inquiry, data, rows, onClose }: SummaryModalProps) {
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const isMobile = useIsMobile();
  const templateSummary = buildSummary(inquiry, data, rows);
  const displayText = aiText || templateSummary;

  const handleAiGenerate = async () => {
    setAiLoading(true);
    try {
      const text = await generateCompareConclusion(inquiry, data, rows);
      setAiText(text);
    } catch {
      notifyWarning('AI 生成失败，已显示模板摘要');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <span>报价对比摘要</span>
          {aiText && <Tag color="purple">AI 生成</Tag>}
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText="关闭"
      cancelButtonProps={{ style: { display: 'none' } }}
      width={isMobile ? '92vw' : 680}
      style={isMobile ? { top: 20 } : undefined}
    >
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          系统根据各供应商报价自动生成摘要，可点击右侧复制按钮复制全文：
        </Text>
        <Button
          size="small"
          icon={<RobotOutlined />}
          loading={aiLoading}
          onClick={handleAiGenerate}
        >
          {aiText ? '重新生成 AI 结论' : 'AI 生成结论'}
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
