/**
 * 通知中心（W6）
 * - 全部通知列表，支持按类型/已读未读筛选
 * - 点击跳转关联询价单
 * - 单条标记已读 / 全部已读
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  Empty,
  InputNumber,
  List,
  Segmented,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useUIStore } from '@/store/useUIStore';
import { NotificationType, type Notification } from '@/types';
import { formatDateTime } from '@/utils/format';

const { Text } = Typography;

/** 通知类型 → 标签颜色 */
const TYPE_COLOR: Record<NotificationType, string> = {
  [NotificationType.INQUIRY_SENT]: 'blue',
  [NotificationType.QUOTATION_SUBMITTED]: 'green',
  [NotificationType.DEADLINE_APPROACHING]: 'orange',
  [NotificationType.APPROVAL]: 'purple',
  [NotificationType.SYSTEM]: 'default',
};

type ReadFilter = 'all' | 'unread';

/** 通知链接状态：可跳转 / 资源已删除 / 无权限 / 无链接 */
type LinkStatus = 'ok' | 'deleted' | 'noPermission' | 'none';

/** 计算通知对应资源的链接状态（基于当前可见询价单与资源存在性） */
function getNotificationLinkStatus(n: Notification): LinkStatus {
  if (!n.inquiryId) return 'none';
  const state = useInquiryStore.getState();
  const exists = state.inquiries.some((i) => i.id === n.inquiryId);
  if (!exists) return 'deleted';
  const currentOrganization = useUIStore.getState().currentOrganization;
  const visible = state.getVisibleInquiries(currentOrganization);
  if (!visible.some((i) => i.id === n.inquiryId)) return 'noPermission';
  return 'ok';
}

export default function NotificationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const preferences = useNotificationStore((s) => s.preferences);
  const updatePreferences = useNotificationStore((s) => s.updatePreferences);

  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === 'unread' && n.read) return false;
      if (typeFilter !== 'ALL' && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, readFilter, typeFilter]);

  const handleClick = (n: Notification) => {
    markRead(n.id);
    if (getNotificationLinkStatus(n) === 'ok' && n.inquiryId) {
      navigate(`/inquiry/detail/${n.inquiryId}`);
    }
  };

  const preferenceItems: { key: keyof typeof preferences; label: string; desc: string }[] = [
    {
      key: 'inquirySent',
      label: t('notification.pref.inquirySent'),
      desc: t('notification.pref.inquirySentDesc'),
    },
    {
      key: 'quotationSubmitted',
      label: t('notification.pref.quotationSubmitted'),
      desc: t('notification.pref.quotationSubmittedDesc'),
    },
    {
      key: 'deadlineReminder',
      label: t('notification.pref.deadlineReminder'),
      desc: t('notification.pref.deadlineReminderDesc'),
    },
    {
      key: 'approvalResult',
      label: t('notification.pref.approvalResult'),
      desc: t('notification.pref.approvalResultDesc'),
    },
  ];
  const booleanPrefKeys = preferenceItems.map((i) => i.key);

  return (
    <div>
      <PageHeader
        title={t('notification.title')}
        description={t('notification.description')}
        extra={
          <Space>
            {unreadCount > 0 && (
              <Button icon={<CheckOutlined />} onClick={markAllRead}>
                {t('notification.markAllRead')}
              </Button>
            )}
          </Space>
        }
      />

      <Card title={t('notification.pref.title')} style={{ borderRadius: 8, marginBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {booleanPrefKeys.map((key) => (
            <Space key={key} style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space direction="vertical" size={0}>
                <Text>{preferenceItems.find((i) => i.key === key)!.label}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {preferenceItems.find((i) => i.key === key)!.desc}
                </Text>
              </Space>
              <Switch
                checked={preferences[key] as boolean}
                onChange={(checked) => {
                  updatePreferences({ ...preferences, [key]: checked });
                }}
              />
            </Space>
          ))}
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space direction="vertical" size={0}>
              <Text>{t('notification.pref.deadlineReminderHours')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('notification.pref.deadlineReminderHoursDesc')}
              </Text>
            </Space>
            <InputNumber
              min={1}
              max={168}
              value={preferences.deadlineReminderHours}
              onChange={(v) => {
                if (v != null) {
                  updatePreferences({ ...preferences, deadlineReminderHours: v });
                }
              }}
            />
          </Space>
        </Space>
      </Card>

      <Card style={{ borderRadius: 8 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 筛选栏 */}
          <Space wrap size="middle">
            <Segmented
              value={readFilter}
              onChange={(v) => setReadFilter(v as ReadFilter)}
              options={[
                {
                  label: t('notification.allWithCount', { count: notifications.length }),
                  value: 'all',
                },
                {
                  label: t('notification.unreadWithCount', { count: unreadCount }),
                  value: 'unread',
                },
              ]}
            />
            <Segmented
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as NotificationType | 'ALL')}
              options={[
                { label: t('notification.allTypes'), value: 'ALL' },
                {
                  label: t('notification.type.INQUIRY_SENT'),
                  value: NotificationType.INQUIRY_SENT,
                },
                {
                  label: t('notification.type.QUOTATION_SUBMITTED'),
                  value: NotificationType.QUOTATION_SUBMITTED,
                },
                {
                  label: t('notification.type.DEADLINE_APPROACHING'),
                  value: NotificationType.DEADLINE_APPROACHING,
                },
                { label: t('notification.type.APPROVAL'), value: NotificationType.APPROVAL },
                { label: t('notification.type.SYSTEM'), value: NotificationType.SYSTEM },
              ]}
            />
          </Space>

          {/* 通知列表 */}
          {filtered.length === 0 ? (
            <Empty
              image={<BellOutlined style={{ fontSize: 48, color: 'var(--color-text-tertiary)' }} />}
              description={t('notification.empty')}
              style={{ padding: 60 }}
            />
          ) : (
            <List
              dataSource={filtered}
              renderItem={(n) => {
                const linkStatus = getNotificationLinkStatus(n);
                const clickable = linkStatus === 'ok';
                return (
                  <List.Item
                    style={{
                      background: n.read ? 'transparent' : 'var(--color-primary-bg)',
                      padding: 0,
                      borderRadius: 8,
                      marginBottom: 8,
                      border: '1px solid var(--color-border-light)',
                    }}
                    actions={[
                      !n.read ? (
                        <Button
                          type="link"
                          size="small"
                          key="read"
                          onClick={(e) => {
                            e.stopPropagation();
                            markRead(n.id);
                          }}
                        >
                          {t('notification.markRead')}
                        </Button>
                      ) : (
                        <Text type="secondary" key="read" style={{ fontSize: 12 }}>
                          {t('notification.read')}
                        </Text>
                      ),
                    ]}
                  >
                    <div
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-disabled={!clickable}
                      aria-label={
                        clickable ? t('notification.openDetail', { title: n.title }) : undefined
                      }
                      style={{
                        padding: '12px 16px',
                        cursor: clickable ? 'pointer' : 'default',
                        width: '100%',
                      }}
                      onClick={clickable ? () => handleClick(n) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleClick(n);
                              }
                            }
                          : undefined
                      }
                    >
                      <List.Item.Meta
                        avatar={<Badge dot={!n.read} offset={[-4, 4]} />}
                        title={
                          <Space size={8} wrap>
                            <Text strong={!n.read}>{n.title}</Text>
                            <Tag color={TYPE_COLOR[n.type]} style={{ marginInlineEnd: 0 }}>
                              {t(`notification.type.${n.type}`)}
                            </Tag>
                            {linkStatus === 'deleted' && (
                              <Tag color="error" style={{ marginInlineEnd: 0 }}>
                                {t('notification.resourceDeleted')}
                              </Tag>
                            )}
                            {linkStatus === 'noPermission' && (
                              <Tag style={{ marginInlineEnd: 0 }}>
                                {t('notification.noPermission')}
                              </Tag>
                            )}
                          </Space>
                        }
                        description={
                          <Space direction="vertical" size={4}>
                            {n.content && (
                              <Text type="secondary" style={{ fontSize: 13 }}>
                                {n.content}
                              </Text>
                            )}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {formatDateTime(n.time)}
                              {linkStatus === 'ok' && t('notification.clickToViewDetail')}
                              {linkStatus === 'deleted' && t('notification.resourceDeletedHint')}
                              {linkStatus === 'noPermission' && t('notification.noPermissionHint')}
                            </Text>
                          </Space>
                        }
                      />
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Space>
      </Card>
    </div>
  );
}
