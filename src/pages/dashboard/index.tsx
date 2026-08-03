/**
 * 工作台页面（Task 6）
 * - 顶部统计卡片行
 * - 最近询价单 + 待处理任务
 * - 询价状态分布饼图 + 近期报价趋势折线图
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Empty,
  List,
  Row,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  PlusOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
} from '@ant-design/icons';
import echarts from '@/utils/echarts';
import dayjs from 'dayjs';

import PageHeader from '@/components/PageHeader';
import { InquiryStatusTag } from '@/components/StatusTag';
import { useAuthStore } from '@/store/useAuthStore';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useUIStore } from '@/store/useUIStore';
import {
  INQUIRY_STATUS_COLOR,
  INQUIRY_STATUS_LABEL,
  InquiryStatus,
  LogType,
  QuotationStatus,
  type Inquiry,
} from '@/types';
import { formatDateTime, getRemainingTime } from '@/utils/format';
import { useChartColors, useChartTextColor, useChartAxisLineColor } from '@/utils/useChartColors';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/** 异常状态色（内联样式用 CSS 变量） */
const WARNING_COLOR = 'var(--color-warning)';
/** 主色（内联样式用 CSS 变量） */
const PRIMARY_COLOR = 'var(--color-primary)';

type ChartInstance = ReturnType<typeof echarts.init>;

interface StatCardData {
  key: string;
  title: string;
  value: string | number;
  icon: ReactNode;
  trend: string;
  /** 是否异常提醒（橙色突出） */
  warning?: boolean;
  /** 环比百分比（正数=增长，负数=下降，null=无数据） */
  mom?: number | null;
}

/* ============================ 统计计算 ============================ */

/** 本月询价单数量 */
function countThisMonth(inquiries: Inquiry[]): number {
  const now = dayjs();
  return inquiries.filter((i) => dayjs(i.createdAt).isSame(now, 'month')).length;
}

/** 上月询价单数量（用于环比） */
function countLastMonth(inquiries: Inquiry[]): number {
  const lastMonth = dayjs().subtract(1, 'month');
  return inquiries.filter((i) => dayjs(i.createdAt).isSame(lastMonth, 'month')).length;
}

/** 计算环比百分比（正数=增长，负数=下降） */
function calcMonthOverMonth(thisMonth: number, lastMonth: number): number | null {
  if (lastMonth === 0) return null;
  return Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
}

/** 指定状态的询价单数量 */
function countByStatus(inquiries: Inquiry[], status: InquiryStatus): number {
  return inquiries.filter((i) => i.status === status).length;
}

/** 待处理报价数：状态为 INQUIRING/PARTIAL_QUOTED 的询价中，未提交报价的供应商邀请数累计 */
function countPendingQuotations(
  inquiries: Inquiry[],
  quotations: ReturnType<typeof useQuotationStore.getState>['quotations'],
): number {
  let total = 0;
  inquiries
    .filter(
      (i) =>
        i.status === InquiryStatus.INQUIRING ||
        i.status === InquiryStatus.PARTIAL_QUOTED,
    )
    .forEach((i) => {
      const submittedSupplierIds = new Set(
        quotations
          .filter(
            (q) => q.inquiryId === i.id && q.status === QuotationStatus.SUBMITTED,
          )
          .map((q) => q.supplierId),
      );
      const pending = i.invitedSupplierIds.filter(
        (id) => !submittedSupplierIds.has(id),
      ).length;
      total += pending;
    });
  return total;
}

/** 即将超时询价单列表（urgent 且状态为 INQUIRING/PARTIAL_QUOTED） */
function getUrgentInquiries(inquiries: Inquiry[]): Inquiry[] {
  return inquiries.filter((i) => {
    if (
      i.status !== InquiryStatus.INQUIRING &&
      i.status !== InquiryStatus.PARTIAL_QUOTED
    ) {
      return false;
    }
    return getRemainingTime(i.deadline).urgent;
  });
}

/** 平均报价回收时长（小时）：SEND_INQUIRY 到第一个 SUBMIT_QUOTATION 的时间差平均 */
function calcAvgResponseHours(inquiries: Inquiry[]): number | null {
  const diffs: number[] = [];
  inquiries.forEach((i) => {
    const sendLog = i.logs.find((l) => l.type === LogType.SEND_INQUIRY);
    if (!sendLog) return;
    const sendTime = dayjs(sendLog.time);
    if (!sendTime.isValid()) return;
    const submitLogs = i.logs
      .filter((l) => l.type === LogType.SUBMIT_QUOTATION)
      .sort((a, b) => (a.time < b.time ? -1 : 1));
    if (!submitLogs.length) return;
    const firstSubmit = dayjs(submitLogs[0].time);
    if (!firstSubmit.isValid()) return;
    const diffHours = firstSubmit.diff(sendTime, 'hour', true);
    if (diffHours >= 0) diffs.push(diffHours);
  });
  if (!diffs.length) return null;
  const sum = diffs.reduce((acc, v) => acc + v, 0);
  return Math.round((sum / diffs.length) * 10) / 10;
}

/* ============================ 图表 ============================ */

/** 询价状态分布饼图 */
function StatusPieChart({ inquiries }: { inquiries: Inquiry[] }) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const textColor = useChartTextColor();
  const domRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const chart = echarts.init(domRef.current);
    chartRef.current = chart;

    // antd Tag 颜色名 -> 主题色板索引（用于 ECharts）
    const tagColorHex: Record<string, string> = {
      default: '#C9CDD4',
      processing: colors[0],
      warning: colors[2],
      success: colors[1],
      error: colors[3],
      gold: colors[7],
      green: colors[1],
      purple: colors[4],
      blue: colors[0],
      orange: colors[2],
    };

    // 按状态分组统计
    const countMap = new Map<InquiryStatus, number>();
    inquiries.forEach((i) => {
      countMap.set(i.status, (countMap.get(i.status) ?? 0) + 1);
    });

    const data = (Object.keys(INQUIRY_STATUS_LABEL) as InquiryStatus[])
      .map((status) => ({
        name: t(`enum.inquiryStatus.${status}`),
        value: countMap.get(status) ?? 0,
        itemStyle: {
          color: tagColorHex[INQUIRY_STATUS_COLOR[status] as string] ?? colors[0],
        },
      }))
      .filter((d) => d.value > 0);

    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 8,
        top: 'center',
        textStyle: { fontSize: 12, color: textColor },
      },
      series: [
        {
          name: t('dashboard.chartSeries.inquiryStatus'),
          type: 'pie',
          radius: ['40%', '68%'],
          center: ['38%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: 'var(--color-card)',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
            },
          },
          data,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [inquiries, t, colors, textColor]);

  if (!inquiries.length) {
    return (
      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={t('dashboard.noInquiryData')} />
      </div>
    );
  }

  return <div ref={domRef} style={{ width: '100%', height: 300 }} />;
}

/** 近期报价趋势折线图（近 7 天每天 SUBMITTED 报价数量） */
function QuotationTrendChart({
  quotations,
}: {
  quotations: ReturnType<typeof useQuotationStore.getState>['quotations'];
}) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const textColor = useChartTextColor();
  const axisLineColor = useChartAxisLineColor();
  const domRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const chart = echarts.init(domRef.current);
    chartRef.current = chart;

    // 近 7 天日期标签
    const days: string[] = [];
    const counts: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day');
      days.push(d.format('MM-DD'));
      const dayStart = d.startOf('day');
      const dayEnd = d.endOf('day');
      const c = quotations.filter((q) => {
        if (q.status !== QuotationStatus.SUBMITTED) return false;
        const t = q.submittedAt ?? q.updatedAt;
        const td = dayjs(t);
        return td.isValid() && td.isAfter(dayStart) && td.isBefore(dayEnd);
      }).length;
      counts.push(c);
    }

    const primaryHex = colors[0];
    // 将 #RRGGBB 转为 r,g,b 用于 rgba()
    const r = parseInt(primaryHex.slice(1, 3), 16);
    const g = parseInt(primaryHex.slice(3, 5), 16);
    const b = parseInt(primaryHex.slice(5, 7), 16);

    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 40, right: 24, top: 32, bottom: 32 },
      xAxis: {
        type: 'category',
        data: days,
        boundaryGap: false,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: textColor, fontSize: 12 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: textColor, fontSize: 12 },
      },
      series: [
        {
          name: t('dashboard.chartSeries.quotationCount'),
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          data: counts,
          itemStyle: { color: primaryHex },
          lineStyle: { width: 2, color: primaryHex },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: `rgba(${r}, ${g}, ${b}, 0.25)` },
              { offset: 1, color: `rgba(${r}, ${g}, ${b}, 0.02)` },
            ]),
          },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [quotations, t, colors, textColor, axisLineColor]);

  const hasData = quotations.some((q) => q.status === QuotationStatus.SUBMITTED);
  if (!hasData) {
    return (
      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={t('dashboard.noQuotationData')} />
      </div>
    );
  }

  return <div ref={domRef} style={{ width: '100%', height: 300 }} />;
}

/** 供应商报价频次 Top10（横向 BarChart，B6 新增） */
function SupplierFrequencyChart({ inquiries }: { inquiries: Inquiry[] }) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const textColor = useChartTextColor();
  const axisLineColor = useChartAxisLineColor();
  const suppliers = useSupplierStore((s) => s.suppliers);
  const domRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const chart = echarts.init(domRef.current);
    chartRef.current = chart;

    // 统计供应商被邀请频次
    const freqMap = new Map<string, number>();
    inquiries.forEach((i) => {
      i.invitedSupplierIds.forEach((sid) => {
        freqMap.set(sid, (freqMap.get(sid) ?? 0) + 1);
      });
    });

    const supName = (sid: string) =>
      suppliers.find((s) => s.id === sid)?.name ?? sid;

    const sorted = [...freqMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reverse(); // 横向 bar 从下往上

    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 10, right: 30, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: textColor, fontSize: 12 },
        splitLine: { lineStyle: { color: axisLineColor } },
      },
      yAxis: {
        type: 'category',
        data: sorted.map(([sid]) => supName(sid)),
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: {
          color: textColor,
          fontSize: 11,
          width: 140,
          overflow: 'truncate',
        },
      },
      series: [
        {
          name: t('dashboard.chartSeries.quotationCount'),
          type: 'bar',
          data: sorted.map(([_, count]) => ({
            value: count,
            itemStyle: { color: colors[0] },
          })),
          barMaxWidth: 20,
          label: { show: true, position: 'right', color: textColor, fontSize: 12 },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [inquiries, t, colors, textColor, axisLineColor, suppliers]);

  const hasData = inquiries.some((i) => i.invitedSupplierIds.length > 0);
  if (!hasData) {
    return <Empty description={t('dashboard.chart.noData')} style={{ padding: '40px 0' }} />;
  }

  return <div ref={domRef} style={{ width: '100%', height: 300 }} />;
}

/** 物料品类分布（PieChart Rose 模式，B6 新增） */
function CategoryDistributionChart({ inquiries }: { inquiries: Inquiry[] }) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const textColor = useChartTextColor();
  const domRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const chart = echarts.init(domRef.current);
    chartRef.current = chart;

    // 统计物料品类
    const catMap = new Map<string, number>();
    inquiries.forEach((i) => {
      i.items.forEach((it) => {
        catMap.set(it.category, (catMap.get(it.category) ?? 0) + 1);
      });
    });

    const data = [...catMap.entries()]
      .map(([name, value], idx) => ({
        name,
        value,
        itemStyle: { color: colors[idx % colors.length] },
      }))
      .sort((a, b) => b.value - a.value);

    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 8,
        top: 'center',
        textStyle: { fontSize: 12, color: textColor },
      },
      series: [
        {
          name: t('dashboard.charts.materialCategory'),
          type: 'pie',
          radius: ['20%', '68%'],
          center: ['38%', '50%'],
          roseType: 'radius',
          itemStyle: { borderRadius: 4, borderColor: 'var(--color-card)', borderWidth: 2 },
          label: { show: false },
          data,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [inquiries, t, colors, textColor]);

  const hasData = inquiries.some((i) => i.items.length > 0);
  if (!hasData) {
    return <Empty description={t('dashboard.chart.noData')} style={{ padding: '40px 0' }} />;
  }

  return <div ref={domRef} style={{ width: '100%', height: 300 }} />;
}

/** 询价审批漏斗（FunnelChart，B6 新增） */
function ApprovalFunnelChart({ inquiries }: { inquiries: Inquiry[] }) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const textColor = useChartTextColor();
  const domRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const chart = echarts.init(domRef.current);
    chartRef.current = chart;

    // 漏斗各阶段：累计达到该阶段（含）的询价数
    const funnelStages = [
      { key: InquiryStatus.DRAFT, label: t('enum.inquiryStatus.DRAFT'), colorIdx: 0 },
      { key: InquiryStatus.PENDING_SEND, label: t('enum.inquiryStatus.PENDING_SEND'), colorIdx: 1 },
      { key: InquiryStatus.INQUIRING, label: t('enum.inquiryStatus.INQUIRING'), colorIdx: 2 },
      { key: InquiryStatus.ALL_QUOTED, label: t('enum.inquiryStatus.ALL_QUOTED'), colorIdx: 3 },
      { key: InquiryStatus.PENDING_APPROVAL, label: t('enum.inquiryStatus.PENDING_APPROVAL'), colorIdx: 4 },
      { key: InquiryStatus.COMPLETED, label: t('enum.inquiryStatus.COMPLETED'), colorIdx: 5 },
    ];

    // 累计计数：DRAFT 包含所有，PENDING_SEND 包含 PENDING_SEND 及之后，以此类推
    const statusOrder = [
      InquiryStatus.DRAFT,
      InquiryStatus.PENDING_SEND,
      InquiryStatus.INQUIRING,
      InquiryStatus.PARTIAL_QUOTED,
      InquiryStatus.ALL_QUOTED,
      InquiryStatus.TIMEOUT,
      InquiryStatus.PENDING_CONFIRM,
      InquiryStatus.PENDING_APPROVAL,
      InquiryStatus.COMPLETED,
      InquiryStatus.CANCELLED,
    ];

    const stageIndex = (status: InquiryStatus): number => {
      const idx = statusOrder.indexOf(status);
      if (idx < 0) return -1;
      // DRAFT: idx 0, PENDING_SEND: idx 1, INQUIRING: idx 2, PARTIAL_QUOTED: idx 2 (same stage as INQUIRING),
      // ALL_QUOTED: idx 4, TIMEOUT: idx 4 (same as ALL_QUOTED for funnel), PENDING_CONFIRM: idx 4,
      // PENDING_APPROVAL: idx 7, COMPLETED: idx 8
      const funnelIdx = funnelStages.findIndex((s) => s.key === status);
      return funnelIdx >= 0 ? funnelIdx : -1;
    };

    const counts = funnelStages.map(() => 0);
    inquiries.forEach((i) => {
      const idx = stageIndex(i.status);
      if (idx >= 0) {
        for (let s = 0; s <= idx; s++) counts[s]++;
        // TIMEOUT 归入 ALL_QUOTED 阶段（有报价但超时）
        if (i.status === InquiryStatus.TIMEOUT) {
          counts[3]++; // ALL_QUOTED stage
        }
      }
    });

    const data = funnelStages
      .map((stage, idx) => ({
        name: stage.label,
        value: counts[idx],
        itemStyle: { color: colors[stage.colorIdx % colors.length] },
      }))
      .filter((d) => d.value > 0);

    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c}' },
      series: [
        {
          name: t('dashboard.charts.approvalFunnel'),
          type: 'funnel',
          left: '10%',
          right: '10%',
          top: 16,
          bottom: 16,
          minSize: '20%',
          maxSize: '100%',
          sort: 'descending',
          gap: 2,
          label: { show: true, position: 'inside', color: '#fff', fontSize: 12 },
          labelLine: { length: 10, lineStyle: { width: 1 } },
          itemStyle: { borderColor: 'var(--color-card)', borderWidth: 1 },
          emphasis: { label: { fontSize: 14 } },
          data,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [inquiries, t, colors, textColor]);

  const funnelStageStatuses: InquiryStatus[] = [
    InquiryStatus.DRAFT,
    InquiryStatus.PENDING_SEND,
    InquiryStatus.INQUIRING,
    InquiryStatus.ALL_QUOTED,
    InquiryStatus.PENDING_APPROVAL,
    InquiryStatus.COMPLETED,
  ];
  const hasData = inquiries.some((i) => funnelStageStatuses.includes(i.status));
  if (!hasData) {
    return <Empty description={t('dashboard.chart.noData')} style={{ padding: '40px 0' }} />;
  }

  return <div ref={domRef} style={{ width: '100%', height: 300 }} />;
}

/* ============================ 统计卡片 ============================ */

function StatCard({ data }: { data: StatCardData }) {
  const { t } = useTranslation();
  const warning = data.warning;
  return (
    <Card
      bodyStyle={{ padding: 16 }}
      style={{
        borderRadius: 8,
        border: warning ? `1px solid ${WARNING_COLOR}` : undefined,
        background: warning ? 'var(--color-warning-bg)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              lineHeight: 1.2,
              color: warning ? WARNING_COLOR : 'var(--color-text)',
            }}
          >
            {data.value}
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {data.title}
          </Text>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: warning ? WARNING_COLOR : 'var(--color-text-tertiary)',
            }}
          >
            {data.trend}
            {data.mom !== undefined && data.mom !== null && (
              <Tag
                color={data.mom >= 0 ? 'green' : 'red'}
                style={{ marginLeft: 6, fontSize: 11 }}
              >
                {data.mom >= 0 ? '+' : ''}{data.mom}% {t('dashboard.mom')}
              </Tag>
            )}
          </div>
        </div>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: warning ? 'var(--color-warning-bg)' : 'var(--color-primary-bg)',
            color: warning ? WARNING_COLOR : PRIMARY_COLOR,
            fontSize: 20,
          }}
        >
          {data.icon}
        </div>
      </div>
    </Card>
  );
}

/* ============================ 页面 ============================ */

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const loading = useInquiryStore((s) => s.loading);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUser = useAuthStore((s) => s.currentUser);
  const canApprove = hasPermission('INQUIRY_APPROVE');
  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const quotations = useQuotationStore((s) => s.quotations);

  const stats = useMemo<StatCardData[]>(() => {
    const monthCount = countThisMonth(inquiries);
    const lastMonthCount = countLastMonth(inquiries);
    const mom = calcMonthOverMonth(monthCount, lastMonthCount);
    const inquiringCount = countByStatus(inquiries, InquiryStatus.INQUIRING);
    const pendingCount = countPendingQuotations(inquiries, quotations);
    const urgentCount = getUrgentInquiries(inquiries).length;
    const completedCount = countByStatus(inquiries, InquiryStatus.COMPLETED);
    const avgHours = calcAvgResponseHours(inquiries);

    return [
      {
        key: 'month',
        title: t('dashboard.stats.monthInquiries'),
        value: monthCount,
        icon: <FileTextOutlined />,
        trend: t('dashboard.stats.monthInquiriesTrend'),
        mom,
      },
      {
        key: 'inquiring',
        title: t('enum.inquiryStatus.INQUIRING'),
        value: inquiringCount,
        icon: <ClockCircleOutlined />,
        trend: t('dashboard.stats.inquiringTrend'),
      },
      {
        key: 'pending',
        title: t('dashboard.stats.pendingQuotations'),
        value: pendingCount,
        icon: <SolutionOutlined />,
        trend: t('dashboard.stats.pendingTrend'),
        warning: pendingCount > 0,
      },
      {
        key: 'urgent',
        title: t('dashboard.stats.urgent'),
        value: urgentCount,
        icon: <ExclamationCircleOutlined />,
        trend: urgentCount > 0 ? t('dashboard.stats.urgentAction') : t('dashboard.stats.noUrgent'),
        warning: urgentCount > 0,
      },
      {
        key: 'completed',
        title: t('dashboard.stats.completedInquiries'),
        value: completedCount,
        icon: <CheckCircleOutlined />,
        trend: t('dashboard.stats.completedTrend'),
      },
      {
        key: 'avg',
        title: t('dashboard.stats.avgResponseHours'),
        value: avgHours === null ? '-' : avgHours,
        icon: <FieldTimeOutlined />,
        trend: t('dashboard.stats.avgResponseTrend'),
      },
    ];
  }, [inquiries, quotations, t]);

  // 最近 5 条询价单（按 createdAt 降序）
  const recentInquiries = useMemo(
    () =>
      [...inquiries]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 5),
    [inquiries],
  );

  // 待处理任务：即将超时 + 部分报价
  const pendingTasks = useMemo(() => {
    const urgent = getUrgentInquiries(inquiries);
    const partial = inquiries.filter(
      (i) => i.status === InquiryStatus.PARTIAL_QUOTED && !urgent.includes(i),
    );
    return [...urgent, ...partial].slice(0, 8);
  }, [inquiries]);

  // 最近询价单表格列定义
  const columns: ColumnsType<Inquiry> = [
    {
      title: t('dashboard.recent.code'),
      dataIndex: 'code',
      key: 'code',
      width: 160,
      render: (code: string) => <Text style={{ fontSize: 13 }}>{code}</Text>,
    },
    {
      title: t('dashboard.recent.subject'),
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: InquiryStatus) => <InquiryStatusTag status={status} />,
    },
    {
      title: t('common.deadline'),
      dataIndex: 'deadline',
      key: 'deadline',
      width: 180,
      render: (deadline: string, record) => {
        const r = getRemainingTime(deadline);
        const showUrgent =
          r.urgent &&
          (record.status === InquiryStatus.INQUIRING ||
            record.status === InquiryStatus.PARTIAL_QUOTED);
        return (
          <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
            <Text style={{ fontSize: 12 }}>{formatDateTime(deadline)}</Text>
            <Text
              style={{ fontSize: 12, color: showUrgent ? WARNING_COLOR : 'var(--color-text-tertiary)' }}
            >
              {r.text}
            </Text>
          </Space>
        );
      },
    },
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (t: string) => <Text style={{ fontSize: 12 }}>{formatDateTime(t)}</Text>,
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 90,
      render: (_: unknown, record: Inquiry) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/inquiry/detail/${record.id}`)}
        >
          {t('dashboard.recent.viewDetail')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.welcome', { name: currentUser.name })}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/inquiry/create')}
          >
            {t('dashboard.quickAction.createInquiry')}
          </Button>
        }
      />

      {/* 统计卡片行 */}
      <Row gutter={[16, 16]}>
        {stats.map((s) => (
          <Col xs={12} sm={12} md={8} lg={4} key={s.key}>
            <StatCard data={s} />
          </Col>
        ))}
      </Row>

      {/* 快捷操作卡片行 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={12} sm={6} lg={6}>
          <Card
            hoverable
            role="button"
            tabIndex={0}
            size="small"
            style={{ borderRadius: 8 }}
            onClick={() => navigate('/inquiry/create')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/inquiry/create'); } }}
          >
            <Space>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--color-primary-bg)', color: PRIMARY_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PlusOutlined style={{ fontSize: 18 }} />
              </div>
              <div>
                <Text strong>{t('dashboard.quickAction.createInquiry')}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>{t('dashboard.quickAction.createInquiryDesc')}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={12} sm={6} lg={6}>
          <Card
            hoverable
            role="button"
            tabIndex={0}
            size="small"
            style={{ borderRadius: 8 }}
            onClick={() => navigate('/quotation/pending')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/quotation/pending'); } }}
          >
            <Space>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--color-warning-bg)', color: WARNING_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SolutionOutlined style={{ fontSize: 18 }} />
              </div>
              <div>
                <Text strong>{t('dashboard.quickAction.pendingQuotation')}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>{t('dashboard.quickAction.pendingQuotationDesc')}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        {canApprove && (
          <Col xs={12} sm={6} lg={6}>
            <Card
              hoverable
              role="button"
              tabIndex={0}
              size="small"
              style={{ borderRadius: 8 }}
              onClick={() => navigate('/approval')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/approval'); } }}
            >
              <Space>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--color-primary-bg)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <SafetyCertificateOutlined style={{ fontSize: 18 }} />
                </div>
                <div>
                  <Text strong>{t('dashboard.quickAction.approvalTodo')}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('dashboard.quickAction.approvalTodoDesc')}</Text>
                </div>
              </Space>
            </Card>
          </Col>
        )}
        <Col xs={12} sm={6} lg={6}>
          <Card
            hoverable
            role="button"
            tabIndex={0}
            size="small"
            style={{ borderRadius: 8 }}
            onClick={() => navigate('/notification')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/notification'); } }}
          >
            <Space>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--color-success-bg)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BellOutlined style={{ fontSize: 18 }} />
              </div>
              <div>
                <Text strong>{t('menu.notification')}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>{t('dashboard.quickAction.notificationDesc')}</Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 第二行：最近询价单 + 待处理任务 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card
            title={t('dashboard.recentInquiries')}
            extra={
              <Button type="link" onClick={() => navigate('/inquiry/list')}>
                {t('dashboard.viewAll')} <RightOutlined />
              </Button>
            }
            style={{ borderRadius: 8 }}
            styles={{ body: { padding: 0 } }}
          >
            {loading && !inquiries.length ? (
              <div style={{ padding: 24 }}>
                <Skeleton active paragraph={{ rows: 4 }} />
              </div>
            ) : !inquiries.length ? (
              <Empty description={t('dashboard.recent.empty')} style={{ padding: 48 }} />
            ) : (
              <Table<Inquiry>
                rowKey="id"
                columns={columns}
                dataSource={recentInquiries}
                pagination={false}
                size="middle"
                locale={{ emptyText: <Empty description={t('dashboard.recent.empty')} /> }}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={t('dashboard.pendingTasks')}
            extra={
              <Tag color={pendingTasks.length ? 'warning' : 'default'}>
                {pendingTasks.length}
              </Tag>
            }
            style={{ borderRadius: 8, height: '100%' }}
          >
            {pendingTasks.length ? (
              <List
                dataSource={pendingTasks}
                renderItem={(item) => {
                  const r = getRemainingTime(item.deadline);
                  return (
                    <List.Item
                      role="button"
                      tabIndex={0}
                      style={{ cursor: 'pointer', padding: '10px 0' }}
                      onClick={() => navigate(`/inquiry/detail/${item.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/inquiry/detail/${item.id}`); } }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: WARNING_COLOR,
                            marginRight: 10,
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              color: 'var(--color-text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.subject}
                          </div>
                          <Space size={8} style={{ marginTop: 2 }}>
                            <Text style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                              {item.code}
                            </Text>
                            <Text style={{ fontSize: 12, color: WARNING_COLOR }}>
                              {r.text}
                            </Text>
                          </Space>
                        </div>
                        <RightOutlined style={{ color: '#C9CDD4', fontSize: 12 }} />
                      </div>
                    </List.Item>
                  );
                }}
              />
            ) : (
              <Empty description={t('dashboard.noPendingTasks')} style={{ padding: '24px 0' }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 第三行：询价状态分布 + 近期报价趋势 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t('dashboard.charts.inquiryStatus')} style={{ borderRadius: 8 }}>
            <StatusPieChart inquiries={inquiries} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('dashboard.charts.quotationTrend')} style={{ borderRadius: 8 }}>
            <QuotationTrendChart quotations={quotations} />
          </Card>
        </Col>
      </Row>

      {/* 第四行：供应商频次 + 品类分布 + 审批漏斗（B6 新增） */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <Card title={t('dashboard.charts.supplierFrequency')} style={{ borderRadius: 8 }}>
            <SupplierFrequencyChart inquiries={inquiries} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={t('dashboard.charts.materialCategory')} style={{ borderRadius: 8 }}>
            <CategoryDistributionChart inquiries={inquiries} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={t('dashboard.charts.approvalFunnel')} style={{ borderRadius: 8 }}>
            <ApprovalFunnelChart inquiries={inquiries} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
