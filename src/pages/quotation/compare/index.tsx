/**
 * 报价对比页面（Task 12）
 * 路由：/quotation/compare（无 id 展示可对比询价单列表）、/quotation/compare/:inquiryId
 * 参考：飞书多维表格密集型数据展示
 *
 * 工程治理（Task 18）：本文件聚焦状态与编排，展示逻辑已下沉到同目录子组件：
 * CompareInquiryPicker / CompareInfoCard / CompareScoreRule / CompareBestThree /
 * CompareRiskAlert / CompareControls / CompareAiResult，导出逻辑见 exportCompare.ts。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Empty, Select, Space, Spin, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { ApprovalNodeStatus, InquiryStatus, QuotationStatus } from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/utils/format';
import { confirmAction, notifyError, notifySuccess } from '@/utils/confirm';
import i18n from '@/i18n';
import { useIsMobile } from '@/utils/useIsMobile';
import {
  analyzeQuotationAnomalies,
  getAIBackendStatus,
  type AnomalyAnalysisResult,
} from '@/utils/aiService';
import CompareByMaterialTable from '@/components/quotation/CompareByMaterialTable';
import CompareBySupplierTable from '@/components/quotation/CompareBySupplierTable';
import SupplierQuotationDrawer from '@/components/quotation/SupplierQuotationDrawer';
import SummaryModal from '@/components/quotation/SummaryModal';
import ScoreDetailModal from '@/components/quotation/ScoreDetailModal';
import CommentEditor, { type SaveStatus } from '@/components/quotation/CommentEditor';
import { type SortMode, prepareCompareData, sortRows } from '@/components/quotation/scoreUtils';
import type { ViewMode } from './types';
import CompareInquiryPicker from './CompareInquiryPicker';
import CompareInfoCard from './CompareInfoCard';
import CompareScoreRule from './CompareScoreRule';
import CompareBestThree from './CompareBestThree';
import CompareRiskAlert from './CompareRiskAlert';
import CompareControls from './CompareControls';
import CompareAiResult from './CompareAiResult';
import { exportCompareWorkbook } from './exportCompare';

const { Text } = Typography;

export default function QuotationComparePage() {
  const { t } = useTranslation();
  const { inquiryId } = useParams<{ inquiryId?: string }>();
  const navigate = useNavigate();

  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );
  const getInquiryById = useInquiryStore((s) => s.getInquiryById);
  const selectSupplier = useInquiryStore((s) => s.selectSupplier);
  const confirmInquiry = useInquiryStore((s) => s.confirmInquiry);
  const updateInquiry = useInquiryStore((s) => s.updateInquiry);
  const submitForApproval = useInquiryStore((s) => s.submitForApproval);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const getQuotationsByInquiry = useQuotationStore((s) => s.getQuotationsByInquiry);
  const approvalConfig = useSettingsStore((s) => s.approval);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canConfirmPerm = hasPermission('INQUIRY_CONFIRM');
  const isMobile = useIsMobile();

  const [viewMode, setViewMode] = useState<ViewMode>('material');
  const [sortMode, setSortMode] = useState<SortMode>('totalAsc');
  const [hideUnquoted, setHideUnquoted] = useState(false);
  const [drawerSupplierId, setDrawerSupplierId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [scoreDetailOpen, setScoreDetailOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const [dirtyFlags, setDirtyFlags] = useState<Record<string, boolean>>({});
  const [aiAnalysis, setAiAnalysis] = useState<AnomalyAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 可对比询价单（至少有一份已提交报价）
  const comparableInquiries = useMemo(
    () =>
      inquiries.filter((i) =>
        getQuotationsByInquiry(i.id).some((q) => q.status === QuotationStatus.SUBMITTED),
      ),
    [inquiries, getQuotationsByInquiry],
  );

  const inquiry = inquiryId ? getInquiryById(inquiryId) : undefined;

  // 切换询价单时重置评语草稿、保存状态与抽屉。
  // 用 ref 记录已处理的询价单 id，仅在真正切换时重置，避免每次评语保存触发的
  // inquiry 对象更新（同 id）导致草稿被反复重置、覆盖用户未提交内容（Task 11.1/11.2）。
  const processedInquiryIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (processedInquiryIdRef.current === inquiry?.id) return;
    processedInquiryIdRef.current = inquiry?.id;
    setDrawerSupplierId(null);
    setSummaryOpen(false);
    setScoreDetailOpen(false);
    setSaveStatuses({});
    setDirtyFlags({});
    if (inquiry) {
      setCommentDraft({ ...(inquiry.purchaserComments || {}) });
    } else {
      setCommentDraft({});
    }
  }, [inquiry]);

  const data = useMemo(() => {
    if (!inquiry) return null;
    return prepareCompareData(inquiry, suppliers, getQuotationsByInquiry(inquiry.id));
  }, [inquiry, suppliers, getQuotationsByInquiry]);

  const visibleRows = useMemo(() => {
    if (!data) return [];
    let r = data.rows;
    if (hideUnquoted) r = r.filter((x) => x.isSubmitted);
    return sortRows(r, sortMode, data.scores);
  }, [data, hideUnquoted, sortMode]);

  const drawerRow = useMemo(
    () =>
      drawerSupplierId ? data?.rows.find((r) => r.supplier.id === drawerSupplierId) : undefined,
    [drawerSupplierId, data],
  );

  // ===== 评语处理（防抖自动保存 + 保存状态） =====
  const handleCommentChange = useCallback((supplierId: string, val: string) => {
    setCommentDraft((prev) => ({ ...prev, [supplierId]: val }));
  }, []);

  const handleSaveComment = useCallback(
    async (supplierId: string, val: string): Promise<boolean> => {
      if (!inquiry) return false;
      const original = (inquiry.purchaserComments?.[supplierId] ?? '').trim();
      if (val.trim() === original) return true;
      const result = await updateInquiry(inquiry.id, {
        purchaserComments: { ...inquiry.purchaserComments, [supplierId]: val },
      });
      return result.success;
    },
    [inquiry, updateInquiry],
  );

  const handleStatusChange = useCallback((supplierId: string, status: SaveStatus) => {
    setSaveStatuses((prev) => ({ ...prev, [supplierId]: status }));
  }, []);

  const handleDirtyChange = useCallback((supplierId: string, dirty: boolean) => {
    setDirtyFlags((prev) => ({ ...prev, [supplierId]: dirty }));
  }, []);

  // 是否存在未保存内容（saving/error 或仍有未保存草稿）
  const hasUnsaved = useMemo(() => {
    const statusUnsaved = Object.values(saveStatuses).some((s) => s === 'saving' || s === 'error');
    const dirtyUnsaved = Object.values(dirtyFlags).some(Boolean);
    return statusUnsaved || dirtyUnsaved;
  }, [saveStatuses, dirtyFlags]);

  // 页面离开前检测未保存内容（后台路由离开 + 刷新/关闭）
  const blocker = useBlocker(hasUnsaved);
  useEffect(() => {
    if (blocker?.state === 'blocked') {
      confirmAction({
        title: i18n.t('quotation.compare.unsavedChanges'),
        content: i18n.t('quotation.compare.unsavedChangesContent'),
        okText: i18n.t('quotation.compare.leaveAnyway'),
        cancelText: i18n.t('common.cancel'),
        onOk: () => blocker.proceed(),
        onCancel: () => blocker.reset(),
      });
    }
  }, [blocker]);

  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  // 稳定回调，供 memo 化对比表使用，避免每次渲染产生新函数导致大表重渲染
  const handleSelectSupplier = useCallback(
    async (itemId: string, supplierId: string) => {
      if (!inquiry) return;
      const result = await selectSupplier(inquiry.id, itemId, supplierId);
      if (result.success) {
        notifySuccess(i18n.t('quotation.compare.selectedSupplierSuccess'));
      } else if (result.reason !== 'pending') {
        notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
      }
    },
    [inquiry, selectSupplier],
  );

  const handleOpenDrawer = useCallback((supplierId: string) => {
    setDrawerSupplierId(supplierId);
  }, []);

  const handleOpenCompare = useCallback(
    (id: string) => navigate(`/quotation/compare/${id}`),
    [navigate],
  );

  // ===== 确认定标 =====
  const handleConfirm = () => {
    if (!inquiry) return;
    confirmAction({
      title: i18n.t('quotation.compare.confirmResult'),
      content: i18n.t('quotation.compare.confirmResultContent'),
      okText: i18n.t('quotation.compare.confirmResult'),
      cancelText: i18n.t('common.cancel'),
      onOk: () => {
        confirmInquiry(inquiry.id);
        notifySuccess(i18n.t('quotation.compare.confirmResultSuccess'));
      },
    });
  };

  // ===== W5：提交审批 =====
  const handleSubmitApproval = () => {
    if (!inquiry) return;
    confirmAction({
      title: i18n.t('quotation.compare.submitApproval'),
      content: i18n.t('quotation.compare.submitApprovalContent', {
        total: formatCurrency(selectedTotal, inquiry.currency),
        threshold: formatCurrency(approvalConfig.amountThreshold, inquiry.currency),
      }),
      okText: i18n.t('quotation.compare.submitApproval'),
      cancelText: i18n.t('common.cancel'),
      onOk: async () => {
        const result = await submitForApproval(inquiry.id);
        if (result.success) {
          notifySuccess(i18n.t('quotation.compare.submitApprovalSuccess'));
        } else if (result.reason === 'pending') {
          return;
        } else {
          notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
        }
      },
    });
  };

  // ===== W9：AI 异常分析 =====
  const handleAiAnalyze = async () => {
    if (!inquiry || !data) return;
    setAiLoading(true);
    try {
      const result = await analyzeQuotationAnomalies(inquiry, data, visibleRows);
      setAiAnalysis(result);
    } finally {
      setAiLoading(false);
    }
  };

  // ===== 导出 Excel =====
  const handleExport = () => {
    if (!inquiry || !data || exporting) return;
    setExporting(true);
    try {
      exportCompareWorkbook(t, inquiry, data, visibleRows);
      notifySuccess(i18n.t('quotation.compare.exportSuccess'));
    } catch {
      notifyError(i18n.t('quotation.compare.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  // ===== 无 inquiryId：可对比询价单卡片列表 =====
  if (!inquiryId) {
    return (
      <div>
        <PageHeader
          title={t('quotation.compare.title')}
          description={t('quotation.compare.description')}
        />
        <CompareInquiryPicker
          inquiries={comparableInquiries}
          getQuotationsByInquiry={getQuotationsByInquiry}
          onOpen={handleOpenCompare}
        />
      </div>
    );
  }

  // ===== 有 inquiryId 但未找到 =====
  if (!inquiry) {
    return (
      <div>
        <PageHeader title={t('quotation.compare.title')} />
        <Card>
          <Empty description={t('quotation.compare.notFound')} style={{ padding: 48 }}>
            <Button type="primary" onClick={() => navigate('/quotation/compare')}>
              {t('quotation.compare.backToList')}
            </Button>
          </Empty>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin />
      </div>
    );
  }

  // ===== 无已提交报价 =====
  if (data.submittedRows.length === 0) {
    return (
      <div>
        <PageHeader
          title={t('quotation.compare.title')}
          description={t('quotation.compare.inquiryDesc', {
            subject: inquiry.subject,
            code: inquiry.code,
          })}
          extra={
            <Select
              style={{ width: isMobile ? '100%' : 280 }}
              placeholder={t('quotation.compare.switchInquiry')}
              value={inquiry.id}
              onChange={(val) => navigate(`/quotation/compare/${val}`)}
              options={comparableInquiries.map((i) => ({
                label: t('quotation.compare.inquiryDesc', { subject: i.subject, code: i.code }),
                value: i.id,
              }))}
            />
          }
        />
        <Card>
          <Empty description={t('quotation.compare.noSubmitted')} style={{ padding: 48 }} />
        </Card>
      </div>
    );
  }

  // W5：审批逻辑
  const selectedSupplierIds = new Set(Object.values(inquiry.selectedSupplierMap));
  const selectedTotal = data.rows
    .filter((r) => selectedSupplierIds.has(r.supplier.id))
    .reduce((sum, r) => sum + r.totalAmount, 0);
  const hasSelectedSuppliers = Object.keys(inquiry.selectedSupplierMap).length > 0;
  const approvalNeeded =
    approvalConfig.enabled &&
    hasSelectedSuppliers &&
    selectedTotal >= approvalConfig.amountThreshold;
  const isPendingApproval = inquiry.status === InquiryStatus.PENDING_APPROVAL;
  const hasApprovedNode = inquiry.approvalNodes.some(
    (n) => n.status === ApprovalNodeStatus.APPROVED,
  );
  // 需审批时：已通过才可定标；无需审批时：ALL_QUOTED/PENDING_CONFIRM 即可
  const canConfirm =
    canConfirmPerm &&
    (approvalNeeded
      ? hasApprovedNode &&
        (inquiry.status === InquiryStatus.ALL_QUOTED ||
          inquiry.status === InquiryStatus.PENDING_CONFIRM)
      : inquiry.status === InquiryStatus.ALL_QUOTED ||
        inquiry.status === InquiryStatus.PENDING_CONFIRM);
  // 可提交审批：需审批 且 尚未提交（无审批节点） 且 状态为 ALL_QUOTED/PENDING_CONFIRM
  const canSubmitApproval =
    canConfirmPerm &&
    approvalNeeded &&
    !isPendingApproval &&
    inquiry.approvalNodes.length === 0 &&
    (inquiry.status === InquiryStatus.ALL_QUOTED ||
      inquiry.status === InquiryStatus.PENDING_CONFIRM);

  // 头部操作区
  const headerExtra = (
    <Space wrap>
      <Select
        style={{ width: isMobile ? '100%' : 280 }}
        placeholder={t('quotation.compare.switchInquiry')}
        value={inquiry.id}
        onChange={(val) => navigate(`/quotation/compare/${val}`)}
        options={comparableInquiries.map((i) => ({
          label: t('quotation.compare.inquiryDesc', { subject: i.subject, code: i.code }),
          value: i.id,
        }))}
        showSearch
        optionFilterProp="label"
      />
      <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exporting}>
        {t('quotation.compare.exportExcel')}
      </Button>
      <Button icon={<FileSearchOutlined />} onClick={() => setSummaryOpen(true)}>
        {t('quotation.compare.generateSummary')}
      </Button>
      <Button icon={<TrophyOutlined />} onClick={() => setScoreDetailOpen(true)}>
        {t('quotation.compare.scoreDetail')}
      </Button>
      <Button icon={<RobotOutlined />} loading={aiLoading} onClick={handleAiAnalyze}>
        {t('quotation.compare.aiAnalysis')}
      </Button>
      {(() => {
        const aiStatus = getAIBackendStatus();
        const color =
          aiStatus.status === 'remote'
            ? 'purple'
            : aiStatus.status === 'local'
              ? 'blue'
              : aiStatus.status === 'degraded'
                ? 'orange'
                : 'red';
        const label =
          aiStatus.status === 'remote'
            ? t('ai.backend.remote')
            : aiStatus.status === 'local'
              ? t('ai.backend.local')
              : aiStatus.status === 'degraded'
                ? t('ai.backend.degraded')
                : t('ai.backend.unavailable');
        return (
          <Tag color={color} icon={<RobotOutlined />} style={{ fontSize: 12, lineHeight: '24px' }}>
            {t('ai.backend.label')}
            {label}
            {aiStatus.confirmRequired ? `（${t('ai.backend.confirmationRequired')}）` : ''}
          </Tag>
        );
      })()}
      {isPendingApproval && (
        <Tag
          color="orange"
          icon={<SafetyCertificateOutlined />}
          style={{ fontSize: 13, padding: '4px 12px' }}
        >
          {t('quotation.compare.inApproval')}
        </Tag>
      )}
      {canSubmitApproval && (
        <Button icon={<SafetyCertificateOutlined />} onClick={handleSubmitApproval}>
          {t('quotation.compare.submitApproval')}
        </Button>
      )}
      {canConfirm && (
        <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleConfirm}>
          {t('quotation.compare.confirmResult')}
        </Button>
      )}
    </Space>
  );

  return (
    <div>
      <PageHeader
        title={t('quotation.compare.title')}
        description={t('quotation.compare.inquiryDesc', {
          subject: inquiry.subject,
          code: inquiry.code,
        })}
        extra={headerExtra}
      />

      {/* 询价单基本信息 */}
      <CompareInfoCard inquiry={inquiry} visibleRowCount={visibleRows.length} />

      {/* 评分规则说明 */}
      <CompareScoreRule />

      {/* 三项最优 */}
      <CompareBestThree data={data} currency={inquiry.currency} />

      {/* P2-12 Task 17：报价回收风险提示（未报价/部分报价/异常报价） */}
      <CompareRiskAlert
        inquiry={inquiry}
        submittedCount={data.submittedRows.length}
        aiAnalysis={aiAnalysis}
      />

      {/* 控制栏 */}
      <CompareControls
        viewMode={viewMode}
        sortMode={sortMode}
        hideUnquoted={hideUnquoted}
        onViewModeChange={setViewMode}
        onSortModeChange={setSortMode}
        onHideUnquotedChange={setHideUnquoted}
      />

      {/* AI 异常分析结果 */}
      {aiAnalysis && (
        <CompareAiResult aiAnalysis={aiAnalysis} onClose={() => setAiAnalysis(null)} />
      )}

      {/* 对比表格 */}
      <Card
        size="small"
        style={{ borderRadius: 8, marginBottom: 12 }}
        styles={{ body: { padding: 0 } }}
      >
        {viewMode === 'material' ? (
          <CompareByMaterialTable
            inquiry={inquiry}
            data={data}
            rows={visibleRows}
            selectedSupplierMap={inquiry.selectedSupplierMap}
            onSelectSupplier={handleSelectSupplier}
            onOpenDrawer={handleOpenDrawer}
          />
        ) : (
          <CompareBySupplierTable
            inquiry={inquiry}
            data={data}
            rows={visibleRows}
            onOpenDrawer={handleOpenDrawer}
          />
        )}
      </Card>

      {/* 采购评语（CommentEditor 隔离：输入只重渲染该组件） */}
      <Card
        size="small"
        title={<Text strong>{t('quotation.compare.purchaserCommentTitle')}</Text>}
        extra={
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('quotation.compare.autoSaveDesc')}
          </Text>
        }
        style={{ borderRadius: 8 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {visibleRows.map((r) => (
            <div style={{ flex: '1 1 45%', minWidth: 280 }} key={r.supplier.id}>
              <CommentEditor
                supplierId={r.supplier.id}
                supplierName={r.supplier.name}
                level={r.supplier.level}
                value={commentDraft[r.supplier.id] ?? ''}
                onChange={handleCommentChange}
                onSave={handleSaveComment}
                onStatusChange={handleStatusChange}
                onDirtyChange={handleDirtyChange}
                saveStatus={saveStatuses[r.supplier.id] ?? 'idle'}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* 供应商报价详情 Drawer */}
      <SupplierQuotationDrawer
        open={!!drawerSupplierId}
        row={drawerRow}
        inquiry={inquiry}
        comment={drawerSupplierId ? (commentDraft[drawerSupplierId] ?? '') : ''}
        onCommentChange={(val) => drawerSupplierId && handleCommentChange(drawerSupplierId, val)}
        onCommentBlur={() =>
          drawerSupplierId &&
          void handleSaveComment(drawerSupplierId, commentDraft[drawerSupplierId] ?? '')
        }
        onClose={() => setDrawerSupplierId(null)}
      />

      {/* 对比摘要 Modal */}
      <SummaryModal
        open={summaryOpen}
        inquiry={inquiry}
        data={data}
        rows={visibleRows}
        onClose={() => setSummaryOpen(false)}
      />

      {/* 评分明细 Modal（分项得分 + 权重调整 + 建议依据） */}
      <ScoreDetailModal
        open={scoreDetailOpen}
        data={data}
        rows={visibleRows}
        onClose={() => setScoreDetailOpen(false)}
      />
    </div>
  );
}
