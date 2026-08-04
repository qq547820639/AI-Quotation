/**
 * 供应商门户报价页增强子组件（Task 16）
 * 步骤条 / 自动保存状态 / 提交前错误摘要 / 批量设置工具条
 */
import { Alert, Button, Select, Space, Steps, Tag, Typography } from 'antd';
import { CheckCircleTwoTone, CloseCircleTwoTone, LoadingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DELIVERY_DAYS_OPTIONS,
  PAYMENT_TERMS_OPTIONS,
  TAX_RATE_OPTIONS,
  type SaveState,
} from './types';

const { Text } = Typography;

/** 报价流程步骤条 */
export function QuotationSteps({ submitted }: { submitted: boolean }) {
  const { t } = useTranslation();
  const items = [
    { title: t('supplierPortal.step.read') },
    { title: t('supplierPortal.step.fill') },
    { title: t('supplierPortal.step.upload') },
    { title: t('supplierPortal.step.review') },
    { title: t('supplierPortal.step.submitted') },
  ];
  return <Steps current={submitted ? 4 : 3} items={items} size="small" responsive={false} />;
}

/** 自动保存状态指示器 */
export function AutoSaveIndicator({
  state,
  lastSavedAt,
}: {
  state: SaveState;
  lastSavedAt: string;
}) {
  const { t } = useTranslation();
  if (state === 'idle') return null;
  let content: React.ReactNode;
  if (state === 'saving') {
    content = (
      <Space size={4}>
        <LoadingOutlined spin style={{ color: 'var(--color-primary)' }} />
        <Text type="secondary">{t('supplierPortal.autoSaveSaving')}</Text>
      </Space>
    );
  } else if (state === 'saved') {
    content = (
      <Space size={4}>
        <CheckCircleTwoTone twoToneColor="#52c41a" />
        <Text type="secondary">{t('supplierPortal.autoSaveSaved', { time: lastSavedAt })}</Text>
      </Space>
    );
  } else {
    content = (
      <Space size={4}>
        <CloseCircleTwoTone twoToneColor="#ff4d4f" />
        <Text type="secondary">{t('supplierPortal.autoSaveFailed')}</Text>
      </Space>
    );
  }
  return (
    <div aria-live="polite" aria-atomic="true">
      {content}
    </div>
  );
}

/** 提交前错误摘要：列出有错误的物料与字段，可点击定位 */
export function ErrorSummary({
  errors,
  getItemName,
  onFocus,
}: {
  errors: Record<string, Set<string>>;
  getItemName: (id: string) => string;
  onFocus: (id: string, field: string) => void;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <Alert
      type="error"
      showIcon
      role="alert"
      message={t('supplierPortal.errorSummaryTitle', { count: entries.length })}
      description={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {entries.map(([id, fields]) => (
            <li key={id}>
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto' }}
                onClick={() => onFocus(id, Array.from(fields)[0])}
              >
                {getItemName(id)}
              </Button>
              ：
              {Array.from(fields)
                .map((f) => t(`supplierPortal.errorField.${f}`))
                .join('、')}
            </li>
          ))}
        </ul>
      }
    />
  );
}

/** 批量设置工具条：批量税率 / 交期 / 付款条件（选中行或全部行） */
export function BatchToolbar({
  selectedCount,
  onClear,
  onApplyTaxRate,
  onApplyDeliveryDays,
  onApplyPaymentTerms,
}: {
  selectedCount: number;
  onClear: () => void;
  onApplyTaxRate: (value: number) => void;
  onApplyDeliveryDays: (value: number) => void;
  onApplyPaymentTerms: (value: string) => void;
}) {
  const { t } = useTranslation();
  const deliveryOptions = DELIVERY_DAYS_OPTIONS.map((v) => ({
    label: `${v} ${t('common.days')}`,
    value: v,
  }));
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}
    >
      <Space size={8}>
        <Tag color="blue">{t('supplierPortal.batchToolbar')}</Tag>
        {selectedCount > 0 ? (
          <>
            <Text>{t('supplierPortal.selectedCount', { count: selectedCount })}</Text>
            <Button size="small" type="link" onClick={onClear}>
              {t('common.clearAll')}
            </Button>
          </>
        ) : (
          <Text type="secondary">{t('supplierPortal.batchApplyAllHint')}</Text>
        )}
      </Space>
      <Select
        size="small"
        style={{ width: 140 }}
        placeholder={t('supplierPortal.batchTaxRate')}
        options={TAX_RATE_OPTIONS}
        onChange={(v) => onApplyTaxRate(v)}
        aria-label={t('supplierPortal.batchTaxRate')}
      />
      <Select
        size="small"
        style={{ width: 140 }}
        placeholder={t('supplierPortal.batchDeliveryDays')}
        options={deliveryOptions}
        onChange={(v) => onApplyDeliveryDays(v)}
        aria-label={t('supplierPortal.batchDeliveryDays')}
      />
      <Select
        size="small"
        style={{ width: 180 }}
        placeholder={t('supplierPortal.batchPaymentTerms')}
        options={PAYMENT_TERMS_OPTIONS}
        onChange={(v) => onApplyPaymentTerms(v)}
        aria-label={t('supplierPortal.batchPaymentTerms')}
      />
    </div>
  );
}
