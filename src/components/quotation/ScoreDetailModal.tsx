/**
 * 评分明细 Modal（Task 6）
 * - 展示每个供应商的分项得分与权重（金额/交期/等级/履约）及总分
 * - 支持通过 Slider 调整各维度权重并实时重算总分，持久化到 localStorage
 * - 标注"由规则引擎生成"，供用户手动调整推荐结果
 */
import { useMemo, useState } from 'react';
import { Button, Divider, Modal, Slider, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { useIsMobile } from '@/utils/useIsMobile';
import { type CompareData, type ScoreWeights, type SupplierQuoteRow, calcScoreWithWeights, loadScoreWeights, saveScoreWeights } from './scoreUtils';

const { Text } = Typography;

interface ScoreDetailModalProps {
  open: boolean;
  data: CompareData;
  rows: SupplierQuoteRow[];
  onClose: () => void;
}

const DIMENSIONS: { key: keyof ScoreWeights; labelKey: string; scoreKey: 'price' | 'delivery' | 'level' | 'fulfillment' }[] = [
  { key: 'price', labelKey: 'quotation.compare.scoreDetailLabels.amount', scoreKey: 'price' },
  { key: 'delivery', labelKey: 'quotation.compare.scoreDetailLabels.delivery', scoreKey: 'delivery' },
  { key: 'level', labelKey: 'quotation.compare.scoreDetailLabels.level', scoreKey: 'level' },
  { key: 'fulfillment', labelKey: 'quotation.compare.scoreDetailLabels.fulfillment', scoreKey: 'fulfillment' },
];

export default function ScoreDetailModal({ open, data, rows, onClose }: ScoreDetailModalProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [weights, setWeights] = useState<ScoreWeights>(() => loadScoreWeights());

  const submittedRows = rows.filter((r) => r.isSubmitted);

  // 按当前权重实时重算各供应商总分
  const recalculated = useMemo(() => {
    const map: Record<string, ReturnType<typeof calcScoreWithWeights>> = {};
    for (const r of submittedRows) {
      map[r.supplier.id] = calcScoreWithWeights(r, data.minTotal, data.fastestAvgDelivery, weights);
    }
    return map;
  }, [submittedRows, data.minTotal, data.fastestAvgDelivery, weights]);

  const topScoreSupplierId = useMemo(() => {
    let best: string | undefined;
    let bestTotal = -1;
    for (const [id, s] of Object.entries(recalculated)) {
      if (s.total > bestTotal) {
        bestTotal = s.total;
        best = id;
      }
    }
    return best;
  }, [recalculated]);

  const handleWeightChange = (key: keyof ScoreWeights, value: number) => {
    const next = { ...weights, [key]: value / 100 };
    setWeights(next);
    saveScoreWeights(next);
  };

  const columns: ColumnsType<SupplierQuoteRow> = [
    {
      title: t('quotation.compare.supplier'),
      key: 'supplier',
      width: 180,
      render: (_, row) => (
        <Space>
          <Text strong>{row.supplier.name}</Text>
          {row.supplier.id === topScoreSupplierId && (
            <Tag color="success" style={{ margin: 0, fontSize: 11 }}>{t('quotation.compare.supplierTable.best')}</Tag>
          )}
        </Space>
      ),
    },
    ...DIMENSIONS.map((d) => ({
      title: (
        <span>
          {t(d.labelKey)}
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            {t('quotation.compare.weightLabel', { weight: Math.round(weights[d.key] * 100) })}
          </Text>
        </span>
      ),
      key: d.key,
      align: 'right' as const,
      width: 110,
      render: (_: unknown, row: SupplierQuoteRow) => {
        const s = recalculated[row.supplier.id];
        return s ? s[d.scoreKey].toFixed(2) : '-';
      },
    })),
    {
      title: t('quotation.compare.score'),
      key: 'total',
      align: 'right',
      width: 100,
      render: (_, row) => {
        const s = recalculated[row.supplier.id];
        if (!s) return <Text type="secondary">-</Text>;
        return <Text strong style={{ color: row.supplier.id === topScoreSupplierId ? 'var(--color-success)' : undefined }}>{s.total.toFixed(2)}</Text>;
      },
    },
  ];

  const topRow = topScoreSupplierId ? rows.find((r) => r.supplier.id === topScoreSupplierId) : undefined;
  const topScore = topScoreSupplierId ? recalculated[topScoreSupplierId] : undefined;

  return (
    <Modal
      title={t('quotation.compare.scoreDetailTitle')}
      open={open}
      onCancel={onClose}
      onOk={onClose}
      okText={t('quotation.compare.summary.closeBtn')}
      cancelButtonProps={{ style: { display: 'none' } }}
      width={isMobile ? '94vw' : 720}
      style={isMobile ? { top: 20 } : undefined}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>
            {t('quotation.compare.scoreWeightAdjust')}
          </Text>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {DIMENSIONS.map((d) => (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Text style={{ width: 72, fontSize: 13, flexShrink: 0 }}>{t(d.labelKey)}</Text>
                <Slider
                  style={{ flex: 1 }}
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(weights[d.key] * 100)}
                  onChange={(v) => handleWeightChange(d.key, v as number)}
                  tooltip={{ formatter: (v) => `${v}%` }}
                />
                <Text type="secondary" style={{ width: 40, textAlign: 'right', fontSize: 13 }}>
                  {Math.round(weights[d.key] * 100)}%
                </Text>
              </div>
            ))}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('quotation.compare.weightEditHint')}
          </Text>
        </div>

        <Divider style={{ margin: 0 }} />

        <Table<SupplierQuoteRow>
          rowKey={(r) => r.supplier.id}
          size="small"
          columns={columns}
          dataSource={submittedRows}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />

        <Divider style={{ margin: 0 }} />

        <div>
          <Space wrap>
            <Tag color="purple" style={{ margin: 0 }}>{t('quotation.compare.ruleEngineTag')}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('quotation.compare.ruleEngineNote')}
            </Text>
          </Space>
          {topRow && topScore && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <Text>
                {t('quotation.compare.ruleRecommendation', {
                  name: topRow.supplier.name,
                  total: topScore.total.toFixed(2),
                  price: topScore.price.toFixed(1),
                  delivery: topScore.delivery.toFixed(1),
                  level: topScore.level.toFixed(1),
                  fulfillment: topScore.fulfillment.toFixed(1),
                })}
              </Text>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Button size="small" type="default" onClick={onClose}>
              {t('quotation.compare.manualAdjustHint')}
            </Button>
          </div>
        </div>
      </Space>
    </Modal>
  );
}