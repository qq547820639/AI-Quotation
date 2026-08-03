/**
 * 待回收报价页（Task 11）
 * 路由：/quotation/pending，使用 MainLayout
 * 功能：跟踪各询价单的供应商报价回收进度，支持筛选、对比、详情、模拟供应商报价
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  List,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EyeOutlined,
  ReloadOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  InquiryStatus,
  QuotationStatus,
  type Inquiry,
  type Quotation,
  type Supplier,
} from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import PageHeader from '@/components/PageHeader';
import { InquiryStatusTag } from '@/components/StatusTag';
import { formatDateTime, getRemainingTime } from '@/utils/format';
import { useIsMobile } from '@/utils/useIsMobile';

const { Text } = Typography;
const { RangePicker } = DatePicker;

/** 仅展示这些状态的询价单 */
const VISIBLE_STATUSES: InquiryStatus[] = [
  InquiryStatus.INQUIRING,
  InquiryStatus.PARTIAL_QUOTED,
  InquiryStatus.ALL_QUOTED,
  InquiryStatus.TIMEOUT,
];

/** 行统计结果 */
interface RowStat {
  invited: number;
  submitted: number;
  draft: number;
  timeout: number;
  unquoted: number;
  progress: number;
}

/** 计算单行报价统计 */
function calcStat(inquiry: Inquiry, quotations: Quotation[]): RowStat {
  const invited = inquiry.invitedSupplierIds.length;
  const submittedQuo = quotations.filter((q) => q.status === QuotationStatus.SUBMITTED);
  const draftQuo = quotations.filter((q) => q.status === QuotationStatus.DRAFT);
  const timeoutQuo = quotations.filter((q) => q.status === QuotationStatus.TIMEOUT);
  const submitted = submittedQuo.length;
  const draft = draftQuo.length;
  // 已记录的超时数
  let timeout = timeoutQuo.length;
  // 若询价已超时，未留下任何报价记录的受邀供应商也算超时
  const remaining = getRemainingTime(inquiry.deadline);
  if (remaining.expired) {
    const respondedSupplierIds = new Set(quotations.map((q) => q.supplierId));
    inquiry.invitedSupplierIds.forEach((sid) => {
      if (!respondedSupplierIds.has(sid)) timeout += 1;
    });
  }
  const unquoted = Math.max(invited - submitted - draft - timeout, 0);
  const progress = invited > 0 ? Math.round((submitted / invited) * 100) : 0;
  return { invited, submitted, draft, timeout, unquoted, progress };
}

export default function QuotationPendingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const suppliers = useSupplierStore((s) => s.suppliers);
  const quotations = useQuotationStore((s) => s.quotations);
  const isMobile = useIsMobile();

  /** 状态筛选选项（任务指定：询价中/部分已报价/已超时） */
  const statusFilterOptions = [
    { label: t('quotation.pending.allStatus'), value: '' },
    { label: t('enum.inquiryStatus.INQUIRING'), value: InquiryStatus.INQUIRING },
    { label: t('enum.inquiryStatus.PARTIAL_QUOTED'), value: InquiryStatus.PARTIAL_QUOTED },
    { label: t('enum.inquiryStatus.TIMEOUT'), value: InquiryStatus.TIMEOUT },
  ];

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [deadlineRange, setDeadlineRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [keyword, setKeyword] = useState('');

  /** 获取某询价单的所有报价 */
  const getQuotationsByInquiry = (inquiryId: string): Quotation[] =>
    quotations.filter((q) => q.inquiryId === inquiryId);

  /** 未报价供应商列表（无 SUBMITTED 报价的受邀供应商，便于测试） */
  const getUnquotedSuppliers = (inquiry: Inquiry): Supplier[] => {
    const quos = getQuotationsByInquiry(inquiry.id);
    const submittedIds = new Set(
      quos.filter((q) => q.status === QuotationStatus.SUBMITTED).map((q) => q.supplierId),
    );
    return inquiry.invitedSupplierIds
      .filter((sid) => !submittedIds.has(sid))
      .map((sid) => suppliers.find((s) => s.id === sid))
      .filter((s): s is Supplier => !!s);
  };

  /** 过滤后的询价单 */
  const filteredInquiries = useMemo(() => {
    let list = inquiries.filter((i) => VISIBLE_STATUSES.includes(i.status));
    if (statusFilter) {
      list = list.filter((i) => i.status === statusFilter);
    }
    if (deadlineRange) {
      const [start, end] = deadlineRange;
      list = list.filter((i) => {
        const d = dayjs(i.deadline);
        return d.isAfter(start.startOf('day').subtract(1, 'ms')) && d.isBefore(end.endOf('day').add(1, 'ms'));
      });
    }
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.code.toLowerCase().includes(kw) || i.subject.toLowerCase().includes(kw),
      );
    }
    return list;
  }, [inquiries, statusFilter, deadlineRange, keyword]);

  /** 表格列 */
  const columns: ColumnsType<Inquiry> = [
    {
      title: t('quotation.pending.inquiryCode'),
      dataIndex: 'code',
      width: 150,
      fixed: 'left',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: t('inquiry.list.subject'),
      dataIndex: 'subject',
      width: 220,
      ellipsis: { showTitle: false },
      render: (v: string) => (
        <Tooltip title={v}>
          <span>{v}</span>
        </Tooltip>
      ),
    },
    {
      title: t('quotation.pending.deadlineTime'),
      dataIndex: 'deadline',
      width: 200,
      render: (v: string, record) => {
        const remaining = getRemainingTime(v);
        return (
          <div>
            <div>{formatDateTime(v)}</div>
            <Tag
              color={remaining.expired ? 'red' : remaining.urgent ? 'orange' : 'green'}
              style={{ marginTop: 2 }}
            >
              {remaining.text}
            </Tag>
            <span style={{ marginLeft: 8 }}>
              <InquiryStatusTag status={record.status} />
            </span>
          </div>
        );
      },
    },
    {
      title: t('quotation.pending.invitedCount'),
      key: 'invited',
      width: 110,
      align: 'center',
      render: (_, record) => calcStat(record, getQuotationsByInquiry(record.id)).invited,
    },
    {
      title: t('quotation.pending.submittedCount'),
      key: 'submitted',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const stat = calcStat(record, getQuotationsByInquiry(record.id));
        return <Text style={{ color: 'var(--color-success)', fontWeight: 600 }}>{stat.submitted}</Text>;
      },
    },
    {
      title: t('quotation.pending.draftCount'),
      key: 'draft',
      width: 90,
      align: 'center',
      render: (_, record) => {
        const stat = calcStat(record, getQuotationsByInquiry(record.id));
        return <Text style={{ color: 'var(--color-warning)' }}>{stat.draft}</Text>;
      },
    },
    {
      title: t('quotation.pending.unquotedCount'),
      key: 'unquoted',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const stat = calcStat(record, getQuotationsByInquiry(record.id));
        return <Text style={{ color: 'var(--color-text-tertiary)' }}>{stat.unquoted}</Text>;
      },
    },
    {
      title: t('quotation.pending.timeoutCount'),
      key: 'timeout',
      width: 90,
      align: 'center',
      render: (_, record) => {
        const stat = calcStat(record, getQuotationsByInquiry(record.id));
        return (
          <Text style={{ color: stat.timeout > 0 ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
            {stat.timeout}
          </Text>
        );
      },
    },
    {
      title: t('quotation.pending.recoveryProgress'),
      key: 'progress',
      width: 160,
      render: (_, record) => {
        const stat = calcStat(record, getQuotationsByInquiry(record.id));
        return (
          <Progress
            percent={stat.progress}
            size="small"
            status={
              stat.progress >= 100
                ? 'success'
                : stat.progress === 0
                  ? 'exception'
                  : 'active'
            }
            format={() => `${stat.submitted}/${stat.invited}`}
          />
        );
      },
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 280,
      fixed: 'right',
      render: (_, record) => {
        const unquotedSuppliers = getUnquotedSuppliers(record);
        return (
          <Space size={4} wrap>
            <Button
              type="link"
              size="small"
              icon={<SwapOutlined />}
              onClick={() => navigate(`/quotation/compare/${record.id}`)}
            >
              {t('quotation.pending.viewCompare')}
            </Button>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/inquiry/detail/${record.id}`)}
            >
              {t('inquiry.list.viewDetail')}
            </Button>
            <Select
              size="small"
              style={{ width: 160 }}
              placeholder={t('quotation.pending.simulateSupplier')}
              suffixIcon={<ReloadOutlined />}
              value={undefined}
              options={unquotedSuppliers.map((s) => ({
                label: s.name,
                value: s.id,
              }))}
              notFoundContent={t('quotation.pending.noUnquotedSupplier')}
              onChange={(supplierId) => {
                if (supplierId) {
                  navigate(`/supplier-portal/${record.id}/${supplierId}`);
                }
              }}
            />
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('quotation.pending.title')}
        description={t('quotation.pending.description')}
      />

      <Card styles={{ body: { padding: 16 } }}>
        {/* 筛选区 */}
        <Space size={12} wrap style={{ marginBottom: 16 }}>
          <Select
            value={statusFilter}
            style={{ width: 160 }}
            options={statusFilterOptions}
            onChange={setStatusFilter}
            placeholder={t('inquiry.list.filterStatus')}
          />
          <RangePicker
            value={deadlineRange}
            onChange={(dates) =>
              setDeadlineRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)
            }
            placeholder={[t('quotation.pending.deadlineStart'), t('quotation.pending.deadlineEnd')]}
          />
          <Input.Search
            value={keyword}
            style={{ width: 240 }}
            placeholder={t('quotation.pending.searchPlaceholder')}
            allowClear
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Text type="secondary" style={{ marginLeft: 'auto' }}>
            {t('common.total', { count: filteredInquiries.length })}
          </Text>
        </Space>

        {isMobile ? (
          <List
            dataSource={filteredInquiries}
            locale={{
              emptyText:
                inquiries.filter((i) => VISIBLE_STATUSES.includes(i.status)).length === 0 ? (
                  <Empty description={t('quotation.pending.empty')} />
                ) : (
                  <Empty description={t('quotation.pending.noMatch')} />
                ),
            }}
            pagination={{ pageSize: 10, simple: true, showTotal: (total) => t('common.total', { count: total }) }}
            renderItem={(record) => {
              const stat = calcStat(record, getQuotationsByInquiry(record.id));
              const remaining = getRemainingTime(record.deadline);
              const unquotedSuppliers = getUnquotedSuppliers(record);
              return (
                <List.Item style={{ padding: '12px 16px', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Text strong>{record.code}</Text>
                    <InquiryStatusTag status={record.status} />
                    <Tag color={remaining.expired ? 'red' : remaining.urgent ? 'orange' : 'green'}>
                      {remaining.text}
                    </Tag>
                  </div>
                  <Text ellipsis style={{ display: 'block', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                    {record.subject}
                  </Text>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                    {t('quotation.pending.deadlineTime')}: {formatDateTime(record.deadline)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, marginBottom: 8 }}>
                    <span>{t('quotation.pending.invitedCount')}: {stat.invited}</span>
                    <span style={{ color: 'var(--color-success)' }}>{t('quotation.pending.submittedCount')}: {stat.submitted}</span>
                    <span style={{ color: 'var(--color-warning)' }}>{t('quotation.pending.draftCount')}: {stat.draft}</span>
                    <span>{t('quotation.pending.unquotedCount')}: {stat.unquoted}</span>
                    {stat.timeout > 0 && (
                      <span style={{ color: 'var(--color-error)' }}>{t('quotation.pending.timeoutCount')}: {stat.timeout}</span>
                    )}
                  </div>
                  <Progress
                    percent={stat.progress}
                    size="small"
                    status={stat.progress >= 100 ? 'success' : stat.progress === 0 ? 'exception' : 'active'}
                    format={() => `${stat.submitted}/${stat.invited}`}
                  />
                  <Space size={4} wrap style={{ marginTop: 8 }}>
                    <Button type="link" size="small" icon={<SwapOutlined />} onClick={() => navigate(`/quotation/compare/${record.id}`)}>
                      {t('quotation.pending.viewCompare')}
                    </Button>
                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/inquiry/detail/${record.id}`)}>
                      {t('inquiry.list.viewDetail')}
                    </Button>
                    <Select
                      size="small"
                      style={{ width: 160 }}
                      placeholder={t('quotation.pending.simulateSupplier')}
                      suffixIcon={<ReloadOutlined />}
                      value={undefined}
                      options={unquotedSuppliers.map((s) => ({ label: s.name, value: s.id }))}
                      notFoundContent={t('quotation.pending.noUnquotedSupplier')}
                      onChange={(supplierId) => {
                        if (supplierId) {
                          navigate(`/supplier-portal/${record.id}/${supplierId}`);
                        }
                      }}
                    />
                  </Space>
                </List.Item>
              );
            }}
          />
        ) : (
        <Table<Inquiry>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filteredInquiries}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => t('common.total', { count: total }) }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText:
              inquiries.filter((i) => VISIBLE_STATUSES.includes(i.status)).length === 0 ? (
                <Empty description={t('quotation.pending.empty')} />
              ) : (
                <Empty description={t('quotation.pending.noMatch')} />
              ),
          }}
        />
        )}
      </Card>
    </div>
  );
}
