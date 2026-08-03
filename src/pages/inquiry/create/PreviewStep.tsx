/**
 * 步骤 4：预览发送
 * - 只读展示基本信息 / 物料清单 / 已选供应商
 * - 一键批量发送询价（由父组件实现具体发送逻辑）
 */
import { Alert, Button, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { InquiryItem, Supplier } from '@/types';
import { useSupplierStore } from '@/store/useSupplierStore';
import { formatCurrency, formatDate } from '@/utils/format';
import { CooperationStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import type { BasicInfoForm } from './shared';

const { Text, Title } = Typography;

interface PreviewStepProps {
  basicInfo: BasicInfoForm;
  items: InquiryItem[];
  selectedSupplierIds: string[];
  onSend: () => void;
  onBack: () => void;
}

export default function PreviewStep({
  basicInfo,
  items,
  selectedSupplierIds,
  onSend,
  onBack,
}: PreviewStepProps) {
  const { t } = useTranslation();
  const suppliers = useSupplierStore((s) => s.suppliers);
  const selectedSuppliers = selectedSupplierIds
    .map((id) => suppliers.find((s) => s.id === id))
    .filter((s): s is Supplier => !!s);

  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const totalTarget = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.targetPrice) || 0),
    0,
  );

  const itemColumns: ColumnsType<InquiryItem> = [
    { title: '#', key: 'idx', width: 50, render: (_, __, i) => i + 1 },
    { title: t('inquiry.create.material.materialName'), dataIndex: 'name', width: 160 },
    { title: t('common.code'), dataIndex: 'code', width: 100 },
    { title: t('common.category'), dataIndex: 'category', width: 100 },
    { title: t('common.brand'), dataIndex: 'brand', width: 100 },
    { title: t('inquiry.create.material.spec'), dataIndex: 'spec', width: 140 },
    { title: t('common.unit'), dataIndex: 'unit', width: 70 },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 80, align: 'right' },
    {
      title: t('inquiry.create.material.targetPrice'),
      dataIndex: 'targetPrice',
      width: 100,
      align: 'right',
      render: (v?: number) => (v != null ? formatCurrency(v, basicInfo.currency) : '-'),
    },
    {
      title: t('inquiry.create.preview.subtotal'),
      key: 'subtotal',
      width: 120,
      align: 'right',
      render: (_, r) =>
        r.targetPrice != null
          ? formatCurrency(r.quantity * r.targetPrice, basicInfo.currency)
          : '-',
    },
    {
      title: t('inquiry.create.preview.expectedDeliveryShort'),
      dataIndex: 'expectedDeliveryDate',
      width: 120,
      render: (v?: string) => (v ? formatDate(v) : '-'),
    },
    { title: t('common.remark'), dataIndex: 'remark' },
  ];

  return (
    <div>
      {selectedSupplierIds.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('inquiry.create.preview.noSupplierAlert')}
          description={t('inquiry.create.preview.noSupplierAlertDesc')}
          style={{ marginBottom: 12 }}
          action={<Button onClick={onBack}>{t('inquiry.create.preview.goSelect')}</Button>}
        />
      )}

      <Title level={5} style={{ marginTop: 0 }}>{t('inquiry.create.preview.basicInfo')}</Title>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} style={{ marginBottom: 20 }}>
        <Descriptions.Item label={t('inquiry.create.basic.subject')}>{basicInfo.subject || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.organization')}>{basicInfo.organization || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.ownerName')}>{basicInfo.ownerName || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.currency')}>
          {basicInfo.currency ? `${t('enum.currency.' + basicInfo.currency)}（${basicInfo.currency}）` : '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.deadline')}>
          {basicInfo.deadline ? basicInfo.deadline.format('YYYY-MM-DD HH:mm') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.expectedDeliveryDate')}>
          {basicInfo.expectedDeliveryDate
            ? basicInfo.expectedDeliveryDate.format('YYYY-MM-DD')
            : '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.deliveryAddress')} span={2}>
          {basicInfo.deliveryAddress || '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.contact')}>{basicInfo.contact || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.paymentTerms')}>{basicInfo.paymentTerms || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.basic.invoiceRequirement')}>
          {basicInfo.invoiceRequirement || '-'}
        </Descriptions.Item>
        <Descriptions.Item label={t('inquiry.create.preview.attachments')}>
          {(basicInfo.attachments?.length ?? 0) === 0
            ? '-'
            : basicInfo.attachments.map((a) => (
                <Tag key={a.id} style={{ marginBottom: 4 }}>
                  {a.name}
                </Tag>
              ))}
        </Descriptions.Item>
        {basicInfo.description && (
          <Descriptions.Item label={t('inquiry.create.basic.description')} span={2}>
            {basicInfo.description}
          </Descriptions.Item>
        )}
      </Descriptions>

      <Title level={5}>{t('inquiry.create.preview.materialListSummary', { count: items.length, total: totalQty })}</Title>
      {items.length === 0 ? (
        <Empty description={t('inquiry.create.preview.noMaterial')} style={{ marginBottom: 20 }} />
      ) : (
        <>
          <Table<InquiryItem>
            rowKey="id"
            size="small"
            columns={itemColumns}
            dataSource={items}
            pagination={false}
            scroll={{ x: 1300 }}
            bordered
            style={{ marginBottom: 8 }}
          />
          <div style={{ textAlign: 'right', marginBottom: 20 }}>
            <Text strong>
              {t('inquiry.create.preview.targetTotal', { amount: formatCurrency(totalTarget, basicInfo.currency) })}
            </Text>
          </div>
        </>
      )}

      <Title level={5}>{t('inquiry.create.preview.selectedSupplierSummary', { count: selectedSuppliers.length })}</Title>
      {selectedSuppliers.length === 0 ? (
        <Empty description={t('inquiry.create.preview.noSupplierSelected')} style={{ marginBottom: 20 }} />
      ) : (
        <Table<Supplier>
          rowKey="id"
          size="small"
          columns={[
            { title: t('common.code'), dataIndex: 'code', width: 100 },
            { title: t('common.name'), dataIndex: 'name' },
            { title: t('common.region'), dataIndex: 'region', width: 100 },
            {
              title: t('inquiry.create.supplier.level'),
              key: 'level',
              width: 80,
              render: (_, r) => <SupplierLevelTag level={r.level} />,
            },
            {
              title: t('inquiry.create.supplier.cooperationStatus'),
              key: 'status',
              width: 90,
              render: (_, r) => <CooperationStatusTag status={r.cooperationStatus} />,
            },
            {
              title: t('inquiry.create.supplier.mainCategories'),
              key: 'cats',
              render: (_, r) => (
                <Space size={4} wrap>
                  {r.mainCategories.map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                </Space>
              ),
            },
          ]}
          dataSource={selectedSuppliers}
          pagination={false}
          bordered
          style={{ marginBottom: 20 }}
        />
      )}

      <Space style={{ marginTop: 8 }}>
        <Button
          type="primary"
          size="large"
          icon={<SendOutlined />}
          onClick={onSend}
          disabled={selectedSupplierIds.length === 0 || items.length === 0}
        >
          {t('inquiry.create.batchSend')}
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('inquiry.create.preview.sendHint', { count: selectedSuppliers.length })}
        </Text>
      </Space>
    </div>
  );
}
