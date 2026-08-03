/**
 * 按供应商对比表格：供应商为行，维度为列
 */
import { Progress, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
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

export default function CompareBySupplierTable({
  inquiry,
  data,
  rows,
  onOpenDrawer,
}: CompareBySupplierTableProps) {
  const columns: ColumnsType<SupplierQuoteRow> = [
    {
      title: '供应商',
      key: 'supplier',
      fixed: 'left',
      width: 220,
      render: (_, row) => (
        <div
          style={{ cursor: 'pointer' }}
          onClick={() => onOpenDrawer(row.supplier.id)}
          title="点击查看完整报价"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <Text strong style={{ fontSize: 13 }}>
              {row.supplier.name}
            </Text>
            {!row.isSubmitted && <Tag color="error" style={{ margin: 0, fontSize: 11 }}>已超时</Tag>}
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
      title: '报价总金额',
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
                最低
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      title: '平均交货周期',
      key: 'avgDeliveryDays',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.avgDeliveryDays - b.avgDeliveryDays,
      render: (_, row) => {
        const isFastest = data.fastestDeliverySupplierId === row.supplier.id;
        return (
          <span style={{ color: isFastest ? 'var(--color-primary)' : undefined, fontWeight: isFastest ? 600 : 400 }}>
            {row.avgDeliveryDays ? `${row.avgDeliveryDays.toFixed(1)} 天` : '-'}
            {isFastest && (
              <Tag color="blue" style={{ marginInlineStart: 4, fontSize: 11 }}>
                最快
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      title: '最早可交货日期',
      key: 'earliestDeliveryDate',
      width: 120,
      render: (_, row) => formatDate(row.earliestDeliveryDate),
    },
    {
      title: '平均质保',
      key: 'avgWarrantyMonths',
      width: 100,
      align: 'right',
      render: (_, row) => (row.avgWarrantyMonths ? `${row.avgWarrantyMonths.toFixed(1)} 月` : '-'),
    },
    {
      title: '付款条件',
      key: 'paymentTerms',
      width: 180,
      render: (_, row) => row.paymentTerms || inquiry.paymentTerms || '-',
    },
    {
      title: '技术偏离',
      key: 'techDeviations',
      width: 180,
      render: (_, row) => {
        const text = joinDeviations(row.techDeviations);
        return text === '无' ? (
          <Text type="secondary">无</Text>
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
      title: '商务偏离',
      key: 'commercialDeviations',
      width: 180,
      render: (_, row) => {
        const text = joinDeviations(row.commercialDeviations);
        return text === '无' ? (
          <Text type="secondary">无</Text>
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
      title: '历史响应率',
      key: 'historyResponseRate',
      width: 110,
      align: 'right',
      render: (_, row) => formatPercent(row.supplier.historyResponseRate),
    },
    {
      title: '历史履约率',
      key: 'historyFulfillmentRate',
      width: 110,
      align: 'right',
      render: (_, row) => formatPercent(row.supplier.historyFulfillmentRate),
    },
    {
      title: '综合评分',
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
                <div>金额：{score.price.toFixed(2)} / 50</div>
                <div>交货：{score.delivery.toFixed(2)} / 20</div>
                <div>等级：{score.level.toFixed(2)} / 15</div>
                <div>履约：{score.fulfillment.toFixed(2)} / 15</div>
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
                  最优
                </Tag>
              )}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '是否最低总价',
      key: 'isLowest',
      width: 110,
      align: 'center',
      render: (_, row) =>
        data.lowestTotalSupplierId === row.supplier.id ? (
          <Tag color="success">是</Tag>
        ) : (
          <Text type="secondary">否</Text>
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
