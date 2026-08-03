/**
 * 步骤 2：物料明细（可编辑表格）
 * - 受控 state 数组 + 行内 Input/InputNumber 直接编辑
 * - 支持新增/删除/复制/批量导入/从物料库选择/从历史询价复制
 */
import { useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Upload,
} from 'antd';
import type { ColumnsType, TableProps } from 'antd/es/table';
import type { UploadProps } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  ImportOutlined,
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { InquiryItem } from '@/types';
import { useMaterialStore } from '@/store/useMaterialStore';
import { useInquiryStore } from '@/store/useInquiryStore';
import { notifyError, notifySuccess, notifyWarning } from '@/utils/confirm';
import { parseInquiryItems } from '@/utils/materialImport';
import {
  MATERIAL_CATEGORY_OPTIONS,
  cloneItem,
  fileToAttachment,
  normalizeCategory,
} from './shared';

interface MaterialStepProps {
  items: InquiryItem[];
  onChange: (items: InquiryItem[]) => void;
  editingId?: string;
  disabled?: boolean;
}

type MaterialRow = InquiryItem;

/** 创建空物料行 */
function createEmptyItem(inquiryId: string): InquiryItem {
  return {
    id: `item-${inquiryId || 'new'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    inquiryId,
    name: '',
    code: '',
    category: '',
    brand: '',
    spec: '',
    techParams: '',
    unit: '',
    quantity: 0,
    targetPrice: undefined,
    expectedDeliveryDate: undefined,
    remark: '',
    attachments: [],
  };
}

export default function MaterialStep({
  items,
  onChange,
  editingId,
  disabled,
}: MaterialStepProps) {
  const { t } = useTranslation();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');
  const [pickedMaterialIds, setPickedMaterialIds] = useState<string[]>([]);

  const materials = useMaterialStore((s) => s.materials);
  const inquiries = useInquiryStore((s) => s.inquiries);

  const totalQty = useMemo(
    () => items.reduce((s, it) => s + (Number(it.quantity) || 0), 0),
    [items],
  );

  /** 更新单行字段 */
  const updateItem = (id: string, patch: Partial<InquiryItem>) => {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const handleAdd = () => {
    onChange([...items, createEmptyItem(editingId ?? '')]);
  };

  const handleDelete = (id: string) => {
    onChange(items.filter((it) => it.id !== id));
    setSelectedKeys((keys) => keys.filter((k) => k !== id));
  };

  const handleCopy = (id: string) => {
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const copy = cloneItem(items[idx], editingId ?? '', idx + 1);
    const next = [...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)];
    onChange(next);
  };

  const handleDeleteSelected = () => {
    if (!selectedKeys.length) {
      notifyWarning(t('inquiry.create.material.selectToDelete'));
      return;
    }
    onChange(items.filter((it) => !selectedKeys.includes(it.id)));
    setSelectedKeys([]);
    notifySuccess(t('inquiry.create.material.deletedRows', { count: selectedKeys.length }));
  };

  const handleCopySelected = () => {
    if (!selectedKeys.length) {
      notifyWarning(t('inquiry.create.material.selectToCopy'));
      return;
    }
    const picked = items.filter((it) => selectedKeys.includes(it.id));
    const copies = picked.map((it, i) => cloneItem(it, editingId ?? '', i + 1));
    onChange([...items, ...copies]);
    setSelectedKeys([]);
    notifySuccess(t('inquiry.create.material.copiedRows', { count: picked.length }));
  };

  /** 批量导入 Excel/CSV */
  const importProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      handleImport(file);
      return false;
    },
  };

  const handleImport = async (file: File) => {
    try {
      const newItems = await parseInquiryItems(file, editingId ?? '');
      onChange([...items, ...newItems]);
      notifySuccess(t('inquiry.create.material.importedItems', { count: newItems.length }));
    } catch (e) {
      const msg =
        (e as Error).message || t('inquiry.create.material.parseFailed');
      // 区分"无有效行"（warning）与"解析失败"（error）
      if (msg.includes('未解析到')) notifyWarning(msg);
      else notifyError(msg);
    }
  };

  /** 从物料库选择批量添加 */
  const filteredMaterials = useMemo(() => {
    const kw = materialSearch.trim().toLowerCase();
    if (!kw) return materials;
    return materials.filter(
      (m) =>
        m.name.toLowerCase().includes(kw) ||
        m.code.toLowerCase().includes(kw) ||
        m.category.toLowerCase().includes(kw) ||
        m.brand.toLowerCase().includes(kw),
    );
  }, [materials, materialSearch]);

  const handleConfirmPickMaterials = () => {
    const picked = materials.filter((m) => pickedMaterialIds.includes(m.id));
    if (!picked.length) {
      notifyWarning(t('inquiry.create.material.selectToAdd'));
      return;
    }
    const newItems: InquiryItem[] = picked.map((m, i) => ({
      id: `item-mat-${Date.now()}-${i}`,
      inquiryId: editingId ?? '',
      material: m,
      name: m.name,
      code: m.code,
      category: normalizeCategory(m.category),
      brand: m.brand,
      spec: m.spec,
      techParams: m.techParams,
      unit: m.unit,
      quantity: 1,
      attachments: [],
    }));
    onChange([...items, ...newItems]);
    notifySuccess(t('inquiry.create.material.addedItems', { count: picked.length }));
    setPickedMaterialIds([]);
    setMaterialSearch('');
    setMaterialModalOpen(false);
  };

  /** 从历史询价复制 */
  const [pickedHistoryId, setPickedHistoryId] = useState<string | undefined>();
  const historyInquiries = useMemo(
    () => inquiries.filter((i) => i.id !== editingId),
    [inquiries, editingId],
  );
  const pickedHistory = pickedHistoryId
    ? inquiries.find((i) => i.id === pickedHistoryId)
    : undefined;

  const handleConfirmCopyHistory = () => {
    if (!pickedHistory) {
      notifyWarning(t('inquiry.create.material.selectHistory'));
      return;
    }
    if (!pickedHistory.items?.length) {
      notifyWarning(t('inquiry.create.material.historyEmpty'));
      return;
    }
    const copies = pickedHistory.items.map((it, i) =>
      cloneItem({ ...it }, editingId ?? '', i + 1),
    );
    onChange([...items, ...copies]);
    notifySuccess(
      t('inquiry.create.material.copiedFromHistory', {
        code: pickedHistory.code,
        count: copies.length,
      }),
    );
    setPickedHistoryId(undefined);
    setHistoryModalOpen(false);
  };

  /** 行附件上传 */
  const rowUploadProps = (id: string): UploadProps => ({
    multiple: true,
    showUploadList: false,
    beforeUpload: (file) => {
      const att = fileToAttachment(file);
      const row = items.find((it) => it.id === id);
      if (row) updateItem(id, { attachments: [...(row.attachments ?? []), att] });
      return false;
    },
  });

  const rowSelection: TableProps<MaterialRow>['rowSelection'] = {
    selectedRowKeys: selectedKeys,
    onChange: (keys) => setSelectedKeys(keys),
    getCheckboxProps: () => ({ disabled }),
  };

  const columns: ColumnsType<MaterialRow> = [
    {
      title: t('inquiry.create.material.materialName'),
      dataIndex: 'name',
      width: 180,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('common.required')}
          value={r.name}
          onChange={(e) => updateItem(r.id, { name: e.target.value })}
          status={r.name ? '' : 'error'}
        />
      ),
    },
    {
      title: t('inquiry.create.material.materialCode'),
      dataIndex: 'code',
      width: 130,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('inquiry.create.material.codePlaceholderExample')}
          value={r.code}
          onChange={(e) => updateItem(r.id, { code: e.target.value })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.category'),
      dataIndex: 'category',
      width: 130,
      render: (_, r) => (
        <Select
          size="small"
          placeholder={t('inquiry.create.material.selectCategoryPlaceholder')}
          style={{ width: '100%' }}
          value={r.category || undefined}
          onChange={(v) => updateItem(r.id, { category: v })}
          options={MATERIAL_CATEGORY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          allowClear
        />
      ),
    },
    {
      title: t('inquiry.create.material.brand'),
      dataIndex: 'brand',
      width: 120,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('inquiry.create.material.brand')}
          value={r.brand}
          onChange={(e) => updateItem(r.id, { brand: e.target.value })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.spec'),
      dataIndex: 'spec',
      width: 150,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('inquiry.create.material.spec')}
          value={r.spec}
          onChange={(e) => updateItem(r.id, { spec: e.target.value })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.techParams'),
      dataIndex: 'techParams',
      width: 200,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('inquiry.create.material.techParams')}
          value={r.techParams}
          onChange={(e) => updateItem(r.id, { techParams: e.target.value })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.unit'),
      dataIndex: 'unit',
      width: 80,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('inquiry.create.material.unit')}
          value={r.unit}
          onChange={(e) => updateItem(r.id, { unit: e.target.value })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.quantity'),
      dataIndex: 'quantity',
      width: 110,
      render: (_, r) => (
        <InputNumber
          size="small"
          min={0}
          style={{ width: '100%' }}
          placeholder={t('common.required')}
          value={r.quantity}
          status={r.quantity > 0 ? '' : 'error'}
          onChange={(v) => updateItem(r.id, { quantity: Number(v) || 0 })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.targetPrice'),
      dataIndex: 'targetPrice',
      width: 110,
      render: (_, r) => (
        <InputNumber
          size="small"
          min={0}
          style={{ width: '100%' }}
          placeholder={t('common.optional')}
          value={r.targetPrice}
          onChange={(v) => updateItem(r.id, { targetPrice: v ?? undefined })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.expectedDeliveryDate'),
      dataIndex: 'expectedDeliveryDate',
      width: 160,
      render: (_, r) => (
        <DatePicker
          size="small"
          style={{ width: '100%' }}
          format="YYYY-MM-DD"
          value={r.expectedDeliveryDate ? dayjs(r.expectedDeliveryDate) : null}
          onChange={(v) =>
            updateItem(r.id, {
              expectedDeliveryDate: v ? v.format('YYYY-MM-DD') : undefined,
            })
          }
        />
      ),
    },
    {
      title: t('inquiry.create.material.remark'),
      dataIndex: 'remark',
      width: 140,
      render: (_, r) => (
        <Input
          size="small"
          placeholder={t('inquiry.create.material.remark')}
          value={r.remark}
          onChange={(e) => updateItem(r.id, { remark: e.target.value })}
        />
      ),
    },
    {
      title: t('inquiry.create.material.attachments'),
      dataIndex: 'attachments',
      width: 110,
      render: (_, r) => (
        <Space size={4}>
          <Upload {...rowUploadProps(r.id)}>
            <Button size="small" icon={<UploadOutlined />} disabled={disabled}>
              {t('common.upload')}
            </Button>
          </Upload>
          {(r.attachments?.length ?? 0) > 0 && (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {r.attachments.length}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('inquiry.create.material.actions'),
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title={t('inquiry.create.material.copyRow')}>
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(r.id)}
              disabled={disabled}
            />
          </Tooltip>
          <Popconfirm
            title={t('inquiry.create.material.confirmDeleteRow')}
            okText={t('common.delete')}
            okButtonProps={{ danger: true }}
            cancelText={t('common.cancel')}
            onConfirm={() => handleDelete(r.id)}
            disabled={disabled}
          >
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={disabled}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space
        style={{ marginBottom: 12, flexWrap: 'wrap' }}
        size={8}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={disabled}>
          {t('inquiry.create.material.addRow')}
        </Button>
        <Button icon={<DeleteOutlined />} onClick={handleDeleteSelected} disabled={disabled}>
          {t('inquiry.create.material.deleteSelected')}
        </Button>
        <Button icon={<CopyOutlined />} onClick={handleCopySelected} disabled={disabled}>
          {t('inquiry.create.material.copySelected')}
        </Button>
        <Upload {...importProps}>
          <Button icon={<ImportOutlined />} disabled={disabled}>
            {t('inquiry.create.material.batchImport')}
          </Button>
        </Upload>
        <Button icon={<SearchOutlined />} onClick={() => setMaterialModalOpen(true)} disabled={disabled}>
          {t('inquiry.create.material.selectFromLibrary')}
        </Button>
        <Button onClick={() => setHistoryModalOpen(true)} disabled={disabled}>
          {t('inquiry.create.material.copyFromHistory')}
        </Button>
      </Space>

      <Space size={24} style={{ marginBottom: 12 }}>
        <Statistic title={t('inquiry.create.material.materialKinds')} value={items.length} />
        <Statistic title={t('inquiry.create.material.materialTotalQty')} value={totalQty} />
      </Space>

      {items.length === 0 ? (
        <Empty description={t('inquiry.create.material.emptyMaterial')}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd} disabled={disabled}>
            {t('inquiry.create.material.addRow')}
          </Button>
        </Empty>
      ) : (
        <Table<MaterialRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={items}
          rowSelection={rowSelection}
          pagination={false}
          scroll={{ x: 1700 }}
          bordered
        />
      )}

      <Modal
        title={t('inquiry.create.material.selectFromLibrary')}
        open={materialModalOpen}
        width={720}
        onCancel={() => setMaterialModalOpen(false)}
        onOk={handleConfirmPickMaterials}
        okText={t('inquiry.create.material.addSelected', { count: pickedMaterialIds.length || '' })}
        okButtonProps={{ disabled: pickedMaterialIds.length === 0 }}
        cancelText={t('common.cancel')}
      >
        <Input.Search
          placeholder={t('inquiry.create.material.searchMaterialPlaceholder')}
          allowClear
          prefix={<SearchOutlined />}
          style={{ marginBottom: 12 }}
          onChange={(e) => setMaterialSearch(e.target.value)}
        />
        <Table
          rowKey="id"
          size="small"
          dataSource={filteredMaterials}
          pagination={{ pageSize: 6, size: 'small' }}
          rowSelection={{
            selectedRowKeys: pickedMaterialIds,
            onChange: (keys) => setPickedMaterialIds(keys as string[]),
          }}
          columns={[
            { title: t('common.code'), dataIndex: 'code', width: 100 },
            { title: t('common.name'), dataIndex: 'name', width: 160 },
            { title: t('common.category'), dataIndex: 'category', width: 110 },
            { title: t('common.brand'), dataIndex: 'brand', width: 100 },
            { title: t('common.spec'), dataIndex: 'spec' },
            { title: t('common.unit'), dataIndex: 'unit', width: 70 },
            {
              title: t('material.list.stockQty'),
              dataIndex: 'stockQty',
              width: 80,
              render: (v: number | undefined) => (v ?? 0),
            },
          ]}
        />
      </Modal>

      <Modal
        title={t('inquiry.create.material.copyFromHistory')}
        open={historyModalOpen}
        width={760}
        onCancel={() => setHistoryModalOpen(false)}
        onOk={handleConfirmCopyHistory}
        okText={t('inquiry.create.material.copyItems')}
        okButtonProps={{ disabled: !pickedHistory }}
        cancelText={t('common.cancel')}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={historyInquiries}
          pagination={{ pageSize: 6, size: 'small' }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: pickedHistoryId ? [pickedHistoryId] : [],
            onChange: (keys) => setPickedHistoryId(keys[0] as string),
          }}
          columns={[
            { title: t('inquiry.create.material.historyCode'), dataIndex: 'code', width: 150 },
            { title: t('inquiry.create.material.historySubject'), dataIndex: 'subject' },
            { title: t('inquiry.create.material.itemCount'), dataIndex: 'items', width: 80, render: (v: InquiryItem[]) => v?.length ?? 0 },
            {
              title: t('common.status'),
              dataIndex: 'status',
              width: 90,
              render: (v: string) => v,
            },
            {
              title: t('common.createdAt'),
              dataIndex: 'createdAt',
              width: 160,
              render: (v: string) => v,
            },
          ]}
        />
        {pickedHistory && (
          <div style={{ marginTop: 12, color: 'var(--color-text-secondary)' }}>
            {t('inquiry.create.material.copyHistoryConfirm', {
              code: pickedHistory.code,
              subject: pickedHistory.subject,
              count: pickedHistory.items.length,
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
