/**
 * 报价对比页：三项最优供应商卡片（最低总价 / 最快交货 / 综合评分最高）
 */
import { Card, Col, Row, Statistic, Tag, Typography } from 'antd';
import { TrophyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Currency } from '@/types';
import type { CompareData } from '@/components/quotation/scoreUtils';
import { formatCurrency } from '@/utils/format';

const { Text } = Typography;

interface Props {
  data: CompareData;
  currency: Currency;
}

export default function CompareBestThree({ data, currency }: Props) {
  const { t } = useTranslation();

  const lowestRow = data.rows.find((r) => r.supplier.id === data.lowestTotalSupplierId);
  const fastestRow = data.rows.find((r) => r.supplier.id === data.fastestDeliverySupplierId);
  const topRow = data.rows.find((r) => r.supplier.id === data.topScoreSupplierId);
  const topScore = data.topScoreSupplierId ? data.scores[data.topScoreSupplierId] : undefined;

  return (
    <Row gutter={12} style={{ marginBottom: 12 }}>
      <Col xs={24} sm={8}>
        <Card size="small" style={{ borderRadius: 8 }}>
          <Statistic
            title={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('quotation.compare.lowestTotalSupplier')}
              </Text>
            }
            valueRender={() => (
              <div>
                <Text strong style={{ fontSize: 16 }}>
                  {lowestRow?.supplier.name ?? '-'}
                </Text>
                {lowestRow && (
                  <div style={{ marginTop: 4 }}>
                    <Text style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                      {formatCurrency(lowestRow.totalAmount, currency)}
                    </Text>
                  </div>
                )}
              </div>
            )}
            prefix={
              <Tag color="success" style={{ marginInlineEnd: 4 }}>
                {t('quotation.compare.lowestPrice')}
              </Tag>
            }
          />
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card size="small" style={{ borderRadius: 8 }}>
          <Statistic
            title={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('quotation.compare.fastestDeliverySupplier')}
              </Text>
            }
            valueRender={() => (
              <div>
                <Text strong style={{ fontSize: 16 }}>
                  {fastestRow?.supplier.name ?? '-'}
                </Text>
                {fastestRow && (
                  <div style={{ marginTop: 4 }}>
                    <Text style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                      {t('quotation.compare.avgDays', {
                        count: fastestRow.avgDeliveryDays.toFixed(1),
                      })}
                    </Text>
                  </div>
                )}
              </div>
            )}
            prefix={
              <Tag color="blue" style={{ marginInlineEnd: 4 }}>
                {t('quotation.compare.fastestDelivery')}
              </Tag>
            }
          />
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card size="small" style={{ borderRadius: 8 }}>
          <Statistic
            title={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('quotation.compare.topScoreSupplier')}
              </Text>
            }
            valueRender={() => (
              <div>
                <Text strong style={{ fontSize: 16 }}>
                  {topRow?.supplier.name ?? '-'}
                </Text>
                {topScore && (
                  <div style={{ marginTop: 4 }}>
                    <Text style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                      {t('quotation.compare.scoreValue', { score: topScore.total.toFixed(2) })}
                    </Text>
                  </div>
                )}
              </div>
            )}
            prefix={<TrophyOutlined style={{ color: 'var(--color-warning)' }} />}
          />
        </Card>
      </Col>
    </Row>
  );
}
