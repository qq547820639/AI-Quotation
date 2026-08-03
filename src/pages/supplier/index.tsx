/**
 * 供应商管理列表（Task 15）
 * 支持多维度筛选、等级/合作状态可视化、启用停用等操作
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import PageHeader from '@/components/PageHeader';
import { CooperationStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  COOPERATION_STATUS_OPTIONS,
  CooperationStatus,
  SUPPLIER_LEVEL_OPTIONS,
  type Supplier,
} from '@/types';
import { formatDate, formatPercent } from '@/utils/format';
import { confirmAction, notifySuccess } from '@/utils/confirm';
import { useIsMobile } from '@/utils/useIsMobile';
import { MATERIAL_CATEGORY_OPTIONS } from '@/constants/materialCategories';

const { Text } = Typography;

export default function SupplierPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const suppliers = useSupplierStore((s) => s.suppliers);
  const toggleSupplierStatus = useSupplierStore((s) => s.toggleSupplierStatus);
  const loading = useSupplierStore((s) => s.loading);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canDisable = hasPermission('SUPPLIER_DISABLE');
  const isMobile = useIsMobile();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // ===== 筛选状态（输入态，点击查询后写入 applied） =====
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined);
  const [filterLevel, setFilterLevel] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  // 已应用的筛选条件（点击查询后生效，与 log/inquiry-list/material 页一致）
  const [applied, setApplied] = useState<{
    keyword: string;
    category: string | undefined;
    level: string | undefined;
    status: string | undefined;
  }>({ keyword: '', category: undefined, level: undefined, status: undefined });

  // E4: 筛选条件持久化到 sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('supplierFilter');
    if (saved) {
      try {
        setApplied(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem('supplierFilter', JSON.stringify(applied));
  }, [applied]);

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      if (applied.keyword) {
        const kw = applied.keyword.toLowerCase();
        if (
          !s.name.toLowerCase().includes(kw) &&
          !s.code.toLowerCase().includes(kw)
        ) {
          return false;
        }
      }
      if (applied.category && !s.mainCategories.includes(applied.category)) {
        return false;
      }
      if (applied.level && s.level !== applied.level) {
        return false;
      }
      if (applied.status && s.cooperationStatus !== applied.status) {
        return false;
      }
      return true;
    });
  }, [suppliers, applied]);

  const handleQuery = () => {
    setApplied({
      keyword: filterKeyword,
      category: filterCategory,
      level: filterLevel,
      status: filterStatus,
    });
  };

  const handleReset = () => {
    setFilterKeyword('');
    setFilterCategory(undefined);
    setFilterLevel(undefined);
    setFilterStatus(undefined);
    setApplied({ keyword: '', category: undefined, level: undefined, status: undefined });
  };

  const handleToggleStatus = (supplier: Supplier) => {
    const isDisabled = supplier.cooperationStatus === CooperationStatus.DISABLED;
    confirmAction({
      title: isDisabled ? t('supplier.list.enableTitle') : t('supplier.list.disableTitle'),
      content: isDisabled
        ? t('supplier.list.confirmEnable', { name: supplier.name })
        : t('supplier.list.confirmDisable', { name: supplier.name }),
      okText: isDisabled ? t('supplier.list.enable') : t('supplier.list.disable'),
      danger: !isDisabled,
      onOk: () => {
        toggleSupplierStatus(supplier.id);
        notifySuccess(
          isDisabled
            ? t('supplier.list.enableSuccess', { name: supplier.name })
            : t('supplier.list.disableSuccess', { name: supplier.name }),
        );
      },
    });
  };

  const columns: ColumnsType<Supplier> = [
    {
      title: t('supplier.list.supplierNumber'),
      dataIndex: 'code',
      key: 'code',
      width: 110,
      fixed: 'left',
      render: (code: string) => <Text strong>{code}</Text>,
    },
    {
      title: t('supplier.list.name'),
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (name: string) => <Text>{name}</Text>,
    },
    {
      title: t('supplier.list.belongRegion'),
      dataIndex: 'region',
      key: 'region',
      width: 100,
    },
    {
      title: t('supplier.list.contactPhone'),
      key: 'contact',
      width: 180,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.contact}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.phone}
          </Text>
        </Space>
      ),
    },
    {
      title: t('supplier.list.mainCategory'),
      dataIndex: 'mainCategories',
      key: 'mainCategories',
      width: 220,
      render: (categories: string[]) =>
        categories && categories.length ? (
          <Space size={[0, 4]} wrap>
            {categories.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t('supplier.list.level'),
      dataIndex: 'level',
      key: 'level',
      width: 90,
      align: 'center',
      render: (level: Supplier['level']) => <SupplierLevelTag level={level} />,
    },
    {
      title: t('supplier.list.cooperationStatus'),
      dataIndex: 'cooperationStatus',
      key: 'cooperationStatus',
      width: 100,
      align: 'center',
      render: (status: Supplier['cooperationStatus']) => (
        <CooperationStatusTag status={status} />
      ),
    },
    {
      title: t('supplier.list.historyResponseRate'),
      dataIndex: 'historyResponseRate',
      key: 'historyResponseRate',
      width: 110,
      align: 'center',
      render: (rate: number) => formatPercent(rate),
      sorter: (a, b) => a.historyResponseRate - b.historyResponseRate,
    },
    {
      title: t('supplier.list.historyFulfillmentRate'),
      dataIndex: 'historyFulfillmentRate',
      key: 'historyFulfillmentRate',
      width: 110,
      align: 'center',
      render: (rate: number) => formatPercent(rate),
      sorter: (a, b) => a.historyFulfillmentRate - b.historyFulfillmentRate,
    },
    {
      title: t('supplier.list.avgDeliveryDays'),
      dataIndex: 'avgDeliveryDays',
      key: 'avgDeliveryDays',
      width: 100,
      align: 'center',
      render: (days: number) => `${days} ${t('common.days')}`,
      sorter: (a, b) => a.avgDeliveryDays - b.avgDeliveryDays,
    },
    {
      title: t('supplier.list.lastCooperateTime'),
      dataIndex: 'lastCooperateTime',
      key: 'lastCooperateTime',
      width: 130,
      render: (val?: string) => formatDate(val),
      sorter: (a, b) => (a.lastCooperateTime ?? '').localeCompare(b.lastCooperateTime ?? ''),
    },
    {
      title: t('supplier.list.actions'),
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, record) => {
        const isDisabled = record.cooperationStatus === CooperationStatus.DISABLED;
        return (
          <Space size={0} wrap>
            <Button
              type="link"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/supplier/${record.id}`)}
            >
              {t('supplier.list.viewDetail')}
            </Button>
            {canDisable && (
              <Button
                type="link"
                size="small"
                danger={!isDisabled}
                icon={isDisabled ? <CheckCircleOutlined /> : <StopOutlined />}
                onClick={() => handleToggleStatus(record)}
              >
                {isDisabled ? t('supplier.list.enable') : t('supplier.list.disable')}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={t('supplier.title')} description={t('supplier.list.description')} />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('supplier.list.nameNumberLabel')}
            </div>
            <Input
              placeholder={t('common.inputPlaceholder')}
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('supplier.list.mainCategory')}
            </div>
            <Select
              placeholder={t('common.selectPlaceholder')}
              value={filterCategory}
              onChange={(val) => setFilterCategory(val)}
              options={MATERIAL_CATEGORY_OPTIONS}
              style={{ width: '100%' }}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('supplier.list.level')}</div>
            <Select
              placeholder={t('common.selectPlaceholder')}
              value={filterLevel}
              onChange={(val) => setFilterLevel(val)}
              options={SUPPLIER_LEVEL_OPTIONS}
              style={{ width: '100%' }}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('supplier.list.cooperationStatus')}
            </div>
            <Select
              placeholder={t('common.selectPlaceholder')}
              value={filterStatus}
              onChange={(val) => setFilterStatus(val)}
              options={COOPERATION_STATUS_OPTIONS}
              style={{ width: '100%' }}
              allowClear
            />
          </Col>
          <Col
            xs={24}
            sm={12}
            md={8}
            lg={6}
            style={{ display: 'flex', alignItems: 'flex-end' }}
          >
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>
                {t('common.query')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 16 }}>
          <Text>{t('supplier.list.selectedCount', { count: selectedRowKeys.length })}</Text>
          <Button
            onClick={() => {
              selectedRowKeys.forEach((key) => toggleSupplierStatus(String(key)));
              setSelectedRowKeys([]);
            }}
          >
            {t('supplier.list.batchDisable')}
          </Button>
          <Button onClick={() => setSelectedRowKeys([])}>
            {t('supplier.list.clearSelection')}
          </Button>
        </Space>
      )}

      <Card styles={{ body: { padding: 0 } }}>
        {isMobile ? (
          <List
            dataSource={filteredSuppliers}
            locale={{
              emptyText:
                suppliers.length === 0 ? (
                  <Empty description={t('supplier.list.empty')} />
                ) : (
                  <Empty description={t('supplier.list.noMatch')} />
                ),
            }}
            pagination={{
              pageSize: 10,
              simple: true,
              showTotal: (total) => t('supplier.list.total', { count: total }),
            }}
            renderItem={(record) => {
              const isDisabled = record.cooperationStatus === CooperationStatus.DISABLED;
              return (
                <List.Item style={{ padding: '12px 16px', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <Text strong>{record.code}</Text>
                        <SupplierLevelTag level={record.level} />
                        <CooperationStatusTag status={record.cooperationStatus} />
                      </div>
                      <Text ellipsis style={{ display: 'block', color: 'var(--color-text-secondary)' }}>
                        {record.name}
                      </Text>
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-tertiary)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    <span>{t('supplier.list.belongRegion')}: {record.region}</span>
                    <span>{t('supplier.list.contactPhone')}: {record.contact} {record.phone}</span>
                    <span>{t('supplier.list.historyResponseRate')}: {formatPercent(record.historyResponseRate)}</span>
                    <span>{t('supplier.list.avgDeliveryDays')}: {record.avgDeliveryDays}{t('common.days')}</span>
                  </div>
                  {record.mainCategories?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Space size={[0, 4]} wrap>
                        {record.mainCategories.map((c) => (
                          <Tag key={c}>{c}</Tag>
                        ))}
                      </Space>
                    </div>
                  )}
                  <Space size={0} wrap style={{ marginTop: 8 }}>
                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/supplier/${record.id}`)}>
                      {t('supplier.list.viewDetail')}
                    </Button>
                    {canDisable && (
                      <Button
                        type="link"
                        size="small"
                        danger={!isDisabled}
                        icon={isDisabled ? <CheckCircleOutlined /> : <StopOutlined />}
                        onClick={() => handleToggleStatus(record)}
                      >
                        {isDisabled ? t('supplier.list.enable') : t('supplier.list.disable')}
                      </Button>
                    )}
                  </Space>
                </List.Item>
              );
            }}
          />
        ) : (
        <Table<Supplier>
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={columns}
          dataSource={filteredSuppliers}
          loading={loading}
          scroll={{ x: 1600 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => t('supplier.list.total', { count: total }),
          }}
          locale={{
            emptyText:
              suppliers.length === 0 ? (
                <Empty description={t('supplier.list.empty')} />
              ) : (
                <Empty description={t('supplier.list.noMatch')} />
              ),
          }}
        />
        )}
      </Card>
    </div>
  );
}
