/**
 * 步骤 3：供应商智能匹配
 * - 根据物料品类集合计算推荐供应商（matchScore 降序）
 * - 支持勾选/批量勾选/移除/手动搜索/查看详情/一键发送
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Progress,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { InquiryItem, Supplier, SupplierMatch } from '@/types';
import { useSupplierStore } from '@/store/useSupplierStore';
import { formatPercent, formatDate } from '@/utils/format';
import { notifyWarning } from '@/utils/confirm';
import { CooperationStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import { computeSupplierMatches, categoryMatch } from './shared';

const { Text } = Typography;

interface SupplierMatchStepProps {
  items: InquiryItem[];
  selectedSupplierIds: string[];
  onChange: (ids: string[]) => void;
  onSend?: () => void;
  disabled?: boolean;
}

export default function SupplierMatchStep({
  items,
  selectedSupplierIds,
  onChange,
  onSend,
  disabled,
}: SupplierMatchStepProps) {
  const { t } = useTranslation();
  const suppliers = useSupplierStore((s) => s.suppliers);
  const [keyword, setKeyword] = useState('');
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);

  const categories = useMemo(
    () => items.map((it) => it.category).filter(Boolean),
    [items],
  );

  const matches = useMemo(
    () => computeSupplierMatches(suppliers, categories),
    [suppliers, categories],
  );

  const filteredMatches = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return matches;
    return matches.filter(
      (m) =>
        m.supplier.name.toLowerCase().includes(kw) ||
        m.supplier.code.toLowerCase().includes(kw) ||
        m.supplier.region.toLowerCase().includes(kw) ||
        m.supplier.mainCategories.some((c) => c.toLowerCase().includes(kw)),
    );
  }, [matches, keyword]);

  /** 勾选切换：禁用供应商不可选 */
  const toggleSelect = (supplierId: string, checked: boolean) => {
    if (disabled) return;
    const m = matches.find((x) => x.supplier.id === supplierId);
    if (!m || m.disabled) return;
    if (checked) {
      if (!selectedSupplierIds.includes(supplierId)) {
        onChange([...selectedSupplierIds, supplierId]);
      }
    } else {
      onChange(selectedSupplierIds.filter((id) => id !== supplierId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (disabled) return;
    if (checked) {
      const allAvailable = matches.filter((m) => !m.disabled).map((m) => m.supplier.id);
      onChange(allAvailable);
    } else {
      onChange([]);
    }
  };

  const handleSend = () => {
    if (!selectedSupplierIds.length) {
      notifyWarning(t('inquiry.create.supplier.atLeastOne'));
      return;
    }
    onSend?.();
  };

  const allChecked =
    matches.length > 0 &&
    matches.filter((m) => !m.disabled).every((m) => selectedSupplierIds.includes(m.supplier.id));
  const indeterminate =
    !allChecked && matches.some((m) => selectedSupplierIds.includes(m.supplier.id));

  const columns: ColumnsType<SupplierMatch> = [
    {
      title: (
        <Checkbox
          checked={allChecked}
          indeterminate={indeterminate}
          onChange={(e) => handleSelectAll(e.target.checked)}
          disabled={disabled}
        />
      ),
      key: 'select',
      width: 50,
      render: (_, r) => {
        const checked = selectedSupplierIds.includes(r.supplier.id);
        if (r.disabled) {
          return (
            <Tooltip title={r.disabledReason}>
              <Checkbox disabled checked={false} />
            </Tooltip>
          );
        }
        return (
          <Checkbox
            checked={checked}
            onChange={(e) => toggleSelect(r.supplier.id, e.target.checked)}
            disabled={disabled}
          />
        );
      },
    },
    {
      title: t('inquiry.create.supplier.supplierName'),
      key: 'name',
      width: 220,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.supplier.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.supplier.code} · {r.supplier.region}
          </Text>
        </Space>
      ),
    },
    {
      title: t('inquiry.create.supplier.level'),
      key: 'level',
      width: 80,
      render: (_, r) => <SupplierLevelTag level={r.supplier.level} />,
    },
    {
      title: t('inquiry.create.supplier.mainCategories'),
      key: 'mainCategories',
      width: 220,
      render: (_, r) => {
        const cats = r.supplier.mainCategories ?? [];
        return (
          <Space size={4} wrap>
            {cats.map((c) => {
              const hit = categories.some((mc) => categoryMatch(mc, [c]));
              return (
                <Tag key={c} color={hit ? 'green' : 'default'}>
                  {c}
                </Tag>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: t('supplier.detail.historyCoopCount'),
      key: 'historyCoopCount',
      width: 110,
      align: 'center',
      render: (_, r) => r.supplier.historyCoopCount,
    },
    {
      title: t('supplier.detail.responseRate'),
      key: 'responseRate',
      width: 110,
      align: 'center',
      render: (_, r) => formatPercent(r.supplier.historyResponseRate),
    },
    {
      title: t('supplier.detail.avgDeliveryDays'),
      key: 'avgDeliveryDays',
      width: 110,
      align: 'center',
      render: (_, r) => `${r.supplier.avgDeliveryDays} ${t('common.days')}`,
    },
    {
      title: t('inquiry.create.supplier.lastCooperateTime'),
      key: 'lastCooperateTime',
      width: 120,
      render: (_, r) => formatDate(r.supplier.lastCooperateTime),
    },
    {
      title: t('inquiry.create.supplier.cooperationStatus'),
      key: 'cooperationStatus',
      width: 90,
      render: (_, r) => <CooperationStatusTag status={r.supplier.cooperationStatus} />,
    },
    {
      title: t('inquiry.create.supplier.recommendReason'),
      key: 'reason',
      width: 260,
      render: (_, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.reason}</Text>,
    },
    {
      title: t('inquiry.create.supplier.matchScore'),
      key: 'matchScore',
      width: 140,
      sorter: (a, b) => a.matchScore - b.matchScore,
      render: (_, r) => (
        <Progress
          percent={r.matchScore}
          size="small"
          status={r.disabled ? 'exception' : r.matchScore >= 60 ? 'success' : 'normal'}
          format={(p) => `${p}`}
        />
      ),
    },
    {
      title: t('inquiry.create.supplier.actions'),
      key: 'action',
      width: 90,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4} direction="vertical">
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => setDetailSupplier(r.supplier)}
          >
            {t('common.detail')}
          </Button>
          {!r.disabled && (
            <Button
              size="small"
              type="link"
              disabled={disabled}
              onClick={() => toggleSelect(r.supplier.id, !selectedSupplierIds.includes(r.supplier.id))}
            >
              {selectedSupplierIds.includes(r.supplier.id)
                ? t('inquiry.create.supplier.removeSelected')
                : t('inquiry.create.supplier.addSelected')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {items.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('inquiry.create.supplier.noMaterialAlert')}
          description={t('inquiry.create.supplier.noMaterialAlertDesc')}
          style={{ marginBottom: 12 }}
        />
      )}

      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }} size={16} align="center">
        <Statistic title={t('inquiry.create.supplier.selectedSuppliers')} value={selectedSupplierIds.length} />
        <Statistic title={t('inquiry.create.supplier.matchedSuppliers')} value={matches.length} />
        <Statistic
          title={t('inquiry.create.supplier.categoryCoverage')}
          value={Array.from(new Set(categories)).length}
          suffix={t('inquiry.create.supplier.unitGe')}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={disabled || selectedSupplierIds.length === 0}
        >
          {t('inquiry.create.supplier.batchSendWithCount', { count: selectedSupplierIds.length })}
        </Button>
      </Space>

      <Input.Search
        placeholder={t('inquiry.create.supplier.searchSupplierPlaceholder')}
        allowClear
        prefix={<SearchOutlined />}
        style={{ maxWidth: 360, marginBottom: 12 }}
        onChange={(e) => setKeyword(e.target.value)}
      />

      {matches.length === 0 ? (
        <Empty description={t('inquiry.create.supplier.noSupplierData')} />
      ) : (
        <Table<SupplierMatch>
          rowKey={(r) => r.supplier.id}
          size="small"
          columns={columns}
          dataSource={filteredMatches}
          pagination={{ pageSize: 8, size: 'small' }}
          scroll={{ x: 1500 }}
          bordered
        />
      )}

      <Drawer
        title={t('inquiry.create.supplier.supplierDetail')}
        width={520}
        open={!!detailSupplier}
        onClose={() => setDetailSupplier(null)}
        extra={
          detailSupplier && (
            <Button
              type="primary"
              size="small"
              disabled={disabled}
              onClick={() => {
                const id = detailSupplier.id;
                setDetailSupplier(null);
                toggleSelect(
                  id,
                  !selectedSupplierIds.includes(id),
                );
              }}
            >
              {selectedSupplierIds.includes(detailSupplier.id)
                ? t('inquiry.create.supplier.removeSelected')
                : t('inquiry.create.supplier.addSelected')}
            </Button>
          )
        }
      >
        {detailSupplier && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('common.code')}>{detailSupplier.code}</Descriptions.Item>
            <Descriptions.Item label={t('common.name')}>{detailSupplier.name}</Descriptions.Item>
            <Descriptions.Item label={t('common.region')}>{detailSupplier.region}</Descriptions.Item>
            <Descriptions.Item label={t('common.contact')}>{detailSupplier.contact}</Descriptions.Item>
            <Descriptions.Item label={t('common.phone')}>{detailSupplier.phone}</Descriptions.Item>
            <Descriptions.Item label={t('common.email')}>{detailSupplier.email}</Descriptions.Item>
            <Descriptions.Item label={t('inquiry.create.supplier.level')}>
              <SupplierLevelTag level={detailSupplier.level} />
            </Descriptions.Item>
            <Descriptions.Item label={t('inquiry.create.supplier.cooperationStatus')}>
              <CooperationStatusTag status={detailSupplier.cooperationStatus} />
            </Descriptions.Item>
            <Descriptions.Item label={t('inquiry.create.supplier.qualified')}>
              {detailSupplier.qualified ? t('common.yes') : t('common.no')}
            </Descriptions.Item>
            <Descriptions.Item label={t('inquiry.create.supplier.mainCategories')}>
              <Space size={4} wrap>
                {detailSupplier.mainCategories.map((c) => (
                  <Tag key={c}>{c}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('supplier.detail.responseRate')}>
              {formatPercent(detailSupplier.historyResponseRate)}
            </Descriptions.Item>
            <Descriptions.Item label={t('supplier.detail.fulfillmentRate')}>
              {formatPercent(detailSupplier.historyFulfillmentRate)}
            </Descriptions.Item>
            <Descriptions.Item label={t('supplier.detail.avgDeliveryDays')}>
              {detailSupplier.avgDeliveryDays} {t('common.days')}
            </Descriptions.Item>
            <Descriptions.Item label={t('supplier.detail.historyCoopCount')}>
              {detailSupplier.historyCoopCount}
            </Descriptions.Item>
            <Descriptions.Item label={t('inquiry.create.supplier.lastCooperateTime')}>
              {formatDate(detailSupplier.lastCooperateTime)}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
