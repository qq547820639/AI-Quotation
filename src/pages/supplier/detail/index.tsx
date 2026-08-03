/**
 * 供应商详情（Task 15）
 * 展示供应商基本信息、历史报价记录、历史合作记录
 */
import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Result,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import {
  CooperationStatusTag,
  InquiryStatusTag,
  QuotationStatusTag,
  SupplierLevelTag,
} from '@/components/StatusTag';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import {
  CooperationStatus,
  QuotationStatus,
  type Inquiry,
  type Quotation,
} from '@/types';
import { formatCurrency, formatDate, formatDateTime, formatPercent } from '@/utils/format';
import { confirmAction, notifySuccess } from '@/utils/confirm';

const { Text } = Typography;

/** 卡片统一样式 */
const cardStyle = { marginBottom: 16, borderRadius: 8 } as const;

export default function SupplierDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const supplier = useSupplierStore((s) => s.suppliers.find((x) => x.id === id));
  const toggleSupplierStatus = useSupplierStore((s) => s.toggleSupplierStatus);
  const inquiries = useInquiryStore((s) => s.inquiries);
  const quotations = useQuotationStore((s) => s.quotations);

  // 历史报价记录：当前供应商的所有报价
  const supplierQuotations = useMemo(() => {
    if (!supplier) return [];
    return quotations
      .filter((q) => q.supplierId === id)
      .slice()
      .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt));
  }, [quotations, id, supplier]);

  // 历史合作记录：受邀供应商包含当前供应商的询价单
  const relatedInquiries = useMemo(() => {
    if (!supplier) return [];
    return inquiries
      .filter((i) => i.invitedSupplierIds.includes(id))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [inquiries, id, supplier]);

  // 不存在 → 404
  if (!supplier) {
    return (
      <Result
        status="404"
        title="404"
        subTitle={t('supplier.detail.notFoundSubTitle')}
        extra={
          <Button type="primary" onClick={() => navigate('/supplier')}>
            {t('supplier.detail.backToList')}
          </Button>
        }
      />
    );
  }

  const isDisabled = supplier.cooperationStatus === CooperationStatus.DISABLED;

  const handleToggleStatus = () => {
    confirmAction({
      title: isDisabled ? t('supplier.list.enableTitle') : t('supplier.list.disableTitle'),
      content: isDisabled
        ? t('supplier.list.confirmEnable', { name: supplier.name })
        : t('supplier.list.confirmDisable', { name: supplier.name }),
      okText: isDisabled ? t('supplier.list.enable') : t('supplier.list.disable'),
      danger: !isDisabled,
      onOk: () => {
        toggleSupplierStatus(supplier.id);
        notifySuccess(
          isDisabled
            ? t('supplier.list.enableSuccess', { name: supplier.name })
            : t('supplier.list.disableSuccess', { name: supplier.name }),
        );
      },
    });
  };

  // ===== 历史报价记录列 =====
  const quotationColumns: ColumnsType<Quotation> = [
    {
      title: t('supplier.detail.inquiryCode'),
      key: 'inquiryCode',
      width: 180,
      render: (_, record) => {
        const inquiry = inquiries.find((i) => i.id === record.inquiryId);
        return (
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => navigate(`/inquiry/detail/${record.inquiryId}`)}
          >
            {inquiry?.code ?? record.inquiryId}
          </Button>
        );
      },
    },
    {
      title: t('supplier.detail.supplierCol'),
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('supplier.detail.quotationTotal'),
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 140,
      align: 'right',
      render: (amount: number) => formatCurrency(amount),
      sorter: (a, b) => a.totalAmount - b.totalAmount,
    },
    {
      title: t('supplier.detail.quotationStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      align: 'center',
      render: (status: QuotationStatus) => <QuotationStatusTag status={status} />,
    },
    {
      title: t('quotation.pending.submittedAt'),
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 160,
      render: (val?: string) => (val ? formatDateTime(val) : '-'),
      sorter: (a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''),
    },
  ];

  // ===== 历史合作记录列 =====
  const inquiryColumns: ColumnsType<Inquiry> = [
    {
      title: t('supplier.detail.inquiryCode'),
      dataIndex: 'code',
      key: 'code',
      width: 180,
      render: (code: string) => <Text strong>{code}</Text>,
    },
    {
      title: t('inquiry.detail.subject'),
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      align: 'center',
      render: (status) => <InquiryStatusTag status={status} />,
    },
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (val: string) => formatDateTime(val),
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      defaultSortOrder: 'descend',
    },
    {
      title: t('supplier.detail.hasQuoted'),
      key: 'hasQuoted',
      width: 110,
      align: 'center',
      render: (_, record) => {
        const q = supplierQuotations.find(
          (x) => x.inquiryId === record.id && x.status === QuotationStatus.SUBMITTED,
        );
        return q ? (
          <Tag color="success">{t('supplier.detail.quoted')}</Tag>
        ) : (
          <Tag>{t('supplier.detail.notQuoted')}</Tag>
        );
      },
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/inquiry/detail/${record.id}`)}
        >
          {t('supplier.list.viewDetail')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={supplier.name}
        description={t('supplier.detail.codeDesc', { code: supplier.code })}
        extra={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/supplier')}>
              {t('common.back')}
            </Button>
            <Button
              danger={!isDisabled}
              icon={isDisabled ? <CheckCircleOutlined /> : <StopOutlined />}
              onClick={handleToggleStatus}
            >
              {isDisabled ? t('supplier.list.enable') : t('supplier.list.disable')}
            </Button>
          </Space>
        }
      />

      {/* 基本信息 */}
      <Card title={t('supplier.detail.basicInfo')} style={cardStyle}>
        <Descriptions column={3} bordered size="small">
          <Descriptions.Item label={t('supplier.detail.supplierNumber')}>{supplier.code}</Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.supplierName')}>{supplier.name}</Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.belongRegion')}>{supplier.region}</Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.contact')}>{supplier.contact}</Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.phone')}>{supplier.phone}</Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.email')}>{supplier.email}</Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.mainCategory')} span={3}>
            {supplier.mainCategories.length ? (
              <Space size={[0, 4]} wrap>
                {supplier.mainCategories.map((c) => (
                  <Tag key={c}>{c}</Tag>
                ))}
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.level')}>
            <SupplierLevelTag level={supplier.level} />
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.cooperationStatus')}>
            <CooperationStatusTag status={supplier.cooperationStatus} />
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.qualifiedLabel')}>
            {supplier.qualified ? (
              <Tag color="success">{t('supplier.detail.qualifiedTag')}</Tag>
            ) : (
              <Tag>{t('supplier.detail.notQualified')}</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.responseRate')}>
            {formatPercent(supplier.historyResponseRate)}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.fulfillmentRate')}>
            {formatPercent(supplier.historyFulfillmentRate)}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.avgDelivery')}>
            {supplier.avgDeliveryDays} {t('common.days')}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.lastCooperateTime')}>
            {formatDate(supplier.lastCooperateTime)}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplier.detail.historyCoopCount')}>
            {supplier.historyCoopCount} {t('common.times')}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 历史报价记录 */}
      <Card
        title={t('supplier.detail.historyQuotations', { count: supplierQuotations.length })}
        style={cardStyle}
      >
        {supplierQuotations.length === 0 ? (
          <Empty description={t('supplier.detail.noHistoryQuotation')} />
        ) : (
          <Table<Quotation>
            rowKey="id"
            columns={quotationColumns}
            dataSource={supplierQuotations}
            pagination={{ pageSize: 5, showTotal: (total) => t('common.total', { count: total }) }}
            scroll={{ x: 900 }}
            size="small"
            onRow={(record) => ({
              onClick: () => navigate(`/inquiry/detail/${record.inquiryId}`),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Card>

      {/* 历史合作记录 */}
      <Card
        title={t('supplier.detail.historyCoopRecords', { count: relatedInquiries.length })}
        style={cardStyle}
      >
        {relatedInquiries.length === 0 ? (
          <Empty description={t('supplier.detail.noHistoryCoop')} />
        ) : (
          <Table<Inquiry>
            rowKey="id"
            columns={inquiryColumns}
            dataSource={relatedInquiries}
            pagination={{ pageSize: 5, showTotal: (total) => t('common.total', { count: total }) }}
            scroll={{ x: 1000 }}
            size="small"
          />
        )}
      </Card>
    </div>
  );
}
