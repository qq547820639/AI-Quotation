/**
 * 供应商门户：提交前预览 Modal（P2 Task 17）
 * 正式提交前展示结构化报价预览（逐项单价/税率/交期/含税小计 + 总额 + 不完整项提示），
 * 供供应商最终核对，确认无误后再提交（提交后不可修改）。
 */
import { Alert, Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { PortalInquiry } from '@/api/portal';
import { formatCurrency } from '@/utils/format';
import { useIsMobile } from '@/utils/useIsMobile';
import { calcItemTotal, type QuotationFormItem } from './types';

const { Text } = Typography;

interface ItemPreview {
  key: string;
  name: string;
  code: string;
  quantity: number;
  unit: string;
  unitPrice: number | undefined;
  taxRate: number;
  deliveryDays: number | undefined;
  taxIncludedTotal: number;
  complete: boolean;
}

interface SubmitPreviewModalProps {
  open: boolean;
  inquiry: PortalInquiry;
  items: QuotationFormItem[];
  remark: string;
  totalAmount: number;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SubmitPreviewModal({
  open,
  inquiry,
  items,
  remark,
  totalAmount,
  loading,
  onConfirm,
  onCancel,
}: SubmitPreviewModalProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const previewRows: ItemPreview[] = items.map((f) => {
    const it = inquiry.items.find((i) => i.id === f.inquiryItemId);
    const quantity = it?.quantity ?? 0;
    const complete = (f.unitPrice ?? 0) > 0 && (f.deliveryDays ?? 0) > 0;
    return {
      key: f.inquiryItemId,
      name: it?.name ?? f.inquiryItemId,
      code: it?.code ?? '',
      quantity,
      unit: it?.unit ?? '',
      unitPrice: f.unitPrice,
      taxRate: f.taxRate,
      deliveryDays: f.deliveryDays,
      taxIncludedTotal: calcItemTotal(f.unitPrice, quantity),
      complete,
    };
  });

  const incompleteCount = previewRows.filter((r) => !r.complete).length;

  const columns: ColumnsType<ItemPreview> = [
    { title: t('material.list.name'), dataIndex: 'name', width: 140 },
    { title: t('material.list.code'), dataIndex: 'code', width: 110 },
    {
      title: t('inquiry.create.material.quantity'),
      dataIndex: 'quantity',
      width: 90,
      align: 'right',
      render: (q: number, r) => `${q} ${r.unit}`,
    },
    {
      title: t('supplierPortal.previewUnitPrice'),
      dataIndex: 'unitPrice',
      width: 110,
      align: 'right',
      render: (v: number | undefined) =>
        v != null ? formatCurrency(v, inquiry.currency as never) : <Text type="secondary">-</Text>,
    },
    {
      title: t('supplierPortal.taxRate'),
      dataIndex: 'taxRate',
      width: 80,
      align: 'right',
      render: (v: number) => `${v * 100}%`,
    },
    {
      title: t('supplierPortal.previewDelivery'),
      dataIndex: 'deliveryDays',
      width: 100,
      align: 'right',
      render: (v: number | undefined) =>
        v != null ? `${v} ${t('common.days')}` : <Text type="secondary">-</Text>,
    },
    {
      title: t('supplierPortal.taxIncludedTotal'),
      dataIndex: 'taxIncludedTotal',
      width: 120,
      align: 'right',
      render: (v: number) =>
        v > 0 ? (
          <Text strong>{formatCurrency(v, inquiry.currency as never)}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
  ];

  return (
    <Modal
      title={t('supplierPortal.previewTitle')}
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={t('supplierPortal.previewConfirm')}
      cancelText={t('supplierPortal.previewBack')}
      confirmLoading={loading}
      width={isMobile ? '92vw' : 760}
      style={isMobile ? { top: 20 } : undefined}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {t('supplierPortal.previewDesc')}
      </Text>
      {incompleteCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('supplierPortal.previewIncomplete', { count: incompleteCount })}
          description={t('supplierPortal.previewIncompleteTip')}
        />
      )}
      <Table<ItemPreview>
        size="small"
        rowKey="key"
        columns={columns}
        dataSource={previewRows}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Text type="secondary" style={{ marginRight: 8 }}>
          {t('supplierPortal.previewTotal')}
        </Text>
        <Text strong style={{ fontSize: 18, color: 'var(--color-primary)' }}>
          {formatCurrency(totalAmount, inquiry.currency as never)}
        </Text>
      </div>
      {remark.trim() && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">{t('supplierPortal.remarkLabel')}</Text>
          <div>
            <Tag color="blue" style={{ whiteSpace: 'pre-wrap' }}>
              {remark}
            </Tag>
          </div>
        </div>
      )}
    </Modal>
  );
}
