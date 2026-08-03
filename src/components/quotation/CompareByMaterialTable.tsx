/**
 * 按物料对比表格：物料为行，供应商为列
 * - 自动标记每物料最低含税单价（绿）与最快交货（蓝）
 * - 异常高价/低价提示
 * - 每行可选"推荐供应商"
 */
import { Select, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type Inquiry, type InquiryItem, type QuotationItem } from '@/types';
import { SupplierLevelTag } from '@/components/StatusTag';
import { formatCurrency, formatDate, formatPercent } from '@/utils/format';
import {
  type CompareData,
  type SupplierQuoteRow,
  getAvgUnitPrice,
  getFastestDelivery,
  getMinUnitPrice,
  getQuotationItem,
  isHighPrice,
  isLowPrice,
} from './scoreUtils';

const { Text } = Typography;

interface CompareByMaterialTableProps {
  inquiry: Inquiry;
  data: CompareData;
  rows: SupplierQuoteRow[];
  selectedSupplierMap: Record<string, string>;
  onSelectSupplier: (itemId: string, supplierId: string) => void;
  onOpenDrawer: (supplierId: string) => void;
}

/** 单元格内一行：label + value */
function Line({ label, value, color, tag }: { label: string; value: React.ReactNode; color?: string; tag?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '20px' }}>
      <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {label}
      </Text>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color, fontWeight: color ? 600 : 400, textAlign: 'right' }}>
        {value}
        {tag}
      </span>
    </div>
  );
}

/** 供应商对某物料的报价单元格 */
function QuoteCell({
  qi,
  row,
  item,
  data,
  currency,
  onOpenDrawer,
}: {
  qi: QuotationItem | undefined;
  row: SupplierQuoteRow;
  item: InquiryItem;
  data: CompareData;
  currency: Inquiry['currency'];
  onOpenDrawer: (supplierId: string) => void;
}) {
  if (!qi) {
    return (
      <div
        style={{ cursor: row.isSubmitted ? 'pointer' : 'not-allowed', padding: '2px 0' }}
        onClick={() => row.isSubmitted && onOpenDrawer(row.supplier.id)}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.isSubmitted ? '未报价' : '已超时'}
        </Text>
      </div>
    );
  }
  const minPrice = getMinUnitPrice(data.submittedRows, item.id);
  const fastest = getFastestDelivery(data.submittedRows, item.id);
  const avg = getAvgUnitPrice(data.submittedRows, item.id);
  const isMin = minPrice !== undefined && qi.unitPrice <= minPrice;
  const isFast = fastest !== undefined && qi.deliveryDays <= fastest;
  const high = avg !== undefined && isHighPrice(qi.unitPrice, avg);
  const low = avg !== undefined && isLowPrice(qi.unitPrice, avg);

  const priceNode = (
    <span
      style={{
        background: isMin ? 'var(--color-success-bg)' : 'transparent',
        padding: '0 4px',
        borderRadius: 3,
        color: isMin ? 'var(--color-success)' : undefined,
      }}
    >
      {formatCurrency(qi.unitPrice, currency)}
    </span>
  );

  return (
    <div
      style={{ cursor: 'pointer', padding: '2px 0' }}
      onClick={() => onOpenDrawer(row.supplier.id)}
      title="点击查看完整报价"
    >
      <Line
        label="单价"
        value={
          high ? (
            <Tooltip title="报价偏高">
              <span style={{ color: 'var(--color-warning)', textDecoration: 'underline' }}>{priceNode}</span>
            </Tooltip>
          ) : low ? (
            <Tooltip title="报价偏低，请核实">
              <span style={{ color: 'var(--color-error)', textDecoration: 'underline' }}>{priceNode}</span>
            </Tooltip>
          ) : (
            priceNode
          )
        }
        color={isMin ? 'var(--color-success)' : undefined}
        tag={isMin ? <Tag color="success" style={{ margin: 0, fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>最低价</Tag> : undefined}
      />
      <Line label="总价" value={formatCurrency(qi.taxIncludedTotal, currency)} />
      <Line
        label="交货"
        value={`${qi.deliveryDays} 天`}
        color={isFast ? 'var(--color-primary)' : undefined}
        tag={isFast ? <Tag color="blue" style={{ margin: 0, fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>最快</Tag> : undefined}
      />
      <Line label="日期" value={formatDate(qi.deliveryDate)} />
      <Line label="质保" value={qi.warrantyMonths ? `${qi.warrantyMonths} 月` : '-'} />
      <Line label="付款" value={qi.paymentTerms || '-'} />
      <Line label="税率" value={formatPercent(qi.taxRate, 0)} />
    </div>
  );
}

export default function CompareByMaterialTable({
  inquiry,
  data,
  rows,
  selectedSupplierMap,
  onSelectSupplier,
  onOpenDrawer,
}: CompareByMaterialTableProps) {
  // 供应商列
  const supplierCols: ColumnsType<InquiryItem> = rows.map((row) => ({
    key: `supplier-${row.supplier.id}`,
    width: 200,
    align: 'left',
    title: (
      <div
        style={{ cursor: 'pointer', minWidth: 168 }}
        onClick={() => onOpenDrawer(row.supplier.id)}
        title="点击查看完整报价"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Text strong style={{ fontSize: 13 }}>
            {row.supplier.name}
          </Text>
          {!row.isSubmitted && <Tag color="error" style={{ margin: 0, fontSize: 11 }}>已超时</Tag>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
          <SupplierLevelTag level={row.supplier.level} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            总额 {formatCurrency(row.totalAmount, inquiry.currency)}
          </Text>
        </div>
      </div>
    ),
    render: (_, item) => (
      <QuoteCell
        qi={getQuotationItem(row, item.id)}
        row={row}
        item={item}
        data={data}
        currency={inquiry.currency}
        onOpenDrawer={onOpenDrawer}
      />
    ),
  }));

  const columns: ColumnsType<InquiryItem> = [
    {
      title: '物料信息',
      key: 'material',
      fixed: 'left',
      width: 260,
      render: (_, item) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            编码：{item.code}
          </Text>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2, lineHeight: '18px' }}>
            规格：{item.spec || '-'}
            <br />
            数量：{item.quantity} {item.unit}
            {item.targetPrice ? ` 目标价：${formatCurrency(item.targetPrice, inquiry.currency)}` : ''}
            {item.expectedDeliveryDate ? ` 期望交货：${formatDate(item.expectedDeliveryDate)}` : ''}
          </div>
        </div>
      ),
    },
    ...supplierCols,
    {
      title: '推荐定标',
      key: 'select',
      fixed: 'right',
      width: 200,
      render: (_, item) => {
        // 候选：对该物料有报价的已提交供应商
        const options = rows
          .filter((r) => r.isSubmitted && getQuotationItem(r, item.id))
          .map((r) => ({ label: r.supplier.name, value: r.supplier.id }));
        const value = selectedSupplierMap[item.id];
        return (
          <Select
            size="small"
            style={{ width: '100%', minWidth: 140 }}
            placeholder="选择推荐供应商"
            value={value}
            options={options}
            onChange={(val) => {
              if (val) onSelectSupplier(item.id, val);
            }}
          />
        );
      },
    },
  ];

  const scrollX = 260 + rows.length * 200 + 200;

  return (
    <Table<InquiryItem>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={data.items}
      pagination={false}
      scroll={{ x: scrollX, y: 'max-content' }}
      bordered
    />
  );
}
