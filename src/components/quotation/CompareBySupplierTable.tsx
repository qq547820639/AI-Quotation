/**
 * 按供应商对比表格：供应商为行，维度为列
 */
import { memo } from 'react';
import { Progress, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { type Inquiry } from '@/types';
import { CooperationStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import { formatCurrency, formatDate, formatPercent } from '@/utils/format';
import {
  type CompareData,
  type SupplierQuoteRow,
  joinDeviations,
} from './scoreUtils';

const { Text } = Typography;

interface CompareBySupplierTableProps {
  inquiry: Inquiry;
  data: CompareData;
  rows: SupplierQuoteRow[];
  onOpenDrawer: (supplierId: string) => void;
}

function CompareBySupplierTable({
  inquiry,
  data,
  rows,
  onOpenDrawer,
}: CompareBySupplierTableProps) {
  const { t } = useTranslation();
  const columns: ColumnsType<SupplierQuoteRow> = [
    {
      title: t('quotation.compare.supplier'),
      key: 'supplier',
      fixed: 'left',
      width: 220,
      render: (_, row) => (
        <div
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenDrawer(row.supplier.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDrawer(row.supplier.id); } }}
          title={t('quotation.compare.supplierTable.viewQuote')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <Text strong style={{ fontSize: 13 }}>
              {row.supplier.name}
            </Text>
            {!row.isSubmitted && <Tag color="error" style={{ margin: 0, fontSize: 11 }}>{t('quotation.compare.supplierTable.timeout')}</Tag>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            <SupplierLevelTag level={row.supplier.level} />
            <CooperationStatusTag status={row.supplier.cooperationStatus} />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.supplier.code}
          </Text>
        </div>
      ),
    },
    {
      title: t('quotation.compare.supplierTable.quotationTotal'),
      key: 'totalAmount',
      width: 130,
      align: 'right',
      sorter: (a, b) => a.totalAmount - b.totalAmount,
      render: (_, row) => {
        const isLowest = data.lowestTotalSupplierId === row.supplier.id;
        return (
          <span style={{ color: isLowest ? 'var(--color-success)' : undefined, fontWeight: isLowest ? 600 : 400 }}>
            {formatCurrency(row.totalAmount, inquiry.currency)}
            {isLowest && (
              <Tag color="success" style={{ marginInlineStart: 4, fontSize: 11 }}>
                {t('quotation.compare.supplierTable.lowest')}
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      title: t('quotation.compare.supplierTable.avgDeliveryCycle'),
      key: 'avgDeliveryDays',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.avgDeliveryDays - b.avgDeliveryDays,
      render: (_, row) => {
        const isFastest = data.fastestDeliverySupplierId === row.supplier.id;
        return (
          <span style={{ color: isFastest ? 'var(--color-primary)' : undefined, fontWeight: isFastest ? 600 : 400 }}>
            {row.avgDeliveryDays ? `${row.avgDeliveryDays.toFixed(1)} ${t('quotation.compare.supplierTable.dayUnit')}` : '-'}
            {isFastest && (
              <Tag color="blue" style={{ marginInlineStart: 4, fontSize: 11 }}>
                {t('quotation.compare.supplierTable.fastest')}
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      title: t('quotation.compare.supplierTable.earliestDeliveryDate'),
      key: 'earliestDeliveryDate',
      width: 120,
      render: (_, row) => formatDate(row.earliestDeliveryDate),
    },
    {
      title: t('quotation.compare.supplierTable.avgWarranty'),
      key: 'avgWarrantyMonths',
      width: 100,
      align: 'right',
      render: (_, row) => (row.avgWarrantyMonths ? `${row.avgWarrantyMonths.toFixed(1)} ${t('quotation.compare.supplierTable.monthUnit')}` : '-'),
    },
    {
      title: t('quotation.compare.supplierTable.paymentTerms'),
      key: 'paymentTerms',
      width: 180,
      render: (_, row) => row.paymentTerms || inquiry.paymentTerms || '-',
    },
    {
      title: t('quotation.compare.supplierTable.techDeviation'),
      key: 'techDeviations',
      width: 180,
      render: (_, row) => {
        const text = joinDeviations(row.techDeviations);
        return text === '无' ? (
          <Text type="secondary">{t('quotation.compare.supplierTable.none')}</Text>
        ) : (
          <Tooltip title={text}>
            <Text type="warning" style={{ fontSize: 12 }}>
              {text.length > 16 ? `${text.slice(0, 16)}…` : text}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: t('quotation.compare.supplierTable.commercialDeviation'),
      key: 'commercialDeviations',
      width: 180,
      render: (_, row) => {
        const text = joinDeviations(row.commercialDeviations);
        return text === '无' ? (
          <Text type="secondary">{t('quotation.compare.supplierTable.none')}</Text>
        ) : (
          <Tooltip title={text}>
            <Text type="warning" style={{ fontSize: 12 }}>
              {text.length > 16 ? `${text.slice(0, 16)}…` : text}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: t('quotation.compare.supplierTable.historyResponseRate'),
      key: 'historyResponseRate',
      width: 110,
      align: 'right',
      render: (_, row) => formatPercent(row.supplier.historyResponseRate),
    },
    {
      title: t('quotation.compare.supplierTable.historyFulfillmentRate'),
      key: 'historyFulfillmentRate',
      width: 110,
      align: 'right',
      render: (_, row) => formatPercent(row.supplier.historyFulfillmentRate),
    },
    {
      title: t('quotation.compare.supplierTable.score'),
      key: 'score',
      width: 160,
      sorter: (a, b) => (data.scores[a.supplier.id]?.total ?? 0) - (data.scores[b.supplier.id]?.total ?? 0),
      render: (_, row) => {
        const score = data.scores[row.supplier.id];
        if (!score) return <Text type="secondary">-</Text>;
        const isTop = data.topScoreSupplierId === row.supplier.id;
        const percent = Math.round(score.total);
        const color = isTop ? 'var(--color-success)' : percent >= 75 ? 'var(--color-primary)' : percent >= 60 ? 'var(--color-warning)' : 'var(--color-error)';
        return (
          <Tooltip
            title={
              <div style={{ fontSize: 12 }}>
                <div>{t('quotation.compare.supplierTable.amountLabel')}：{score.price.toFixed(2)} / 50</div>
                <div>{t('quotation.compare.supplierTable.deliveryLabel')}：{score.delivery.toFixed(2)} / 20</div>
                <div>{t('quotation.compare.supplierTable.levelLabel')}：{score.level.toFixed(2)} / 15</div>
                <div>{t('quotation.compare.supplierTable.fulfillmentLabel')}：{score.fulfillment.toFixed(2)} / 15</div>
              </div>
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Progress
                percent={percent}
                size="small"
                strokeColor={color}
                style={{ width: 100, margin: 0 }}
                format={() => `${percent}`}
              />
              {isTop && (
                <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
                  {t('quotation.compare.supplierTable.best')}
                </Tag>
              )}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: t('quotation.compare.supplierTable.isLowestTotal'),
      key: 'isLowest',
      width: 110,
      align: 'center',
      render: (_, row) =>
        data.lowestTotalSupplierId === row.supplier.id ? (
          <Tag color="success">{t('quotation.compare.supplierTable.yes')}</Tag>
        ) : (
          <Text type="secondary">{t('quotation.compare.supplierTable.no')}</Text>
        ),
    },
  ];

  return (
    <Table<SupplierQuoteRow>
      rowKey={(r) => r.supplier.id}
      size="small"
      columns={columns}
      dataSource={rows}
      pagination={false}
      scroll={{ x: 'max-content' }}
      bordered
    />
  );
}

/** React.memo：父组件任意状态变化（含评语输入）不重渲染大表，仅 props 变化时重渲染 */
export default memo(CompareBySupplierTable);
