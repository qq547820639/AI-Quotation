/**
 * 报价对比页：可对比询价单卡片列表（无 inquiryId 时展示）
 */
import { Card, Col, Descriptions, Empty, Row, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { QuotationStatus, type Inquiry, type Quotation } from '@/types';
import { InquiryStatusTag } from '@/components/StatusTag';
import { formatDate, getRemainingTime } from '@/utils/format';

const { Text } = Typography;

interface Props {
  inquiries: Inquiry[];
  getQuotationsByInquiry: (inquiryId: string) => Quotation[];
  onOpen: (inquiryId: string) => void;
}

export default function CompareInquiryPicker({ inquiries, getQuotationsByInquiry, onOpen }: Props) {
  const { t } = useTranslation();

  if (inquiries.length === 0) {
    return (
      <Card>
        <Empty description={t('quotation.compare.noComparable')} />
      </Card>
    );
  }

  return (
    <Row gutter={[16, 16]}>
      {inquiries.map((inq) => {
        const quos = getQuotationsByInquiry(inq.id);
        const submittedCount = quos.filter((q) => q.status === QuotationStatus.SUBMITTED).length;
        const remaining = getRemainingTime(inq.deadline);
        return (
          <Col xs={24} sm={12} lg={8} xl={6} key={inq.id}>
            <Card
              hoverable
              role="button"
              tabIndex={0}
              aria-label={t('quotation.compare.openCompare', { subject: inq.subject })}
              size="small"
              style={{ borderRadius: 8 }}
              onClick={() => onOpen(inq.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(inq.id);
                }
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 8,
                }}
              >
                <Text strong style={{ fontSize: 14 }}>
                  {inq.subject}
                </Text>
                <InquiryStatusTag status={inq.status} />
              </div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {inq.code}
              </Text>
              <Descriptions
                size="small"
                column={1}
                labelStyle={{ width: 70, fontSize: 12 }}
                contentStyle={{ fontSize: 12 }}
              >
                <Descriptions.Item label={t('quotation.compare.owner')}>
                  {inq.ownerName}
                </Descriptions.Item>
                <Descriptions.Item label={t('quotation.compare.materialRows')}>
                  {inq.items.length} {t('quotation.compare.itemsUnit')}
                </Descriptions.Item>
                <Descriptions.Item label={t('quotation.compare.quotedCount')}>
                  {submittedCount} / {inq.invitedSupplierIds.length}{' '}
                  {t('quotation.compare.supplierUnit')}
                </Descriptions.Item>
                <Descriptions.Item label={t('quotation.compare.deadlineShort')}>
                  {formatDate(inq.deadline)}（{remaining.text}）
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
