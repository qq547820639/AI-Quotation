/**
 * 物料管理（Task 16）
 * 支持多维度筛选、新增/编辑/删除物料，弹窗表单维护物料主数据
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import Permission from '@/components/Permission';
import { useMaterialStore } from '@/store/useMaterialStore';
import { useAuthStore } from '@/store/useAuthStore';
import { type Material } from '@/types';
import { confirmAction, notifyError, notifySuccess, notifyWarning } from '@/utils/confirm';
import { buildMaterials, parseMaterialFile } from '@/utils/materialImport';
import { useIsMobile } from '@/utils/useIsMobile';

const { Text } = Typography;

/** 品类筛选选项 */
const CATEGORY_OPTIONS = [
  { label: '工业电子', value: '工业电子' },
  { label: '五金件', value: '五金件' },
  { label: '自动化', value: '自动化' },
  { label: '办公设备', value: '办公设备' },
  { label: '包材', value: '包材' },
  { label: '劳保', value: '劳保' },
];

/** 表单字段类型 */
interface MaterialFormValues {
  code: string;
  name: string;
  category: string;
  brand?: string;
  spec?: string;
  techParams?: string;
  unit: string;
  stockQty?: number;
}

export default function MaterialPage() {
  const { t } = useTranslation();
  const materials = useMaterialStore((s) => s.materials);
  const addMaterial = useMaterialStore((s) => s.addMaterial);
  const updateMaterial = useMaterialStore((s) => s.updateMaterial);
  const deleteMaterial = useMaterialStore((s) => s.deleteMaterial);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission('MATERIAL_MANAGE');
  const isMobile = useIsMobile();

  // ===== 筛选状态（输入态，点击查询后写入 applied） =====
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined);
  const [filterBrand, setFilterBrand] = useState('');
  // 已应用的筛选条件（点击查询后生效，与 log/inquiry-list 页一致）
  const [applied, setApplied] = useState<{
    keyword: string;
    category: string | undefined;
    brand: string;
  }>({ keyword: '', category: undefined, brand: '' });

  // ===== 弹窗状态 =====
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<MaterialFormValues>();

  // ===== 批量导入状态 =====
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<Material[]>([]);
  const [importing, setImporting] = useState(false);

  const importProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
    multiple: false,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const parsed = await parseMaterialFile(file);
        setImportPreview(buildMaterials(parsed));
      } catch (e) {
        notifyError((e as Error).message || t('material.import.parseFailed'));
        setImportPreview([]);
      }
      return false;
    },
  };

  const handleConfirmImport = () => {
    if (!importPreview.length) {
      notifyWarning(t('material.import.uploadFirst'));
      return;
    }
    setImporting(true);
    importPreview.forEach((m) => addMaterial(m));
    notifySuccess(t('material.import.importSuccessCount', { count: importPreview.length }));
    setImportPreview([]);
    setImportOpen(false);
    setImporting(false);
  };

  const handleCancelImport = () => {
    setImportPreview([]);
    setImportOpen(false);
  };

  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (applied.keyword) {
        const kw = applied.keyword.toLowerCase();
        if (
          !m.name.toLowerCase().includes(kw) &&
          !m.code.toLowerCase().includes(kw)
        ) {
          return false;
        }
      }
      if (applied.category && !m.category.includes(applied.category)) {
        return false;
      }
      if (applied.brand && !m.brand.toLowerCase().includes(applied.brand.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [materials, applied]);

  const handleQuery = () => {
    setApplied({ keyword: filterKeyword, category: filterCategory, brand: filterBrand });
  };

  const handleReset = () => {
    setFilterKeyword('');
    setFilterCategory(undefined);
    setFilterBrand('');
    setApplied({ keyword: '', category: undefined, brand: '' });
  };

  // 打开新增弹窗
  const handleAdd = () => {
    setEditingId(null);
    form.resetFields();
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const handleEdit = (material: Material) => {
    setEditingId(material.id);
    form.setFieldsValue({
      code: material.code,
      name: material.name,
      category: material.category,
      brand: material.brand,
      spec: material.spec,
      techParams: material.techParams,
      unit: material.unit,
      stockQty: material.stockQty,
    });
    setModalOpen(true);
  };

  // 提交表单
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingId) {
        // 编辑：code 只读，不更新
        const { code: _code, ...patch } = values;
        void _code;
        updateMaterial(editingId, patch);
        notifySuccess(t('material.form.updated'));
      } else {
        // 新增
        const newMaterial: Material = {
          id: `mat-${dayjs().valueOf()}`,
          code: values.code,
          name: values.name,
          category: values.category,
          brand: values.brand ?? '',
          spec: values.spec ?? '',
          techParams: values.techParams ?? '',
          unit: values.unit,
          stockQty: values.stockQty,
        };
        addMaterial(newMaterial);
        notifySuccess(t('material.form.added'));
      }
      setModalOpen(false);
      form.resetFields();
    } catch {
      // 校验失败，保持弹窗打开
    } finally {
      setSubmitting(false);
    }
  };

  // 删除物料
  const handleDelete = (material: Material) => {
    confirmAction({
      title: t('material.list.deleteTitle'),
      content: t('material.form.confirmDeleteDetail', { name: material.name, code: material.code }),
      okText: t('common.delete'),
      danger: true,
      onOk: () => {
        deleteMaterial(material.id);
        notifySuccess(t('material.form.deleted'));
      },
    });
  };

  const columns: ColumnsType<Material> = [
    {
      title: t('material.list.code'),
      dataIndex: 'code',
      key: 'code',
      width: 120,
      fixed: 'left',
      render: (code: string) => <Text strong>{code}</Text>,
    },
    {
      title: t('material.list.name'),
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name: string) => <Text>{name}</Text>,
    },
    {
      title: t('material.list.categoryShort'),
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (category: string) => <Tag color="blue">{category}</Tag>,
    },
    {
      title: t('material.list.brand'),
      dataIndex: 'brand',
      key: 'brand',
      width: 110,
      render: (brand: string) => brand || <Text type="secondary">-</Text>,
    },
    {
      title: t('material.list.specModel'),
      dataIndex: 'spec',
      key: 'spec',
      width: 180,
      ellipsis: true,
      render: (spec: string) => spec || <Text type="secondary">-</Text>,
    },
    {
      title: t('material.list.techParams'),
      dataIndex: 'techParams',
      key: 'techParams',
      width: 240,
      ellipsis: true,
      render: (params: string) => params || <Text type="secondary">-</Text>,
    },
    {
      title: t('material.list.unit'),
      dataIndex: 'unit',
      key: 'unit',
      width: 80,
      align: 'center',
    },
    {
      title: t('material.list.stockQty'),
      dataIndex: 'stockQty',
      key: 'stockQty',
      width: 100,
      align: 'right',
      render: (qty?: number) =>
        qty != null ? (
          <Text>{qty}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
      sorter: (a, b) => (a.stockQty ?? 0) - (b.stockQty ?? 0),
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 140,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          {canManage && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            >
              {t('material.list.edit')}
            </Button>
          )}
          {canManage && (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
            >
              {t('material.list.delete')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('material.list.title')}
        description={t('material.list.description')}
        extra={
          <Permission perm="MATERIAL_MANAGE">
            <Space>
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
                {t('material.list.batchImport')}
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
                {t('material.list.create')}
              </Button>
            </Space>
          </Permission>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('material.list.nameCodeLabel')}
            </div>
            <Input
              placeholder={t('common.inputPlaceholder')}
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('material.list.categoryShort')}</div>
            <Select
              placeholder={t('common.selectPlaceholder')}
              value={filterCategory}
              onChange={(val) => setFilterCategory(val)}
              options={CATEGORY_OPTIONS}
              style={{ width: '100%' }}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12} md={8} lg={6}>
            <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('material.list.brand')}</div>
            <Input
              placeholder={t('common.inputPlaceholder')}
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
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

      <Card styles={{ body: { padding: 0 } }}>
        {isMobile ? (
          <List
            dataSource={filteredMaterials}
            locale={{
              emptyText:
                materials.length === 0 ? (
                  <Empty description={t('material.list.empty')} />
                ) : (
                  <Empty description={t('material.list.noMatch')} />
                ),
            }}
            pagination={{
              pageSize: 10,
              simple: true,
              showTotal: (total) => t('material.list.total', { count: total }),
            }}
            renderItem={(record) => (
              <List.Item style={{ padding: '12px 16px', flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <Text strong>{record.code}</Text>
                  <Tag color="blue">{record.category}</Tag>
                </div>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>{record.name}</Text>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  <span>{t('material.list.brand')}: {record.brand || '-'}</span>
                  <span>{t('material.list.specModel')}: {record.spec || '-'}</span>
                  <span>{t('material.list.unit')}: {record.unit}</span>
                  <span>{t('material.list.stockQty')}: {record.stockQty != null ? record.stockQty : '-'}</span>
                </div>
                {record.techParams && (
                  <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                    {record.techParams}
                  </Text>
                )}
                <Space size={0} wrap style={{ marginTop: 8 }}>
                  {canManage && (
                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                      {t('material.list.edit')}
                    </Button>
                  )}
                  {canManage && (
                    <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
                      {t('material.list.delete')}
                    </Button>
                  )}
                </Space>
              </List.Item>
            )}
          />
        ) : (
        <Table<Material>
          rowKey="id"
          columns={columns}
          dataSource={filteredMaterials}
          scroll={{ x: 1300 }}
          pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => t('material.list.total', { count: total }),
            }}
            locale={{
              emptyText:
                materials.length === 0 ? (
                  <Empty description={t('material.list.empty')} />
                ) : (
                  <Empty description={t('material.list.noMatch')} />
                ),
            }}
          />
        )}
      </Card>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingId ? t('material.form.editTitle') : t('material.form.createTitle')}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        confirmLoading={submitting}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        width={640}
        destroyOnClose
      >
        <Form<MaterialFormValues>
          form={form}
          layout="vertical"
          preserve={false}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="code"
                label={t('material.form.code')}
                rules={[{ required: true, message: t('material.form.codeRequired') }]}
              >
                <Input placeholder={t('material.form.codeExample')} disabled={!!editingId} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label={t('material.form.name')}
                rules={[{ required: true, message: t('material.form.nameRequired') }]}
              >
                <Input placeholder={t('material.form.namePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="category"
                label={t('material.form.categoryShort')}
                rules={[{ required: true, message: t('material.form.categoryRequired') }]}
              >
                <Select
                  placeholder={t('material.form.categorySelectPlaceholder')}
                  options={CATEGORY_OPTIONS}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="brand" label={t('material.form.brand')}>
                <Input placeholder={t('material.form.brandPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="spec" label={t('material.form.specModel')}>
                <Input placeholder={t('material.form.specModelPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="unit"
                label={t('material.form.unit')}
                rules={[{ required: true, message: t('material.form.unitRequired') }]}
              >
                <Input placeholder={t('material.form.unitExample')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stockQty" label={t('material.form.stockLabel')}>
                <InputNumber
                  placeholder={t('material.form.stockQtyPlaceholder')}
                  min={0}
                  precision={0}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="techParams" label={t('material.form.techParams')}>
                <Input.TextArea
                  placeholder={t('material.form.techParamsDescPlaceholder')}
                  rows={3}
                  maxLength={500}
                  showCount
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 批量导入弹窗 */}
      <Modal
        title={t('material.import.title')}
        open={importOpen}
        onOk={handleConfirmImport}
        onCancel={handleCancelImport}
        confirmLoading={importing}
        okText={
          importPreview.length
            ? `${t('material.import.confirmImport')}（${importPreview.length}）`
            : t('material.import.confirmImport')
        }
        cancelText={t('common.cancel')}
        width={720}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Upload {...importProps}>
            <Button icon={<UploadOutlined />}>{t('material.import.selectExcel')}</Button>
          </Upload>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('material.import.supportedColumns')}
          </Text>
          {importPreview.length > 0 && (
            <>
              <Text strong>{t('material.import.previewCount', { count: importPreview.length })}</Text>
              <Table<Material>
                size="small"
                rowKey="id"
                dataSource={importPreview.slice(0, 10)}
                pagination={false}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: t('material.form.code'), dataIndex: 'code', width: 120 },
                  { title: t('material.form.name'), dataIndex: 'name', width: 160 },
                  {
                    title: t('material.form.categoryShort'),
                    dataIndex: 'category',
                    width: 100,
                    render: (c: string) => <Tag color="blue">{c}</Tag>,
                  },
                  { title: t('material.form.brand'), dataIndex: 'brand', width: 100 },
                  { title: t('material.form.specModel'), dataIndex: 'spec', width: 140, ellipsis: true },
                  { title: t('material.form.unit'), dataIndex: 'unit', width: 70, align: 'center' },
                ]}
              />
            </>
          )}
        </Space>
      </Modal>
    </div>
  );
}
