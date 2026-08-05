/**
 * 询价单列表（Task 7）
 * 支持多维度筛选、状态可视化、截止时间警示、复制/取消/导出等操作
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Button,
  Card,
  Collapse,
  Col,
  DatePicker,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BellOutlined,
  ClearOutlined,
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  EyeOutlined,
  FilterOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import PageHeader from '@/components/PageHeader';
import Permission from '@/components/Permission';
import { InquiryStatusTag } from '@/components/StatusTag';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useQuery } from '@tanstack/react-query';
import { inquiryApi, type BatchOperationResult } from '@/api';
import { QUERY_KEYS } from '@/lib/queryClient';
import { IS_DEMO_MODE } from '@/config';
import {
  INQUIRY_STATUS_OPTIONS,
  InquiryStatus,
  QuotationStatus,
  type Inquiry,
  type PaginatedInquiries,
} from '@/types';
import { formatDateTime, formatDate, getRemainingTime } from '@/utils/format';
import { confirmAction, notifyError, notifySuccess } from '@/utils/confirm';
import { exportAOA } from '@/utils/excel';
import { isCancelable, isEditable } from '@/utils/inquiryStatus';
import { useIsMobile } from '@/utils/useIsMobile';
import { getMaterialCategoryOptions } from '@/constants/materialCategories';
import TableSettings from '@/components/table/TableSettings';
import {
  DENSITY_TO_SIZE,
  useTablePreferences,
  type TableColumnPref,
} from '@/hooks/useTablePreferences';
import { useSavedViews, type SavedFilterView } from '@/hooks/useSavedViews';
import {
  useBatchInquiries,
  type BatchActionKind,
  type BatchPreviewItem,
} from '@/hooks/useBatchInquiries';

const { RangePicker } = DatePicker;
const { Text } = Typography;

/** 保存视图使用的可序列化筛选条件（Dayjs 序列化为 ISO 字符串） */
interface SavedViewFilter {
  code: string;
  subject: string;
  creator: string;
  status: InquiryStatus[];
  createdAt: [string, string] | null;
  deadline: [string, string] | null;
  category: string | undefined;
}

export default function InquiryListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const copyInquiry = useInquiryStore((s) => s.copyInquiry);
  const cancelInquiry = useInquiryStore((s) => s.cancelInquiry);
  const batchCancelInquiries = useInquiryStore((s) => s.batchCancelInquiries);
  const loading = useInquiryStore((s) => s.loading);
  const quotations = useQuotationStore((s) => s.quotations);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('INQUIRY_EDIT');
  const canCancel = hasPermission('INQUIRY_CANCEL');
  const isMobile = useIsMobile();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  // ===== Task 19：保存筛选视图 + 默认视图 =====
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const viewsApi = useSavedViews<SavedViewFilter>(20);
  const {
    views: savedViews,
    saveView,
    setDefaultView: setViewDefault,
    removeView: removeSavedView,
    getDefaultView,
  } = viewsApi;

  // ===== Task 19：批量操作（发送/提醒/导出/负责人调整）=====
  const batch = useBatchInquiries();
  const [batchKind, setBatchKind] = useState<BatchActionKind | null>(null);
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
  const [batchPreviewItems, setBatchPreviewItems] = useState<BatchPreviewItem[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignOwner, setAssignOwner] = useState('');
  const canSend = hasPermission('INQUIRY_SEND');

  // ===== 筛选状态（输入态，点击查询后写入 applied） =====
  const [filterCode, setFilterCode] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterCreator, setFilterCreator] = useState('');
  const [filterStatus, setFilterStatus] = useState<InquiryStatus[]>([]);
  const [filterCreatedAt, setFilterCreatedAt] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [filterDeadline, setFilterDeadline] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | undefined>(undefined);

  // 已应用的筛选条件（点击查询后生效，与 log 页一致）
  const [applied, setApplied] = useState<{
    code: string;
    subject: string;
    creator: string;
    status: InquiryStatus[];
    createdAt: [Dayjs | null, Dayjs | null] | null;
    deadline: [Dayjs | null, Dayjs | null] | null;
    category: string | undefined;
  }>({
    code: '',
    subject: '',
    creator: '',
    status: [],
    createdAt: null,
    deadline: null,
    category: undefined,
  });

  // E4: 筛选条件持久化到 sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('inquiryFilter');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.createdAt) {
          parsed.createdAt = [
            parsed.createdAt[0] ? dayjs(parsed.createdAt[0]) : null,
            parsed.createdAt[1] ? dayjs(parsed.createdAt[1]) : null,
          ];
        }
        if (parsed.deadline) {
          parsed.deadline = [
            parsed.deadline[0] ? dayjs(parsed.deadline[0]) : null,
            parsed.deadline[1] ? dayjs(parsed.deadline[1]) : null,
          ];
        }
        setApplied(parsed);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem('inquiryFilter', JSON.stringify(applied));
  }, [applied]);

  // ===== P2-12 Task 17：URL 同步筛选/排序/分页状态 =====
  const [searchParams, setSearchParams] = useSearchParams();
  // 服务端分页状态（page/sort 来自 URL，向后兼容：无 page 参数时走客户端全量筛选）
  const serverPage = Number(searchParams.get('page') ?? '1');
  const serverSort = searchParams.get('sort') ?? 'createdAt:desc';

  // 挂载时从 URL 恢复筛选条件（keyword/status/dateFrom/dateTo），与 sessionStorage 取并集
  useEffect(() => {
    const urlKeyword = searchParams.get('keyword');
    const urlStatus = searchParams.get('status');
    const urlFrom = searchParams.get('dateFrom');
    const urlTo = searchParams.get('dateTo');
    setApplied((prev) => ({
      ...prev,
      code: urlKeyword ?? prev.code,
      subject: urlKeyword ?? prev.subject,
      status: urlStatus ? (urlStatus.split(',') as InquiryStatus[]) : prev.status,
      createdAt:
        urlFrom || urlTo
          ? [urlFrom ? dayjs(urlFrom) : null, urlTo ? dayjs(urlTo) : null]
          : prev.createdAt,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 查询后同步 URL（keyword=code|subject、status、dateFrom/dateTo、sort、page）
  const syncUrl = (next: typeof applied, page = 1, sort = serverSort) => {
    const params = new URLSearchParams();
    const keyword = next.code || next.subject;
    if (keyword) params.set('keyword', keyword);
    if (next.status.length > 0) params.set('status', next.status.join(','));
    if (next.createdAt?.[0]) params.set('dateFrom', next.createdAt[0].format('YYYY-MM-DD'));
    if (next.createdAt?.[1]) params.set('dateTo', next.createdAt[1].format('YYYY-MM-DD'));
    if (page > 1) params.set('page', String(page));
    if (sort !== 'createdAt:desc') params.set('sort', sort);
    setSearchParams(params, { replace: true });
  };

  // P2-12 Task 17：服务端分页查询（生产模式启用；演示模式回退客户端全量筛选）
  const serverEnabled = !IS_DEMO_MODE && searchParams.get('page') !== null;
  const keyword = serverEnabled ? applied.code || applied.subject : undefined;
  const statusStr =
    serverEnabled && applied.status.length > 0 ? applied.status.join(',') : undefined;
  const dateFrom =
    serverEnabled && applied.createdAt?.[0] ? applied.createdAt[0].format('YYYY-MM-DD') : undefined;
  const dateTo =
    serverEnabled && applied.createdAt?.[1] ? applied.createdAt[1].format('YYYY-MM-DD') : undefined;
  const { data: serverData, isLoading: serverLoading } = useQuery<PaginatedInquiries>({
    queryKey: [
      QUERY_KEYS.inquiries,
      'page',
      serverPage,
      serverSort,
      keyword,
      statusStr,
      dateFrom,
      dateTo,
    ],
    queryFn: () =>
      inquiryApi.listPage({
        page: serverPage,
        pageSize: 10,
        keyword,
        status: statusStr,
        dateFrom,
        dateTo,
        sort: serverSort,
      }),
    enabled: serverEnabled,
  });

  // 已提交报价数量映射：inquiryId -> count
  const submittedCountMap = useMemo(() => {
    const map = new Map<string, number>();
    quotations.forEach((q) => {
      if (q.status === QuotationStatus.SUBMITTED) {
        map.set(q.inquiryId, (map.get(q.inquiryId) ?? 0) + 1);
      }
    });
    return map;
  }, [quotations]);

  // 过滤后的询价单（基于 applied，非输入态）
  const filteredInquiries = useMemo(() => {
    return inquiries.filter((inquiry) => {
      if (applied.code && !inquiry.code.toLowerCase().includes(applied.code.toLowerCase())) {
        return false;
      }
      if (
        applied.subject &&
        !inquiry.subject.toLowerCase().includes(applied.subject.toLowerCase())
      ) {
        return false;
      }
      if (applied.creator && !inquiry.createdByName.includes(applied.creator)) {
        return false;
      }
      if (applied.status.length > 0 && !applied.status.includes(inquiry.status)) {
        return false;
      }
      if (applied.createdAt && applied.createdAt[0] && applied.createdAt[1]) {
        const created = dayjs(inquiry.createdAt);
        if (
          created.isBefore(applied.createdAt[0].startOf('day')) ||
          created.isAfter(applied.createdAt[1].endOf('day'))
        ) {
          return false;
        }
      }
      if (applied.deadline && applied.deadline[0] && applied.deadline[1]) {
        const deadline = dayjs(inquiry.deadline);
        if (
          deadline.isBefore(applied.deadline[0].startOf('day')) ||
          deadline.isAfter(applied.deadline[1].endOf('day'))
        ) {
          return false;
        }
      }
      if (applied.category) {
        const matched = inquiry.items.some((item) => item.category.includes(applied.category!));
        if (!matched) return false;
      }
      return true;
    });
  }, [inquiries, applied]);

  // P2-12 Task 17：服务端分页时用服务端数据，否则用客户端全量筛选结果
  const displayInquiries = serverEnabled ? (serverData?.items ?? []) : filteredInquiries;
  const displayTotal = serverEnabled
    ? (serverData?.total ?? filteredInquiries.length)
    : filteredInquiries.length;
  const displayLoading = serverEnabled ? serverLoading : loading;

  const handleQuery = () => {
    const next = {
      code: filterCode,
      subject: filterSubject,
      creator: filterCreator,
      status: filterStatus,
      createdAt: filterCreatedAt,
      deadline: filterDeadline,
      category: filterCategory,
    };
    setApplied(next);
    syncUrl(next, 1);
  };

  const handleReset = () => {
    setFilterCode('');
    setFilterSubject('');
    setFilterCreator('');
    setFilterStatus([]);
    setFilterCreatedAt(null);
    setFilterDeadline(null);
    setFilterCategory(undefined);
    const empty = {
      code: '',
      subject: '',
      creator: '',
      status: [],
      createdAt: null,
      deadline: null,
      category: undefined,
    };
    setApplied(empty);
    syncUrl(empty, 1);
  };

  // ===== Task 19：保存筛选视图（序列化 / 反序列化 / 应用）=====
  const serializeFilter = (f: typeof applied): SavedViewFilter => ({
    code: f.code,
    subject: f.subject,
    creator: f.creator,
    status: f.status,
    createdAt:
      f.createdAt?.[0] && f.createdAt?.[1]
        ? [f.createdAt[0].toISOString(), f.createdAt[1].toISOString()]
        : null,
    deadline:
      f.deadline?.[0] && f.deadline?.[1]
        ? [f.deadline[0].toISOString(), f.deadline[1].toISOString()]
        : null,
    category: f.category,
  });

  const applySavedView = (view: SavedFilterView<SavedViewFilter>) => {
    const v = view.filter;
    const next: typeof applied = {
      code: v.code,
      subject: v.subject,
      creator: v.creator,
      status: v.status,
      createdAt: v.createdAt ? [dayjs(v.createdAt[0]), dayjs(v.createdAt[1])] : null,
      deadline: v.deadline ? [dayjs(v.deadline[0]), dayjs(v.deadline[1])] : null,
      category: v.category,
    };
    // 同步到输入态与 applied，并写回 URL
    setFilterCode(v.code);
    setFilterSubject(v.subject);
    setFilterCreator(v.creator);
    setFilterStatus(v.status);
    setFilterCreatedAt(next.createdAt as [Dayjs | null, Dayjs | null] | null);
    setFilterDeadline(next.deadline as [Dayjs | null, Dayjs | null] | null);
    setFilterCategory(v.category);
    setApplied(next);
    syncUrl(next, 1);
  };

  // Task 19：进入列表页时自动应用默认视图
  useEffect(() => {
    const def = getDefaultView();
    if (def) applySavedView(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveView = () => {
    const name = viewName.trim();
    if (!name) {
      notifyError(t('inquiry.savedViews.nameRequired'));
      return;
    }
    saveView(name, serializeFilter(applied));
    notifySuccess(t('inquiry.savedViews.saved', { name }));
    setViewModalOpen(false);
    setViewName('');
  };

  const handleApplyView = (view: SavedFilterView<SavedViewFilter>) => {
    applySavedView(view);
    notifySuccess(t('inquiry.savedViews.applied', { name: view.name }));
  };

  const handleSetDefaultView = (view: SavedFilterView<SavedViewFilter>) => {
    setViewDefault(view.id);
    notifySuccess(t('inquiry.savedViews.defaultSet', { name: view.name }));
  };

  const handleRemoveView = (view: SavedFilterView<SavedViewFilter>) => {
    confirmAction({
      title: t('inquiry.savedViews.remove'),
      content: t('inquiry.savedViews.confirmRemove', { name: view.name }),
      danger: true,
      onOk: () => {
        removeSavedView(view.id);
        notifySuccess(t('inquiry.savedViews.removed'));
      },
    });
  };

  // ===== Task 19：批量操作执行前预览 + 逐条结果 =====
  const showBatchPreview = (kind: BatchActionKind) => {
    const items = batch.preview(selectedRowKeys.map(String), kind, inquiries);
    setBatchKind(kind);
    setBatchPreviewItems(items);
    setBatchPreviewOpen(true);
  };

  const runBatch = async () => {
    if (!batchKind) return;
    const ids = selectedRowKeys.map(String);
    let result: BatchOperationResult | null = null;
    try {
      if (batchKind === 'send') result = await batch.batchSend(ids);
      else if (batchKind === 'remind') result = await batch.batchRemind(ids);
      else if (batchKind === 'export') result = await batch.batchExport(ids, 'xlsx');
      else if (batchKind === 'assign') {
        if (!assignOwner.trim()) {
          notifyError(t('inquiry.list.batchOwnerRequired'));
          return;
        }
        result = await batch.batchAssign(ids, currentUser.id, assignOwner.trim());
      }
    } catch (e) {
      notifyError((e as Error)?.message ?? t('common.operateFailed'));
      return;
    }
    setBatchPreviewOpen(false);
    setAssignOpen(false);
    setAssignOwner('');
    if (!result) return;
    // 成功提示（导出提示后台队列）
    if (result.succeeded > 0) {
      const key =
        batchKind === 'send'
          ? 'batchSendSuccess'
          : batchKind === 'remind'
            ? 'batchRemindSuccess'
            : batchKind === 'export'
              ? 'batchExportSuccess'
              : 'batchAssignSuccess';
      notifySuccess(t(`inquiry.list.${key}`, { count: result.succeeded }));
    }
    if (batchKind === 'export' && result.queued) {
      notifySuccess(t('inquiry.list.batchExportQueued'));
    }
    // 逐条失败提示
    if (result.failed > 0) {
      const reasons = Array.from(
        new Set(
          result.results
            .filter((r) => !r.success && !r.skipped && r.reason)
            .map((r) => r.reason as string),
        ),
      );
      const reasonText = reasons.length ? `：${reasons.join('；')}` : '';
      notifyError(t('inquiry.list.batchPartialFailed', { count: result.failed }) + reasonText);
    }
    setSelectedRowKeys([]);
  };

  const handleCopy = (inquiry: Inquiry) => {
    confirmAction({
      title: i18n.t('inquiry.list.confirmCopyTitle'),
      content: i18n.t('inquiry.list.confirmCopyContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.list.confirmCopyOk'),
      onOk: () => {
        const copy = copyInquiry(inquiry.id);
        if (copy) {
          notifySuccess(i18n.t('inquiry.list.copySuccess', { code: copy.code }));
        }
      },
    });
  };

  const handleCancel = (inquiry: Inquiry) => {
    confirmAction({
      title: i18n.t('inquiry.list.confirmCancelTitle'),
      content: i18n.t('inquiry.list.confirmCancelContent', { code: inquiry.code }),
      okText: i18n.t('inquiry.list.confirmCancelOk'),
      danger: true,
      onOk: async () => {
        const result = await cancelInquiry(inquiry.id);
        if (result.success) {
          notifySuccess(i18n.t('inquiry.list.cancelSuccess'));
        } else if (result.reason === 'pending') {
          return;
        } else {
          notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
        }
      },
    });
  };

  const handleBatchCancel = () => {
    const ids = selectedRowKeys.map(String);
    const skippedCount = ids.filter((id) => {
      const status = inquiries.find((i) => i.id === id)?.status;
      return status === undefined || !isCancelable(status);
    }).length;
    const executableCount = ids.length - skippedCount;
    confirmAction({
      title: i18n.t('inquiry.list.batchCancelConfirmTitle'),
      content: i18n.t('inquiry.list.batchCancelSummary', {
        total: ids.length,
        executable: executableCount,
        skipped: skippedCount,
      }),
      okText: i18n.t('inquiry.list.batchCancel'),
      danger: true,
      onOk: async () => {
        const result = await batchCancelInquiries(ids);
        if (result.succeeded > 0) {
          notifySuccess(i18n.t('inquiry.list.batchCancelSuccess', { count: result.succeeded }));
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
          notifyError(
            i18n.t('inquiry.list.batchCancelFailed', { count: result.failed }) + reasonText,
          );
        }
        setSelectedRowKeys([]);
      },
    });
  };

  const handleExport = (inquiry: Inquiry) => {
    const header = [
      i18n.t('inquiry.export.materialName'),
      i18n.t('inquiry.export.materialCode'),
      i18n.t('inquiry.export.category'),
      i18n.t('inquiry.export.brand'),
      i18n.t('inquiry.export.spec'),
      i18n.t('inquiry.export.unit'),
      i18n.t('inquiry.export.quantity'),
      i18n.t('inquiry.export.targetPrice'),
    ];
    const rows = inquiry.items.map((item) => [
      item.name,
      item.code,
      item.category,
      item.brand,
      item.spec,
      item.unit,
      item.quantity,
      item.targetPrice ?? '',
    ]);
    exportAOA(i18n.t('inquiry.export.filename', { code: inquiry.code }), header, rows);
    notifySuccess(i18n.t('inquiry.export.success'));
  };

  // ===== Task 7：快捷视图 / 当前筛选 / 一键清空 / 导出当前筛选结果 =====
  const applyMyPending = () => {
    const statuses = [
      InquiryStatus.DRAFT,
      InquiryStatus.INQUIRING,
      InquiryStatus.PENDING_APPROVAL,
      InquiryStatus.PENDING_CONFIRM,
    ];
    setFilterStatus(statuses);
    setFilterCreator(currentUser.name);
    const next = {
      code: filterCode,
      subject: filterSubject,
      creator: currentUser.name,
      status: statuses,
      createdAt: filterCreatedAt,
      deadline: filterDeadline,
      category: filterCategory,
    };
    setApplied(next);
    syncUrl(next, 1);
  };

  const resetDefaultView = () => {
    handleReset();
  };

  /** 一键清空筛选：清空输入态 + applied */
  const clearFilters = () => {
    setFilterCode('');
    setFilterSubject('');
    setFilterCreator('');
    setFilterStatus([]);
    setFilterCreatedAt(null);
    setFilterDeadline(null);
    setFilterCategory(undefined);
    const empty = {
      code: '',
      subject: '',
      creator: '',
      status: [],
      createdAt: null,
      deadline: null,
      category: undefined,
    };
    setApplied(empty);
    syncUrl(empty, 1);
  };

  /** 当前生效筛选条件 Tag 列表 */
  const activeFilterTags = useMemo(() => {
    const tags: React.ReactNode[] = [];
    if (applied.code) {
      tags.push(
        <Tag key="code">
          {t('inquiry.list.inquiryCode')}: {applied.code}
        </Tag>,
      );
    }
    if (applied.subject) {
      tags.push(
        <Tag key="subject">
          {t('inquiry.list.subject')}: {applied.subject}
        </Tag>,
      );
    }
    if (applied.creator) {
      tags.push(
        <Tag key="creator">
          {t('inquiry.list.creator')}: {applied.creator}
        </Tag>,
      );
    }
    applied.status.forEach((s) => {
      tags.push(
        <Tag key={`status-${s}`} color="blue">
          {t('inquiry.list.status')}: {i18n.t(`enum.inquiryStatus.${s}`)}
        </Tag>,
      );
    });
    if (applied.createdAt && applied.createdAt[0] && applied.createdAt[1]) {
      tags.push(
        <Tag key="createdAt">
          {t('inquiry.list.createdAt')}: {formatDate(applied.createdAt[0].toISOString())} ~{' '}
          {formatDate(applied.createdAt[1].toISOString())}
        </Tag>,
      );
    }
    if (applied.deadline && applied.deadline[0] && applied.deadline[1]) {
      tags.push(
        <Tag key="deadline">
          {t('inquiry.list.deadline')}: {formatDate(applied.deadline[0].toISOString())} ~{' '}
          {formatDate(applied.deadline[1].toISOString())}
        </Tag>,
      );
    }
    if (applied.category) {
      tags.push(
        <Tag key="category" color="geekblue">
          {t('inquiry.list.materialCategory')}: {applied.category}
        </Tag>,
      );
    }
    return tags;
  }, [applied, t]);

  /** 导出当前筛选结果 */
  const handleExportCurrent = () => {
    const header = [
      t('inquiry.list.inquiryCode'),
      t('inquiry.list.subject'),
      t('inquiry.list.currentStatus'),
      t('inquiry.list.creator'),
      t('inquiry.list.createdAt'),
      t('inquiry.list.deadlineLabel'),
      t('inquiry.list.itemCount'),
      t('inquiry.list.invitedCount'),
      t('inquiry.list.submittedCount'),
    ];
    const rows = filteredInquiries.map((inq) => [
      inq.code,
      inq.subject,
      i18n.t(`enum.inquiryStatus.${inq.status}`),
      inq.createdByName,
      formatDateTime(inq.createdAt),
      formatDateTime(inq.deadline),
      inq.items.length,
      inq.invitedSupplierIds.length,
      submittedCountMap.get(inq.id) ?? 0,
    ]);
    exportAOA(t('inquiry.list.pageTitle'), header, rows);
    notifySuccess(t('table.exportCurrentSuccess'));
  };

  /** P2-12 Task 17：服务端生成 PDF/Excel 导出（基于报价数据，不依赖浏览器状态） */
  const exportServer = async (inquiry: Inquiry, format: 'pdf' | 'xlsx') => {
    try {
      await inquiryApi.export(inquiry.id, { format, scope: 'compare' });
      notifySuccess(i18n.t('inquiry.export.success'));
    } catch {
      notifyError(i18n.t('common.operateFailed'));
    }
  };

  // 截止时间单元格：超时红色、即将超时橙色
  const renderDeadline = (deadline: string) => {
    const remaining = getRemainingTime(deadline);
    const formatted = formatDateTime(deadline);
    if (remaining.expired) {
      return (
        <Space direction="vertical" size={0}>
          <Text style={{ color: 'var(--color-error)' }}>{formatted}</Text>
          <Tag color="error" style={{ marginInlineStart: 0 }}>
            {t('inquiry.list.expired')}
          </Tag>
        </Space>
      );
    }
    if (remaining.urgent) {
      return (
        <Space direction="vertical" size={0}>
          <Text style={{ color: 'var(--color-warning)' }}>{formatted}</Text>
          <Text style={{ fontSize: 12, color: 'var(--color-warning)' }}>{remaining.text}</Text>
        </Space>
      );
    }
    return <Text>{formatted}</Text>;
  };

  // ===== 表格列偏好（Task 7）：可见性 / 顺序 / 固定 / 密度，本地持久化 =====
  const defaultColumnPrefs: TableColumnPref[] = useMemo(
    () => [
      { key: 'code', title: t('inquiry.list.inquiryCode'), visible: true, fixed: 'left', order: 0 },
      { key: 'subject', title: t('inquiry.list.subject'), visible: true, order: 1 },
      { key: 'itemCount', title: t('inquiry.list.itemCount'), visible: true, order: 2 },
      { key: 'invitedCount', title: t('inquiry.list.invitedCount'), visible: true, order: 3 },
      { key: 'submittedCount', title: t('inquiry.list.submittedCount'), visible: true, order: 4 },
      { key: 'deadline', title: t('inquiry.list.deadlineLabel'), visible: true, order: 5 },
      {
        key: 'status',
        title: t('inquiry.list.currentStatus'),
        visible: true,
        fixed: 'left',
        order: 6,
      },
      { key: 'createdByName', title: t('inquiry.list.creator'), visible: true, order: 7 },
      { key: 'createdAt', title: t('inquiry.list.createdAt'), visible: true, order: 8 },
      { key: 'action', title: t('inquiry.list.actions'), visible: true, fixed: 'right', order: 9 },
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
  } = useTablePreferences(
    'inquiryList',
    {
      columns: defaultColumnPrefs,
      density: 'default',
    },
    !IS_DEMO_MODE,
  );

  const columnDefs: ColumnsType<Inquiry> = [
    {
      title: t('inquiry.list.inquiryCode'),
      dataIndex: 'code',
      key: 'code',
      width: 160,
      fixed: 'left',
      render: (code: string) => <Text strong>{code}</Text>,
    },
    {
      title: t('inquiry.list.subject'),
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
      render: (subject: string) => <Text>{subject}</Text>,
    },
    {
      title: t('inquiry.list.itemCount'),
      key: 'itemCount',
      width: 90,
      align: 'center',
      render: (_, record) => record.items.length,
      sorter: (a, b) => a.items.length - b.items.length,
    },
    {
      title: t('inquiry.list.invitedCount'),
      key: 'invitedCount',
      width: 100,
      align: 'center',
      render: (_, record) => record.invitedSupplierIds.length,
      sorter: (a, b) => a.invitedSupplierIds.length - b.invitedSupplierIds.length,
    },
    {
      title: t('inquiry.list.submittedCount'),
      key: 'submittedCount',
      width: 90,
      align: 'center',
      render: (_, record) => {
        const count = submittedCountMap.get(record.id) ?? 0;
        const total = record.invitedSupplierIds.length;
        const allDone = total > 0 && count === total;
        return (
          <Text
            style={{
              color: allDone ? 'var(--color-success)' : undefined,
              fontWeight: allDone ? 600 : 400,
            }}
          >
            {count}
          </Text>
        );
      },
      sorter: (a, b) => (submittedCountMap.get(a.id) ?? 0) - (submittedCountMap.get(b.id) ?? 0),
    },
    {
      title: t('inquiry.list.deadlineLabel'),
      dataIndex: 'deadline',
      key: 'deadline',
      width: 180,
      render: (deadline: string) => renderDeadline(deadline),
      sorter: (a, b) => dayjs(a.deadline).valueOf() - dayjs(b.deadline).valueOf(),
    },
    {
      title: t('inquiry.list.currentStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: InquiryStatus) => <InquiryStatusTag status={status} />,
      sorter: (a, b) => a.status.localeCompare(b.status),
    },
    {
      title: t('inquiry.list.creator'),
      dataIndex: 'createdByName',
      key: 'createdByName',
      width: 100,
    },
    {
      title: t('inquiry.list.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (createdAt: string) => formatDateTime(createdAt),
      sorter: (a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
      defaultSortOrder: 'descend',
    },
    {
      title: t('inquiry.list.actions'),
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} wrap>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/inquiry/detail/${record.id}`)}
          >
            {t('common.detail')}
          </Button>
          {canEdit && isEditable(record.status) && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => navigate(`/inquiry/edit/${record.id}`)}
            >
              {t('inquiry.list.edit')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(record)}
          >
            {t('common.copy')}
          </Button>
          {canCancel && isCancelable(record.status) && (
            <Button
              type="link"
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() => handleCancel(record)}
            >
              {t('common.cancel')}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => handleExport(record)}
          >
            {t('common.export')}
          </Button>
        </Space>
      ),
    },
  ];

  // 按偏好渲染生效列：过滤可见 + 按 order 排序 + 应用固定方向
  const columns = prefs.columns
    .filter((c) => c.visible)
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const def = columnDefs.find((d) => d.key === p.key);
      if (!def) return null;
      // 固定方向以用户偏好优先，未设置则回退到列默认
      return p.fixed ? { ...def, fixed: p.fixed } : def;
    })
    .filter((d): d is (typeof columnDefs)[number] => d !== null);

  const tableSize = DENSITY_TO_SIZE[prefs.density];

  /** 空状态引导：无数据或筛选无结果时提供「清空筛选」入口 */
  const renderEmpty = () => (
    <Empty
      description={inquiries.length === 0 ? t('inquiry.list.empty') : t('inquiry.list.noMatch')}
    >
      <Button onClick={clearFilters}>{t('table.clearFilters')}</Button>
    </Empty>
  );

  /** 筛选控件（桌面端 Collapse / 移动端 Drawer 复用） */
  const filterForm = (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.inquiryCode')}
        </div>
        <Input
          placeholder={t('common.inputPlaceholder')}
          value={filterCode}
          onChange={(e) => setFilterCode(e.target.value)}
          allowClear
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.subject')}
        </div>
        <Input
          placeholder={t('common.inputPlaceholder')}
          value={filterSubject}
          onChange={(e) => setFilterSubject(e.target.value)}
          allowClear
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.creator')}
        </div>
        <Input
          placeholder={t('common.inputPlaceholder')}
          value={filterCreator}
          onChange={(e) => setFilterCreator(e.target.value)}
          allowClear
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.status')}
        </div>
        <Select
          mode="multiple"
          placeholder={t('common.selectPlaceholder')}
          value={filterStatus}
          onChange={(val) => setFilterStatus(val)}
          options={INQUIRY_STATUS_OPTIONS}
          style={{ width: '100%' }}
          allowClear
          maxTagCount="responsive"
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.createdAt')}
        </div>
        <RangePicker
          value={filterCreatedAt as [Dayjs, Dayjs] | null}
          onChange={(val) => setFilterCreatedAt(val as [Dayjs | null, Dayjs | null] | null)}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.deadline')}
        </div>
        <RangePicker
          value={filterDeadline as [Dayjs, Dayjs] | null}
          onChange={(val) => setFilterDeadline(val as [Dayjs | null, Dayjs | null] | null)}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6}>
        <div style={{ marginBottom: 4, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t('inquiry.list.materialCategory')}
        </div>
        <Select
          placeholder={t('common.selectPlaceholder')}
          value={filterCategory}
          onChange={(val) => setFilterCategory(val)}
          options={getMaterialCategoryOptions()}
          style={{ width: '100%' }}
          allowClear
        />
      </Col>
      <Col xs={24} sm={12} md={8} lg={6} style={{ display: 'flex', alignItems: 'flex-end' }}>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>
            {t('inquiry.list.query')}
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
      <PageHeader
        title={t('inquiry.list.pageTitle')}
        description={t('inquiry.list.pageDescription')}
        extra={
          <Permission perm="INQUIRY_CREATE">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/inquiry/create')}
            >
              {t('inquiry.list.newInquiry')}
            </Button>
          </Permission>
        }
      />

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
          <Collapse
            items={[
              {
                key: 'filter',
                label: t('common.filter'),
                children: filterForm,
              },
            ]}
            defaultActiveKey={['filter']}
          />
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
          <Tooltip title={t('table.myPendingDesc')}>
            <Button icon={<EyeOutlined />} onClick={applyMyPending}>
              {t('table.myPending')}
            </Button>
          </Tooltip>
          <Button icon={<ReloadOutlined />} onClick={resetDefaultView}>
            {t('table.resetDefaultView')}
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'save',
                  label: t('inquiry.savedViews.save'),
                  icon: <SaveOutlined />,
                },
                { type: 'divider' },
                ...(savedViews.length === 0
                  ? [{ key: 'empty', label: t('inquiry.savedViews.empty'), disabled: true }]
                  : savedViews.map((v) => ({
                      key: v.id,
                      label: (
                        <Space size={4}>
                          {v.name}
                          {v.isDefault && (
                            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                              {t('inquiry.savedViews.defaultTag')}
                            </Tag>
                          )}
                        </Space>
                      ),
                      children: [
                        { key: `apply-${v.id}`, label: t('inquiry.savedViews.apply') },
                        { key: `default-${v.id}`, label: t('inquiry.savedViews.setDefault') },
                        {
                          key: `remove-${v.id}`,
                          label: t('inquiry.savedViews.remove'),
                          danger: true,
                        },
                      ],
                    }))),
              ],
              onClick: ({ key }) => {
                if (key === 'save') {
                  setViewModalOpen(true);
                } else if (key.startsWith('apply-')) {
                  const v = savedViews.find((i) => i.id === key.slice(6));
                  if (v) handleApplyView(v);
                } else if (key.startsWith('default-')) {
                  const v = savedViews.find((i) => i.id === key.slice(8));
                  if (v) handleSetDefaultView(v);
                } else if (key.startsWith('remove-')) {
                  const v = savedViews.find((i) => i.id === key.slice(7));
                  if (v) handleRemoveView(v);
                }
              },
            }}
          >
            <Button icon={<SaveOutlined />}>{t('inquiry.savedViews.title')}</Button>
          </Dropdown>
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
              {t('inquiry.list.selectedCount', { count: selectedRowKeys.length })}
            </Text>
            {canSend && (
              <Button icon={<SendOutlined />} onClick={() => showBatchPreview('send')}>
                {t('inquiry.list.batchSend')}
              </Button>
            )}
            {canSend && (
              <Button icon={<BellOutlined />} onClick={() => showBatchPreview('remind')}>
                {t('inquiry.list.batchRemind')}
              </Button>
            )}
            <Button icon={<ExportOutlined />} onClick={() => showBatchPreview('export')}>
              {t('inquiry.list.batchExport')}
            </Button>
            {canEdit && (
              <Button
                icon={<UserOutlined />}
                onClick={() => {
                  setBatchKind('assign');
                  setAssignOpen(true);
                }}
              >
                {t('inquiry.list.batchAssign')}
              </Button>
            )}
            {canCancel && (
              <Button
                danger
                disabled={
                  !selectedRowKeys.some((key) => {
                    const status = inquiries.find((i) => i.id === String(key))?.status;
                    return status !== undefined && isCancelable(status);
                  })
                }
                onClick={handleBatchCancel}
              >
                {t('inquiry.list.batchCancel')}
              </Button>
            )}
            <Button onClick={() => setSelectedRowKeys([])}>
              {t('inquiry.list.clearSelection')}
            </Button>
          </Space>
        </div>
      )}

      {/* Task 19：批量操作执行前预览 Modal */}
      <Modal
        title={t('inquiry.list.batchPreviewTitle')}
        open={batchPreviewOpen}
        onCancel={() => setBatchPreviewOpen(false)}
        onOk={runBatch}
        okText={t('common.confirm')}
        confirmLoading={batch.running}
        okButtonProps={{ disabled: batchPreviewItems.every((i) => !i.executable) }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {t('inquiry.list.batchPreviewSummary', {
            total: batchPreviewItems.length,
            executable: batchPreviewItems.filter((i) => i.executable).length,
            skipped: batchPreviewItems.filter((i) => !i.executable).length,
          })}
        </Text>
        <List
          size="small"
          dataSource={batchPreviewItems}
          renderItem={(item) => (
            <List.Item>
              <Space>
                <Text strong>{item.code}</Text>
                <Text type="secondary" ellipsis style={{ maxWidth: 240 }}>
                  {item.subject}
                </Text>
              </Space>
              {item.executable ? (
                <Tag color="success">{t('common.yes')}</Tag>
              ) : (
                <Tag color="warning">
                  {item.reason === 'status_not_sendable'
                    ? t('inquiry.list.batchReasonNotSendable')
                    : t('inquiry.list.batchReasonNotFound')}
                </Tag>
              )}
            </List.Item>
          )}
        />
      </Modal>

      {/* Task 19：批量调整负责人 Modal */}
      <Modal
        title={t('inquiry.list.batchAssignTitle')}
        open={assignOpen}
        onCancel={() => {
          setAssignOpen(false);
          setAssignOwner('');
        }}
        onOk={runBatch}
        confirmLoading={batch.running}
        okButtonProps={{ disabled: !assignOwner.trim() }}
      >
        <Input
          placeholder={t('inquiry.list.batchAssignPlaceholder')}
          value={assignOwner}
          onChange={(e) => setAssignOwner(e.target.value)}
          onPressEnter={runBatch}
        />
      </Modal>

      {/* Task 19：保存筛选视图 Modal */}
      <Modal
        title={t('inquiry.savedViews.save')}
        open={viewModalOpen}
        onCancel={() => {
          setViewModalOpen(false);
          setViewName('');
        }}
        onOk={handleSaveView}
        okButtonProps={{ disabled: !viewName.trim() }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {t('inquiry.savedViews.saveDesc')}
        </Text>
        <Input
          placeholder={t('inquiry.savedViews.namePlaceholder')}
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          onPressEnter={handleSaveView}
        />
      </Modal>

      <Card styles={{ body: { padding: 0 } }}>
        {isMobile ? (
          <List
            dataSource={displayInquiries}
            locale={{
              emptyText: renderEmpty(),
            }}
            pagination={{
              pageSize: 10,
              simple: true,
              total: displayTotal,
              onChange: (page) => {
                if (serverEnabled) {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('page', String(page));
                  setSearchParams(params, { replace: true });
                }
              },
              showTotal: (total) => t('inquiry.list.total', { count: total }),
            }}
            renderItem={(record) => {
              const submittedCount = submittedCountMap.get(record.id) ?? 0;
              const remaining = getRemainingTime(record.deadline);
              return (
                <List.Item
                  style={{ padding: '12px 16px', flexDirection: 'column', alignItems: 'stretch' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}
                      >
                        <Text strong>{record.code}</Text>
                        <InquiryStatusTag status={record.status} />
                      </div>
                      <Text
                        ellipsis
                        style={{ display: 'block', color: 'var(--color-text-secondary)' }}
                      >
                        {record.subject}
                      </Text>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: 'var(--color-text-tertiary)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px 12px',
                    }}
                  >
                    <span>
                      {t('inquiry.list.itemCount')}: {record.items.length}
                    </span>
                    <span>
                      {t('inquiry.list.invitedCount')}: {record.invitedSupplierIds.length}
                    </span>
                    <span>
                      {t('inquiry.list.submittedCount')}: {submittedCount}
                    </span>
                    <span>
                      {t('inquiry.list.creator')}: {record.createdByName}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: remaining.expired
                        ? 'var(--color-error)'
                        : remaining.urgent
                          ? 'var(--color-warning)'
                          : 'var(--color-text-tertiary)',
                    }}
                  >
                    {t('inquiry.list.deadline')}: {formatDateTime(record.deadline)}
                    {remaining.expired
                      ? ` · ${t('inquiry.list.expired')}`
                      : remaining.urgent
                        ? ` · ${remaining.text}`
                        : ''}
                  </div>
                  <Space size={0} wrap style={{ marginTop: 8, alignItems: 'center' }}>
                    <Button
                      type="link"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => navigate(`/inquiry/detail/${record.id}`)}
                    >
                      {t('common.detail')}
                    </Button>
                    <Dropdown
                      menu={{
                        items: [
                          ...(canEdit && isEditable(record.status)
                            ? [
                                {
                                  key: 'edit',
                                  label: t('inquiry.list.edit'),
                                  icon: <EditOutlined />,
                                },
                              ]
                            : []),
                          { key: 'copy', label: t('common.copy'), icon: <CopyOutlined /> },
                          ...(canCancel && isCancelable(record.status)
                            ? [
                                {
                                  key: 'cancel',
                                  label: t('common.cancel'),
                                  icon: <StopOutlined />,
                                  danger: true,
                                },
                              ]
                            : []),
                          { key: 'export', label: t('common.export'), icon: <ExportOutlined /> },
                          {
                            key: 'exportPdf',
                            label: t('inquiry.list.exportPdf'),
                            icon: <ExportOutlined />,
                          },
                        ],
                        onClick: ({ key }) => {
                          if (key === 'edit') navigate(`/inquiry/edit/${record.id}`);
                          else if (key === 'copy') handleCopy(record);
                          else if (key === 'cancel') handleCancel(record);
                          else if (key === 'export') handleExport(record);
                          else if (key === 'exportPdf') void exportServer(record, 'pdf');
                        },
                      }}
                    >
                      <Button type="link" size="small" icon={<MoreOutlined />}>
                        {t('common.more')}
                      </Button>
                    </Dropdown>
                  </Space>
                </List.Item>
              );
            }}
          />
        ) : (
          <Table<Inquiry>
            rowKey="id"
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
            }}
            columns={columns}
            dataSource={displayInquiries}
            loading={displayLoading}
            size={tableSize}
            scroll={{ x: 1500 }}
            pagination={{
              pageSize: 10,
              current: serverEnabled ? serverPage : undefined,
              total: displayTotal,
              showSizeChanger: true,
              onChange: (page) => {
                if (serverEnabled) {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set('page', String(page));
                  setSearchParams(params, { replace: true });
                }
              },
              showTotal: (total) => t('inquiry.list.total', { count: total }),
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
