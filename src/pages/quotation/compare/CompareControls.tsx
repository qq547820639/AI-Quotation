/**
 * 报价对比页：视图/排序/隐藏未报价 控制栏
 */
import { Card, Segmented, Space, Switch, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { SortMode } from '@/components/quotation/scoreUtils';
import type { ViewMode } from './types';

const { Text } = Typography;

interface Props {
  viewMode: ViewMode;
  sortMode: SortMode;
  hideUnquoted: boolean;
  onViewModeChange: (v: ViewMode) => void;
  onSortModeChange: (v: SortMode) => void;
  onHideUnquotedChange: (v: boolean) => void;
}

export default function CompareControls({
  viewMode,
  sortMode,
  hideUnquoted,
  onViewModeChange,
  onSortModeChange,
  onHideUnquotedChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
      <Space wrap size="middle">
        <Segmented
          value={viewMode}
          onChange={(v) => onViewModeChange(v as ViewMode)}
          options={[
            { label: t('quotation.compare.byMaterial'), value: 'material' },
            { label: t('quotation.compare.bySupplier'), value: 'supplier' },
          ]}
        />
        <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          {t('quotation.compare.sortBy')}
        </span>
        <Segmented
          value={sortMode}
          onChange={(v) => onSortModeChange(v as SortMode)}
          options={[
            { label: t('quotation.compare.sortTotalAsc'), value: 'totalAsc' },
            { label: t('quotation.compare.sortDeliveryAsc'), value: 'deliveryAsc' },
            { label: t('quotation.compare.sortScoreDesc'), value: 'scoreDesc' },
          ]}
        />
        <Space size="small">
          <Switch size="small" checked={hideUnquoted} onChange={onHideUnquotedChange} />
          <Text style={{ fontSize: 13 }}>{t('quotation.compare.hideUnquoted')}</Text>
        </Space>
      </Space>
    </Card>
  );
}
