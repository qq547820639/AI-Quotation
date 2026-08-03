/**
 * 供应商报价详情 Drawer：展示供应商资质 + 完整报价明细 + 采购评语
 */
import { Descriptions, Drawer, Input, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  COOPERATION_STATUS_LABEL,
  SUPPLIER_LEVEL_LABEL,
  type Currency,
  type Inquiry,
  type InquiryItem,
  type QuotationItem,
} from '@/types';
import { SupplierLevelTag, QuotationStatusTag } from '@/components/StatusTag';
import { formatCurrency, formatDate, formatPercent } from '@/utils/format';
import { useIsMobile } from '@/utils/useIsMobile';
import type { SupplierQuoteRow } from './scoreUtils';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface SupplierQuotationDrawerProps {
  open: boolean;
  row: SupplierQuoteRow | undefined;
  inquiry: Inquiry;
  comment: string;
  onCommentChange: (val: string) => void;
  onCommentBlur: () => void;
  onClose: () => void;
}

/** 报价明细表列 */
const itemColumns = (itemMap: Map<string, InquiryItem>, currency: Currency, t: TFunction): ColumnsType<QuotationItem> => [
  {
    title: t('quotation.compare.drawer.materialName'),
    key: 'name',
    width: 160,
    fixed: 'left',
    render: (_, r) => {
      const item = itemMap.get(r.inquiryItemId);
      return (
        <div>
          <div style={{ fontWeight: 500 }}>{item?.name ?? '-'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item?.code ?? '-'}
          </Text>
        </div>
      );
    },
  },
  { title: t('quotation.compare.drawer.brand'), dataIndex: 'brand', width: 100, render: (v: string) => v || '-' },
  {
    title: t('quotation.compare.drawer.taxIncludedUnitPrice'),
    dataIndex: 'unitPrice',
    width: 110,
    align: 'right',
    render: (v: number) => formatCurrency(v, currency),
  },
  {
    title: t('quotation.compare.drawer.taxRate'),
    dataIndex: 'taxRate',
    width: 80,
    align: 'right',
    render: (v: number) => formatPercent(v, 0),
  },
  {
    title: t('quotation.compare.drawer.taxIncludedTotal'),
    dataIndex: 'taxIncludedTotal',
    width: 120,
    align: 'right',
    render: (v: number) => formatCurrency(v, currency),
  },
  {
    title: t('quotation.compare.drawer.deliveryCycle'),
    dataIndex: 'deliveryDays',
    width: 90,
    align: 'right',
    render: (v: number) => `${v} ${t('quotation.compare.drawer.dayUnit')}`,
  },
  {
    title: t('quotation.compare.drawer.deliveryDate'),
    dataIndex: 'deliveryDate',
    width: 110,
    render: (v?: string) => formatDate(v),
  },
  {
    title: t('quotation.compare.drawer.warranty'),
    dataIndex: 'warrantyMonths',
    width: 80,
    align: 'right',
    render: (v?: number) => (v ? `${v} ${t('quotation.compare.drawer.monthUnit')}` : '-'),
  },
  {
    title: t('quotation.compare.drawer.paymentTerms'),
    dataIndex: 'paymentTerms',
    width: 160,
    render: (v?: string) => v || '-',
  },
  {
    title: t('quotation.compare.drawer.validUntil'),
    dataIndex: 'validUntil',
    width: 110,
    render: (v?: string) => formatDate(v),
  },
  {
    title: t('quotation.compare.drawer.techDeviation'),
    dataIndex: 'techDeviation',
    width: 160,
    render: (v?: string) => (v?.trim() ? <Text type="warning">{v}</Text> : t('quotation.compare.drawer.none')),
  },
  {
    title: t('quotation.compare.drawer.commercialDeviation'),
    dataIndex: 'commercialDeviation',
    width: 160,
    render: (v?: string) => (v?.trim() ? <Text type="warning">{v}</Text> : t('quotation.compare.drawer.none')),
  },
  {
    title: t('quotation.compare.drawer.remark'),
    dataIndex: 'remark',
    width: 180,
    render: (v?: string) => v || '-',
  },
];

export default function SupplierQuotationDrawer({
  open,
  row,
  inquiry,
  comment,
  onCommentChange,
  onCommentBlur,
  onClose,
}: SupplierQuotationDrawerProps) {
  const { t } = useTranslation();
  const itemMap = new Map(inquiry.items.map((it) => [it.id, it]));
  const supplier = row?.supplier;
  const quotation = row?.quotation;
  const isMobile = useIsMobile();

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{supplier?.name}</span>
          {supplier && <SupplierLevelTag level={supplier.level} />}
          {row && <QuotationStatusTag status={row.status} />}
        </div>
      }
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 960}
      styles={isMobile ? { body: { padding: 12 } } : undefined}
      destroyOnClose
    >
      {row && supplier && quotation ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Descriptions
            title={t('quotation.compare.drawer.supplierQualification')}
            size="small"
            column={2}
            bordered
            labelStyle={{ width: 110, background: '#FAFBFC' }}
          >
            <Descriptions.Item label={t('quotation.compare.drawer.supplierCode')}>{supplier.code}</Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.supplierLevel')}>
              {SUPPLIER_LEVEL_LABEL[supplier.level]}
            </Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.cooperationStatus')}>
              {COOPERATION_STATUS_LABEL[supplier.cooperationStatus]}
            </Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.region')}>{supplier.region}</Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.contact')}>{supplier.contact}</Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.phone')}>{supplier.phone}</Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.email')} span={2}>
              {supplier.email}
            </Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.mainCategories')} span={2}>
              {supplier.mainCategories?.length ? supplier.mainCategories.join(t('quotation.compare.drawer.categorySeparator')) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.historyResponseRate')}>
              {formatPercent(supplier.historyResponseRate)}
            </Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.historyFulfillmentRate')}>
              {formatPercent(supplier.historyFulfillmentRate)}
            </Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.avgDelivery')}>{supplier.avgDeliveryDays} {t('quotation.compare.drawer.dayUnit')}</Descriptions.Item>
            <Descriptions.Item label={t('quotation.compare.drawer.historyCoopCount')}>{supplier.historyCoopCount} {t('quotation.compare.drawer.timeUnit')}</Descriptions.Item>
          </Descriptions>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Text strong>{t('quotation.compare.drawer.quotationDetail')}</Text>
              <Space align="center">
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {t('quotation.compare.drawer.quotationTotal')}
                </Text>
                <Text strong style={{ color: 'var(--color-primary)', fontSize: 16 }}>
                  {formatCurrency(quotation.totalAmount, inquiry.currency)}
                </Text>
              </Space>
            </div>
            <Table<QuotationItem>
              rowKey="id"
              size="small"
              columns={itemColumns(itemMap, inquiry.currency, t)}
              dataSource={row.items}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
            {quotation.remark && (
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>
                {t('quotation.compare.drawer.quotationRemark')}：{quotation.remark}
              </Paragraph>
            )}
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('quotation.compare.drawer.purchaserComment')}
            </Text>
            <TextArea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              onBlur={onCommentBlur}
              rows={4}
              placeholder={t('quotation.compare.drawer.commentPlaceholder')}
              maxLength={500}
              showCount
            />
          </div>
        </div>
      ) : (
        <Text type="secondary">{t('quotation.compare.drawer.noData')}</Text>
      )}
    </Drawer>
  );
}
