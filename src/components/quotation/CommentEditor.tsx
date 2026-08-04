/**
 * 采购评语编辑器（Task 6）
 * - 组件内持有防抖逻辑（默认 800ms），输入停止后自动保存
 * - 评语输入由本组件独立持有 draft，父组件/对比表不随之重渲染
 * - 保存状态：idle | saving | saved | error，通过 onStatusChange 上报给父组件
 * - 失败时保留输入并展示重试入口；onBlur 立即 flush 未保存内容
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { SupplierLevel } from '@/types';
import { SupplierLevelTag } from '@/components/StatusTag';

const { Text } = Typography;
const { TextArea } = Input;

/** 保存状态 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** 默认防抖延时（ms） */
export const DEFAULT_DEBOUNCE_MS = 800;

export interface CommentEditorProps {
  supplierId: string;
  supplierName: string;
  level: SupplierLevel;
  /** 已提交（已保存）的评语值，由父组件维护 */
  value: string;
  /** 同步草稿给父组件（保存/失焦时触发） */
  onChange: (supplierId: string, value: string) => void;
  /** 保存回调：父组件内 await updateInquiry，返回是否成功 */
  onSave: (supplierId: string, value: string) => Promise<boolean>;
  /** 保存状态上报（供父组件做未保存检测） */
  onStatusChange: (supplierId: string, status: SaveStatus) => void;
  /** 是否有未保存内容上报（供父组件做离开拦截） */
  onDirtyChange: (supplierId: string, dirty: boolean) => void;
  /** 初始保存状态（父组件切换询价单/供应商时重置） */
  saveStatus?: SaveStatus;
  /** 防抖延时（测试可注入） */
  debounceMs?: number;
}

function CommentEditorBase({
  supplierId,
  supplierName,
  level,
  value,
  onChange,
  onSave,
  onStatusChange,
  onDirtyChange,
  saveStatus = 'idle',
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: CommentEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<SaveStatus>(saveStatus);
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(value);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportStatus = useCallback(
    (s: SaveStatus) => {
      setStatus(s);
      onStatusChange(supplierId, s);
    },
    [supplierId, onStatusChange],
  );

  const setDraftBoth = useCallback((v: string) => {
    setDraft(v);
    draftRef.current = v;
  }, []);

  // 外部 value 变化（如切换询价单）时重置草稿与状态
  useEffect(() => {
    setDraftBoth(value);
    setDirty(false);
    onDirtyChange(supplierId, false);
    reportStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, supplierId]);

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // dirty 变化时上报给父组件（仅在状态翻转时触发，避免每键重渲染父组件）
  useEffect(() => {
    onDirtyChange(supplierId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, supplierId]);

  /**
   * 统一保存入口：保存前去除首尾空白。
   * 若保存期间用户继续输入，旧响应不得把新草稿标记为 saved/error，
   * 仅当保存值仍等于当前草稿时才更新状态，避免旧响应覆盖新内容。
   */
  const performSave = useCallback(
    async (val: string) => {
      const trimmed = val.trim();
      dirtyRef.current = false;
      setDirty(false);
      onChange(supplierId, trimmed);
      reportStatus('saving');
      const ok = await onSave(supplierId, trimmed);
      if (draftRef.current.trim() === trimmed) {
        reportStatus(ok ? 'saved' : 'error');
      } else {
        // 保存期间已有更新的输入，保持待保存状态
        reportStatus('idle');
      }
    },
    [supplierId, onChange, onSave, reportStatus],
  );

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) return;
    await performSave(draftRef.current);
  }, [performSave]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraftBoth(val);
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirty(true);
    }
    reportStatus('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
  };

  const handleBlur = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current) void flush();
  };

  const handleRetry = async () => {
    await performSave(draftRef.current);
  };

  const statusNode = (() => {
    if (status === 'saving') {
      return <Text type="secondary" style={{ fontSize: 12 }}>{t('quotation.compare.saveSaving')}</Text>;
    }
    if (status === 'error') {
      return (
        <Space size={4}>
          <Text type="danger" style={{ fontSize: 12 }}>{t('quotation.compare.saveFailed')}</Text>
          <Button size="small" type="link" style={{ padding: 0, fontSize: 12 }} onClick={() => void handleRetry()}>
            {t('common.retry')}
          </Button>
        </Space>
      );
    }
    if (status === 'saved' && !dirty) {
      return <Text type="success" style={{ fontSize: 12 }}>{t('quotation.compare.saveSaved')}</Text>;
    }
    return null;
  })();

  return (
    <div>
      <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text strong style={{ fontSize: 13 }}>{supplierName}</Text>
        <SupplierLevelTag level={level} />
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          {statusNode}
        </span>
      </div>
      <TextArea
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        rows={2}
        placeholder={t('quotation.compare.commentPlaceholder')}
        maxLength={500}
        showCount
      />
    </div>
  );
}

/** 用 React.memo 隔离：评语输入只重渲染本组件，不重渲染对比表/整页 */
const CommentEditor = memo(CommentEditorBase);

export default CommentEditor;