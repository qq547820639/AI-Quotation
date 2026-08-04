/**
 * 报价对比页：报价回收风险提示（未报价 / 部分报价 / 异常报价）
 */
import { Alert, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Inquiry } from '@/types';
import type { AnomalyAnalysisResult } from '@/utils/aiService';

const { Text } = Typography;

interface Props {
  inquiry: Inquiry;
  submittedCount: number;
  aiAnalysis: AnomalyAnalysisResult | null;
}

export default function CompareRiskAlert({ inquiry, submittedCount, aiAnalysis }: Props) {
  const { t } = useTranslation();

  const invitedCount = inquiry.invitedSupplierIds.length;
  const unquotedCount = Math.max(0, invitedCount - submittedCount);
  const hasUnquoted = unquotedCount > 0;
  const hasAnomaly = !!aiAnalysis?.hasAnomaly;
  if (!hasUnquoted && !hasAnomaly) return null;

  const description = (
    <span style={{ fontSize: 13 }}>
      {hasUnquoted && (
        <div>
          {t('quotation.compare.riskUnquoted', { count: unquotedCount, total: invitedCount })}
          {t('quotation.compare.riskUnquotedHint')}
        </div>
      )}
      {hasAnomaly && (
        <div style={{ marginTop: hasUnquoted ? 4 : 0 }}>
          {t('quotation.compare.riskAnomalyHint')}
        </div>
      )}
    </span>
  );

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 12, borderRadius: 8 }}
      message={<Text strong>{t('quotation.compare.riskTitle')}</Text>}
      description={description}
    />
  );
}
