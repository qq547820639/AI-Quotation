/**
 * 报价对比页：AI 异常分析结果提示
 */
import { Alert, Space, Tag, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { AnomalyAnalysisResult } from '@/utils/aiService';

const { Text } = Typography;

interface Props {
  aiAnalysis: AnomalyAnalysisResult;
  onClose: () => void;
}

export default function CompareAiResult({ aiAnalysis, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Alert
      message={
        <Space>
          <RobotOutlined />
          <Text strong>
            {aiAnalysis.hasAnomaly
              ? t('quotation.compare.aiResult', { count: aiAnalysis.anomalyCount })
              : t('quotation.compare.aiResultNoAnomaly')}
          </Text>
          <Tag color="purple" style={{ marginInlineStart: 4 }}>
            {t('quotation.compare.aiGenerated')}
          </Tag>
        </Space>
      }
      description={
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: 13,
            margin: 0,
            lineHeight: 1.7,
          }}
        >
          {aiAnalysis.summary}
        </pre>
      }
      type={aiAnalysis.hasAnomaly ? 'warning' : 'success'}
      showIcon
      closable
      onClose={onClose}
      style={{ marginBottom: 12, borderRadius: 8, alignItems: 'flex-start' }}
    />
  );
}
