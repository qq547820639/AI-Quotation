/**
 * 询价单详情与流程追溯（Task 14）
 * 分区展示基本信息、物料清单、供应商邀请名单、报价进度、报价对比摘要、附件、操作记录与流程时间轴
 */
import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Button,
  Card,
  Descriptions,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Progress,
  Result,
  Skeleton,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  SendOutlined,
  StopOutlined,
  SwapOutlined,
  CheckOutlined,
  CloseOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import {
  CooperationStatusTag,
  InquiryStatusTag,
  QuotationStatusTag,
  SupplierLevelTag,
} from '@/components/StatusTag';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  APPROVAL_NODE_STATUS_COLOR,
  ApprovalNodeStatus,
  InquiryStatus,
  LogType,
  QuotationStatus,
  type InquiryItem,
  type InquiryLog,
  type Quotation,
  type Supplier,
} from '@/types';
import { formatCurrency, formatDate, formatDateTime, formatPercent, getRemainingTime } from '@/utils/format';
import { confirmAction, notifyError, notifySuccess, notifyWarning } from '@/utils/confirm';
import { exportAOA } from '@/utils/excel';
import { isCancelable, isEditable } from '@/utils/inquiryStatus';
import { formatFileSize } from '@/utils/file';
import { exportPDFWithFallback } from '@/utils/pdf';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

/** 根据日志类型返回 Timeline 颜色 */
function getTimelineColor(type: LogType): string {
  switch (type) {
    case LogType.CREATE:
    case LogType.SEND_INQUIRY:
    case LogType.SUBMIT_QUOTATION:
    case LogType.APPROVE:
      return 'green';
    case LogType.UPDATE:
    case LogType.SAVE_DRAFT:
    case LogType.SAVE_QUOTATION_DRAFT:
    case LogType.SUBMIT_APPROVAL:
      return 'blue';
    case LogType.CANCEL:
    case LogType.QUOTATION_DEADLINE:
    case LogType.REJECT:
      return 'red';
    default:
      return 'gray';
  }
}

/** 卡片统一样式 */
const cardStyle = { marginBottom: 16, borderRadius: 8 } as const;

export default function InquiryDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const inquiry = useInquiryStore((s) => s.inquiries.find((i) => i.id === id));
  const loading = useInquiryStore((s) => s.loading);
  const copyInquiry = useInquiryStore((s) => s.copyInquiry);
  const cancelInquiry = useInquiryStore((s) => s.cancelInquiry);
  const sendInquiry = useInquiryStore((s) => s.sendInquiry);
  const submitForApproval = useInquiryStore((s) => s.submitForApproval);
  const approveInquiry = useInquiryStore((s) => s.approveInquiry);
  const rejectInquiry = useInquiryStore((s) => s.rejectInquiry);
  const quotations = useQuotationStore((s) => s.quotations);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('INQUIRY_EDIT');
  const canCancel = hasPermission('INQUIRY_CANCEL');
  const canSend = hasPermission('INQUIRY_SEND');
  const canApprove = hasPermission('INQUIRY_APPROVE');

  // 审批意见 Modal 状态（type: 'approve' | 'reject'）
  const [approvalModal, setApprovalModal] = useState<{
    open: boolean;
    type: 'approve' | 'reject';
    comment: string;
  }>({ open: false, type: 'approve', comment: '' });

  // 导出区域 ref + 导出中状态（Excel/PDF 共用，防重复点击）
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);

  // 当前询价单关联的报价
  const inquiryQuotations = useMemo(
    () => quotations.filter((q) => q.inquiryId === id),
    [quotations, id],
  );

  // 已提交报价
  const submittedQuotations = useMemo(
    () => inquiryQuotations.filter((q) => q.status === QuotationStatus.SUBMITTED),
    [inquiryQuotations],
  );

  // 受邀供应商明细
  const invitedSuppliers = useMemo(() => {
    if (!inquiry) return [];
    return inquiry.invitedSupplierIds
      .map((sid) => suppliers.find((s) => s.id === sid))
      .filter((s): s is Supplier => Boolean(s));
  }, [inquiry, suppliers]);

  // 操作记录按时间正序
  const sortedLogs = useMemo(() => {
    if (!inquiry) return [];
    return [...inquiry.logs].sort(
      (a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf(),
    );
  }, [inquiry]);

  // 加载中 → Skeleton
  if (loading && !inquiry) {
    return (
      <div style={{ padding: 48 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  // 不存在 → 404
  if (!inquiry) {
    return (
      <Result
        status="404"
        title="404"
        subTitle={t('inquiry.detail.notFound')}
        extra={
          <Button type="primary" onClick={() => navigate('/inquiry/list')}>
            {t('inquiry.detail.backToList')}
          </Button>
        }
      />
    );
  }

  const remaining = getRemainingTime(inquiry.deadline);
  const submittedCount = submittedQuotations.length;
  const invitedCount = inquiry.invitedSupplierIds.length;
  const progressPercent =
    invitedCount > 0 ? Math.round((submittedCount / invitedCount) * 100) : 0;

  // ===== 操作 =====
  const handleExportPDF = () => {
    if (exporting) return;
    setExporting(true);
    exportPDFWithFallback(detailRef.current, {
      filename: `询价单-${inquiry.code}`,
      hideSelector: '.no-print',
    })
      .then(() => notifySuccess(i18n.t('inquiry.detail.pdfExportSuccess')))
      .catch(() => {
        notifyWarning(i18n.t('inquiry.detail.pdfExportFailed'));
      })
      .finally(() => setExporting(false));
  };

  const handleCopy = () => {
    confirmAction({
      title: i18n.t('inquiry.detail.confirmCopyTitle'),
      content: i18n.t('inquiry.detail.confirmCopyContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.detail.confirmCopyOk'),
      onOk: () => {
        const copy = copyInquiry(inquiry.id);
        if (copy) {
          notifySuccess(i18n.t('inquiry.detail.copySuccess', { code: copy.code }));
          navigate(`/inquiry/detail/${copy.id}`);
        }
      },
    });
  };

  const handleCancel = () => {
    confirmAction({
      title: i18n.t('inquiry.detail.confirmCancelTitle'),
      content: i18n.t('inquiry.detail.confirmCancelContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.detail.confirmCancelOk'),
      danger: true,
      onOk: () => {
        cancelInquiry(inquiry.id);
        notifySuccess(i18n.t('inquiry.detail.cancelSuccess'));
      },
    });
  };

  /** 重新发送询价（PENDING_SEND 状态） */
  const handleResend = () => {
    confirmAction({
      title: i18n.t('inquiry.detail.resendTitle'),
      content: i18n.t('inquiry.detail.resendContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.detail.resendOk'),
      onOk: () => {
        sendInquiry(inquiry.id);
        notifySuccess(i18n.t('inquiry.detail.sendSuccess'));
      },
    });
  };

  /** 提交审批（PENDING_CONFIRM 状态） */
  const handleSubmitApproval = () => {
    confirmAction({
      title: i18n.t('inquiry.detail.submitApprovalTitle'),
      content: i18n.t('inquiry.detail.submitApprovalContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.detail.submitApprovalOk'),
      onOk: async () => {
        const result = await submitForApproval(inquiry.id);
        if (result.success) {
          notifySuccess(i18n.t('inquiry.detail.submitApprovalSuccess'));
        } else if (result.reason === 'pending') {
          return;
        } else {
          notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
        }
      },
    });
  };

  /** 打开审批意见 Modal */
  const openApprovalModal = (type: 'approve' | 'reject') => {
    setApprovalModal({ open: true, type, comment: '' });
  };

  /** 确认审批（通过/驳回） */
  const handleConfirmApproval = () => {
    const isApprove = approvalModal.type === 'approve';
    confirmAction({
      title: isApprove ? i18n.t('inquiry.detail.confirmApproveTitle') : i18n.t('inquiry.detail.confirmRejectTitle'),
      content: isApprove
        ? i18n.t('inquiry.detail.approveContent')
        : i18n.t('inquiry.detail.rejectContent'),
      okText: isApprove ? i18n.t('inquiry.detail.approveOk') : i18n.t('inquiry.detail.rejectOk'),
      danger: !isApprove,
      onOk: async () => {
        if (isApprove) {
          const result = await approveInquiry(inquiry.id, approvalModal.comment);
          if (result.success) {
            notifySuccess(i18n.t('inquiry.detail.approveSuccessMsg'));
          } else if (result.reason === 'pending') {
            return;
          } else {
            notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
          }
        } else {
          if (!approvalModal.comment.trim()) {
            notifyWarning(i18n.t('inquiry.detail.rejectWarning'));
            return Promise.reject();
          }
          const result = await rejectInquiry(inquiry.id, approvalModal.comment);
          if (result.success) {
            notifySuccess(i18n.t('inquiry.detail.rejectSuccess'));
          } else if (result.reason === 'pending') {
            return;
          } else {
            notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
          }
        }
        setApprovalModal({ ...approvalModal, open: false });
      },
    });
  };

  const handleExport = () => {
    if (exporting) return;
    setExporting(true);
    try {
      const header = [
        i18n.t('inquiry.export.materialName'),
        i18n.t('inquiry.export.materialCode'),
        i18n.t('inquiry.export.category'),
        i18n.t('inquiry.export.brand'),
        i18n.t('inquiry.export.spec'),
        i18n.t('inquiry.export.unit'),
        i18n.t('inquiry.export.quantity'),
        i18n.t('inquiry.export.targetPrice'),
      ];
      const rows = inquiry.items.map((item) => [
        item.name,
        item.code,
        item.category,
        item.brand,
        item.spec,
        item.unit,
        item.quantity,
        item.targetPrice ?? '',
      ]);
      exportAOA(i18n.t('inquiry.export.filename', { code: inquiry.code }), header, rows);
      notifySuccess(i18n.t('inquiry.export.success'));
    } catch {
      notifyError(i18n.t('inquiry.export.failed'));
    } finally {
      setExporting(false);
    }
  };

  // ===== 物料清单列 =====
  const itemColumns: ColumnsType<InquiryItem> = [
    { title: t('material.list.name'), dataIndex: 'name', key: 'name', width: 160, fixed: 'left' },
    { title: t('material.list.code'), dataIndex: 'code', key: 'code', width: 120 },
    { title: t('inquiry.detail.category'), dataIndex: 'category', key: 'category', width: 120 },
    { title: t('material.list.brand'), dataIndex: 'brand', key: 'brand', width: 100 },
    { title: t('material.list.spec'), dataIndex: 'spec', key: 'spec', width: 160, ellipsis: true },
    { title: t('material.list.unit'), dataIndex: 'unit', key: 'unit', width: 70, align: 'center' },
    { title: t('common.quantity'), dataIndex: 'quantity', key: 'quantity', width: 90, align: 'right' },
    {
      title: t('inquiry.detail.targetPrice'),
      dataIndex: 'targetPrice',
      key: 'targetPrice',
      width: 120,
      align: 'right',
      render: (price?: number) =>
        price != null ? formatCurrency(price, inquiry.currency) : '-',
    },
    {
      title: t('inquiry.detail.expectedDeliveryDate'),
      dataIndex: 'expectedDeliveryDate',
      key: 'expectedDeliveryDate',
      width: 130,
      render: (d?: string) => formatDate(d),
    },
    {
      title: t('common.remark'),
      dataIndex: 'remark',
      key: 'remark',
      width: 180,
      ellipsis: true,
      render: (remark?: string) => remark || '-',
    },
  ];

  // ===== 供应商邀请名单：行数据 =====
  const supplierRows = invitedSuppliers.map((supplier) => {
    const quotation = inquiryQuotations.find((q) => q.supplierId === supplier.id);
    return { supplier, quotation };
  });

  const supplierColumns: ColumnsType<(typeof supplierRows)[number]> = [
    {
      title: t('supplier.list.name'),
      key: 'name',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.supplier.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.supplier.code}
          </Text>
        </Space>
      ),
    },
    {
      title: t('supplier.list.level'),
      key: 'level',
      width: 90,
      align: 'center',
      render: (_, record) => <SupplierLevelTag level={record.supplier.level} />,
    },
    {
      title: t('supplier.list.cooperationStatus'),
      key: 'cooperationStatus',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <CooperationStatusTag status={record.supplier.cooperationStatus} />
      ),
    },
    {
      title: t('inquiry.detail.mainCategory'),
      key: 'mainCategories',
      width: 200,
      render: (_, record) =>
        record.supplier.mainCategories.map((c) => <Tag key={c}>{c}</Tag>),
    },
    {
      title: t('supplier.detail.responseRate'),
      key: 'historyResponseRate',
      width: 110,
      align: 'center',
      render: (_, record) => formatPercent(record.supplier.historyResponseRate),
    },
    {
      title: t('supplier.list.avgDeliveryDays'),
      key: 'avgDeliveryDays',
      width: 100,
      align: 'center',
      render: (_, record) => t('inquiry.detail.deliveryDaysUnit', { count: record.supplier.avgDeliveryDays }),
    },
    {
      title: t('inquiry.detail.quotationStatus'),
      key: 'quotationStatus',
      width: 160,
      render: (_, record) => {
        const q = record.quotation;
        if (!q) {
          return <Tag>{t('inquiry.detail.notQuoted')}</Tag>;
        }
        if (q.status === QuotationStatus.DRAFT) {
          return <Tag color="default">{t('inquiry.detail.draftSaving')}</Tag>;
        }
        if (q.status === QuotationStatus.TIMEOUT) {
          return <QuotationStatusTag status={QuotationStatus.TIMEOUT} />;
        }
        // SUBMITTED
        return (
          <Space direction="vertical" size={0}>
            <QuotationStatusTag status={QuotationStatus.SUBMITTED} />
            {q.submittedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatDateTime(q.submittedAt)}
              </Text>
            )}
          </Space>
        );
      },
    },
  ];

  // ===== 报价对比摘要列 =====
  const summaryColumns: ColumnsType<Quotation> = [
    {
      title: t('quotation.compare.supplier'),
      dataIndex: 'supplierName',
      key: 'supplierName',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('inquiry.detail.totalAmount'),
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      align: 'right',
      render: (amount: number) => formatCurrency(amount, inquiry.currency),
    },
    {
      title: t('inquiry.detail.deliveryCycle'),
      key: 'deliveryDays',
      align: 'center',
      render: (_, record) => {
        if (!record.items.length) return '-';
        const maxDays = Math.max(...record.items.map((it) => it.deliveryDays));
        return t('inquiry.detail.deliveryDaysUnit', { count: maxDays });
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      align: 'center',
      render: (status: QuotationStatus) => <QuotationStatusTag status={status} />,
    },
  ];

  // ===== 操作记录列 =====
  const logColumns: ColumnsType<InquiryLog> = [
    {
      title: t('common.time'),
      dataIndex: 'time',
      key: 'time',
      width: 160,
      render: (time: string) => formatDateTime(time),
    },
    { title: t('common.operator'), dataIndex: 'operator', key: 'operator', width: 180 },
    {
      title: t('common.role'),
      dataIndex: 'operatorRole',
      key: 'operatorRole',
      width: 100,
      render: (role?: string) => role || '-',
    },
    {
      title: t('inquiry.detail.operationType'),
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (type: LogType) => <Tag>{t(`enum.logType.${type}`)}</Tag>,
    },
    { title: t('inquiry.detail.operationContent'), dataIndex: 'content', key: 'content', ellipsis: true },
    {
      title: t('inquiry.detail.operationResult'),
      dataIndex: 'result',
      key: 'result',
      width: 120,
      render: (result?: string) => result || '-',
    },
  ];

  return (
    <Spin spinning={exporting} tip={i18n.t('inquiry.detail.exporting')}>
      <PageHeader
        title={inquiry.subject}
        description={t('inquiry.detail.inquiryCodePrefix', { code: inquiry.code })}
        extra={
          <Space wrap className="no-print">
            {canEdit && isEditable(inquiry.status) && (
              <Button
                icon={<EditOutlined />}
                onClick={() => navigate(`/inquiry/edit/${inquiry.id}`)}
              >
                {t('inquiry.detail.editDraft')}
              </Button>
            )}
            {canSend && inquiry.status === InquiryStatus.PENDING_SEND && (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleResend}
              >
                {t('inquiry.detail.sendInquiry')}
              </Button>
            )}
            <Button icon={<CopyOutlined />} onClick={handleCopy}>
              {t('common.copy')}
            </Button>
            {canCancel && isCancelable(inquiry.status) && (
              <Button danger icon={<StopOutlined />} onClick={handleCancel}>
                {t('inquiry.detail.cancelInquiry')}
              </Button>
            )}
            {canApprove && inquiry.status === InquiryStatus.PENDING_CONFIRM && (
              <Button
                icon={<AuditOutlined />}
                onClick={handleSubmitApproval}
              >
                {t('inquiry.detail.submitApproval')}
              </Button>
            )}
            {canApprove && inquiry.status === InquiryStatus.PENDING_APPROVAL && (
              <>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => openApprovalModal('approve')}
                >
                  {t('inquiry.detail.approve')}
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => openApprovalModal('reject')}
                >
                  {t('inquiry.detail.reject')}
                </Button>
              </>
            )}
            <Button
              icon={<SwapOutlined />}
              onClick={() => navigate(`/quotation/compare/${inquiry.id}`)}
            >
              {t('inquiry.detail.viewQuotationCompare')}
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'excel', label: t('inquiry.detail.exportExcel'), icon: <ExportOutlined /> },
                  { key: 'pdf', label: t('inquiry.detail.exportPDF'), icon: <FilePdfOutlined /> },
                ],
                onClick: ({ key }) => {
                  if (key === 'excel') handleExport();
                  else if (key === 'pdf') handleExportPDF();
                },
              }}
            >
              <Button icon={<ExportOutlined />} loading={exporting}>
                {t('common.export')}
              </Button>
            </Dropdown>
          </Space>
        }
      />

      {/* PDF 导出区域（B5）：detailRef 标记可被 html2canvas 截取的内容范围 */}
      <div ref={detailRef}>
      {/* 1. 基本信息 */}
      <Card title={t('inquiry.detail.basicInfo')} style={cardStyle}>
        <Descriptions column={3} bordered size="small">
          <Descriptions.Item label={t('inquiry.detail.inquiryCodeLabel')}>{inquiry.code}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.subject')}>{inquiry.subject}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.organization')}>{inquiry.organization}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.owner')}>{inquiry.ownerName}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.currency')}>{t(`enum.currency.${inquiry.currency}`)}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.currentStatus')}>
            <InquiryStatusTag status={inquiry.status} />
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.quotationDeadline')}>
            <Space size={4}>
              <Text>{formatDateTime(inquiry.deadline)}</Text>
              {remaining.expired ? (
                <Tag color="error">{t('inquiry.detail.expired')}</Tag>
              ) : remaining.urgent ? (
                <Tag color="warning">{remaining.text}</Tag>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {remaining.text}
                </Text>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.expectedDeliveryDate')}>
            {formatDate(inquiry.expectedDeliveryDate)}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.createdBy')}>{inquiry.createdByName}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.deliveryAddressLabel')} span={2}>
            {inquiry.deliveryAddress}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.createdAt')}>
            {formatDateTime(inquiry.createdAt)}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.contact')}>{inquiry.contact}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.paymentTerms')}>{inquiry.paymentTerms}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.invoiceRequirement')}>
            {inquiry.invoiceRequirement || '-'}
          </Descriptions.Item>
          {inquiry.description && (
            <Descriptions.Item label={t('inquiry.detail.requirementDesc')} span={3}>
              {inquiry.description}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 2. 物料清单 */}
      <Card title={t('inquiry.detail.materialListTitle', { count: inquiry.items.length })} style={cardStyle}>
        <Table<InquiryItem>
          rowKey="id"
          columns={itemColumns}
          dataSource={inquiry.items}
          pagination={false}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>

      {/* 3. 供应商邀请名单 */}
      <Card title={t('inquiry.detail.supplierListTitle', { count: invitedCount })} style={cardStyle}>
        {invitedCount === 0 ? (
          <Empty description={t('inquiry.detail.noInvitedSupplier')} />
        ) : (
          <Table
            rowKey={(record) => record.supplier.id}
            columns={supplierColumns}
            dataSource={supplierRows}
            pagination={false}
            scroll={{ x: 1000 }}
            size="small"
          />
        )}
      </Card>

      {/* 4. 报价回收进度 */}
      <Card title={t('inquiry.detail.quotationProgress')} style={cardStyle}>
        <Space size={32} wrap align="center">
          <div style={{ width: 240 }}>
            <Progress
              percent={progressPercent}
              status={
                remaining.expired && submittedCount < invitedCount ? 'exception' : 'active'
              }
              format={() => `${submittedCount} / ${invitedCount}`}
            />
          </div>
          <Space size={24} wrap>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('inquiry.detail.submitted')}
              </Text>
              <div>
                <Text strong style={{ color: 'var(--color-success)', fontSize: 20 }}>
                  {submittedCount}
                </Text>
                <Text type="secondary">{t('inquiry.detail.supplierUnit')}</Text>
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('inquiry.detail.notSubmitted')}
              </Text>
              <div>
                <Text strong style={{ fontSize: 20 }}>
                  {Math.max(invitedCount - submittedCount, 0)}
                </Text>
                <Text type="secondary">{t('inquiry.detail.supplierUnit')}</Text>
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('inquiry.detail.invitedTotal')}
              </Text>
              <div>
                <Text strong style={{ fontSize: 20 }}>
                  {invitedCount}
                </Text>
                <Text type="secondary">{t('inquiry.detail.supplierUnit')}</Text>
              </div>
            </div>
          </Space>
        </Space>
      </Card>

      {/* 5. 报价对比结果摘要 */}
      <Card
        title={t('inquiry.detail.quotationSummary')}
        style={cardStyle}
        extra={
          submittedQuotations.length > 0 && (
            <Button
              type="link"
              icon={<SwapOutlined />}
              onClick={() => navigate(`/quotation/compare/${inquiry.id}`)}
            >
              {t('inquiry.detail.viewFullCompare')}
            </Button>
          )
        }
      >
        {submittedQuotations.length === 0 ? (
          <Empty description={t('inquiry.detail.noSubmittedQuotation')} />
        ) : (
          <Table<Quotation>
            rowKey="id"
            columns={summaryColumns}
            dataSource={submittedQuotations}
            pagination={false}
            size="small"
          />
        )}
      </Card>

      {/* 6. 附件列表 */}
      <Card title={t('inquiry.detail.attachmentListTitle', { count: inquiry.attachments.length })} style={cardStyle}>
        {inquiry.attachments.length === 0 ? (
          <Empty description={t('inquiry.detail.noAttachment')} />
        ) : (
          <List
            itemLayout="horizontal"
            dataSource={inquiry.attachments}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<PaperClipOutlined style={{ fontSize: 20, color: 'var(--color-primary)' }} />}
                  title={
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.name}
                    </a>
                  }
                  description={t('inquiry.detail.attachmentDesc', { size: formatFileSize(item.size), time: formatDateTime(item.uploadTime) })}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* 7. 操作记录 */}
      <Card title={t('inquiry.detail.logListTitle', { count: sortedLogs.length })} style={cardStyle}>
        {sortedLogs.length === 0 ? (
          <Empty description={t('inquiry.detail.noLogRecord')} />
        ) : (
          <Table<InquiryLog>
            rowKey="id"
            columns={logColumns}
            dataSource={sortedLogs}
            pagination={false}
            scroll={{ x: 900 }}
            size="small"
          />
        )}
      </Card>

      {/* 8. 流程时间轴 */}
      <Card title={t('inquiry.detail.timelineTitle')} style={cardStyle}>
        {sortedLogs.length === 0 ? (
          <Empty description={t('inquiry.detail.noTimelineRecord')} />
        ) : (
          <Timeline
            mode="left"
            items={sortedLogs.map((log) => ({
              color: getTimelineColor(log.type),
              label: (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {formatDateTime(log.time)}
                </Text>
              ),
              children: (
                <div>
                  <Space size={6} wrap>
                    <Tag color={getTimelineColor(log.type)}>{t(`enum.logType.${log.type}`)}</Tag>
                    <Text strong>{log.operator}</Text>
                    {log.operatorRole && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('inquiry.detail.operatorRoleWrap', { role: log.operatorRole })}
                      </Text>
                    )}
                  </Space>
                  <Paragraph style={{ margin: '4px 0 0' }}>{log.content}</Paragraph>
                  {log.result && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('inquiry.detail.resultPrefix', { result: log.result })}
                    </Text>
                  )}
                </div>
              ),
            }))}
          />
        )}
      </Card>

      {/* 9. 审批流程（W5） */}
      {inquiry.approvalNodes.length > 0 && (
        <Card title={t('inquiry.detail.approvalProcess')} style={cardStyle}>
          <Timeline
            items={inquiry.approvalNodes.map((node) => ({
              color:
                node.status === ApprovalNodeStatus.APPROVED
                  ? 'green'
                  : node.status === ApprovalNodeStatus.REJECTED
                    ? 'red'
                    : 'blue',
              children: (
                <div>
                  <Space size={8} wrap>
                    <Text strong>{node.approverName}</Text>
                    <Tag color={APPROVAL_NODE_STATUS_COLOR[node.status]}>
                      {t(`enum.approvalNodeStatus.${node.status}`)}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {node.approverRole}
                    </Text>
                  </Space>
                  {node.time && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(node.time)}
                      </Text>
                    </div>
                  )}
                  {node.comment && (
                    <Paragraph style={{ margin: '4px 0 0' }}>{node.comment}</Paragraph>
                  )}
                </div>
              ),
            }))}
          />
        </Card>
      )}
      </div>

      {/* 审批意见 Modal */}
      <Modal
        title={approvalModal.type === 'approve' ? t('inquiry.detail.approve') : t('inquiry.detail.reject')}
        open={approvalModal.open}
        onCancel={() => setApprovalModal({ ...approvalModal, open: false })}
        onOk={handleConfirmApproval}
        okText={approvalModal.type === 'approve' ? t('inquiry.detail.approveOk') : t('inquiry.detail.rejectOk')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: approvalModal.type === 'reject' }}
        destroyOnClose
      >
        <TextArea
          rows={4}
          placeholder={
            approvalModal.type === 'approve'
              ? t('inquiry.detail.approvalCommentOptional')
              : t('inquiry.detail.rejectReasonRequired')
          }
          value={approvalModal.comment}
          onChange={(e) =>
            setApprovalModal({ ...approvalModal, comment: e.target.value })
          }
          maxLength={200}
          showCount
        />
      </Modal>
    </Spin>
  );
}
