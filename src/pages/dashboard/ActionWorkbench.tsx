/**
 * 行动工作台（P2 Task 14）
 * - 8 个行动卡片：待发送 / 即将截止 / 未报价 / 发送失败 / 异常报价 / 待审批 / 审批超时 / 待定标
 * - 每个卡片可跳转到对应筛选结果
 * - 支持按负责人 / 创建时间范围筛选
 * - 加载态骨架屏、空态下一步操作、错误态重试
 * - 数量为 0 的卡片不可点击（不落入无效占位）
 * - 移动端响应式（xs 每行 2 卡）
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Result,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { Dayjs } from 'dayjs';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FieldTimeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SolutionOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useConnectivityStore } from '@/store/useConnectivityStore';
import type { Permission } from '@/types';
import {
  applyWorkbenchFilter,
  computeDashboardActions,
  getOwnerOptions,
  type ActionKey,
} from './workbenchActions';

const { RangePicker } = DatePicker;
const { Text } = Typography;

/** 卡片展示配置（纯静态，图标/文案/i18n key/跳转目标） */
interface CardConfig {
  key: ActionKey;
  icon: ReactNode;
  titleKey: string;
  descKey: string;
  jumpPath: string;
  /** 卡片主题色 css 变量 */
  color: string;
  /** 是否需要审批权限才展示 */
  permission?: Permission;
  urgent?: boolean;
}

const CARD_CONFIGS: CardConfig[] = [
  {
    key: 'pendingSend',
    icon: <SendOutlined />,
    titleKey: 'dashboard.workbench.pendingSend',
    descKey: 'dashboard.workbench.pendingSendDesc',
    jumpPath: '/inquiry/list?status=PENDING_SEND',
    color: 'primary',
  },
  {
    key: 'deadlineApproaching',
    icon: <ClockCircleOutlined />,
    titleKey: 'dashboard.workbench.deadlineApproaching',
    descKey: 'dashboard.workbench.deadlineApproachingDesc',
    jumpPath: '/inquiry/list?status=INQUIRING,PARTIAL_QUOTED',
    color: 'warning',
    urgent: true,
  },
  {
    key: 'unquotedSuppliers',
    icon: <SolutionOutlined />,
    titleKey: 'dashboard.workbench.unquotedSuppliers',
    descKey: 'dashboard.workbench.unquotedSuppliersDesc',
    jumpPath: '/inquiry/list?status=INQUIRING,PARTIAL_QUOTED',
    color: 'warning',
  },
  {
    key: 'failedDeliveries',
    icon: <CloseCircleOutlined />,
    titleKey: 'dashboard.workbench.failedDeliveries',
    descKey: 'dashboard.workbench.failedDeliveriesDesc',
    jumpPath: '/inquiry/list',
    color: 'error',
    urgent: true,
  },
  {
    key: 'abnormalQuotations',
    icon: <WarningOutlined />,
    titleKey: 'dashboard.workbench.abnormalQuotations',
    descKey: 'dashboard.workbench.abnormalQuotationsDesc',
    jumpPath: '/quotation/pending',
    color: 'warning',
    urgent: true,
  },
  {
    key: 'pendingApproval',
    icon: <SafetyCertificateOutlined />,
    titleKey: 'dashboard.workbench.pendingApproval',
    descKey: 'dashboard.workbench.pendingApprovalDesc',
    jumpPath: '/approval',
    color: 'primary',
    permission: 'INQUIRY_APPROVE',
  },
  {
    key: 'approvalTimeout',
    icon: <FieldTimeOutlined />,
    titleKey: 'dashboard.workbench.approvalTimeout',
    descKey: 'dashboard.workbench.approvalTimeoutDesc',
    jumpPath: '/approval',
    color: 'error',
    urgent: true,
    permission: 'INQUIRY_APPROVE',
  },
  {
    key: 'pendingConfirm',
    icon: <CheckCircleOutlined />,
    titleKey: 'dashboard.workbench.pendingConfirm',
    descKey: 'dashboard.workbench.pendingConfirmDesc',
    jumpPath: '/inquiry/list?status=PENDING_CONFIRM',
    color: 'success',
  },
];

/** 主题色 css 变量映射 */
const COLOR_VAR: Record<string, string> = {
  primary: 'var(--color-primary)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  success: 'var(--color-success)',
};

const COLOR_BG_VAR: Record<string, string> = {
  primary: 'var(--color-primary-bg)',
  warning: 'var(--color-warning-bg)',
  error: 'var(--color-error-bg)',
  success: 'var(--color-success-bg)',
};

export default function ActionWorkbench() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const loading = useInquiryStore((s) => s.loading);
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const quotations = useQuotationStore((s) => s.quotations);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [owner, setOwner] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const allInquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const ownerOptions = useMemo(() => getOwnerOptions(allInquiries), [allInquiries]);

  const filtered = useMemo(
    () =>
      applyWorkbenchFilter(allInquiries, {
        owner,
        dateFrom: dateRange?.[0] ? dateRange[0].format('YYYY-MM-DD') : null,
        dateTo: dateRange?.[1] ? dateRange[1].format('YYYY-MM-DD') : null,
      }),
    [allInquiries, owner, dateRange],
  );

  const counts = useMemo(
    () => computeDashboardActions(filtered, quotations),
    [filtered, quotations],
  );

  const cards = useMemo(
    () =>
      CARD_CONFIGS.filter((c) => !c.permission || hasPermission(c.permission)).map((c) => ({
        ...c,
        count: counts[c.key] as number,
      })),
    [counts, hasPermission],
  );

  const retry = () => {
    useInquiryStore.getState().loadFromApi();
    useQuotationStore.getState().loadFromApi();
  };

  // 错误态：后端离线时提供重试
  if (!isOnline && allInquiries.length === 0) {
    return (
      <Card title={t('dashboard.workbench.title')} style={{ borderRadius: 8 }}>
        <Result
          status="warning"
          title={t('dashboard.workbench.errorTitle')}
          subTitle={t('dashboard.workbench.errorDesc')}
          extra={
            <Button type="primary" icon={<ReloadOutlined />} onClick={retry}>
              {t('common.retry')}
            </Button>
          }
        />
      </Card>
    );
  }

  // 加载态：骨架屏（无数据且加载中）
  if (loading && allInquiries.length === 0) {
    return (
      <Card title={t('dashboard.workbench.title')} style={{ borderRadius: 8 }}>
        <Row gutter={[16, 16]}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Col xs={12} sm={8} lg={6} key={i}>
              <Card size="small" style={{ borderRadius: 8 }}>
                <Skeleton active title={false} paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    );
  }

  // 空态：无可执行数据时展示下一步操作
  if (allInquiries.length === 0 && !loading) {
    return (
      <Card title={t('dashboard.workbench.title')} style={{ borderRadius: 8 }}>
        <Empty description={t('dashboard.workbench.empty')} style={{ padding: '24px 0' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/inquiry/create')}
          >
            {t('dashboard.quickAction.createInquiry')}
          </Button>
        </Empty>
      </Card>
    );
  }

  return (
    <Card title={t('dashboard.workbench.title')} style={{ borderRadius: 8 }}>
      {/* 筛选栏：负责人 + 时间范围 */}
      <Space wrap size="middle" style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder={t('dashboard.workbench.filterOwnerPlaceholder')}
          style={{ minWidth: 160 }}
          value={owner}
          onChange={setOwner}
          options={ownerOptions.map((name) => ({ label: name, value: name }))}
        />
        <RangePicker
          value={dateRange}
          onChange={(v) => setDateRange(v as [Dayjs | null, Dayjs | null] | null)}
          allowClear
        />
        <Button
          type="link"
          onClick={() => {
            setOwner(undefined);
            setDateRange(null);
          }}
        >
          {t('common.reset')}
        </Button>
      </Space>

      {allInquiries.length > 0 && filtered.length === 0 && (
        <Alert
          type="info"
          showIcon
          message={t('dashboard.workbench.filterEmpty')}
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        {cards.map((c) => {
          const clickable = c.count > 0;
          return (
            <Col xs={12} sm={8} lg={6} key={c.key}>
              <Card
                hoverable={clickable}
                role="button"
                tabIndex={clickable ? 0 : -1}
                aria-disabled={!clickable}
                aria-label={t('dashboard.workbench.openCard', { title: t(c.titleKey) })}
                size="small"
                style={{
                  borderRadius: 8,
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: clickable ? 1 : 0.6,
                  border: c.urgent && c.count > 0 ? `1px solid ${COLOR_VAR[c.color]}` : undefined,
                }}
                onClick={clickable ? () => navigate(c.jumpPath) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(c.jumpPath);
                        }
                      }
                    : undefined
                }
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: COLOR_BG_VAR[c.color],
                      color: COLOR_VAR[c.color],
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {c.icon}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13 }}>
                      {t(c.titleKey)}
                    </Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t(c.descKey)}
                    </Text>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontSize: 24, fontWeight: 600, color: COLOR_VAR[c.color] }}>
                    {c.count}
                  </span>
                  {c.urgent && c.count > 0 && (
                    <Tag color={c.color} style={{ marginInlineEnd: 0 }}>
                      {t('dashboard.workbench.urgentTag')}
                    </Tag>
                  )}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}
