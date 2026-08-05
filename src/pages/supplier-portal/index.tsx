/**
 * 供应商报价填报端（邀请令牌门户）
 * 路由：/supplier-portal/:invitationToken，使用 SupplierLayout
 * 通过 /api/portal 独立 API 认证，不依赖内部 Bearer token 与 stores
 * 页面状态：valid / submitted / revoked / expired / terminal / error / loading
 *
 * Task 16 供应商报价体验深化：
 * 1. 步骤条  2. 防抖自动保存 + 保存状态  3. 未保存离开提示 + 草稿恢复
 * 4. 提交前错误摘要  5. 批量操作  6. Excel 导入/模板导出/复制上一轮
 * 7. 移动端卡片 + 底部操作栏  8. 回执下载  9. 撤回/修订状态规则  10. 无障碍
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  CopyOutlined,
  DownloadOutlined,
  ImportOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  portalApi,
  type PortalInquiry,
  type PortalInquiryItem,
  type QuotationSubmitReceipt,
  type InvitationValidationResult,
} from '@/api/portal';
import { ApiError } from '@/api/errors';
import { formatCurrency, formatDate, formatDateTime, getRemainingTime } from '@/utils/format';
import { confirmAction, notifyError, notifySuccess } from '@/utils/confirm';
import { useIsMobile } from '@/utils/useIsMobile';
import { downloadTextFile, generateCSV, parseCSV } from '@/utils/csv';
import { AutoSaveIndicator, BatchToolbar, ErrorSummary, QuotationSteps } from './components';
import SubmitPreviewModal from './SubmitPreviewModal';
import {
  calcItemTotal,
  createEmptyItem,
  isTerminalStatus,
  PAYMENT_TERMS_OPTIONS,
  TAX_RATE_OPTIONS,
  type QuotationFormItem,
  type SaveState,
} from './types';

const { Title, Text, Paragraph } = Typography;

/** 页面状态 */
type Phase = 'loading' | 'valid' | 'submitted' | 'revoked' | 'expired' | 'terminal' | 'error';

/** 计算报价签名（用于判断是否有未保存变更） */
function computeSignature(items: QuotationFormItem[], remark: string): string {
  return (
    JSON.stringify(
      items.map((it) => ({
        inquiryItemId: it.inquiryItemId,
        unitPrice: it.unitPrice ?? null,
        taxRate: it.taxRate,
        moq: it.moq ?? null,
        deliveryDays: it.deliveryDays ?? null,
        deliveryDate: it.deliveryDate ? it.deliveryDate.format('YYYY-MM-DD') : null,
        brand: it.brand,
        warrantyMonths: it.warrantyMonths ?? null,
        paymentTerms: it.paymentTerms,
        validUntil: it.validUntil ? it.validUntil.format('YYYY-MM-DD') : null,
        techDeviation: it.techDeviation,
        commercialDeviation: it.commercialDeviation,
        remark: it.remark,
      })),
    ) +
    '\u0001' +
    remark
  );
}

export default function SupplierPortalPage() {
  const { t } = useTranslation();
  const { invitationToken = '' } = useParams();
  const isMobile = useIsMobile();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [invitation, setInvitation] = useState<InvitationValidationResult | null>(null);
  const [inquiry, setInquiry] = useState<PortalInquiry | null>(null);
  const [receipt, setReceipt] = useState<QuotationSubmitReceipt | null>(null);

  const [formItems, setFormItems] = useState<QuotationFormItem[]>([]);
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const mountedRef = useRef(true);

  // Task 16：自动保存状态
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [dirty, setDirty] = useState(false);
  const lastSavedSignatureRef = useRef('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGenRef = useRef(0);

  // Task 16：草稿恢复提示 / 批量选择 / 错误定位高亮
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [highlight, setHighlight] = useState<{ id: string; field: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** 将邀请令牌写入 sessionStorage，供 portalClient 拦截器兜底使用 */
  useEffect(() => {
    if (invitationToken) {
      sessionStorage.setItem('invitation_token', invitationToken);
    }
  }, [invitationToken]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 加载可报价页面数据（询价 + 草稿） */
  const loadValidData = async (token: string) => {
    try {
      const [inquiryData, draft] = await Promise.all([
        portalApi.getPortalInquiry(token),
        portalApi.getCurrentQuotation(token),
      ]);
      if (!mountedRef.current) return;
      // 询价处于终态 → 呈现截止页
      if (isTerminalStatus(inquiryData.status)) {
        setPhase('terminal');
        return;
      }
      setInquiry(inquiryData);
      const items = inquiryData.items.map((it) => createEmptyItem(it));
      // 回填已有草稿
      let remarkLocal = '';
      if (draft && draft.items.length > 0) {
        draft.items.forEach((qItem) => {
          const idx = items.findIndex((f) => f.inquiryItemId === qItem.inquiryItemId);
          if (idx >= 0) {
            items[idx] = {
              inquiryItemId: qItem.inquiryItemId,
              unitPrice: qItem.unitPrice,
              taxRate: qItem.taxRate,
              moq: qItem.moq ?? undefined,
              deliveryDays: qItem.deliveryDays,
              deliveryDate: qItem.deliveryDate ? dayjs(qItem.deliveryDate) : null,
              brand: qItem.brand || '',
              warrantyMonths: qItem.warrantyMonths ?? undefined,
              paymentTerms: qItem.paymentTerms || '货到验收后 30 天付款',
              validUntil: qItem.validUntil ? dayjs(qItem.validUntil) : null,
              techDeviation: qItem.techDeviation || '',
              commercialDeviation: qItem.commercialDeviation || '',
              remark: qItem.remark || '',
              attachments: qItem.attachments || [],
            };
          }
        });
        remarkLocal = draft.remark || '';
        setDraftLoaded(true);
      }
      setFormItems(items);
      setRemark(remarkLocal);
      lastSavedSignatureRef.current = computeSignature(items, remarkLocal);
      setPhase('valid');
    } catch (e) {
      if (!mountedRef.current) return;
      setErrorMessage(getErrorMessage(e));
      setPhase('error');
    }
  };

  /** 加载已提交回执 */
  const loadReceipt = async (token: string) => {
    try {
      const data = await portalApi.getReceipt(token);
      if (!mountedRef.current) return;
      setReceipt(data);
      setPhase('submitted');
    } catch (_e) {
      if (!mountedRef.current) return;
      // 回执获取失败但已提交，仍展示已提交成功页
      setPhase('submitted');
    }
  };

  /** 根据错误码映射为对应页面状态或错误信息 */
  const handleValidateError = (e: unknown) => {
    const err = e as ApiError;
    const status = err?.status;
    if (status === 403) {
      setPhase('revoked');
    } else if (status === 410) {
      void loadReceipt(invitationToken);
    } else if (status === 401) {
      setPhase('expired');
    } else {
      setErrorMessage(getErrorMessage(e));
      setPhase('error');
    }
  };

  /** 初始化：验证邀请令牌 */
  useEffect(() => {
    if (!invitationToken) {
      setPhase('error');
      setErrorMessage(t('supplierPortal.loadFailed'));
      return;
    }
    let cancelled = false;
    setPhase('loading');
    if (mountedRef.current) {
      portalApi
        .validateInvitation(invitationToken)
        .then((result) => {
          if (cancelled) return;
          setInvitation(result);
          switch (result.status) {
            case 'valid':
              void loadValidData(invitationToken);
              break;
            case 'submitted':
              void loadReceipt(invitationToken);
              break;
            case 'revoked':
              setPhase('revoked');
              break;
            case 'expired':
              setPhase('expired');
              break;
            default:
              setPhase('error');
          }
        })
        .catch((e) => {
          if (cancelled) return;
          handleValidateError(e);
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationToken]);

  /** 询价剩余时间 */
  const remaining = useMemo(() => {
    if (!inquiry) return { text: '-', urgent: false, expired: false };
    return getRemainingTime(inquiry.deadline);
  }, [inquiry]);

  const expired = remaining.expired;

  /** 报价总金额 */
  const totalAmount = useMemo(() => {
    if (!inquiry) return 0;
    return Number(
      formItems
        .reduce((sum, item, idx) => {
          const qty = inquiry.items[idx]?.quantity ?? 0;
          return sum + calcItemTotal(item.unitPrice, qty);
        }, 0)
        .toFixed(2),
    );
  }, [formItems, inquiry]);

  /** 更新单行字段 */
  const updateField = <K extends keyof QuotationFormItem>(
    inquiryItemId: string,
    field: K,
    value: QuotationFormItem[K],
  ) => {
    setFormItems((prev) =>
      prev.map((it) => (it.inquiryItemId === inquiryItemId ? { ...it, [field]: value } : it)),
    );
    setErrors((prev) => {
      if (!prev[inquiryItemId]) return prev;
      const next = { ...prev };
      const set = new Set(next[inquiryItemId]);
      set.delete(field as string);
      if (set.size === 0) {
        delete next[inquiryItemId];
      } else {
        next[inquiryItemId] = set;
      }
      return next;
    });
  };

  /** 构造提交 / 暂存 payload */
  const buildPayload = useCallback(
    () => ({
      items: formItems.map((f) => ({
        inquiryItemId: f.inquiryItemId,
        unitPrice: f.unitPrice ?? 0,
        taxRate: f.taxRate,
        moq: f.moq ?? null,
        deliveryDays: f.deliveryDays ?? 0,
        deliveryDate: f.deliveryDate ? f.deliveryDate.format('YYYY-MM-DD') : null,
        brand: f.brand || '',
        warrantyMonths: f.warrantyMonths ?? null,
        paymentTerms: f.paymentTerms || '',
        validUntil: f.validUntil ? f.validUntil.format('YYYY-MM-DD') : null,
        techDeviation: f.techDeviation || '',
        commercialDeviation: f.commercialDeviation || '',
        remark: f.remark || '',
      })),
      remark,
    }),
    [formItems, remark],
  );

  // ===== Task 16-2：防抖自动保存 =====
  useEffect(() => {
    if (phase !== 'valid' || !inquiry) return;
    const sig = computeSignature(formItems, remark);
    if (sig === lastSavedSignatureRef.current) return;
    setDirty(true);
    setSaveState('saving');
    const gen = ++saveGenRef.current;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await portalApi.saveQuotationDraft(invitationToken, buildPayload());
        if (gen === saveGenRef.current) {
          lastSavedSignatureRef.current = computeSignature(formItems, remark);
          setDirty(false);
          setSaveState('saved');
          setLastSavedAt(dayjs().format('HH:mm:ss'));
        }
      } catch (_e) {
        if (gen === saveGenRef.current) {
          setSaveState('failed');
        }
      }
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [phase, inquiry, formItems, remark, buildPayload, invitationToken]);

  // ===== Task 16-3：未保存离开提示（浏览器刷新 / 关闭） =====
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ===== Task 16-3：路由守卫（SPA 内跳转） =====
  const blocker = useBlocker(
    useCallback(
      (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        dirty && args.currentLocation.pathname !== args.nextLocation.pathname,
      [dirty],
    ),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    Modal.confirm({
      title: t('supplierPortal.leavePageTitle'),
      content: t('supplierPortal.leavePageContent'),
      okText: t('supplierPortal.leave'),
      cancelText: t('supplierPortal.continueEdit'),
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
  }, [blocker, t]);

  /** 完整性校验 */
  const validate = (): boolean => {
    const nextErrors: Record<string, Set<string>> = {};
    formItems.forEach((item) => {
      const set = new Set<string>();
      if (item.unitPrice === undefined || item.unitPrice <= 0) set.add('unitPrice');
      if (item.deliveryDays === undefined || item.deliveryDays <= 0) set.add('deliveryDays');
      if (set.size > 0) nextErrors[item.inquiryItemId] = set;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setAttemptedSubmit(true);
      notifyError(t('supplierPortal.validateError'));
      return false;
    }
    return true;
  };

  /** 暂存报价 */
  const handleSaveDraft = async () => {
    setSubmitting(true);
    try {
      await portalApi.saveQuotationDraft(invitationToken, buildPayload());
      lastSavedSignatureRef.current = computeSignature(formItems, remark);
      saveGenRef.current += 1;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      setDirty(false);
      setSaveState('saved');
      setLastSavedAt(dayjs().format('HH:mm:ss'));
      notifySuccess(t('supplierPortal.draftSaved'));
    } catch (e) {
      notifyError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  /** 正式提交：校验通过后先打开提交前预览 Modal，核对无误后确认提交（Task 17） */
  const handleSubmit = () => {
    if (expired) {
      notifyError(t('supplierPortal.deadlinePassedSubmit'));
      return;
    }
    if (!validate()) return;
    setPreviewOpen(true);
  };

  /** 确认提交（预览 Modal 的「确认提交」回调） */
  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const result = await portalApi.submitQuotation(invitationToken, {
        ...buildPayload(),
        idempotencyKey: crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      });
      setReceipt(result);
      setPhase('submitted');
      notifySuccess(t('supplierPortal.submitSuccessMsg'));
    } catch (e) {
      notifyError(getErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  /** 重新报价（撤销提交） */
  const handleRevise = () => {
    confirmAction({
      title: t('supplierPortal.reviseConfirmTitle'),
      content: t('supplierPortal.reviseConfirmContent'),
      okText: t('supplierPortal.reviseBtn'),
      onOk: async () => {
        setSubmitting(true);
        try {
          await portalApi.reviseQuotation(invitationToken);
          notifySuccess(t('supplierPortal.reviseSuccess'));
          await loadValidData(invitationToken);
        } catch (e) {
          notifyError(getErrorMessage(e));
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  /** 重置表单 */
  const handleReset = () => {
    confirmAction({
      title: t('supplierPortal.confirmResetTitle'),
      content: t('supplierPortal.confirmResetContent'),
      okText: t('supplierPortal.confirmResetOk'),
      danger: true,
      onOk: () => {
        if (!inquiry) return;
        setFormItems(inquiry.items.map((it) => createEmptyItem(it)));
        setRemark('');
        setErrors({});
        setSelectedRowKeys([]);
        notifySuccess(t('supplierPortal.resetSuccess'));
      },
    });
  };

  // ===== Task 16-5：批量设置 =====
  const applyBatch = <K extends keyof QuotationFormItem>(field: K, value: QuotationFormItem[K]) => {
    const targets =
      selectedRowKeys.length > 0
        ? selectedRowKeys.map(String)
        : formItems.map((i) => i.inquiryItemId);
    if (targets.length === 0) return;
    setFormItems((prev) =>
      prev.map((it) => (targets.includes(it.inquiryItemId) ? { ...it, [field]: value } : it)),
    );
    setSelectedRowKeys([]);
  };

  // ===== Task 16-6：Excel 模板列定义 =====
  const templateColumns = useMemo(
    () => [
      { key: 'code', label: t('material.list.code') },
      { key: 'name', label: t('material.list.name') },
      { key: 'unitPrice', label: t('supplierPortal.materialUnitPrice') },
      { key: 'taxRate', label: t('supplierPortal.taxRate') },
      { key: 'deliveryDays', label: t('supplierPortal.deliveryDaysCol') },
      { key: 'deliveryDate', label: t('supplierPortal.deliveryDateCol') },
      { key: 'brand', label: t('supplierPortal.brand') },
      { key: 'warrantyMonths', label: t('supplierPortal.warrantyMonthsCol') },
      { key: 'paymentTerms', label: t('supplierPortal.paymentTerms') },
      { key: 'validUntil', label: t('supplierPortal.validUntil') },
      { key: 'techDeviation', label: t('supplierPortal.techDeviationDesc') },
      { key: 'commercialDeviation', label: t('supplierPortal.commercialDeviationDesc') },
      { key: 'remark', label: t('supplierPortal.remark') },
    ],
    [t],
  );

  /** 导出待填报价模板（CSV） */
  const exportTemplate = () => {
    if (!inquiry) return;
    const header = templateColumns.map((c) => c.label);
    const rows = formItems.map((f) => {
      const it = inquiry.items.find((i) => i.id === f.inquiryItemId);
      return [
        it?.code ?? '',
        it?.name ?? '',
        f.unitPrice ?? '',
        f.taxRate != null ? String(f.taxRate * 100) : '',
        f.deliveryDays ?? '',
        f.deliveryDate ? f.deliveryDate.format('YYYY-MM-DD') : '',
        f.brand ?? '',
        f.warrantyMonths ?? '',
        f.paymentTerms ?? '',
        f.validUntil ? f.validUntil.format('YYYY-MM-DD') : '',
        f.techDeviation ?? '',
        f.commercialDeviation ?? '',
        f.remark ?? '',
      ];
    });
    downloadTextFile(t('supplierPortal.templateFilename'), generateCSV([header, ...rows]));
    notifySuccess(t('supplierPortal.exportTemplateSuccess'));
  };

  /** 从 CSV 导入报价并回填 */
  const handleImportCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const rows = parseCSV(text);
        if (rows.length < 2) {
          notifyError(t('supplierPortal.importParseFailed'));
          return;
        }
        const header = rows[0].map((h) => h.trim());
        const colIndex: Record<string, number> = {};
        templateColumns.forEach((col) => {
          const idx = header.indexOf(col.label);
          if (idx >= 0) colIndex[col.key] = idx;
        });
        if (colIndex.name === undefined && colIndex.code === undefined) {
          notifyError(t('supplierPortal.importParseFailed'));
          return;
        }
        const toNum = (v: string | undefined): number | undefined => {
          if (v === undefined || v.trim() === '') return undefined;
          const n = Number(v.replace(/[^\d.-]/g, ''));
          return Number.isFinite(n) ? n : undefined;
        };
        let count = 0;
        setFormItems((prev) =>
          prev.map((item) => {
            const it = inquiry?.items.find((i) => i.id === item.inquiryItemId);
            const row = rows.slice(1).find((r) => {
              const code = colIndex.code !== undefined ? (r[colIndex.code] ?? '').trim() : '';
              const name = colIndex.name !== undefined ? (r[colIndex.name] ?? '').trim() : '';
              return Boolean(code && it?.code === code) || Boolean(name && it?.name === name);
            });
            if (!row) return item;
            count += 1;
            const col = (key: string): string | undefined =>
              colIndex[key] !== undefined ? row[colIndex[key]] : undefined;
            const dateStr = col('deliveryDate');
            const validStr = col('validUntil');
            return {
              ...item,
              unitPrice:
                colIndex.unitPrice !== undefined ? toNum(col('unitPrice')) : item.unitPrice,
              taxRate:
                colIndex.taxRate !== undefined ? (toNum(col('taxRate')) ?? 0) / 100 : item.taxRate,
              deliveryDays:
                colIndex.deliveryDays !== undefined
                  ? toNum(col('deliveryDays'))
                  : item.deliveryDays,
              deliveryDate: dateStr && dateStr.trim() ? dayjs(dateStr.trim()) : item.deliveryDate,
              brand: colIndex.brand !== undefined ? (col('brand') ?? '').trim() : item.brand,
              warrantyMonths:
                colIndex.warrantyMonths !== undefined
                  ? toNum(col('warrantyMonths'))
                  : item.warrantyMonths,
              paymentTerms:
                colIndex.paymentTerms !== undefined
                  ? (col('paymentTerms') ?? '').trim()
                  : item.paymentTerms,
              validUntil: validStr && validStr.trim() ? dayjs(validStr.trim()) : item.validUntil,
              techDeviation:
                colIndex.techDeviation !== undefined
                  ? (col('techDeviation') ?? '').trim()
                  : item.techDeviation,
              commercialDeviation:
                colIndex.commercialDeviation !== undefined
                  ? (col('commercialDeviation') ?? '').trim()
                  : item.commercialDeviation,
              remark: colIndex.remark !== undefined ? (col('remark') ?? '').trim() : item.remark,
            };
          }),
        );
        notifySuccess(
          count > 0
            ? t('supplierPortal.importSuccess', { count })
            : t('supplierPortal.importNoMatch'),
        );
      } catch (_e) {
        notifyError(t('supplierPortal.importParseFailed'));
      }
    };
    reader.onerror = () => notifyError(t('supplierPortal.importParseFailed'));
    reader.readAsText(file);
  };

  /** 从上一轮报价复制（前端实现：重新拉取当前草稿覆盖表单） */
  const handleCopyPrevious = async () => {
    try {
      const draft = await portalApi.getCurrentQuotation(invitationToken);
      if (!draft || draft.items.length === 0) {
        notifyError(t('supplierPortal.copyPreviousEmpty'));
        return;
      }
      setFormItems((prev) =>
        prev.map((f) => {
          const q = draft.items.find((d) => d.inquiryItemId === f.inquiryItemId);
          if (!q) return f;
          return {
            ...f,
            unitPrice: q.unitPrice,
            taxRate: q.taxRate,
            moq: q.moq ?? undefined,
            deliveryDays: q.deliveryDays,
            deliveryDate: q.deliveryDate ? dayjs(q.deliveryDate) : null,
            brand: q.brand || '',
            warrantyMonths: q.warrantyMonths ?? undefined,
            paymentTerms: q.paymentTerms || f.paymentTerms,
            validUntil: q.validUntil ? dayjs(q.validUntil) : null,
            techDeviation: q.techDeviation || '',
            commercialDeviation: q.commercialDeviation || '',
            remark: q.remark || '',
          };
        }),
      );
      setRemark(draft.remark || '');
      notifySuccess(t('supplierPortal.copyPreviousSuccess'));
    } catch (e) {
      notifyError(getErrorMessage(e));
    }
  };

  /** 附件上传：尺寸 / MIME 校验 */
  const validateUploadFile = (file: File): boolean => {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED = [
      'image/png',
      'image/jpeg',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ];
    if (file.size > MAX_SIZE) {
      notifyError(t('supplierPortal.uploadTooLarge'));
      return false;
    }
    if (!ALLOWED.includes(file.type)) {
      notifyError(t('supplierPortal.uploadTypeInvalid'));
      return false;
    }
    return true;
  };

  /** 上传附件（真实上传，支持进度回调） */
  const uploadQuotationAttachment = async (
    record: QuotationFormItem,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<boolean> => {
    if (!validateUploadFile(file)) return false;
    try {
      // 优先使用草稿中的报价明细 id，否则退回询价明细 id
      const ownerId = record.inquiryItemId;
      const data = await portalApi.uploadAttachment(
        invitationToken,
        'quotation_item',
        ownerId,
        file,
        onProgress,
      );
      const attachment = {
        id: data.id,
        name: data.name,
        url: data.url,
        size: data.size,
        uploadTime: data.uploadTime,
      };
      updateField(record.inquiryItemId, 'attachments', [...record.attachments, attachment]);
      return true;
    } catch (e) {
      notifyError(getErrorMessage(e));
      return false;
    }
  };

  /** 删除附件 */
  const deleteQuotationAttachment = async (
    record: QuotationFormItem,
    attachmentId: string,
  ): Promise<void> => {
    try {
      await portalApi.deleteAttachment(invitationToken, attachmentId);
      updateField(
        record.inquiryItemId,
        'attachments',
        record.attachments.filter((a) => a.id !== attachmentId),
      );
    } catch (e) {
      notifyError(getErrorMessage(e));
    }
  };

  // ===== Task 16-4：错误定位（滚动 + 高亮） =====
  const focusField = (id: string, field: string) => {
    setHighlight({ id, field });
    const el = document.getElementById(`${id}-${field}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlight(null), 2000);
  };

  const getItemName = (id: string): string => {
    const it = inquiry?.items.find((i) => i.id === id);
    return it?.name ?? id;
  };

  const isHighlighted = (record: QuotationFormItem, field: string): boolean =>
    Boolean(highlight && highlight.id === record.inquiryItemId && highlight.field === field);

  const highlightStyle = (record: QuotationFormItem, field: string) =>
    isHighlighted(record, field) ? { boxShadow: '0 0 0 2px var(--color-primary)' } : undefined;

  // ===== Task 16-8：下载回执（文本） =====
  const downloadReceipt = () => {
    if (!receipt) return;
    const lines = [
      t('supplierPortal.receiptDownloadTitle'),
      `${t('supplierPortal.receiptCodeLabel')} ${receipt.receiptCode}`,
      `${t('supplierPortal.receiptSubmittedAtLabel')} ${formatDateTime(receipt.submittedAt)}`,
      `${t('supplierPortal.receiptTotalLabel')} ${formatCurrency(receipt.totalAmount)}`,
    ];
    downloadTextFile(
      `${t('supplierPortal.receiptFilename')}_${receipt.receiptCode}.txt`,
      lines.join('\n'),
      'text/plain;charset=utf-8',
    );
    notifySuccess(t('supplierPortal.receiptDownloadSuccess'));
  };

  /** 加载中 */
  if (phase === 'loading') {
    return (
      <div style={{ textAlign: 'center', padding: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  /** 邀请已撤销 */
  if (phase === 'revoked') {
    return (
      <Card>
        <Result
          status="warning"
          title={t('supplierPortal.revokedTitle')}
          subTitle={t('supplierPortal.revokedSubTitle')}
        />
      </Card>
    );
  }

  /** 邀请已过期 */
  if (phase === 'expired') {
    return (
      <Card>
        <Result
          status="error"
          title={t('supplierPortal.expiredTitle')}
          subTitle={t('supplierPortal.expiredSubTitle')}
        />
      </Card>
    );
  }

  /** 询价已截止 / 已取消 */
  if (phase === 'terminal') {
    return (
      <Card>
        <Result
          status="error"
          title={t('supplierPortal.terminalTitle')}
          subTitle={t('supplierPortal.terminalSubTitle')}
        />
      </Card>
    );
  }

  /** 加载失败 / API 错误 */
  if (phase === 'error') {
    return (
      <Card>
        <Result
          status="error"
          title={t('supplierPortal.loadFailedTitle')}
          subTitle={errorMessage || t('supplierPortal.loadFailedSubTitle')}
        />
      </Card>
    );
  }

  /** 已提交 / 回执页 */
  if (phase === 'submitted') {
    return (
      <Card>
        <QuotationSteps submitted />
        <Result
          status="success"
          title={t('supplierPortal.receiptTitle')}
          subTitle={
            invitation
              ? t('supplierPortal.submittedSubTitle', { code: invitation.inquiryCode })
              : undefined
          }
          extra={
            <Space direction="vertical" align="center" size={12}>
              {receipt && (
                <div style={{ textAlign: 'left' }}>
                  <div>
                    <Text type="secondary">{t('supplierPortal.receiptCodeLabel')}</Text>
                    <Text strong>{receipt.receiptCode}</Text>
                  </div>
                  <div>
                    <Text type="secondary">{t('supplierPortal.receiptSubmittedAtLabel')}</Text>
                    <Text>{formatDateTime(receipt.submittedAt)}</Text>
                  </div>
                  <div>
                    <Text type="secondary">{t('supplierPortal.receiptTotalLabel')}</Text>
                    <Text strong>{formatCurrency(receipt.totalAmount)}</Text>
                  </div>
                </div>
              )}
              <Space>
                <Button icon={<DownloadOutlined />} onClick={downloadReceipt} disabled={!receipt}>
                  {t('supplierPortal.downloadReceipt')}
                </Button>
                <Button icon={<ReloadOutlined />} onClick={handleRevise} loading={submitting}>
                  {t('supplierPortal.reviseBtn')}
                </Button>
              </Space>
            </Space>
          }
        />
      </Card>
    );
  }

  // ===== 有效状态：报价表单 =====
  if (!inquiry) {
    return (
      <Card>
        <Result
          status="error"
          title={t('supplierPortal.loadFailedTitle')}
          subTitle={t('supplierPortal.loadFailedSubTitle')}
        />
      </Card>
    );
  }

  /** 询价物料只读表格列 */
  const inquiryItemColumns: ColumnsType<PortalInquiryItem> = [
    { title: t('material.list.name'), dataIndex: 'name', width: 140, fixed: 'left' },
    { title: t('material.list.code'), dataIndex: 'code', width: 120 },
    { title: t('material.list.categoryShort'), dataIndex: 'category', width: 100 },
    { title: t('material.list.brand'), dataIndex: 'brand', width: 100 },
    { title: t('material.list.spec'), dataIndex: 'spec', width: 140 },
    { title: t('material.list.techParams'), dataIndex: 'techParams', width: 220 },
    { title: t('material.list.unit'), dataIndex: 'unit', width: 70 },
    {
      title: t('inquiry.create.material.quantity'),
      dataIndex: 'quantity',
      width: 90,
      align: 'right',
    },
    {
      title: t('supplierPortal.targetPrice'),
      dataIndex: 'targetPrice',
      width: 100,
      align: 'right',
      render: (v?: number) => (v != null ? formatCurrency(v, inquiry.currency as never) : '-'),
    },
  ];

  /** 报价填写表格列 */
  const quotationColumns: ColumnsType<QuotationFormItem> = [
    {
      title: t('material.list.name'),
      dataIndex: 'inquiryItemId',
      width: 130,
      fixed: 'left',
      render: (_, record) => {
        const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{it?.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {it?.code}
            </Text>
          </div>
        );
      },
    },
    {
      title: t('inquiry.create.material.quantity'),
      key: 'quantity',
      width: 90,
      align: 'right',
      render: (_, record) => {
        const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
        return `${it?.quantity ?? 0} ${it?.unit ?? ''}`;
      },
    },
    {
      title: t('supplierPortal.materialUnitPrice'),
      key: 'unitPrice',
      width: 130,
      render: (_, record) => {
        const hasErr = errors[record.inquiryItemId]?.has('unitPrice');
        const errId = `${record.inquiryItemId}-unitPrice-error`;
        return (
          <div>
            <InputNumber
              id={`${record.inquiryItemId}-unitPrice`}
              value={record.unitPrice}
              min={0}
              precision={2}
              style={{ width: '100%', ...highlightStyle(record, 'unitPrice') }}
              placeholder={t('common.required')}
              status={hasErr ? 'error' : undefined}
              aria-label={t('supplierPortal.materialUnitPrice')}
              aria-invalid={hasErr || undefined}
              aria-describedby={hasErr ? errId : undefined}
              onChange={(v) => updateField(record.inquiryItemId, 'unitPrice', v ?? undefined)}
            />
            {hasErr && (
              <div id={errId} style={{ fontSize: 12, color: 'var(--color-error)' }}>
                {t(`supplierPortal.errorField.unitPrice`)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: t('supplierPortal.taxRate'),
      key: 'taxRate',
      width: 100,
      render: (_, record) => (
        <Select
          id={`${record.inquiryItemId}-taxRate`}
          value={record.taxRate}
          style={{ width: '100%' }}
          options={TAX_RATE_OPTIONS}
          aria-label={t('supplierPortal.taxRate')}
          onChange={(v) => updateField(record.inquiryItemId, 'taxRate', v)}
        />
      ),
    },
    {
      title: t('supplierPortal.taxIncludedTotal'),
      key: 'taxIncludedTotal',
      width: 120,
      align: 'right',
      render: (_, record) => {
        const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
        const total = calcItemTotal(record.unitPrice, it?.quantity ?? 0);
        return <Text strong>{formatCurrency(total, inquiry.currency as never)}</Text>;
      },
    },
    {
      title: t('supplierPortal.moq'),
      key: 'moq',
      width: 110,
      render: (_, record) => (
        <InputNumber
          id={`${record.inquiryItemId}-moq`}
          value={record.moq}
          min={0}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.optional')}
          aria-label={t('supplierPortal.moq')}
          onChange={(v) => updateField(record.inquiryItemId, 'moq', v ?? undefined)}
        />
      ),
    },
    {
      title: t('supplierPortal.deliveryDaysCol'),
      key: 'deliveryDays',
      width: 130,
      render: (_, record) => {
        const hasErr = errors[record.inquiryItemId]?.has('deliveryDays');
        const errId = `${record.inquiryItemId}-deliveryDays-error`;
        return (
          <div>
            <InputNumber
              id={`${record.inquiryItemId}-deliveryDays`}
              value={record.deliveryDays}
              min={0}
              style={{ width: '100%', ...highlightStyle(record, 'deliveryDays') }}
              placeholder={t('common.required')}
              status={hasErr ? 'error' : undefined}
              aria-label={t('supplierPortal.deliveryDaysCol')}
              aria-invalid={hasErr || undefined}
              aria-describedby={hasErr ? errId : undefined}
              onChange={(v) => updateField(record.inquiryItemId, 'deliveryDays', v ?? undefined)}
            />
            {hasErr && (
              <div id={errId} style={{ fontSize: 12, color: 'var(--color-error)' }}>
                {t(`supplierPortal.errorField.deliveryDays`)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: t('supplierPortal.deliveryDateCol'),
      key: 'deliveryDate',
      width: 160,
      render: (_, record) => (
        <DatePicker
          id={`${record.inquiryItemId}-deliveryDate`}
          value={record.deliveryDate}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.selectDate')}
          aria-label={t('supplierPortal.deliveryDateCol')}
          onChange={(d) =>
            updateField(record.inquiryItemId, 'deliveryDate', d as dayjs.Dayjs | null)
          }
        />
      ),
    },
    {
      title: t('supplierPortal.brand'),
      key: 'brand',
      width: 120,
      render: (_, record) => (
        <Input
          id={`${record.inquiryItemId}-brand`}
          value={record.brand}
          placeholder={t('supplierPortal.brand')}
          aria-label={t('supplierPortal.brand')}
          onChange={(e) => updateField(record.inquiryItemId, 'brand', e.target.value)}
        />
      ),
    },
    {
      title: t('supplierPortal.warrantyMonthsCol'),
      key: 'warrantyMonths',
      width: 110,
      render: (_, record) => (
        <InputNumber
          id={`${record.inquiryItemId}-warrantyMonths`}
          value={record.warrantyMonths}
          min={0}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.optional')}
          aria-label={t('supplierPortal.warrantyMonthsCol')}
          onChange={(v) => updateField(record.inquiryItemId, 'warrantyMonths', v ?? undefined)}
        />
      ),
    },
    {
      title: t('supplierPortal.paymentTerms'),
      key: 'paymentTerms',
      width: 180,
      render: (_, record) => (
        <Select
          id={`${record.inquiryItemId}-paymentTerms`}
          value={record.paymentTerms}
          style={{ width: '100%' }}
          options={PAYMENT_TERMS_OPTIONS}
          aria-label={t('supplierPortal.paymentTerms')}
          onChange={(v) => updateField(record.inquiryItemId, 'paymentTerms', v)}
        />
      ),
    },
    {
      title: t('supplierPortal.validUntil'),
      key: 'validUntil',
      width: 160,
      render: (_, record) => (
        <DatePicker
          id={`${record.inquiryItemId}-validUntil`}
          value={record.validUntil}
          style={{ width: '100%' }}
          placeholder={t('supplierPortal.selectDate')}
          aria-label={t('supplierPortal.validUntil')}
          onChange={(d) => updateField(record.inquiryItemId, 'validUntil', d as dayjs.Dayjs | null)}
        />
      ),
    },
    {
      title: t('supplierPortal.techDeviationDesc'),
      key: 'techDeviation',
      width: 160,
      render: (_, record) => (
        <Input
          id={`${record.inquiryItemId}-techDeviation`}
          value={record.techDeviation}
          placeholder={t('supplierPortal.noDeviationPlaceholder')}
          aria-label={t('supplierPortal.techDeviationDesc')}
          onChange={(e) => updateField(record.inquiryItemId, 'techDeviation', e.target.value)}
        />
      ),
    },
    {
      title: t('supplierPortal.commercialDeviationDesc'),
      key: 'commercialDeviation',
      width: 160,
      render: (_, record) => (
        <Input
          id={`${record.inquiryItemId}-commercialDeviation`}
          value={record.commercialDeviation}
          placeholder={t('supplierPortal.noDeviationPlaceholder')}
          aria-label={t('supplierPortal.commercialDeviationDesc')}
          onChange={(e) => updateField(record.inquiryItemId, 'commercialDeviation', e.target.value)}
        />
      ),
    },
    {
      title: t('supplierPortal.remark'),
      key: 'remark',
      width: 160,
      render: (_, record) => (
        <Input
          id={`${record.inquiryItemId}-remark`}
          value={record.remark}
          placeholder={t('supplierPortal.remark')}
          aria-label={t('supplierPortal.remark')}
          onChange={(e) => updateField(record.inquiryItemId, 'remark', e.target.value)}
        />
      ),
    },
    {
      title: t('common.attachments'),
      key: 'attachments',
      width: 160,
      render: (_, record) => (
        <Upload
          fileList={
            record.attachments.map((a) => ({
              uid: a.id,
              name: a.name,
              status: 'done',
              url: a.url,
            })) as UploadFile[]
          }
          customRequest={async ({ file, onProgress, onSuccess, onError }) => {
            const ok = await uploadQuotationAttachment(record, file as File, (percent) => {
              onProgress?.({ percent });
            });
            if (ok) {
              onSuccess?.({});
            } else {
              onError?.(new Error('upload failed'));
            }
          }}
          onPreview={(file) => {
            // 下载端点需携带邀请 token（query 参数）
            const base = file.url || '';
            const sep = base.includes('?') ? '&' : '?';
            window.open(
              `${base}${sep}token=${encodeURIComponent(invitationToken)}`,
              '_blank',
              'noopener',
            );
          }}
          onRemove={(file) => {
            void deleteQuotationAttachment(record, file.uid);
          }}
          itemRender={(originNode, file, _fileList, actions) => {
            // 上传失败时提供重试按钮（移除失败项后重新上传原始文件）
            if (file.status === 'error') {
              return (
                <Space size={4}>
                  {originNode}
                  <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    title={t('supplierPortal.uploadRetry')}
                    onClick={() => {
                      const origin = file.originFileObj as File | undefined;
                      actions.remove();
                      if (origin) {
                        void uploadQuotationAttachment(record, origin);
                      }
                    }}
                  />
                </Space>
              );
            }
            return originNode;
          }}
          multiple
        >
          <Button size="small" icon={<PaperClipOutlined />}>
            {t('common.upload')}
          </Button>
        </Upload>
      ),
    },
  ];

  // ===== Task 16-7：移动端物料卡片 =====
  const renderMobileItemCard = (record: QuotationFormItem) => {
    const it = inquiry.items.find((i) => i.id === record.inquiryItemId);
    const hasErr = (f: string) => errors[record.inquiryItemId]?.has(f);
    const fieldStyle = (f: string) => highlightStyle(record, f);
    const label = (text: string) => (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {text}
      </Text>
    );
    return (
      <Card key={record.inquiryItemId} size="small" styles={{ body: { padding: 12 } }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
        >
          <div style={{ minWidth: 0 }}>
            <Text strong>{it?.name}</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {it?.code} · {it?.spec}
              </Text>
            </div>
          </div>
          <Tag color="blue">
            {t('inquiry.create.material.quantity')} {it?.quantity ?? 0} {it?.unit ?? ''}
          </Tag>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            marginTop: 10,
          }}
        >
          <div>
            {label(t('supplierPortal.materialUnitPrice'))}
            <InputNumber
              id={`${record.inquiryItemId}-unitPrice`}
              value={record.unitPrice}
              min={0}
              precision={2}
              style={{ width: '100%', ...fieldStyle('unitPrice') }}
              status={hasErr('unitPrice') ? 'error' : undefined}
              aria-label={t('supplierPortal.materialUnitPrice')}
              onChange={(v) => updateField(record.inquiryItemId, 'unitPrice', v ?? undefined)}
            />
          </div>
          <div>
            {label(t('supplierPortal.taxRate'))}
            <Select
              id={`${record.inquiryItemId}-taxRate`}
              value={record.taxRate}
              style={{ width: '100%' }}
              options={TAX_RATE_OPTIONS}
              aria-label={t('supplierPortal.taxRate')}
              onChange={(v) => updateField(record.inquiryItemId, 'taxRate', v)}
            />
          </div>
          <div>
            {label(t('supplierPortal.deliveryDaysCol'))}
            <InputNumber
              id={`${record.inquiryItemId}-deliveryDays`}
              value={record.deliveryDays}
              min={0}
              style={{ width: '100%', ...fieldStyle('deliveryDays') }}
              status={hasErr('deliveryDays') ? 'error' : undefined}
              aria-label={t('supplierPortal.deliveryDaysCol')}
              onChange={(v) => updateField(record.inquiryItemId, 'deliveryDays', v ?? undefined)}
            />
          </div>
          <div>
            {label(t('supplierPortal.deliveryDateCol'))}
            <DatePicker
              id={`${record.inquiryItemId}-deliveryDate`}
              value={record.deliveryDate}
              style={{ width: '100%' }}
              placeholder={t('supplierPortal.selectDate')}
              aria-label={t('supplierPortal.deliveryDateCol')}
              onChange={(d) =>
                updateField(record.inquiryItemId, 'deliveryDate', d as dayjs.Dayjs | null)
              }
            />
          </div>
          <div>
            {label(t('supplierPortal.moq'))}
            <InputNumber
              id={`${record.inquiryItemId}-moq`}
              value={record.moq}
              min={0}
              style={{ width: '100%' }}
              placeholder={t('supplierPortal.optional')}
              aria-label={t('supplierPortal.moq')}
              onChange={(v) => updateField(record.inquiryItemId, 'moq', v ?? undefined)}
            />
          </div>
          <div>
            {label(t('supplierPortal.warrantyMonthsCol'))}
            <InputNumber
              id={`${record.inquiryItemId}-warrantyMonths`}
              value={record.warrantyMonths}
              min={0}
              style={{ width: '100%' }}
              placeholder={t('supplierPortal.optional')}
              aria-label={t('supplierPortal.warrantyMonthsCol')}
              onChange={(v) => updateField(record.inquiryItemId, 'warrantyMonths', v ?? undefined)}
            />
          </div>
          <div>
            {label(t('supplierPortal.brand'))}
            <Input
              id={`${record.inquiryItemId}-brand`}
              value={record.brand}
              placeholder={t('supplierPortal.brand')}
              aria-label={t('supplierPortal.brand')}
              onChange={(e) => updateField(record.inquiryItemId, 'brand', e.target.value)}
            />
          </div>
          <div>
            {label(t('supplierPortal.paymentTerms'))}
            <Select
              id={`${record.inquiryItemId}-paymentTerms`}
              value={record.paymentTerms}
              style={{ width: '100%' }}
              options={PAYMENT_TERMS_OPTIONS}
              aria-label={t('supplierPortal.paymentTerms')}
              onChange={(v) => updateField(record.inquiryItemId, 'paymentTerms', v)}
            />
          </div>
          <div>
            {label(t('supplierPortal.validUntil'))}
            <DatePicker
              id={`${record.inquiryItemId}-validUntil`}
              value={record.validUntil}
              style={{ width: '100%' }}
              placeholder={t('supplierPortal.selectDate')}
              aria-label={t('supplierPortal.validUntil')}
              onChange={(d) =>
                updateField(record.inquiryItemId, 'validUntil', d as dayjs.Dayjs | null)
              }
            />
          </div>
          <div>
            {label(t('supplierPortal.techDeviationDesc'))}
            <Input
              id={`${record.inquiryItemId}-techDeviation`}
              value={record.techDeviation}
              placeholder={t('supplierPortal.noDeviationPlaceholder')}
              aria-label={t('supplierPortal.techDeviationDesc')}
              onChange={(e) => updateField(record.inquiryItemId, 'techDeviation', e.target.value)}
            />
          </div>
          <div>
            {label(t('supplierPortal.commercialDeviationDesc'))}
            <Input
              id={`${record.inquiryItemId}-commercialDeviation`}
              value={record.commercialDeviation}
              placeholder={t('supplierPortal.noDeviationPlaceholder')}
              aria-label={t('supplierPortal.commercialDeviationDesc')}
              onChange={(e) =>
                updateField(record.inquiryItemId, 'commercialDeviation', e.target.value)
              }
            />
          </div>
          <div>
            {label(t('supplierPortal.remark'))}
            <Input
              id={`${record.inquiryItemId}-remark`}
              value={record.remark}
              placeholder={t('supplierPortal.remark')}
              aria-label={t('supplierPortal.remark')}
              onChange={(e) => updateField(record.inquiryItemId, 'remark', e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Text type="secondary">{t('common.attachments')}</Text>
          <Upload
            fileList={
              record.attachments.map((a) => ({
                uid: a.id,
                name: a.name,
                status: 'done',
                url: a.url,
              })) as UploadFile[]
            }
            customRequest={async ({ file, onProgress, onSuccess, onError }) => {
              const ok = await uploadQuotationAttachment(record, file as File, (percent) => {
                onProgress?.({ percent });
              });
              if (ok) {
                onSuccess?.({});
              } else {
                onError?.(new Error('upload failed'));
              }
            }}
            onPreview={(file) => {
              const base = file.url || '';
              const sep = base.includes('?') ? '&' : '?';
              window.open(
                `${base}${sep}token=${encodeURIComponent(invitationToken)}`,
                '_blank',
                'noopener',
              );
            }}
            onRemove={(file) => {
              void deleteQuotationAttachment(record, file.uid);
            }}
            multiple
          >
            <Button size="small" icon={<PaperClipOutlined />}>
              {t('common.upload')}
            </Button>
          </Upload>
        </div>
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <Text type="secondary">{t('supplierPortal.taxIncludedTotal')}</Text>{' '}
          <Text strong>
            {formatCurrency(
              calcItemTotal(record.unitPrice, it?.quantity ?? 0),
              inquiry.currency as never,
            )}
          </Text>
        </div>
      </Card>
    );
  };

  return (
    <Space
      direction="vertical"
      size={16}
      style={{ width: '100%', paddingBottom: isMobile ? 72 : 0 }}
    >
      {/* Task 16-1：步骤条 */}
      <QuotationSteps submitted={false} />

      {/* 顶部信息 */}
      <Card styles={{ body: { padding: 16 } }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <Space align="center" size={12}>
              <Title level={4} style={{ margin: 0 }}>
                {invitation?.supplierName || t('supplierPortal.platformTitle')}
              </Title>
              <Tag color="blue">{t('supplierPortal.fillTag')}</Tag>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text strong>{t('supplierPortal.inquirySubjectLabel')}</Text>
              <Text>{inquiry.subject}</Text>
              <Text type="secondary" style={{ marginLeft: 16 }}>
                {t('supplierPortal.codeLabel')}
                {inquiry.code}
              </Text>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              <Text type="secondary">{t('supplierPortal.deadlineLabel')}</Text>
              <Text strong>{formatDateTime(inquiry.deadline)}</Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Tag color={expired ? 'red' : remaining.urgent ? 'orange' : 'green'}>
                {remaining.text}
              </Tag>
            </div>
          </div>
        </div>
      </Card>

      {/* 超时警告 */}
      {expired && (
        <Alert
          type="error"
          showIcon
          message={t('supplierPortal.deadlinePassedSubmit')}
          description={t('supplierPortal.deadlineAlertDesc')}
        />
      )}

      {/* Task 16-3：草稿恢复提示 */}
      {draftLoaded && (
        <Alert
          type="info"
          showIcon
          message={t('supplierPortal.draftLoadedTitle')}
          description={t('supplierPortal.draftLoadedDesc')}
        />
      )}

      {/* 询价基本信息 */}
      <Card title={t('supplierPortal.inquiryBasicInfo')} styles={{ body: { padding: 16 } }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
          <Descriptions.Item label={t('inquiry.detail.organization')}>
            {inquiry.organization}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.currency')}>
            {t(`enum.currency.${inquiry.currency}`)}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.expectedDeliveryDate')}>
            {formatDate(inquiry.expectedDeliveryDate)}
          </Descriptions.Item>
          <Descriptions.Item label={t('supplierPortal.deliveryAddress')} span={2}>
            {inquiry.deliveryAddress}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.contact')}>
            {inquiry.contact}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.paymentTerms')} span={2}>
            {inquiry.paymentTerms}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.invoiceRequirement')}>
            {inquiry.invoiceRequirement || '-'}
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.detail.description')} span={3}>
            {inquiry.description || '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 采购物料明细 */}
      <Card title={t('supplierPortal.purchaseMaterialList')} styles={{ body: { padding: 16 } }}>
        <Table<PortalInquiryItem>
          rowKey="id"
          size="small"
          columns={inquiryItemColumns}
          dataSource={inquiry.items}
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      {/* 技术附件 / 询价附件 */}
      <Card title={t('supplierPortal.inquiryAttachments')} styles={{ body: { padding: 16 } }}>
        {inquiry.attachments.length > 0 ? (
          <List
            size="small"
            dataSource={inquiry.attachments}
            renderItem={(a) => (
              <List.Item>
                <Space>
                  <PaperClipOutlined />
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.name}
                  </a>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {(a.size / 1024).toFixed(1)} KB · {formatDateTime(a.uploadTime)}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty
            description={t('supplierPortal.noAttachments')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          <Text strong>{t('supplierPortal.deliveryRequirement')}</Text>
          {inquiry.deliveryAddress}，{t('inquiry.detail.expectedDeliveryDate')}{' '}
          {formatDate(inquiry.expectedDeliveryDate)}。
        </Paragraph>
      </Card>

      {/* 报价填写表单 */}
      <Card
        title={t('supplierPortal.fillQuotation')}
        styles={{ body: { padding: 16 } }}
        extra={
          <Space direction="vertical" align="end" size={4}>
            <div>
              <Text type="secondary">{t('supplierPortal.totalAmountLabel')}</Text>
              <Text strong style={{ fontSize: 20, color: 'var(--color-primary)' }}>
                {formatCurrency(totalAmount, inquiry.currency as never)}
              </Text>
            </div>
            <AutoSaveIndicator state={saveState} lastSavedAt={lastSavedAt} />
          </Space>
        }
      >
        {/* 桌面端：批量设置 + Excel 工具 */}
        {!isMobile && (
          <>
            <BatchToolbar
              selectedCount={selectedRowKeys.length}
              onClear={() => setSelectedRowKeys([])}
              onApplyTaxRate={(v) => applyBatch('taxRate', v)}
              onApplyDeliveryDays={(v) => applyBatch('deliveryDays', v)}
              onApplyPaymentTerms={(v) => applyBatch('paymentTerms', v)}
            />
            <div style={{ marginBottom: 12 }}>
              <Space wrap>
                <Button size="small" icon={<DownloadOutlined />} onClick={exportTemplate}>
                  {t('supplierPortal.exportTemplate')}
                </Button>
                <Button
                  size="small"
                  icon={<ImportOutlined />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('supplierPortal.importExcel')}
                </Button>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopyPrevious}>
                  {t('supplierPortal.copyPrevious')}
                </Button>
              </Space>
            </div>
          </>
        )}

        {/* Task 16-4：提交前错误摘要 */}
        <ErrorSummary errors={errors} getItemName={getItemName} onFocus={focusField} />

        {/* 提交校验失败的内联提示（与 toast 并存，便于键盘/读屏用户感知） */}
        {attemptedSubmit && Object.keys(errors).length > 0 && (
          <Alert
            type="error"
            showIcon
            role="alert"
            style={{ marginBottom: 12 }}
            message={t('supplierPortal.validateError')}
          />
        )}

        {/* CSV 导入隐藏输入框 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportCSV(file);
            e.target.value = '';
          }}
        />

        {/* 桌面端表格 / 移动端卡片 */}
        {!isMobile ? (
          <Table<QuotationFormItem>
            rowKey="inquiryItemId"
            size="small"
            columns={quotationColumns}
            dataSource={formItems}
            pagination={false}
            scroll={{ x: 'max-content' }}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {formItems.map(renderMobileItemCard)}
          </Space>
        )}

        <div style={{ marginTop: 16 }}>
          <Text strong>{t('supplierPortal.remarkLabel')}</Text>
          <Input.TextArea
            value={remark}
            rows={2}
            placeholder={t('supplierPortal.remarkPlaceholder')}
            onChange={(e) => setRemark(e.target.value)}
            style={{ marginTop: 8 }}
            aria-label={t('supplierPortal.remarkLabel')}
          />
        </div>

        {/* 桌面端操作栏 */}
        {!isMobile && (
          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
            }}
          >
            <Button icon={<ReloadOutlined />} onClick={handleReset}>
              {t('common.reset')}
            </Button>
            <Button
              icon={<SaveOutlined />}
              onClick={handleSaveDraft}
              disabled={expired || submitting}
              loading={submitting}
            >
              {t('supplierPortal.saveDraft')}
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSubmit}
              disabled={expired || submitting}
              loading={submitting}
            >
              {t('supplierPortal.submitBtn')}
            </Button>
          </div>
        )}
      </Card>

      {/* 移动端底部固定操作栏 */}
      {isMobile && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '10px 12px',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
            background: 'var(--color-card)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            gap: 12,
            zIndex: 100,
          }}
        >
          <Button
            icon={<SaveOutlined />}
            onClick={handleSaveDraft}
            disabled={expired || submitting}
            loading={submitting}
            block
          >
            {t('supplierPortal.saveDraft')}
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSubmit}
            disabled={expired || submitting}
            loading={submitting}
            block
          >
            {t('supplierPortal.submitBtn')}
          </Button>
        </div>
      )}

      {/* 提交前预览 Modal */}
      {inquiry && (
        <SubmitPreviewModal
          open={previewOpen}
          inquiry={inquiry}
          items={formItems}
          remark={remark}
          totalAmount={totalAmount}
          loading={submitting}
          onConfirm={() => void doSubmit()}
          onCancel={() => setPreviewOpen(false)}
        />
      )}
    </Space>
  );
}

/** 解析错误信息为可展示文案 */
function getErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    return e.message || e.code;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}
