/**
 * 系统设置
 * 包含基本信息、询价规则、通知设置与关于信息，大部分为模拟展示
 */
import {
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { SaveOutlined, InfoCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import PageHeader from '@/components/PageHeader';
import Permission from '@/components/Permission';
import { useAuthStore } from '@/store/useAuthStore';
import { CURRENCY_OPTIONS } from '@/types';
import { confirmAction, notifySuccess } from '@/utils/confirm';
import i18n from '@/i18n';
import { removeKey, clearAll } from '@/utils/storage';
import { useSettingsStore } from '@/store/useSettingsStore';

const { Text, Paragraph } = Typography;

/** 卡片统一样式 */
const cardStyle = { marginBottom: 16, borderRadius: 8 } as const;

/** 综合评分权重项 */
const SCORE_WEIGHTS = [
  { key: 'amount', weight: 50, color: 'var(--color-primary)' },
  { key: 'delivery', weight: 20, color: 'var(--color-success)' },
  { key: 'level', weight: 15, color: 'var(--color-warning)' },
  { key: 'fulfillment', weight: 15, color: '#722ED1' },
];

/** 通知项 */
const NOTIFICATION_ITEMS = [
  { key: 'inquirySent' },
  { key: 'quotationSubmitted' },
  { key: 'timeoutAlert' },
  { key: 'todoReminder' },
  { key: 'approval' },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  // ===== 设置全部从 useSettingsStore 读取，onChange 即时持久化 =====
  const {
    organization,
    systemName,
    currency,
    validDays,
    deadlineLeadDays,
    timeoutThresholdHours,
    notifications,
    approval,
    updateSettings,
  } = useSettingsStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const users = useAuthStore((s) => s.users);

  const handleSaveBasic = () => {
    updateSettings({ organization, systemName, currency });
    notifySuccess(i18n.t('settings.saveSuccess'));
  };

  const handleSaveRules = () => {
    updateSettings({ validDays, deadlineLeadDays, timeoutThresholdHours });
    notifySuccess(i18n.t('settings.saveSuccess'));
  };

  const handleSaveNotifications = () => {
    updateSettings({ notifications });
    notifySuccess(i18n.t('settings.saveSuccess'));
  };

  const handleSaveApproval = () => {
    updateSettings({ approval });
    notifySuccess(i18n.t('settings.approval.saveSuccess'));
  };

  const handleToggleNotification = (key: string, checked: boolean) =>
    updateSettings({ notifications: { ...notifications, [key]: checked } });

  // ===== 数据管理 =====
  const handleClearDraft = () => {
    confirmAction({
      title: i18n.t('settings.dataManagement.clearDraftTitle'),
      content: i18n.t('settings.dataManagement.clearDraftContent'),
      onOk: () => {
        removeKey('inquiry_draft');
        notifySuccess(i18n.t('settings.dataManagement.clearDraftSuccess'));
      },
    });
  };

  const handleResetAll = () => {
    confirmAction({
      title: i18n.t('settings.dataManagement.resetAllTitle'),
      content: i18n.t('settings.dataManagement.resetAllContent'),
      danger: true,
      onOk: () => {
        clearAll();
        notifySuccess(i18n.t('settings.dataManagement.resetAllSuccess'));
        window.location.reload();
      },
    });
  };

  return (
    <Permission
      perm="SETTINGS_MANAGE"
      fallback={
        <div>
          <PageHeader title={t('settings.title')} description={t('settings.description')} />
          <Empty description={t('settings.noPermission')} style={{ padding: 80 }} />
        </div>
      }
    >
      <div>
        <PageHeader title={t('settings.title')} description={t('settings.description')} />

      {/* 1. 基本信息设置 */}
      <Card title={t('settings.basicTitle')} style={cardStyle}>
        <Row gutter={[24, 16]}>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('settings.basic.organization')}
            </div>
            <Input
              value={organization}
              onChange={(e) => updateSettings({ organization: e.target.value })}
              placeholder={t('settings.basic.organizationPlaceholder')}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('settings.basic.systemName')}
            </div>
            <Input
              value={systemName}
              onChange={(e) => updateSettings({ systemName: e.target.value })}
              placeholder={t('settings.basic.systemNamePlaceholder')}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('settings.basic.currency')}</div>
            <Select
              value={currency}
              onChange={(val) => updateSettings({ currency: val })}
              options={CURRENCY_OPTIONS}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveBasic}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      {/* 2. 询价规则设置 */}
      <Card title={t('settings.rulesTitle')} style={cardStyle}>
        <Row gutter={[24, 16]}>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('settings.rules.validDays')}
            </div>
            <InputNumber
              value={validDays}
              onChange={(v) => updateSettings({ validDays: v ?? 0 })}
              min={1}
              precision={0}
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('settings.rules.deadlineLeadDays')}
            </div>
            <InputNumber
              value={deadlineLeadDays}
              onChange={(v) => updateSettings({ deadlineLeadDays: v ?? 0 })}
              min={0}
              precision={0}
              style={{ width: '100%' }}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('settings.rules.timeoutThresholdHours')}
            </div>
            <InputNumber
              value={timeoutThresholdHours}
              onChange={(v) => updateSettings({ timeoutThresholdHours: v ?? 0 })}
              min={1}
              precision={0}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>

        <Divider style={{ margin: '20px 0 16px' }} />

        {/* 综合评分权重（只读展示） */}
        <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('settings.scoreWeightsTitle')}
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {t('settings.readonly')}
          </Text>
        </div>
        <Space size={[16, 12]} wrap>
          {SCORE_WEIGHTS.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                background: 'var(--color-bg)',
                borderRadius: 6,
                minWidth: 140,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: item.color,
                }}
              />
              <Text>{t(`settings.scoreWeights.${item.key}`)}</Text>
              <Text strong style={{ marginLeft: 'auto' }}>
                {item.weight}%
              </Text>
            </div>
          ))}
        </Space>

        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveRules}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      {/* 3. 通知设置 */}
      <Card title={t('settings.notification.title')} style={cardStyle}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {NOTIFICATION_ITEMS.map((item) => (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 0',
                borderBottom: '1px solid var(--color-border-light)',
              }}
            >
              <div>
                <div style={{ fontSize: 14, color: 'var(--color-text)' }}>
                  {t(`settings.notification.${item.key}`)}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t(`settings.notification.${item.key}Desc`)}
                </Text>
              </div>
              <Switch
                checked={notifications[item.key]}
                onChange={(checked) =>
                  handleToggleNotification(item.key, checked)
                }
              />
            </div>
          ))}
        </Space>
        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSaveNotifications}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      {/* 4. 审批配置（W5） */}
      <Card
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#722ED1' }} />
            <span>{t('settings.approval.title')}</span>
          </Space>
        }
        style={cardStyle}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid var(--color-border-light)',
            }}
          >
            <div>
              <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{t('settings.approval.enabled')}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('settings.approval.enabledDesc')}
              </Text>
            </div>
            <Switch
              checked={approval.enabled}
              onChange={(checked) => updateSettings({ approval: { ...approval, enabled: checked } })}
            />
          </div>
          <Row gutter={[24, 16]}>
            <Col xs={24} sm={12}>
              <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {t('settings.approval.amountThresholdLabel')}
              </div>
              <InputNumber
                value={approval.amountThreshold}
                onChange={(v) =>
                  updateSettings({ approval: { ...approval, amountThreshold: v ?? 0 } })
                }
                min={0}
                precision={2}
                style={{ width: '100%' }}
                formatter={(value) => `¥ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(value) => Number(value?.replace(/¥\s?|(,*)/g, '') || 0)}
                disabled={!approval.enabled}
              />
            </Col>
            <Col xs={24} sm={12}>
              <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('settings.approval.approverId')}</div>
              <Select
                value={approval.approverId}
                onChange={(val) => updateSettings({ approval: { ...approval, approverId: val } })}
                style={{ width: '100%' }}
                disabled={!approval.enabled}
                options={users
                  .filter((u) => u.role === '采购主管' || u.role === '管理员')
                  .map((u) => ({
                    label: t('settings.about.userWithRoleOrg', { name: u.name, role: t(`enum.role.${u.role}`), org: u.organization }),
                    value: u.id,
                  }))}
              />
            </Col>
          </Row>
          <div>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveApproval}>
              {t('common.save')}
            </Button>
          </div>
        </Space>
      </Card>

      {/* 5. 关于 */}
      <Card
        title={
          <Space>
            <InfoCircleOutlined style={{ color: 'var(--color-primary)' }} />
            <span>{t('settings.about.title')}</span>
          </Space>
        }
        style={cardStyle}
      >
        <Descriptions column={1} size="small">
          <Descriptions.Item label={t('settings.about.version')}>
            <Tag color="blue">v1.0.0</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('settings.about.currentUser')}>
            {t('settings.about.userWithRole', { name: currentUser.name, role: t(`enum.role.${currentUser.role}`) })}
          </Descriptions.Item>
          <Descriptions.Item label={t('settings.about.organization')}>
            {currentUser.organization}
          </Descriptions.Item>
          <Descriptions.Item label={t('settings.about.techStack')}>
            <Space size={[4, 4]} wrap>
              <Tag>React 18</Tag>
              <Tag>TypeScript 5</Tag>
              <Tag>Vite 5</Tag>
              <Tag>Ant Design 5</Tag>
              <Tag>Zustand 4</Tag>
              <Tag>React Router 6</Tag>
              <Tag>dayjs</Tag>
              <Tag>ECharts 5</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={t('settings.about.descriptionLabel')}>
            <Paragraph style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
              {t('settings.about.description')}
            </Paragraph>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 5. 数据管理 */}
      <Card title={t('settings.dataManagement.title')} style={cardStyle}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
            >
              {t('settings.dataManagement.clearDraftDesc')}
            </Text>
            <Button onClick={handleClearDraft}>{t('settings.dataManagement.clearDraft')}</Button>
          </div>
          <Divider style={{ margin: '4px 0' }} />
          <div>
            <Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
            >
              {t('settings.dataManagement.resetAllDesc')}
            </Text>
            <Button danger onClick={handleResetAll}>
              {t('settings.dataManagement.resetAll')}
            </Button>
          </div>
        </Space>
      </Card>
      </div>
    </Permission>
  );
}
