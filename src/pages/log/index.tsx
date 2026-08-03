/**
 * 操作日志页面（Task 17）
 * - 聚合所有询价单的 logs，按时间倒序展示
 * - 支持操作时间、操作人、操作类型、关键字筛选
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import type { TagProps } from 'antd';

import PageHeader from '@/components/PageHeader';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useUIStore } from '@/store/useUIStore';
import {
  LogType,
  type InquiryLog,
} from '@/types';
import { formatDateTime } from '@/utils/format';

const { RangePicker } = DatePicker;
const { Text } = Typography;

/** 日志类型对应的 Tag 颜色 */
const LOG_TYPE_TAG_COLOR: Record<LogType, TagProps['color']> = {
  [LogType.CREATE]: 'blue',
  [LogType.SAVE_DRAFT]: 'default',
  [LogType.UPDATE]: 'cyan',
  [LogType.ADD_SUPPLIER]: 'geekblue',
  [LogType.SEND_INQUIRY]: 'processing',
  [LogType.SUPPLIER_VIEW]: 'default',
  [LogType.SAVE_QUOTATION_DRAFT]: 'default',
  [LogType.SUBMIT_QUOTATION]: 'success',
  [LogType.QUOTATION_DEADLINE]: 'warning',
  [LogType.VIEW_QUOTATION]: 'purple',
  [LogType.SELECT_SUPPLIER]: 'gold',
  [LogType.CONFIRM_RESULT]: 'green',
  [LogType.SUBMIT_APPROVAL]: 'geekblue',
  [LogType.APPROVE]: 'success',
  [LogType.REJECT]: 'error',
  [LogType.CANCEL]: 'red',
};

interface FilterForm {
  timeRange?: [Dayjs, Dayjs] | null;
  operator?: string;
  type?: LogType | null;
  keyword?: string;
}

/** 聚合所有询价单日志（按时间倒序），并附加稳定 key */
function aggregateLogs(inquiries: ReturnType<typeof useInquiryStore.getState>['inquiries']) {
  const all = inquiries
    .flatMap((i) => i.logs)
    .sort((a, b) => (a.time < b.time ? 1 : -1));
  // 附加稳定 key：inquiryId+time+index
  return all.map((log, index) => ({
    ...log,
    key: `${log.inquiryId}-${log.time}-${index}`,
  }));
}

export default function LogPage() {
  const { t } = useTranslation();
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const [form] = Form.useForm<FilterForm>();

  const logTypeOptions = (Object.keys(LogType) as LogType[]).map((value) => ({
    label: t(`enum.logType.${value}`),
    value,
  }));

  // 已应用的筛选条件（点击查询后生效）
  const [applied, setApplied] = useState<FilterForm>({});

  const allLogs = useMemo(() => aggregateLogs(inquiries), [inquiries]);

  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      if (applied.timeRange && applied.timeRange.length === 2) {
        const [start, end] = applied.timeRange;
        const t = dayjs(log.time);
        if (!t.isValid()) return false;
        if (t.isBefore(start.startOf('day')) || t.isAfter(end.endOf('day'))) {
          return false;
        }
      }
      if (applied.operator) {
        if (!log.operator.toLowerCase().includes(applied.operator.toLowerCase())) {
          return false;
        }
      }
      if (applied.type && log.type !== applied.type) {
        return false;
      }
      if (applied.keyword) {
        if (!log.content.toLowerCase().includes(applied.keyword.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [allLogs, applied]);

  const handleQuery = () => {
    const values = form.getFieldsValue();
    setApplied({
      timeRange: values.timeRange ?? null,
      operator: values.operator?.trim() || undefined,
      type: values.type ?? null,
      keyword: values.keyword?.trim() || undefined,
    });
  };

  const handleReset = () => {
    form.resetFields();
    setApplied({});
  };

  const columns: ColumnsType<InquiryLog & { key: string }> = [
    {
      title: t('common.time'),
      dataIndex: 'time',
      key: 'time',
      width: 160,
      render: (v: string) => <Text style={{ fontSize: 13 }}>{formatDateTime(v)}</Text>,
    },
    {
      title: t('log.operator'),
      dataIndex: 'operator',
      key: 'operator',
      width: 200,
      render: (operator: string) => <Text style={{ fontSize: 13 }}>{operator}</Text>,
    },
    {
      title: t('log.operatorRole'),
      dataIndex: 'operatorRole',
      key: 'operatorRole',
      width: 110,
      render: (role?: string) =>
        role ? (
          <Tag color={role === '系统' ? 'default' : 'blue'}>{role}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t('log.operationType'),
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: LogType) => (
        <Tag color={LOG_TYPE_TAG_COLOR[type]}>{t(`enum.logType.${type}`)}</Tag>
      ),
    },
    {
      title: t('log.operationContent'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
    },
    {
      title: t('log.result'),
      dataIndex: 'result',
      key: 'result',
      width: 140,
      render: (result?: string) =>
        result ? <Text style={{ fontSize: 13 }}>{result}</Text> : <Text type="secondary">-</Text>,
    },
  ];

  return (
    <div>
      <PageHeader title={t('log.title')} description={t('log.description')} />

      {/* 筛选区 */}
      <Card style={{ borderRadius: 8, marginBottom: 16 }} styles={{ body: { paddingBottom: 0 } }}>
        <Form form={form} layout="inline" onFinish={handleQuery}>
          <Row gutter={[16, 16]} style={{ width: '100%' }}>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Form.Item name="timeRange" label={t('log.operationTime')}>
                <RangePicker style={{ width: '100%' }} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6} lg={5}>
              <Form.Item name="operator" label={t('log.operator')}>
                <Input placeholder={t('log.operatorPlaceholder')} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6} lg={5}>
              <Form.Item name="type" label={t('log.operationType')}>
                <Select
                  placeholder={t('log.typePlaceholder')}
                  allowClear
                  options={logTypeOptions}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4} lg={5}>
              <Form.Item name="keyword" label={t('log.keyword')}>
                <Input placeholder={t('log.contentSearchPlaceholder')} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} md={2} lg={3}>
              <Form.Item style={{ marginBottom: 16 }}>
                <Space>
                  <Button type="primary" htmlType="submit">
                    {t('log.query')}
                  </Button>
                  <Button onClick={handleReset}>{t('common.reset')}</Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* 日志表格 */}
      <Card style={{ borderRadius: 8 }} styles={{ body: { padding: 0 } }}>
        <Table<InquiryLog & { key: string }>
          rowKey="key"
          columns={columns}
          dataSource={filteredLogs}
          size="middle"
          scroll={{ x: 'max-content' }}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
            showTotal: (total) => t('log.totalRecords', { count: total }),
          }}
          locale={{
            emptyText: <Empty description={allLogs.length ? t('log.noSearchResult') : t('log.empty')} />,
          }}
        />
      </Card>
    </div>
  );
}
