/**
 * 全局搜索（B2）
 * - 受控 Modal，搜索询价单 / 供应商 / 物料
 * - 实时过滤、分组展示、点击跳转
 */
import { useMemo, useState } from 'react';
import { Empty, Input, List, Modal, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useMaterialStore } from '@/store/useMaterialStore';
import { InquiryStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import type { Inquiry, Material, Supplier } from '@/types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 单组最大展示条数 */
const MAX_PER_GROUP = 8;

export default function GlobalSearch({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const inquiries = useInquiryStore((s) => s.inquiries);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const materials = useMaterialStore((s) => s.materials);

  const kw = keyword.trim().toLowerCase();

  const results = useMemo(() => {
    if (!kw) return { inquiries: [] as Inquiry[], suppliers: [] as Supplier[], materials: [] as Material[] };
    return {
      inquiries: inquiries
        .filter(
          (i) => i.code.toLowerCase().includes(kw) || i.subject.toLowerCase().includes(kw),
        )
        .slice(0, MAX_PER_GROUP),
      suppliers: suppliers
        .filter(
          (s) => s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw),
        )
        .slice(0, MAX_PER_GROUP),
      materials: materials
        .filter(
          (m) => m.name.toLowerCase().includes(kw) || m.code.toLowerCase().includes(kw),
        )
        .slice(0, MAX_PER_GROUP),
    };
  }, [kw, inquiries, suppliers, materials]);

  const total = results.inquiries.length + results.suppliers.length + results.materials.length;

  const handleClose = () => {
    setKeyword('');
    onClose();
  };
  const go = (path: string) => {
    navigate(path);
    handleClose();
  };

  return (
    <Modal
      title={t('globalSearch.title')}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Input.Search
        autoFocus
        placeholder={t('globalSearch.detailPlaceholder')}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 16 }}
        size="large"
      />
      {total === 0 ? (
        <Empty description={kw ? t('globalSearch.noMatch') : t('globalSearch.enterKeyword')} />
      ) : (
        <>
          {results.inquiries.length > 0 && (
            <List
              size="small"
              header={<Text strong>{t('globalSearch.inquiry')}（{results.inquiries.length}）</Text>}
              dataSource={results.inquiries}
              renderItem={(i) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => go(`/inquiry/detail/${i.id}`)}
                >
                  <List.Item.Meta
                    title={
                      <>
                        <Text strong>{i.code}</Text> · {i.subject}
                      </>
                    }
                    description={<InquiryStatusTag status={i.status} />}
                  />
                </List.Item>
              )}
            />
          )}
          {results.suppliers.length > 0 && (
            <List
              size="small"
              header={<Text strong>{t('globalSearch.supplier')}（{results.suppliers.length}）</Text>}
              dataSource={results.suppliers}
              renderItem={(s) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => go(`/supplier/${s.id}`)}
                >
                  <List.Item.Meta
                    title={
                      <>
                        <Text strong>{s.code}</Text> · {s.name}
                      </>
                    }
                    description={<SupplierLevelTag level={s.level} />}
                  />
                </List.Item>
              )}
            />
          )}
          {results.materials.length > 0 && (
            <List
              size="small"
              header={<Text strong>{t('globalSearch.material')}（{results.materials.length}）</Text>}
              dataSource={results.materials}
              renderItem={(m) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => go('/material')}>
                  <List.Item.Meta
                    title={
                      <>
                        <Text strong>{m.code}</Text> · {m.name}
                      </>
                    }
                    description={<Tag color="blue">{m.category}</Tag>}
                  />
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </Modal>
  );
}
