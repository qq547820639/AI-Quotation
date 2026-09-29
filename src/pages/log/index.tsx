import { useVisibleInquiries } from '@/hooks/useVisibleInquiries';
/**
 * 操作日志页面（Task 17）
 * - 聚合所有询价单的 logs，按时间倒序展示
 * - 支持操作时间、操作人、操作类型、关键字筛选
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
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
import { IS_DEMO_MODE } from '@/config';
import { inquiryApi } from '@/api/inquiryApi';
import { useInquiryStore } from '@/store/useInquiryStore';
import { LogType, type InquiryLog, type PaginatedLogs } from '@/types';
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

/** 聚合所有询价单日志（按时间倒序）——R112 起这条只在演示模式那一支跑 */
function aggregateLogs(inquiries: ReturnType<typeof useInquiryStore.getState>['inquiries']) {
  return inquiries.flatMap((i) => i.logs).sort((a, b) => (a.time < b.time ? 1 : -1));
}

export default function LogPage() {
  const { t } = useTranslation();
  const inquiries = useVisibleInquiries();
  const [form] = Form.useForm<FilterForm>();

  const logTypeOptions = (Object.keys(LogType) as LogType[]).map((value) => ({
    label: t(`enum.logType.${value}`),
    value,
  }));

  // 已应用的筛选条件（点击查询后生效）
  const [applied, setApplied] = useState<FilterForm>({});

  // R112：这一页原来是开放项 8 里最重的消费者——它要的不是询价单而是日志行，
  // 却把整份询价数组（每条带全部 logs）拉下来再 flatMap。服务端按日志行分页后，
  // 一页 10 行只付 10 行的价；筛子（操作人/类型/关键字/时间区间）一并下推。
  const serverEnabled = !IS_DEMO_MODE;
  const [serverPage, setServerPage] = useState(1);
  const [serverPageSize] = useState(10);

  const timeFrom = applied.timeRange ? applied.timeRange[0].format('YYYY-MM-DD') : undefined;
  const timeTo = applied.timeRange ? applied.timeRange[1].format('YYYY-MM-DD') : undefined;
  const logParams = useMemo(
    () => ({
      page: serverPage,
      pageSize: serverPageSize,
      operator: applied.operator,
      type: applied.type ?? undefined,
      keyword: applied.keyword,
      timeFrom,
      timeTo,
    }),
    [serverPage, serverPageSize, applied, timeFrom, timeTo],
  );

  const { data: serverData, isFetching: serverFetching } = useQuery<PaginatedLogs>({
    queryKey: ['logs', 'page', serverPage, serverPageSize, applied, timeFrom, timeTo],
    queryFn: () => inquiryApi.logs(logParams),
    enabled: serverEnabled,
  });

  // 演示模式那一支继续用整份数组聚合排序；服务端那一支不该再排一次全集（R112）。
  // 注意这条不改变行集——它改的是"服务端分支还摸不摸无界数组"。
  const allLogs = useMemo(
    () => (serverEnabled ? [] : aggregateLogs(inquiries)),
    [inquiries, serverEnabled],
  );

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
    // 换筛子必须回第 1 页：否则"停在第 4 页 + 新筛子"会读到一页空白，看着像没数据（同 R109）
    setServerPage(1);
  };

  const handleReset = () => {
    form.resetFields();
    setApplied({});
    setServerPage(1);
  };

  const displayRows = serverEnabled ? (serverData?.items ?? []) : filteredLogs;
  const displayTotal = serverEnabled ? (serverData?.total ?? 0) : filteredLogs.length;
  const hasFilters = Boolean(
    applied.operator || applied.type || applied.keyword || applied.timeRange,
  );
  const emptyNode = (
    <Empty
      description={displayTotal === 0 && !hasFilters ? t('log.empty') : t('log.noSearchResult')}
    />
  );

  const columns: ColumnsType<InquiryLog> = [
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
        <Table<InquiryLog>
          rowKey="id"
          columns={columns}
          dataSource={displayRows}
          loading={serverEnabled && serverFetching}
          size="middle"
          scroll={{ x: 'max-content' }}
          pagination={{
            pageSize: serverPageSize,
            current: serverEnabled ? serverPage : undefined,
            total: displayTotal,
            showSizeChanger: false,
            showTotal: (total) => t('log.totalRecords', { count: total }),
            onChange: (p) => setServerPage(p),
          }}
          locale={{ emptyText: emptyNode }}
        />
      </Card>
    </div>
  );
}
