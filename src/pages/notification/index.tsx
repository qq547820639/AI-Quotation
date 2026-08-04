/**
 * 通知中心（W6）
 * - 全部通知列表，支持按类型/已读未读筛选
 * - 点击跳转关联询价单
 * - 单条标记已读 / 全部已读
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, List, Segmented, Space, Tag, Typography } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { useNotificationStore } from '@/store/useNotificationStore';
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

export default function NotificationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);

  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'ALL'>('ALL');

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === 'unread' && n.read) return false;
      if (typeFilter !== 'ALL' && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, readFilter, typeFilter]);

  const handleClick = (n: Notification) => {
    markRead(n.id);
    if (n.inquiryId) navigate(`/inquiry/detail/${n.inquiryId}`);
  };

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

      <Card style={{ borderRadius: 8 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 筛选栏 */}
          <Space wrap size="middle">
            <Segmented
              value={readFilter}
              onChange={(v) => setReadFilter(v as ReadFilter)}
              options={[
                { label: t('notification.allWithCount', { count: notifications.length }), value: 'all' },
                { label: t('notification.unreadWithCount', { count: unreadCount }), value: 'unread' },
              ]}
            />
            <Segmented
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as NotificationType | 'ALL')}
              options={[
                { label: t('notification.allTypes'), value: 'ALL' },
                { label: t('notification.type.INQUIRY_SENT'), value: NotificationType.INQUIRY_SENT },
                { label: t('notification.type.QUOTATION_SUBMITTED'), value: NotificationType.QUOTATION_SUBMITTED },
                { label: t('notification.type.DEADLINE_APPROACHING'), value: NotificationType.DEADLINE_APPROACHING },
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
              renderItem={(n) => (
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
                    role={n.inquiryId ? 'button' : undefined}
                    tabIndex={n.inquiryId ? 0 : undefined}
                    aria-label={n.inquiryId ? t('notification.openDetail', { title: n.title }) : undefined}
                    style={{
                      padding: '12px 16px',
                      cursor: n.inquiryId ? 'pointer' : 'default',
                      width: '100%',
                    }}
                    onClick={() => handleClick(n)}
                    onKeyDown={
                      n.inquiryId
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
                        <Space size={8}>
                          <Text strong={!n.read}>{n.title}</Text>
                          <Tag color={TYPE_COLOR[n.type]} style={{ marginInlineEnd: 0 }}>
                            {t(`notification.type.${n.type}`)}
                          </Tag>
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size={4}>
                          {n.content && <Text type="secondary" style={{ fontSize: 13 }}>{n.content}</Text>}
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatDateTime(n.time)}
                            {n.inquiryId && t('notification.clickToViewDetail')}
                          </Text>
                        </Space>
                      }
                    />
                  </div>
                </List.Item>
              )}
            />
          )}
        </Space>
      </Card>
    </div>
  );
}
