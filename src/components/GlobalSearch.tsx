/**
 * 全局搜索（B2 + Task 19）
 * - 受控 Modal，跨询价 / 供应商 / 物料 / 报价统一搜索
 * - 服务端分页：keyword/page/pageSize 由 searchApi 发送，避免前端全量拉取
 * - 防抖输入、加载态、空态、参数校验错误提示
 */
import { useEffect, useRef, useState } from 'react';
import { Empty, Input, List, Modal, Spin, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { searchApi, type GlobalSearchResponse } from '@/api/searchApi';
import { InquiryStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import type { Inquiry, Material, Quotation, Supplier } from '@/types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 单组最大展示条数 */
const PAGE_SIZE = 5;

export default function GlobalSearch({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GlobalSearchResponse | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const kw = keyword.trim();

  /** 防抖触发服务端搜索：仅 GET 幂等，参数由服务端校验 */
  useEffect(() => {
    if (!open) return;
    if (!kw) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      searchApi
        .global({ keyword: kw, pageSize: PAGE_SIZE })
        .then((data) => {
          if (seq !== requestSeq.current) return; // 丢弃过期响应
          setResult(data);
        })
        .catch((e) => {
          if (seq !== requestSeq.current) return;
          setResult(null);
          setError(e?.message ?? t('common.operateFailed'));
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [kw, open, t]);

  const handleClose = () => {
    setKeyword('');
    setResult(null);
    setError(null);
    setLoading(false);
    onClose();
  };
  const go = (path: string) => {
    navigate(path);
    handleClose();
  };

  const inquiries = result?.inquiries.items ?? ([] as Inquiry[]);
  const suppliers = result?.suppliers.items ?? ([] as Supplier[]);
  const materials = result?.materials.items ?? ([] as Material[]);
  const quotations = result?.quotations.items ?? ([] as Quotation[]);
  const total =
    (result?.inquiries.total ?? 0) +
    (result?.suppliers.total ?? 0) +
    (result?.materials.total ?? 0) +
    (result?.quotations.total ?? 0);

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
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : error ? (
        <Empty description={error} />
      ) : !kw ? (
        <Empty description={t('globalSearch.enterKeyword')} />
      ) : total === 0 ? (
        <Empty description={t('globalSearch.noMatch')} />
      ) : (
        <>
          {inquiries.length > 0 && (
            <List
              size="small"
              header={
                <Text strong>
                  {t('globalSearch.inquiry')}（{inquiries.length}/
                  {result?.inquiries.total ?? inquiries.length}）
                </Text>
              }
              dataSource={inquiries}
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
          {suppliers.length > 0 && (
            <List
              size="small"
              header={
                <Text strong>
                  {t('globalSearch.supplier')}（{suppliers.length}/
                  {result?.suppliers.total ?? suppliers.length}）
                </Text>
              }
              dataSource={suppliers}
              renderItem={(s) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => go(`/supplier/${s.id}`)}>
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
          {materials.length > 0 && (
            <List
              size="small"
              header={
                <Text strong>
                  {t('globalSearch.material')}（{materials.length}/
                  {result?.materials.total ?? materials.length}）
                </Text>
              }
              dataSource={materials}
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
          {quotations.length > 0 && (
            <List
              size="small"
              header={
                <Text strong>
                  {t('globalSearch.quotation')}（{quotations.length}/
                  {result?.quotations.total ?? quotations.length}）
                </Text>
              }
              dataSource={quotations}
              renderItem={(q) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => go(`/inquiry/detail/${q.inquiryId}`)}
                >
                  <List.Item.Meta
                    title={
                      <>
                        <Text strong>{q.supplierName}</Text> · 报价
                      </>
                    }
                    description={
                      <Tag color="green">
                        {t('globalSearch.quotationAmount', { amount: q.totalAmount })}
                      </Tag>
                    }
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
