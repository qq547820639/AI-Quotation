/**
 * 报价对比页：询价单基本信息卡片
 */
import { Card, Descriptions } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Inquiry } from '@/types';
import { InquiryStatusTag } from '@/components/StatusTag';
import { formatDate } from '@/utils/format';

interface Props {
  inquiry: Inquiry;
  visibleRowCount: number;
}

export default function CompareInfoCard({ inquiry, visibleRowCount }: Props) {
  const { t } = useTranslation();
  return (
    <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
        <Descriptions.Item label={t('quotation.compare.inquiryStatus')}>
          <InquiryStatusTag status={inquiry.status} />
        </Descriptions.Item>
        <Descriptions.Item label={t('inquiry.list.currency')}>{inquiry.currency}</Descriptions.Item>
        <Descriptions.Item label={t('quotation.compare.owner')}>
          {inquiry.ownerName}
        </Descriptions.Item>
        <Descriptions.Item label={t('common.deadline')}>
          {formatDate(inquiry.deadline, 'YYYY-MM-DD HH:mm')}
        </Descriptions.Item>
        <Descriptions.Item label={t('quotation.compare.materialRowCount')}>
          {inquiry.items.length} {t('quotation.compare.itemsUnit')}
        </Descriptions.Item>
        <Descriptions.Item label={t('quotation.compare.participating')}>
          {t('quotation.compare.suppliersCount', { count: visibleRowCount })}
        </Descriptions.Item>
        <Descriptions.Item label={t('quotation.compare.selectedRecommendation')}>
          {Object.keys(inquiry.selectedSupplierMap).length} {t('quotation.compare.itemsUnit')}
        </Descriptions.Item>
        <Descriptions.Item label={t('quotation.compare.paymentTerms')}>
          {inquiry.paymentTerms}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
