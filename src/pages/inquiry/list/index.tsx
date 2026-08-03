/**
 * 询价单列表（Task 7）
 * 支持多维度筛选、状态可视化、截止时间警示、复制/取消/导出等操作
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import PageHeader from '@/components/PageHeader';
import Permission from '@/components/Permission';
import { InquiryStatusTag } from '@/components/StatusTag';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  INQUIRY_STATUS_OPTIONS,
  InquiryStatus,
  QuotationStatus,
  type Inquiry,
} from '@/types';
import { formatDateTime, getRemainingTime } from '@/utils/format';
import { confirmAction, notifySuccess } from '@/utils/confirm';
import { exportAOA } from '@/utils/excel';
import { isCancelable, isEditable } from '@/utils/inquiryStatus';
import { useIsMobile } from '@/utils/useIsMobile';

const { RangePicker } = DatePicker;
const { Text } = Typography;

/** 物料品类筛选选项 */
const MATERIAL_CATEGORY_OPTIONS = [
  { label: '工业电子', value: '工业电子' },
  { label: '五金件', value: '五金件' },
  { label: '自动化', value: '自动化' },
  { label: '办公设备', value: '办公设备' },
  { label: '包材', value: '包材' },
  { label: '劳保', value: '劳保' },
];

export default function InquiryListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const copyInquiry = useInquiryStore((s) => s.copyInquiry);
  const cancelInquiry = useInquiryStore((s) => s.cancelInquiry);
  const quotations = useQuotationStore((s) => s.quotations);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('INQUIRY_EDIT');
  const canCancel = hasPermission('INQUIRY_CANCEL');
  const isMobile = useIsMobile();

  // ===== 筛选状态（输入态，点击查询后写入 applied） =====
  const [filterCode, setFilterCode] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterCreator, setFilterCreator] = useState('');
  const [filterStatus, setFilterStatus] = useState<InquiryStatus[]>([]);
  const [filterCreatedAt, setFilterCreatedAt] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [filterDeadline, setFilterDeadline] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined);

  // 已应用的筛选条件（点击查询后生效，与 log 页一致）
  const [applied, setApplied] = useState<{
    code: string;
    subject: string;
    creator: string;
    status: InquiryStatus[];
    createdAt: [Dayjs | null, Dayjs | null] | null;
    deadline: [Dayjs | null, Dayjs | null] | null;
    category: string | undefined;
  }>({
    code: '',
    subject: '',
    creator: '',
    status: [],
    createdAt: null,
    deadline: null,
    category: undefined,
  });

  // 已提交报价数量映射：inquiryId -> count
  const submittedCountMap = useMemo(() => {
    const map = new Map<string, number>();
    quotations.forEach((q) => {
      if (q.status === QuotationStatus.SUBMITTED) {
        map.set(q.inquiryId, (map.get(q.inquiryId) ?? 0) + 1);
      }
    });
    return map;
  }, [quotations]);

  // 过滤后的询价单（基于 applied，非输入态）
  const filteredInquiries = useMemo(() => {
    return inquiries.filter((inquiry) => {
      if (
        applied.code &&
        !inquiry.code.toLowerCase().includes(applied.code.toLowerCase())
      ) {
        return false;
      }
      if (
        applied.subject &&
        !inquiry.subject.toLowerCase().includes(applied.subject.toLowerCase())
      ) {
        return false;
      }
      if (applied.creator && !inquiry.createdByName.includes(applied.creator)) {
        return false;
      }
      if (applied.status.length > 0 && !applied.status.includes(inquiry.status)) {
        return false;
      }
      if (applied.createdAt && applied.createdAt[0] && applied.createdAt[1]) {
        const created = dayjs(inquiry.createdAt);
        if (
          created.isBefore(applied.createdAt[0].startOf('day')) ||
          created.isAfter(applied.createdAt[1].endOf('day'))
        ) {
          return false;
        }
      }
      if (applied.deadline && applied.deadline[0] && applied.deadline[1]) {
        const deadline = dayjs(inquiry.deadline);
        if (
          deadline.isBefore(applied.deadline[0].startOf('day')) ||
          deadline.isAfter(applied.deadline[1].endOf('day'))
        ) {
          return false;
        }
      }
      if (applied.category) {
        const matched = inquiry.items.some((item) =>
          item.category.includes(applied.category!),
        );
        if (!matched) return false;
      }
      return true;
    });
  }, [inquiries, applied]);

  const handleQuery = () => {
    setApplied({
      code: filterCode,
      subject: filterSubject,
      creator: filterCreator,
      status: filterStatus,
      createdAt: filterCreatedAt,
      deadline: filterDeadline,
      category: filterCategory,
    });
  };

  const handleReset = () => {
    setFilterCode('');
    setFilterSubject('');
    setFilterCreator('');
    setFilterStatus([]);
    setFilterCreatedAt(null);
    setFilterDeadline(null);
    setFilterCategory(undefined);
    setApplied({
      code: '',
      subject: '',
      creator: '',
      status: [],
      createdAt: null,
      deadline: null,
      category: undefined,
    });
  };

  const handleCopy = (inquiry: Inquiry) => {
    confirmAction({
      title: i18n.t('inquiry.list.confirmCopyTitle'),
      content: i18n.t('inquiry.list.confirmCopyContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.list.confirmCopyOk'),
      onOk: () => {
        const copy = copyInquiry(inquiry.id);
        if (copy) {
          notifySuccess(i18n.t('inquiry.list.copySuccess', { code: copy.code }));
        }
      },
    });
  };

  const handleCancel = (inquiry: Inquiry) => {
    confirmAction({
      title: i18n.t('inquiry.list.confirmCancelTitle'),
      content: i18n.t('inquiry.list.confirmCancelContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.list.confirmCancelOk'),
      danger: true,
      onOk: () => {
        cancelInquiry(inquiry.id);
        notifySuccess(i18n.t('inquiry.list.cancelSuccess'));
      },
    });
  };

  const handleExport = (inquiry: Inquiry) => {
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
  };

  // 截止时间单元格：超时红色、即将超时橙色
  const renderDeadline = (deadline: string) => {
    const remaining = getRemainingTime(deadline);
    const formatted = formatDateTime(deadline);
    if (remaining.expired) {
      return (
        <Space direction="vertical" size={0}>
          <Text style={{ color: 'var(--color-error)' }}>{formatted}</Text>
          <Tag color="error" style={{ marginInlineStart: 0 }}>
            {t('inquiry.list.expired')}
          </Tag>
        </Space>
      );
    }
    if (remaining.urgent) {
      return (
        <Space direction="vertical" size={0}>
          <Text style={{ color: 'var(--color-warning)' }}>{formatted}</Text>
          <Text style={{ fontSize: 12, color: 'var(--color-warning)' }}>{remaining.text}</Text>
        </Space>
      );
    }
    return <Text>{formatted}</Text>;
  };

  const columns: ColumnsType<Inquiry> = [
    {
      title: t('inquiry.list.inquiryCode'),
      dataIndex: 'code',
      key: 'code',
      width: 160,
      fixed: 'left',
      render: (code: string) => <Text strong>{code}</Text>,
    },
    {
      title: t('inquiry.list.subject'),
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
      render: (subject: string) => <Text>{subject}</Text>,
    },
    {
      title: t('inquiry.list.itemCount'),
      key: 'itemCount',
      width: 90,
      align: 'center',
      render: (_, record) => record.items.length,
      sorter: (a, b) => a.items.length - b.items.length,
    },
    {
      title: t('inquiry.list.invitedCount'),
      key: 'invitedCount',
      width: 100,
      align: 'center',
      render: (_, record) => record.invitedSupplierIds.length,
      sorter: (a, b) => a.invitedSupplierIds.length - b.invitedSupplierIds.length,
    },
    {
      title: t('inquiry.list.submittedCount'),
      key: 'submittedCount',
      width: 90,
      align: 'center',
      render: (_, record) => {
        const count = submittedCountMap.get(record.id) ?? 0;
        const total = record.invitedSupplierIds.length;
        const allDone = total > 0 && count === total;
        return (
          <Text style={{ color: allDone ? 'var(--color-success)' : undefined, fontWeight: allDone ? 600 : 400 }}>
            {count}
          </Text>
        );
      },
      sorter: (a, b) =>
        (submittedCountMap.get(a.id) ?? 0) - (submittedCountMap.get(b.id) ?? 0),
    },
    {
      title: t('inquiry.list.deadlineLabel'),
      dataIndex: 'deadline',
      key: 'deadline',
      width: 180,
      render: (deadline: string) => renderDeadline(deadline),
      sorter: (a, b) => dayjs(a.deadline).valueOf() - dayjs(b.deadline).valueOf(),
    },
    {
      title: t('inquiry.list.currentStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: InquiryStatus) => <InquiryStatusTag status={status} />,
      sorter: (a, b) => a.status.localeCompare(b.status),
    },
    {
      title: t('inquiry.list.creator'),
      dataIndex: 'createdByName',
      key: 'createdByName',
      width: 100,
    },
    {
      title: t('inquiry.list.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (createdAt: string) => formatDateTime(createdAt),
      sorter: (a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
      defaultSortOrder: 'descend',
    },
    {
      title: t('inquiry.list.actions'),
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/inquiry/detail/${record.id}`)}
          >
            {t('common.detail')}
          </Button>
          {canEdit && isEditable(record.status) && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/inquiry/edit/${record.id}`)}
            >
              {t('inquiry.list.edit')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(record)}
          >
            {t('common.copy')}
          </Button>
          {canCancel && isCancelable(record.status) && (
            <Button
              type="link"
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() => handleCancel(record)}
            >
              {t('common.cancel')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => handleExport(record)}
          >
            {t('common.export')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('inquiry.list.pageTitle')}
        description={t('inquiry.list.pageDescription')}
        extra={
          <Permission perm="INQUIRY_CREATE">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/inquiry/create')}
            >
              {t('inquiry.list.newInquiry')}
            </Button>
          </Permission>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.inquiryCode')}</div>
            <Input
              placeholder={t('common.inputPlaceholder')}
              value={filterCode}
              onChange={(e) => setFilterCode(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.subject')}</div>
            <Input
              placeholder={t('common.inputPlaceholder')}
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.creator')}</div>
            <Input
              placeholder={t('common.inputPlaceholder')}
              value={filterCreator}
              onChange={(e) => setFilterCreator(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.status')}</div>
            <Select
              mode="multiple"
              placeholder={t('common.selectPlaceholder')}
              value={filterStatus}
              onChange={(val) => setFilterStatus(val)}
              options={INQUIRY_STATUS_OPTIONS}
              style={{ width: '100%' }}
              allowClear
              maxTagCount="responsive"
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.createdAt')}</div>
            <RangePicker
              value={filterCreatedAt as [Dayjs, Dayjs] | null}
              onChange={(val) =>
                setFilterCreatedAt(val as [Dayjs | null, Dayjs | null] | null)
              }
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.deadline')}</div>
            <RangePicker
              value={filterDeadline as [Dayjs, Dayjs] | null}
              onChange={(val) =>
                setFilterDeadline(val as [Dayjs | null, Dayjs | null] | null)
              }
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('inquiry.list.materialCategory')}</div>
            <Select
              placeholder={t('common.selectPlaceholder')}
              value={filterCategory}
              onChange={(val) => setFilterCategory(val)}
              options={MATERIAL_CATEGORY_OPTIONS}
              style={{ width: '100%' }}
              allowClear
            />
          </Col>
          <Col
            xs={24}
            sm={12}
            md={8}
            lg={6}
            style={{ display: 'flex', alignItems: 'flex-end' }}
          >
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>
                {t('inquiry.list.query')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        {isMobile ? (
          <List
            dataSource={filteredInquiries}
            locale={{
              emptyText:
                inquiries.length === 0 ? (
                  <Empty description={t('inquiry.list.empty')} />
                ) : (
                  <Empty description={t('inquiry.list.noMatch')} />
                ),
            }}
            pagination={{
              pageSize: 10,
              simple: true,
              showTotal: (total) => t('inquiry.list.total', { count: total }),
            }}
            renderItem={(record) => {
              const submittedCount = submittedCountMap.get(record.id) ?? 0;
              const remaining = getRemainingTime(record.deadline);
              return (
                <List.Item style={{ padding: '12px 16px', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Text strong>{record.code}</Text>
                        <InquiryStatusTag status={record.status} />
                      </div>
                      <Text ellipsis style={{ display: 'block', color: 'var(--color-text-secondary)' }}>
                        {record.subject}
                      </Text>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-tertiary)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    <span>{t('inquiry.list.itemCount')}: {record.items.length}</span>
                    <span>{t('inquiry.list.invitedCount')}: {record.invitedSupplierIds.length}</span>
                    <span>{t('inquiry.list.submittedCount')}: {submittedCount}</span>
                    <span>{t('inquiry.list.creator')}: {record.createdByName}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: remaining.expired ? 'var(--color-error)' : remaining.urgent ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}>
                    {t('inquiry.list.deadline')}: {formatDateTime(record.deadline)}
                    {remaining.expired ? ` · ${t('inquiry.list.expired')}` : remaining.urgent ? ` · ${remaining.text}` : ''}
                  </div>
                  <Space size={0} wrap style={{ marginTop: 8 }}>
                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/inquiry/detail/${record.id}`)}>
                      {t('common.detail')}
                    </Button>
                    {canEdit && isEditable(record.status) && (
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/inquiry/edit/${record.id}`)}>
                        {t('inquiry.list.edit')}
                      </Button>
                    )}
                    <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(record)}>
                      {t('common.copy')}
                    </Button>
                    {canCancel && isCancelable(record.status) && (
                      <Button type="link" size="small" danger icon={<StopOutlined />} onClick={() => handleCancel(record)}>
                        {t('common.cancel')}
                      </Button>
                    )}
                    <Button type="link" size="small" icon={<ExportOutlined />} onClick={() => handleExport(record)}>
                      {t('common.export')}
                    </Button>
                  </Space>
                </List.Item>
              );
            }}
          />
        ) : (
        <Table<Inquiry>
          rowKey="id"
          columns={columns}
          dataSource={filteredInquiries}
          scroll={{ x: 1500 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => t('inquiry.list.total', { count: total }),
          }}
          locale={{
            emptyText:
              inquiries.length === 0 ? (
                <Empty description={t('inquiry.list.empty')} />
              ) : (
                <Empty description={t('inquiry.list.noMatch')} />
              ),
          }}
        />
        )}
      </Card>
    </div>
  );
}
