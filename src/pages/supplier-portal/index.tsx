/**
 * 供应商报价填报端（Task 10）
 * 路由：/supplier-portal/:inquiryId/:supplierId，使用 SupplierLayout
 * 功能：查看询价信息 -> 填写报价 -> 暂存/提交；支持回填草稿、超时禁提交
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  List,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  PaperClipOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  QuotationStatus,
  type Attachment,
  type InquiryItem,
  type Quotation,
  type QuotationItem,
} from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  getRemainingTime,
} from '@/utils/format';
import { confirmAction, notifyError, notifySuccess } from '@/utils/confirm';

const { Title, Text, Paragraph } = Typography;

/** 税率选项 */
const TAX_RATE_OPTIONS = [
  { label: '13%', value: 0.13 },
  { label: '9%', value: 0.09 },
  { label: '6%', value: 0.06 },
  { label: '0%', value: 0 },
];

/** 付款条件选项 */
const PAYMENT_TERMS_OPTIONS = [
  { label: '货到验收后 30 天付款', value: '货到验收后 30 天付款' },
  { label: '货到验收后 45 天付款', value: '货到验收后 45 天付款' },
  { label: '货到验收后 60 天付款', value: '货到验收后 60 天付款' },
  { label: '款到发货', value: '款到发货' },
  { label: '预付 30% 发货前付清', value: '预付 30% 发货前付清' },
];

/** 报价明细表单值 */
interface QuotationFormItem {
  inquiryItemId: string;
  unitPrice: number | undefined;
  taxRate: number;
  moq: number | undefined;
  deliveryDays: number | undefined;
  deliveryDate: dayjs.Dayjs | null;
  brand: string;
  warrantyMonths: number | undefined;
  paymentTerms: string;
  validUntil: dayjs.Dayjs | null;
  techDeviation: string;
  commercialDeviation: string;
  remark: string;
  attachments: Attachment[];
}

/** 根据询价明细构造空表单项 */
function createEmptyItem(inquiryItem: InquiryItem): QuotationFormItem {
  return {
    inquiryItemId: inquiryItem.id,
    unitPrice: undefined,
    taxRate: 0.13,
    moq: undefined,
    deliveryDays: undefined,
    deliveryDate: null,
    brand: inquiryItem.brand || '',
    warrantyMonths: undefined,
    paymentTerms: '货到验收后 30 天付款',
    validUntil: null,
    techDeviation: '',
    commercialDeviation: '',
    remark: '',
    attachments: [],
  };
}

/** 计算单行含税总价（unitPrice 视为含税单价） */
function calcItemTotal(unitPrice: number | undefined, quantity: number): number {
  if (!unitPrice || unitPrice <= 0) return 0;
  return Number((unitPrice * quantity).toFixed(2));
}

export default function SupplierPortalPage() {
  const { t } = useTranslation();
  const { inquiryId = '', supplierId = '' } = useParams();
  const inquiry = useInquiryStore((s) => s.getInquiryById(inquiryId));
  const supplier = useSupplierStore((s) => s.getSupplierById(supplierId));
  const quotations = useQuotationStore((s) => s.quotations);
  const saveQuotationDraft = useQuotationStore((s) => s.saveQuotationDraft);
  const submitQuotation = useQuotationStore((s) => s.submitQuotation);
  const upsertQuotation = useQuotationStore((s) => s.upsertQuotation);

  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [formItems, setFormItems] = useState<QuotationFormItem[]>([]);
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<Record<string, Set<string>>>({});

  /** 已存在的该供应商报价（草稿或已提交） */
  const existingQuotation = useMemo(() => {
    return quotations.find(
      (q) =>
        q.inquiryId === inquiryId &&
        q.supplierId === supplierId &&
        (q.status === QuotationStatus.DRAFT || q.status === QuotationStatus.SUBMITTED),
    );
  }, [quotations, inquiryId, supplierId]);

  const remaining = useMemo(() => {
    return inquiry ? getRemainingTime(inquiry.deadline) : { text: '-', urgent: false, expired: false };
  }, [inquiry]);

  const expired = remaining.expired;

  /** 初始化 / 回填 */
  useEffect(() => {
    if (!inquiry) {
      setLoading(false);
      return;
    }
    const items = inquiry.items.map((it) => createEmptyItem(it));
    // 回填已有草稿
    if (existingQuotation && existingQuotation.items.length > 0) {
      existingQuotation.items.forEach((qItem) => {
        const idx = items.findIndex((f) => f.inquiryItemId === qItem.inquiryItemId);
        if (idx >= 0) {
          items[idx] = {
            inquiryItemId: qItem.inquiryItemId,
            unitPrice: qItem.unitPrice,
            taxRate: qItem.taxRate,
            moq: qItem.moq,
            deliveryDays: qItem.deliveryDays,
            deliveryDate: qItem.deliveryDate ? dayjs(qItem.deliveryDate) : null,
            brand: qItem.brand || '',
            warrantyMonths: qItem.warrantyMonths,
            paymentTerms: qItem.paymentTerms || '货到验收后 30 天付款',
            validUntil: qItem.validUntil ? dayjs(qItem.validUntil) : null,
            techDeviation: qItem.techDeviation || '',
            commercialDeviation: qItem.commercialDeviation || '',
            remark: qItem.remark || '',
            attachments: qItem.attachments || [],
          };
        }
      });
      setRemark(existingQuotation.remark || '');
      if (existingQuotation.status === QuotationStatus.SUBMITTED) {
        setSubmitted(true);
      }
    }
    setFormItems(items);
    setLoading(false);
  }, [inquiry, existingQuotation]);

  /** 报价总金额 */
  const totalAmount = useMemo(() => {
    if (!inquiry) return 0;
    return Number(
      formItems
        .reduce((sum, item, idx) => {
          const qty = inquiry.items[idx]?.quantity ?? 0;
          return sum + calcItemTotal(item.unitPrice, qty);
        }, 0)
        .toFixed(2),
    );
  }, [formItems, inquiry]);

  /** 更新单行字段 */
  const updateField = <K extends keyof QuotationFormItem>(
    inquiryItemId: string,
    field: K,
    value: QuotationFormItem[K],
  ) => {
    setFormItems((prev) =>
      prev.map((it) => (it.inquiryItemId === inquiryItemId ? { ...it, [field]: value } : it)),
    );
    // 清除该行错误标记
    setErrors((prev) => {
      if (!prev[inquiryItemId]) return prev;
      const next = { ...prev };
      const set = new Set(next[inquiryItemId]);
      set.delete(field as string);
      if (set.size === 0) {
        delete next[inquiryItemId];
      } else {
        next[inquiryItemId] = set;
      }
      return next;
    });
  };

  /** 构造完整 Quotation 对象 */
  const buildQuotation = (status: QuotationStatus): Quotation => {
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const quotationId = `quo-${inquiryId}-${supplierId}`;
    const quotationItems: QuotationItem[] = (inquiry?.items ?? []).map((inqItem) => {
      const formItem =
        formItems.find((f) => f.inquiryItemId === inqItem.id) ?? createEmptyItem(inqItem);
      const unitPrice = formItem.unitPrice ?? 0;
      const taxIncludedTotal = calcItemTotal(unitPrice, inqItem.quantity);
      return {
        id: `qi-${inquiryId}-${supplierId}-${inqItem.id}`,
        quotationId,
        inquiryItemId: inqItem.id,
        unitPrice,
        taxRate: formItem.taxRate,
        taxIncludedTotal,
        moq: formItem.moq,
        deliveryDays: formItem.deliveryDays ?? 0,
        deliveryDate: formItem.deliveryDate ? formItem.deliveryDate.format('YYYY-MM-DD') : undefined,
        brand: formItem.brand,
        warrantyMonths: formItem.warrantyMonths,
        paymentTerms: formItem.paymentTerms,
        validUntil: formItem.validUntil ? formItem.validUntil.format('YYYY-MM-DD') : undefined,
        techDeviation: formItem.techDeviation,
        commercialDeviation: formItem.commercialDeviation,
        remark: formItem.remark,
        attachments: formItem.attachments,
      };
    });
    const total = Number(
      quotationItems.reduce((s, it) => s + it.taxIncludedTotal, 0).toFixed(2),
    );
    return {
      id: quotationId,
      inquiryId,
      supplierId,
      supplierName: supplier?.name ?? supplierId,
      status,
      submittedAt: status === QuotationStatus.SUBMITTED ? nowStr : existingQuotation?.submittedAt,
      items: quotationItems,
      totalAmount: total,
      remark,
      attachments: [],
      createdAt: existingQuotation?.createdAt || nowStr,
      updatedAt: nowStr,
    };
  };

  /** 完整性校验 */
  const validate = (): boolean => {
    const nextErrors: Record<string, Set<string>> = {};
    formItems.forEach((item) => {
      const set = new Set<string>();
      if (item.unitPrice === undefined || item.unitPrice <= 0) set.add('unitPrice');
      if (item.deliveryDays === undefined || item.deliveryDays <= 0) set.add('deliveryDays');
      if (set.size > 0) nextErrors[item.inquiryItemId] = set;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      notifyError(t('supplierPortal.validateError'));
      return false;
    }
    return true;
  };

  /** 暂存报价 */
  const handleSaveDraft = () => {
    const quotation = buildQuotation(QuotationStatus.DRAFT);
    saveQuotationDraft(quotation);
    notifySuccess(t('supplierPortal.draftSaved'));
  };

  /** 正式提交 */
  const handleSubmit = () => {
    if (expired) {
      notifyError(t('supplierPortal.deadlinePassedSubmit'));
      return;
    }
    if (!validate()) return;
    confirmAction({
      title: t('supplierPortal.confirmSubmitTitle'),
      content: t('supplierPortal.confirmSubmitContent'),
      okText: t('supplierPortal.confirmSubmitOk'),
      cancelText: t('supplierPortal.checkAgain'),
      onOk: () => {
        const quotation = buildQuotation(QuotationStatus.SUBMITTED);
        upsertQuotation(quotation);
        submitQuotation(quotation.id);
        setSubmitted(true);
        notifySuccess(t('supplierPortal.submitSuccessMsg'));
      },
    });
  };

  /** 重置表单 */
  const handleReset = () => {
    confirmAction({
      title: t('supplierPortal.confirmResetTitle'),
      content: t('supplierPortal.confirmResetContent'),
      okText: t('supplierPortal.confirmResetOk'),
      danger: true,
      onOk: () => {
        if (!inquiry) return;
        setFormItems(inquiry.items.map((it) => createEmptyItem(it)));
        setRemark('');
        setErrors({});
        notifySuccess(t('supplierPortal.resetSuccess'));
      },
    });
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!inquiry || !supplier) {
    return (
      <Card>
        <Result
          status="warning"
          title={t('supplierPortal.notExistTitle')}
          subTitle={`inquiryId: ${inquiryId} / supplierId: ${supplierId}`}
        />
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card>
        <Result
          status="success"
          title={t('supplierPortal.submitSuccessMsg')}
          subTitle={t('supplierPortal.submittedSubTitle', { code: inquiry.code })}
          extra={
            <Space>
              <Button type="primary" onClick={() => window.location.reload()}>
                {t('supplierPortal.viewSubmitted')}
              </Button>
            </Space>
          }
        />
      </Card>
    );
  }

  /** 询价物料只读表格列 */
  const inquiryItemColumns: ColumnsType<InquiryItem> = [
    { title: t('material.list.name'), dataIndex: 'name', width: 140, fixed: 'left' },
    { title: t('material.list.code'), dataIndex: 'code', width: 120 },
    { title: t('material.list.categoryShort'), dataIndex: 'category', width: 100 },
    { title: t('material.list.brand'), dataIndex: 'brand', width: 100 },
    { title: t('material.list.spec'), dataIndex: 'spec', width: 140 },
    { title: t('material.list.techParams'), dataIndex: 'techParams', width: 220 },
    { title: t('material.list.unit'), dataIndex: 'unit', width: 70 },
    { title: t('inquiry.create.material.quantity'), dataIndex: 'quantity', width: 90, align: 'right' },
    {
      title: t('supplierPortal.targetPrice'),
      dataIndex: 'targetPrice',
      width: 100,
      align: 'right',
      render: (v?: number) => (v != null ? formatCurrency(v, inquiry.currency) : '-'),
    },
  ];

  /** 报价填写表格列 */
  const quotationColumns: ColumnsType<QuotationFormItem> = [
    {
      title: t('material.list.name'),
      dataIndex: 'inquiryItemId',
      width: 130,
      fixed: 'left',
      render: (_, record) => {
        const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{it?.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {it?.code}
            </Text>
          </div>
        );
      },
    },
    {
      title: t('inquiry.create.material.quantity'),
      key: 'quantity',
      width: 90,
      align: 'right',
      render: (_, record) => {
        const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
        return `${it?.quantity ?? 0} ${it?.unit ?? ''}`;
      },
    },
    {
      title: t('supplierPortal.materialUnitPrice'),
      key: 'unitPrice',
      width: 130,
      render: (_, record) => {
        const hasErr = errors[record.inquiryItemId]?.has('unitPrice');
        return (
          <InputNumber
            value={record.unitPrice}
            min={0}
            precision={2}
            style={{ width: '100%' }}
            placeholder={t('common.required')}
            status={hasErr ? 'error' : undefined}
            onChange={(v) => updateField(record.inquiryItemId, 'unitPrice', v ?? undefined)}
          />
        );
      },
    },
    {
      title: t('supplierPortal.taxRate'),
      key: 'taxRate',
      width: 100,
      render: (_, record) => (
        <Select
          value={record.taxRate}
          style={{ width: '100%' }}
          options={TAX_RATE_OPTIONS}
          onChange={(v) => updateField(record.inquiryItemId, 'taxRate', v)}
        />
      ),
    },
    {
      title: t('supplierPortal.taxIncludedTotal'),
      key: 'taxIncludedTotal',
      width: 120,
      align: 'right',
      render: (_, record) => {
        const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
        const total = calcItemTotal(record.unitPrice, it?.quantity ?? 0);
        return <Text strong>{formatCurrency(total, inquiry.currency)}</Text>;
      },
    },
    {
      title: t('supplierPortal.moq'),
      key: 'moq',
      width: 110,
      render: (_, record) => (
        <InputNumber
          value={record.moq}
          min={0}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.optional')}
          onChange={(v) => updateField(record.inquiryItemId, 'moq', v ?? undefined)}
        />
      ),
    },
    {
      title: t('supplierPortal.deliveryDaysCol'),
      key: 'deliveryDays',
      width: 130,
      render: (_, record) => {
        const hasErr = errors[record.inquiryItemId]?.has('deliveryDays');
        return (
          <InputNumber
            value={record.deliveryDays}
            min={0}
            style={{ width: '100%' }}
            placeholder={t('common.required')}
            status={hasErr ? 'error' : undefined}
            onChange={(v) => updateField(record.inquiryItemId, 'deliveryDays', v ?? undefined)}
          />
        );
      },
    },
    {
      title: t('supplierPortal.deliveryDateCol'),
      key: 'deliveryDate',
      width: 160,
      render: (_, record) => (
        <DatePicker
          value={record.deliveryDate}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.selectDate')}
          onChange={(d) => updateField(record.inquiryItemId, 'deliveryDate', d as dayjs.Dayjs | null)}
        />
      ),
    },
    {
      title: t('supplierPortal.brand'),
      key: 'brand',
      width: 120,
      render: (_, record) => (
        <Input
          value={record.brand}
          placeholder={t('supplierPortal.brand')}
          onChange={(e) => updateField(record.inquiryItemId, 'brand', e.target.value)}
        />
      ),
    },
    {
      title: t('supplierPortal.warrantyMonthsCol'),
      key: 'warrantyMonths',
      width: 110,
      render: (_, record) => (
        <InputNumber
          value={record.warrantyMonths}
          min={0}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.optional')}
          onChange={(v) => updateField(record.inquiryItemId, 'warrantyMonths', v ?? undefined)}
        />
      ),
    },
    {
      title: t('supplierPortal.paymentTerms'),
      key: 'paymentTerms',
      width: 180,
      render: (_, record) => (
        <Select
          value={record.paymentTerms}
          style={{ width: '100%' }}
          options={PAYMENT_TERMS_OPTIONS}
          onChange={(v) => updateField(record.inquiryItemId, 'paymentTerms', v)}
        />
      ),
    },
    {
      title: t('supplierPortal.validUntil'),
      key: 'validUntil',
      width: 160,
      render: (_, record) => (
        <DatePicker
          value={record.validUntil}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.selectDate')}
          onChange={(d) => updateField(record.inquiryItemId, 'validUntil', d as dayjs.Dayjs | null)}
        />
      ),
    },
    {
      title: t('supplierPortal.techDeviationDesc'),
      key: 'techDeviation',
      width: 160,
      render: (_, record) => (
        <Input
          value={record.techDeviation}
          placeholder={t('supplierPortal.noDeviationPlaceholder')}
          onChange={(e) => updateField(record.inquiryItemId, 'techDeviation', e.target.value)}
        />
      ),
    },
    {
      title: t('supplierPortal.commercialDeviationDesc'),
      key: 'commercialDeviation',
      width: 160,
      render: (_, record) => (
        <Input
          value={record.commercialDeviation}
          placeholder={t('supplierPortal.noDeviationPlaceholder')}
          onChange={(e) => updateField(record.inquiryItemId, 'commercialDeviation', e.target.value)}
        />
      ),
    },
    {
      title: t('supplierPortal.remark'),
      key: 'remark',
      width: 160,
      render: (_, record) => (
        <Input
          value={record.remark}
          placeholder={t('supplierPortal.remark')}
          onChange={(e) => updateField(record.inquiryItemId, 'remark', e.target.value)}
        />
      ),
    },
    {
      title: t('common.attachments'),
      key: 'attachments',
      width: 140,
      render: (_, record) => (
        <Upload
          fileList={record.attachments.map((a) => ({
            uid: a.id,
            name: a.name,
            status: 'done',
            url: a.url,
          })) as UploadFile[]}
          beforeUpload={(file) => {
            const newAtt: Attachment = {
              id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: file.name,
              url: '',
              size: file.size,
              uploadTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            };
            updateField(record.inquiryItemId, 'attachments', [
              ...record.attachments,
              newAtt,
            ]);
            return false; // 阻止真实上传
          }}
          onRemove={(file) => {
            updateField(
              record.inquiryItemId,
              'attachments',
              record.attachments.filter((a) => a.id !== file.uid),
            );
          }}
          multiple
        >
          <Button size="small" icon={<PaperClipOutlined />}>
            {t('common.upload')}
          </Button>
        </Upload>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 顶部信息 */}
      <Card styles={{ body: { padding: 16 } }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <Space align="center" size={12}>
              <Title level={4} style={{ margin: 0 }}>
                {supplier.name}
              </Title>
              <Tag color="blue">{t('supplierPortal.fillTag')}</Tag>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text strong>{t('supplierPortal.inquirySubjectLabel')}</Text>
              <Text>{inquiry.subject}</Text>
              <Text type="secondary" style={{ marginLeft: 16 }}>
                {t('supplierPortal.codeLabel')}{inquiry.code}
              </Text>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              <Text type="secondary">{t('supplierPortal.deadlineLabel')}</Text>
              <Text strong>{formatDateTime(inquiry.deadline)}</Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Tag
                color={
                  expired ? 'red' : remaining.urgent ? 'orange' : 'green'
                }
              >
                {remaining.text}
              </Tag>
            </div>
          </div>
        </div>
      </Card>

      {/* 超时警告 */}
      {expired && (
        <Alert
          type="error"
          showIcon
          message={t('supplierPortal.deadlinePassedSubmit')}
          description={t('supplierPortal.deadlineAlertDesc')}
        />
      )}

      {/* 已存在草稿提示 */}
      {existingQuotation?.status === QuotationStatus.DRAFT && (
        <Alert
          type="info"
          showIcon
          message={t('supplierPortal.draftLoadedTitle')}
          description={t('supplierPortal.draftLoadedDesc')}
        />
      )}

      {/* 询价基本信息 */}
      <Card title={t('supplierPortal.inquiryBasicInfo')} styles={{ body: { padding: 16 } }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
          <Descriptions.Item label={t('inquiry.detail.organization')}>{inquiry.organization}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.currency')}>
            {t(`enum.currency.${inquiry.currency}`)}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.expectedDeliveryDate')}>
            {formatDate(inquiry.expectedDeliveryDate)}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplierPortal.deliveryAddress')} span={2}>
            {inquiry.deliveryAddress}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.contact')}>{inquiry.contact}</Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.paymentTerms')} span={2}>
            {inquiry.paymentTerms}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.invoiceRequirement')}>
            {inquiry.invoiceRequirement || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.description')} span={3}>
            {inquiry.description || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 采购物料明细 */}
      <Card title={t('supplierPortal.purchaseMaterialList')} styles={{ body: { padding: 16 } }}>
        <Table<InquiryItem>
          rowKey="id"
          size="small"
          columns={inquiryItemColumns}
          dataSource={inquiry.items}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      {/* 技术附件 / 询价附件 */}
      <Card title={t('supplierPortal.inquiryAttachments')} styles={{ body: { padding: 16 } }}>
        {inquiry.attachments.length > 0 ? (
          <List
            size="small"
            dataSource={inquiry.attachments}
            renderItem={(a) => (
              <List.Item>
                <Space>
                  <PaperClipOutlined />
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {(a.size / 1024).toFixed(1)} KB · {formatDateTime(a.uploadTime)}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty description={t('supplierPortal.noAttachments')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          <Text strong>{t('supplierPortal.deliveryRequirement')}</Text>
          {inquiry.deliveryAddress}，{t('inquiry.detail.expectedDeliveryDate')} {formatDate(inquiry.expectedDeliveryDate)}。
        </Paragraph>
      </Card>

      {/* 报价填写表单 */}
      <Card
        title={t('supplierPortal.fillQuotation')}
        styles={{ body: { padding: 16 } }}
        extra={
          <Space size="large">
            <div>
              <Text type="secondary">{t('supplierPortal.totalAmountLabel')}</Text>
              <Text
                strong
                style={{ fontSize: 20, color: 'var(--color-primary)' }}
              >
                {formatCurrency(totalAmount, inquiry.currency)}
              </Text>
            </div>
          </Space>
        }
      >
        <Table<QuotationFormItem>
          rowKey="inquiryItemId"
          size="small"
          columns={quotationColumns}
          dataSource={formItems}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />

        <div style={{ marginTop: 16 }}>
          <Text strong>{t('supplierPortal.remarkLabel')}</Text>
          <Input.TextArea
            value={remark}
            rows={2}
            placeholder={t('supplierPortal.remarkPlaceholder')}
            onChange={(e) => setRemark(e.target.value)}
            style={{ marginTop: 8 }}
          />
        </div>

        {/* 操作栏 */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
          }}
        >
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button icon={<SaveOutlined />} onClick={handleSaveDraft} disabled={expired}>
            {t('supplierPortal.saveDraft')}
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSubmit}
            disabled={expired}
          >
            {t('supplierPortal.submitBtn')}
          </Button>
        </div>
      </Card>
    </Space>
  );
}
