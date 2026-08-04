/**
 * 报价对比页：综合评分规则说明
 */
import { Alert, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function CompareScoreRule() {
  const { t } = useTranslation();
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12, borderRadius: 8 }}
      message={<Text strong>{t('quotation.compare.scoreRule')}</Text>}
      description={
        <span style={{ fontSize: 13 }}>
          {t('quotation.compare.scoreRuleDesc')}
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('quotation.compare.scoreRuleDetail')}
          </Text>
        </span>
      }
    />
  );
}
