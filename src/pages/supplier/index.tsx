/**
 * 供应商管理列表（Task 15）
 * 支持多维度筛选、等级/合作状态可视化、启用停用等操作
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
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
  CheckCircleOutlined,
  ClearOutlined,
  ExportOutlined,
  EyeOutlined,
  FilterOutlined,
  MoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
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
import { confirmAction, notifyError, notifySuccess } from '@/utils/confirm';
import { exportAOA } from '@/utils/excel';
import { useIsMobile } from '@/utils/useIsMobile';
import { MATERIAL_CATEGORY_OPTIONS } from '@/constants/materialCategories';
import TableSettings from '@/components/table/TableSettings';
import {
  DENSITY_TO_SIZE,
  useTablePreferences,
  type TableColumnPref,
} from '@/hooks/useTablePreferences';

const { Text } = Typography;

export default function SupplierPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const suppliers = useSupplierStore((s) => s.suppliers);
  const toggleSupplierStatus = useSupplierStore((s) => s.toggleSupplierStatus);
  const batchDisableSuppliers = useSupplierStore((s) => s.batchDisableSuppliers);
  const batchEnableSuppliers = useSupplierStore((s) => s.batchEnableSuppliers);
  const loading = useSupplierStore((s) => s.loading);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canDisable = hasPermission('SUPPLIER_DISABLE');
  const isMobile = useIsMobile();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

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
      onOk: async () => {
        const result = await toggleSupplierStatus(supplier.id);
        if (result.success) {
          notifySuccess(
            isDisabled
              ? t('supplier.list.enableSuccess', { name: supplier.name })
              : t('supplier.list.disableSuccess', { name: supplier.name }),
          );
        } else if (result.reason === 'pending') {
          // 重复点击被拦截，静默
          return;
        } else {
          notifyError(result.error?.message ?? t('common.operateFailed'));
        }
      },
    });
  };

  /** 批量操作结果提示：成功/失败条数 + 逐条失败原因（Task 4） */
  const notifyBatchResult = (result: {
    succeeded: number;
    failed: number;
    results: { success: boolean; skipped?: boolean; reason?: string }[];
  }) => {
    if (result.succeeded > 0) {
      notifySuccess(t('supplier.list.batchSuccess', { count: result.succeeded }));
    }
    if (result.failed > 0) {
      const reasons = Array.from(
        new Set(
          result.results
            .filter((r) => !r.success && !r.skipped && r.reason)
            .map((r) => r.reason as string),
        ),
      );
      const reasonText = reasons.length ? `：${reasons.join('；')}` : '';
      notifyError(t('supplier.list.batchFailed', { count: result.failed }) + reasonText);
    }
  };

  const handleBatchDisable = () => {
    const ids = selectedRowKeys.map(String);
    const skippedCount = ids.filter(
      (id) => suppliers.find((s) => s.id === id)?.cooperationStatus === CooperationStatus.DISABLED,
    ).length;
    const executableCount = ids.length - skippedCount;
    confirmAction({
      title: t('supplier.list.batchDisableConfirmTitle'),
      content: t('supplier.list.batchSummary', {
        total: ids.length,
        executable: executableCount,
        skipped: skippedCount,
      }),
      okText: t('supplier.list.batchDisable'),
      danger: true,
      onOk: async () => {
        const result = await batchDisableSuppliers(ids);
        notifyBatchResult(result);
        setSelectedRowKeys([]);
      },
    });
  };

  const handleBatchEnable = () => {
    const ids = selectedRowKeys.map(String);
    const skippedCount = ids.filter(
      (id) => suppliers.find((s) => s.id === id)?.cooperationStatus !== CooperationStatus.DISABLED,
    ).length;
    const executableCount = ids.length - skippedCount;
    confirmAction({
      title: t('supplier.list.batchEnableConfirmTitle'),
      content: t('supplier.list.batchSummary', {
        total: ids.length,
        executable: executableCount,
        skipped: skippedCount,
      }),
      okText: t('supplier.list.batchEnable'),
      onOk: async () => {
        const result = await batchEnableSuppliers(ids);
        notifyBatchResult(result);
        setSelectedRowKeys([]);
      },
    });
  };

  // ===== Task 7：当前筛选 / 一键清空 / 导出当前筛选结果 =====
  /** 一键清空筛选：清空输入态 + applied */
  const clearFilters = () => {
    setFilterKeyword('');
    setFilterCategory(undefined);
    setFilterLevel(undefined);
    setFilterStatus(undefined);
    setApplied({ keyword: '', category: undefined, level: undefined, status: undefined });
  };

  /** 当前生效筛选条件 Tag 列表 */
  const activeFilterTags = useMemo(() => {
    const tags: React.ReactNode[] = [];
    if (applied.keyword) {
      tags.push(
        <Tag key="keyword">{t('supplier.list.nameNumberLabel')}: {applied.keyword}</Tag>,
      );
    }
    if (applied.category) {
      tags.push(
        <Tag key="category" color="geekblue">
          {t('supplier.list.mainCategory')}: {applied.category}
        </Tag>,
      );
    }
    if (applied.level) {
      tags.push(
        <Tag key="level" color="blue">
          {t('supplier.list.level')}: {i18n.t(`enum.supplierLevel.${applied.level}`)}
        </Tag>,
      );
    }
    if (applied.status) {
      tags.push(
        <Tag key="status" color="processing">
          {t('supplier.list.cooperationStatus')}: {i18n.t(`enum.cooperationStatus.${applied.status}`)}
        </Tag>,
      );
    }
    return tags;
  }, [applied, t]);

  /** 导出当前筛选结果 */
  const handleExportCurrent = () => {
    const header = [
      t('supplier.list.supplierNumber'),
      t('supplier.list.name'),
      t('supplier.list.belongRegion'),
      t('supplier.list.contactPhone'),
      t('supplier.list.mainCategory'),
      t('supplier.list.level'),
      t('supplier.list.cooperationStatus'),
      t('supplier.list.historyResponseRate'),
      t('supplier.list.historyFulfillmentRate'),
      t('supplier.list.avgDeliveryDays'),
      t('supplier.list.lastCooperateTime'),
    ];
    const rows = filteredSuppliers.map((s) => [
      s.code,
      s.name,
      s.region,
      `${s.contact} ${s.phone}`,
      s.mainCategories.join('、'),
      i18n.t(`enum.supplierLevel.${s.level}`),
      i18n.t(`enum.cooperationStatus.${s.cooperationStatus}`),
      formatPercent(s.historyResponseRate),
      formatPercent(s.historyFulfillmentRate),
      `${s.avgDeliveryDays} ${t('common.days')}`,
      formatDate(s.lastCooperateTime),
    ]);
    exportAOA(t('supplier.title'), header, rows);
    notifySuccess(t('table.exportCurrentSuccess'));
  };

  /** 空状态引导：无数据或筛选无结果时提供「清空筛选」入口 */
  const renderEmpty = () => (
    <Empty
      description={
        suppliers.length === 0 ? t('supplier.list.empty') : t('supplier.list.noMatch')
      }
    >
      <Button onClick={clearFilters}>{t('table.clearFilters')}</Button>
    </Empty>
  );

  // ===== 表格列偏好（Task 7）：可见性 / 顺序 / 固定 / 密度，本地持久化 =====
  const defaultColumnPrefs: TableColumnPref[] = useMemo(
    () => [
      { key: 'code', title: t('supplier.list.supplierNumber'), visible: true, fixed: 'left', order: 0 },
      { key: 'name', title: t('supplier.list.name'), visible: true, order: 1 },
      { key: 'region', title: t('supplier.list.belongRegion'), visible: true, order: 2 },
      { key: 'contact', title: t('supplier.list.contactPhone'), visible: true, order: 3 },
      { key: 'mainCategories', title: t('supplier.list.mainCategory'), visible: true, order: 4 },
      { key: 'level', title: t('supplier.list.level'), visible: true, order: 5 },
      { key: 'cooperationStatus', title: t('supplier.list.cooperationStatus'), visible: true, order: 6 },
      { key: 'historyResponseRate', title: t('supplier.list.historyResponseRate'), visible: true, order: 7 },
      { key: 'historyFulfillmentRate', title: t('supplier.list.historyFulfillmentRate'), visible: true, order: 8 },
      { key: 'avgDeliveryDays', title: t('supplier.list.avgDeliveryDays'), visible: true, order: 9 },
      { key: 'lastCooperateTime', title: t('supplier.list.lastCooperateTime'), visible: true, order: 10 },
      { key: 'action', title: t('supplier.list.actions'), visible: true, fixed: 'right', order: 11 },
    ],
    [t],
  );
  const {
    prefs,
    setColumnVisible,
    setColumnOrder,
    setColumnFixed,
    setDensity,
    reset: resetTablePrefs,
  } = useTablePreferences('supplierList', {
    columns: defaultColumnPrefs,
    density: 'default',
  });

  const columnDefs: ColumnsType<Supplier> = [
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

  // 按偏好渲染生效列：过滤可见 + 按 order 排序 + 应用固定方向
  const columns = prefs.columns
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const def = columnDefs.find((d) => d.key === p.key);
      if (!def) return null;
      return p.fixed ? { ...def, fixed: p.fixed } : def;
    })
    .filter((d): d is (typeof columnDefs)[number] => d !== null);

  const tableSize = DENSITY_TO_SIZE[prefs.density];

  /** 筛选控件（桌面端 Card / 移动端 Drawer 复用） */
  const filterForm = (
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
  );

  return (
    <div>
      <PageHeader title={t('supplier.title')} description={t('supplier.list.description')} />

      {isMobile ? (
        <>
          <Button
            block
            icon={<FilterOutlined />}
            onClick={() => setFilterOpen(true)}
            style={{ marginBottom: 16 }}
          >
            {t('common.filter')}
          </Button>
          <Drawer
            title={t('common.filter')}
            placement="right"
            width={320}
            open={filterOpen}
            onClose={() => {
              handleQuery();
              setFilterOpen(false);
            }}
          >
            {filterForm}
          </Drawer>
        </>
      ) : (
        <Card size="small" style={{ marginBottom: 16 }}>
          {filterForm}
        </Card>
      )}

      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Text type="secondary">{t('table.currentFilters')}:</Text>
          {activeFilterTags.length === 0 ? (
            <Text type="secondary">{t('common.all')}</Text>
          ) : (
            activeFilterTags
          )}
          {activeFilterTags.length > 0 && (
            <Button size="small" icon={<ClearOutlined />} onClick={clearFilters}>
              {t('table.clearFilters')}
            </Button>
          )}
        </Space>
        <Space wrap>
          <TableSettings
            columns={prefs.columns}
            density={prefs.density}
            onToggleVisible={setColumnVisible}
            onMoveOrder={setColumnOrder}
            onSetFixed={setColumnFixed}
            onSetDensity={setDensity}
            onReset={resetTablePrefs}
          />
          <Button icon={<ExportOutlined />} onClick={handleExportCurrent}>
            {t('table.exportCurrent')}
          </Button>
        </Space>
      </Space>

      {selectedRowKeys.length > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            marginBottom: 16,
            padding: '10px 16px calc(10px + env(safe-area-inset-bottom))',
            background: '#1f2937',
            color: '#fff',
            borderRadius: 8,
            boxShadow: '0 -2px 8px rgba(0,0,0,0.15)',
          }}
        >
          <Space wrap>
            <Text style={{ color: '#fff' }}>
              {t('supplier.list.selectedCount', { count: selectedRowKeys.length })}
            </Text>
            {canDisable && (
              <Button
                danger
                disabled={!selectedRowKeys.some(
                  (key) =>
                    suppliers.find((s) => s.id === String(key))?.cooperationStatus !==
                    CooperationStatus.DISABLED,
                )}
                onClick={handleBatchDisable}
              >
                {t('supplier.list.batchDisable')}
              </Button>
            )}
            {canDisable && (
              <Button
                disabled={!selectedRowKeys.some(
                  (key) =>
                    suppliers.find((s) => s.id === String(key))?.cooperationStatus ===
                    CooperationStatus.DISABLED,
                )}
                onClick={handleBatchEnable}
              >
                {t('supplier.list.batchEnable')}
              </Button>
            )}
            <Button onClick={() => setSelectedRowKeys([])}>
              {t('supplier.list.clearSelection')}
            </Button>
          </Space>
        </div>
      )}

      <Card styles={{ body: { padding: 0 } }}>
        {isMobile ? (
          <List
            dataSource={filteredSuppliers}
            locale={{
              emptyText: renderEmpty(),
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
                  <Space size={0} wrap style={{ marginTop: 8, alignItems: 'center' }}>
                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/supplier/${record.id}`)}>
                      {t('supplier.list.viewDetail')}
                    </Button>
                    {canDisable && (
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'toggle',
                              label: isDisabled ? t('supplier.list.enable') : t('supplier.list.disable'),
                              icon: isDisabled ? <CheckCircleOutlined /> : <StopOutlined />,
                              danger: !isDisabled,
                            },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'toggle') handleToggleStatus(record);
                          },
                        }}
                      >
                        <Button type="link" size="small" icon={<MoreOutlined />}>
                          {t('common.more')}
                        </Button>
                      </Dropdown>
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
          size={tableSize}
          scroll={{ x: 1600 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => t('supplier.list.total', { count: total }),
          }}
          locale={{
            emptyText: renderEmpty(),
          }}
        />
        )}
      </Card>
    </div>
  );
}
