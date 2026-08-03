/**
 * 供应商报价详情 Drawer：展示供应商资质 + 完整报价明细 + 采购评语
 */
import { Descriptions, Drawer, Input, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
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
const itemColumns = (itemMap: Map<string, InquiryItem>, currency: Currency): ColumnsType<QuotationItem> => [
  {
    title: '物料名称',
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
  { title: '品牌', dataIndex: 'brand', width: 100, render: (v: string) => v || '-' },
  {
    title: '含税单价',
    dataIndex: 'unitPrice',
    width: 110,
    align: 'right',
    render: (v: number) => formatCurrency(v, currency),
  },
  {
    title: '税率',
    dataIndex: 'taxRate',
    width: 80,
    align: 'right',
    render: (v: number) => formatPercent(v, 0),
  },
  {
    title: '含税总价',
    dataIndex: 'taxIncludedTotal',
    width: 120,
    align: 'right',
    render: (v: number) => formatCurrency(v, currency),
  },
  {
    title: '交货周期',
    dataIndex: 'deliveryDays',
    width: 90,
    align: 'right',
    render: (v: number) => `${v} 天`,
  },
  {
    title: '可交货日期',
    dataIndex: 'deliveryDate',
    width: 110,
    render: (v?: string) => formatDate(v),
  },
  {
    title: '质保',
    dataIndex: 'warrantyMonths',
    width: 80,
    align: 'right',
    render: (v?: number) => (v ? `${v} 月` : '-'),
  },
  {
    title: '付款条件',
    dataIndex: 'paymentTerms',
    width: 160,
    render: (v?: string) => v || '-',
  },
  {
    title: '有效期至',
    dataIndex: 'validUntil',
    width: 110,
    render: (v?: string) => formatDate(v),
  },
  {
    title: '技术偏离',
    dataIndex: 'techDeviation',
    width: 160,
    render: (v?: string) => (v?.trim() ? <Text type="warning">{v}</Text> : '无'),
  },
  {
    title: '商务偏离',
    dataIndex: 'commercialDeviation',
    width: 160,
    render: (v?: string) => (v?.trim() ? <Text type="warning">{v}</Text> : '无'),
  },
  {
    title: '备注',
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
            title="供应商资质"
            size="small"
            column={2}
            bordered
            labelStyle={{ width: 110, background: '#FAFBFC' }}
          >
            <Descriptions.Item label="供应商编码">{supplier.code}</Descriptions.Item>
            <Descriptions.Item label="供应商等级">
              {SUPPLIER_LEVEL_LABEL[supplier.level]}
            </Descriptions.Item>
            <Descriptions.Item label="合作状态">
              {COOPERATION_STATUS_LABEL[supplier.cooperationStatus]}
            </Descriptions.Item>
            <Descriptions.Item label="所在地区">{supplier.region}</Descriptions.Item>
            <Descriptions.Item label="联系人">{supplier.contact}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{supplier.phone}</Descriptions.Item>
            <Descriptions.Item label="邮箱" span={2}>
              {supplier.email}
            </Descriptions.Item>
            <Descriptions.Item label="主营品类" span={2}>
              {supplier.mainCategories?.length ? supplier.mainCategories.join('、') : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="历史响应率">
              {formatPercent(supplier.historyResponseRate)}
            </Descriptions.Item>
            <Descriptions.Item label="历史履约率">
              {formatPercent(supplier.historyFulfillmentRate)}
            </Descriptions.Item>
            <Descriptions.Item label="平均交货">{supplier.avgDeliveryDays} 天</Descriptions.Item>
            <Descriptions.Item label="历史合作次数">{supplier.historyCoopCount} 次</Descriptions.Item>
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
              <Text strong>报价明细</Text>
              <Space align="center">
                <Text type="secondary" style={{ fontSize: 13 }}>
                  报价总额
                </Text>
                <Text strong style={{ color: 'var(--color-primary)', fontSize: 16 }}>
                  {formatCurrency(quotation.totalAmount, inquiry.currency)}
                </Text>
              </Space>
            </div>
            <Table<QuotationItem>
              rowKey="id"
              size="small"
              columns={itemColumns(itemMap, inquiry.currency)}
              dataSource={row.items}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
            {quotation.remark && (
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>
                报价说明：{quotation.remark}
              </Paragraph>
            )}
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              采购评语
            </Text>
            <TextArea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              onBlur={onCommentBlur}
              rows={4}
              placeholder="填写对该供应商报价的评语（失焦自动保存）"
              maxLength={500}
              showCount
            />
          </div>
        </div>
      ) : (
        <Text type="secondary">暂无报价数据</Text>
      )}
    </Drawer>
  );
}

