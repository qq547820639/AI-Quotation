/**
 * 报价对比页面（Task 12）
 * 路由：/quotation/compare（无 id 展示可对比询价单列表）、/quotation/compare/:inquiryId
 * 参考：飞书多维表格密集型数据展示
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import {
  ApprovalNodeStatus,
  InquiryStatus,
  QuotationStatus,
} from '@/types';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useQuotationStore } from '@/store/useQuotationStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import PageHeader from '@/components/PageHeader';
import { InquiryStatusTag, SupplierLevelTag } from '@/components/StatusTag';
import { formatCurrency, formatDate, formatPercent, getRemainingTime } from '@/utils/format';
import { exportMultiSheet } from '@/utils/excel';
import { confirmAction, notifySuccess } from '@/utils/confirm';
import i18n from '@/i18n';
import { analyzeQuotationAnomalies, type AnomalyAnalysisResult } from '@/utils/aiService';
import CompareByMaterialTable from '@/components/quotation/CompareByMaterialTable';
import CompareBySupplierTable from '@/components/quotation/CompareBySupplierTable';
import SupplierQuotationDrawer from '@/components/quotation/SupplierQuotationDrawer';
import SummaryModal from '@/components/quotation/SummaryModal';
import {
  type SortMode,
  getQuotationItem,
  prepareCompareData,
  sortRows,
} from '@/components/quotation/scoreUtils';

const { Text } = Typography;
const { TextArea } = Input;

type ViewMode = 'material' | 'supplier';

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

  const [viewMode, setViewMode] = useState<ViewMode>('material');
  const [sortMode, setSortMode] = useState<SortMode>('totalAsc');
  const [hideUnquoted, setHideUnquoted] = useState(false);
  const [drawerSupplierId, setDrawerSupplierId] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [aiAnalysis, setAiAnalysis] = useState<AnomalyAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // 可对比询价单（至少有一份已提交报价）
  const comparableInquiries = useMemo(
    () =>
      inquiries.filter((i) =>
        getQuotationsByInquiry(i.id).some((q) => q.status === QuotationStatus.SUBMITTED),
      ),
    [inquiries, getQuotationsByInquiry],
  );

  const inquiry = inquiryId ? getInquiryById(inquiryId) : undefined;

  // 切换询价单时重置评语草稿与抽屉
  useEffect(() => {
    setDrawerSupplierId(null);
    setSummaryOpen(false);
    if (inquiry) {
      setCommentDraft({ ...(inquiry.purchaserComments || {}) });
    } else {
      setCommentDraft({});
    }
  }, [inquiry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    () => (drawerSupplierId ? data?.rows.find((r) => r.supplier.id === drawerSupplierId) : undefined),
    [drawerSupplierId, data],
  );

  // ===== 评语处理 =====
  const handleCommentChange = (supplierId: string, val: string) => {
    setCommentDraft((prev) => ({ ...prev, [supplierId]: val }));
  };
  const handleCommentBlur = (supplierId: string) => {
    if (!inquiry) return;
    const val = (commentDraft[supplierId] ?? '').trim();
    const original = (inquiry.purchaserComments?.[supplierId] ?? '').trim();
    if (val === original) return;
    updateInquiry(inquiry.id, {
      purchaserComments: { ...inquiry.purchaserComments, [supplierId]: val },
    });
    notifySuccess(i18n.t('quotation.compare.commentSaved'));
  };

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
      onOk: () => {
        submitForApproval(inquiry.id);
        notifySuccess(i18n.t('quotation.compare.submitApprovalSuccess'));
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
    if (!inquiry || !data) return;

    // sheet1 按物料对比
    const s1Header: (string | number)[] = [
      t('quotation.compare.excel.materialName'),
      t('quotation.compare.excel.materialCode'),
      t('common.spec'),
      t('common.unit'),
      t('common.quantity'),
      t('quotation.compare.excel.targetPrice'),
    ];
    visibleRows.forEach((r) => {
      s1Header.push(`${r.supplier.name}-${t('quotation.compare.unitPrice')}`, `${r.supplier.name}-${t('quotation.compare.excel.totalSuffix')}`, `${r.supplier.name}-${t('quotation.compare.excel.deliveryDaysSuffix')}`, `${r.supplier.name}-${t('quotation.compare.excel.warrantyMonthsSuffix')}`);
    });
    const s1Rows: (string | number)[][] = data.items.map((item) => {
      const row: (string | number)[] = [
        item.name,
        item.code,
        item.spec || '',
        item.unit,
        item.quantity,
        item.targetPrice ?? '',
      ];
      visibleRows.forEach((r) => {
        const qi = getQuotationItem(r, item.id);
        row.push(qi?.unitPrice ?? '', qi?.taxIncludedTotal ?? '', qi?.deliveryDays ?? '', qi?.warrantyMonths ?? '');
      });
      return row;
    });

    // sheet2 按供应商汇总
    const s2Header = [t('quotation.compare.supplier'), t('common.code'), t('common.level'), t('quotation.compare.excel.totalAmount'), t('quotation.compare.excel.avgDeliveryDays'), t('quotation.compare.excel.earliestDeliveryDate'), t('quotation.compare.excel.avgWarrantyMonths'), t('quotation.compare.paymentTerms'), t('quotation.compare.excel.responseRate'), t('quotation.compare.excel.fulfillmentRate'), t('quotation.compare.score')];
    const s2Rows: (string | number)[][] = visibleRows.map((r) => {
      const score = data.scores[r.supplier.id]?.total ?? '';
      return [
        r.supplier.name,
        r.supplier.code,
        t(`enum.supplierLevel.${r.supplier.level}`),
        r.totalAmount,
        r.avgDeliveryDays ? Number(r.avgDeliveryDays.toFixed(1)) : '',
        r.earliestDeliveryDate ? formatDate(r.earliestDeliveryDate) : '',
        r.avgWarrantyMonths ? Number(r.avgWarrantyMonths.toFixed(1)) : '',
        r.paymentTerms || inquiry.paymentTerms || '',
        formatPercent(r.supplier.historyResponseRate),
        formatPercent(r.supplier.historyFulfillmentRate),
        score,
      ];
    });

    // sheet3 评分说明
    const s3Header = [t('quotation.compare.excel.dimension'), t('quotation.compare.excel.weight'), t('quotation.compare.excel.explanation')];
    const s3Rows: (string | number)[][] = [
      [t('quotation.compare.excel.amountDimension'), '50%', t('quotation.compare.excel.amountExplain')],
      [t('quotation.compare.excel.deliveryDimension'), '20%', t('quotation.compare.excel.deliveryExplain')],
      [t('quotation.compare.excel.levelDimension'), '15%', t('quotation.compare.excel.levelExplain')],
      [t('quotation.compare.excel.fulfillmentDimension'), '15%', t('quotation.compare.excel.fulfillmentExplain')],
      [t('quotation.compare.excel.totalDimension'), '100%', t('quotation.compare.excel.totalExplain')],
    ];

    // sheet4 采购评语
    const s4Header = [t('quotation.compare.supplier'), t('quotation.compare.excel.comment')];
    const s4Rows: (string | number)[][] = visibleRows.map((r) => [
      r.supplier.name,
      inquiry.purchaserComments?.[r.supplier.id] ?? '',
    ]);

    exportMultiSheet(t('quotation.compare.excel.fileName', { code: inquiry.code }), [
      { name: t('quotation.compare.excel.sheet1'), header: s1Header, rows: s1Rows },
      { name: t('quotation.compare.excel.sheet2'), header: s2Header, rows: s2Rows },
      { name: t('quotation.compare.excel.sheet3'), header: s3Header, rows: s3Rows },
      { name: t('quotation.compare.excel.sheet4'), header: s4Header, rows: s4Rows },
    ]);
    notifySuccess(i18n.t('quotation.compare.exportSuccess'));
  };

  // ===== 无 inquiryId：可对比询价单卡片列表 =====
  if (!inquiryId) {
    return (
      <div>
        <PageHeader title={t('quotation.compare.title')} description={t('quotation.compare.description')} />
        {comparableInquiries.length === 0 ? (
          <Card>
            <Empty description={t('quotation.compare.noComparable')} />
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {comparableInquiries.map((inq) => {
              const quos = getQuotationsByInquiry(inq.id);
              const submittedCount = quos.filter((q) => q.status === QuotationStatus.SUBMITTED).length;
              const remaining = getRemainingTime(inq.deadline);
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={inq.id}>
                  <Card
                    hoverable
                    size="small"
                    style={{ borderRadius: 8 }}
                    onClick={() => navigate(`/quotation/compare/${inq.id}`)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 14 }}>{inq.subject}</Text>
                      <InquiryStatusTag status={inq.status} />
                    </div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      {inq.code}
                    </Text>
                    <Descriptions size="small" column={1} labelStyle={{ width: 70, fontSize: 12 }} contentStyle={{ fontSize: 12 }}>
                      <Descriptions.Item label={t('quotation.compare.owner')}>{inq.ownerName}</Descriptions.Item>
                      <Descriptions.Item label={t('quotation.compare.materialRows')}>{inq.items.length} {t('quotation.compare.itemsUnit')}</Descriptions.Item>
                      <Descriptions.Item label={t('quotation.compare.quotedCount')}>{submittedCount} / {inq.invitedSupplierIds.length} {t('quotation.compare.supplierUnit')}</Descriptions.Item>
                      <Descriptions.Item label={t('quotation.compare.deadlineShort')}>{formatDate(inq.deadline)}（{remaining.text}）</Descriptions.Item>
                    </Descriptions>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
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
          description={t('quotation.compare.inquiryDesc', { subject: inquiry.subject, code: inquiry.code })}
          extra={
            <Select
              style={{ width: 280 }}
              placeholder={t('quotation.compare.switchInquiry')}
              value={inquiry.id}
              onChange={(val) => navigate(`/quotation/compare/${val}`)}
              options={comparableInquiries.map((i) => ({ label: t('quotation.compare.inquiryDesc', { subject: i.subject, code: i.code }), value: i.id }))}
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
  const canConfirm = canConfirmPerm &&
    (approvalNeeded
      ? hasApprovedNode &&
        (inquiry.status === InquiryStatus.ALL_QUOTED || inquiry.status === InquiryStatus.PENDING_CONFIRM)
      : inquiry.status === InquiryStatus.ALL_QUOTED || inquiry.status === InquiryStatus.PENDING_CONFIRM);
  // 可提交审批：需审批 且 尚未提交（无审批节点） 且 状态为 ALL_QUOTED/PENDING_CONFIRM
  const canSubmitApproval =
    canConfirmPerm &&
    approvalNeeded &&
    !isPendingApproval &&
    inquiry.approvalNodes.length === 0 &&
    (inquiry.status === InquiryStatus.ALL_QUOTED || inquiry.status === InquiryStatus.PENDING_CONFIRM);

  // 头部操作区
  const headerExtra = (
    <Space wrap>
      <Select
        style={{ width: 280 }}
        placeholder={t('quotation.compare.switchInquiry')}
        value={inquiry.id}
        onChange={(val) => navigate(`/quotation/compare/${val}`)}
        options={comparableInquiries.map((i) => ({ label: t('quotation.compare.inquiryDesc', { subject: i.subject, code: i.code }), value: i.id }))}
        showSearch
        optionFilterProp="label"
      />
      <Button icon={<DownloadOutlined />} onClick={handleExport}>
        {t('quotation.compare.exportExcel')}
      </Button>
      <Button icon={<FileSearchOutlined />} onClick={() => setSummaryOpen(true)}>
        {t('quotation.compare.generateSummary')}
      </Button>
      <Button icon={<RobotOutlined />} loading={aiLoading} onClick={handleAiAnalyze}>
        {t('quotation.compare.aiAnalysis')}
      </Button>
      {isPendingApproval && (
        <Tag color="orange" icon={<SafetyCertificateOutlined />} style={{ fontSize: 13, padding: '4px 12px' }}>
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

  // 三个最优供应商
  const lowestRow = data.rows.find((r) => r.supplier.id === data.lowestTotalSupplierId);
  const fastestRow = data.rows.find((r) => r.supplier.id === data.fastestDeliverySupplierId);
  const topRow = data.rows.find((r) => r.supplier.id === data.topScoreSupplierId);
  const topScore = data.topScoreSupplierId ? data.scores[data.topScoreSupplierId] : undefined;

  return (
    <div>
      <PageHeader
        title={t('quotation.compare.title')}
        description={t('quotation.compare.inquiryDesc', { subject: inquiry.subject, code: inquiry.code })}
        extra={headerExtra}
      />

      {/* 询价单基本信息 */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
          <Descriptions.Item label={t('quotation.compare.inquiryStatus')}>
            <InquiryStatusTag status={inquiry.status} />
          </Descriptions.Item>
          <Descriptions.Item label={t('inquiry.list.currency')}>{inquiry.currency}</Descriptions.Item>
          <Descriptions.Item label={t('quotation.compare.owner')}>{inquiry.ownerName}</Descriptions.Item>
          <Descriptions.Item label={t('common.deadline')}>{formatDate(inquiry.deadline, 'YYYY-MM-DD HH:mm')}</Descriptions.Item>
          <Descriptions.Item label={t('quotation.compare.materialRowCount')}>{inquiry.items.length} {t('quotation.compare.itemsUnit')}</Descriptions.Item>
          <Descriptions.Item label={t('quotation.compare.participating')}>{t('quotation.compare.suppliersCount', { count: visibleRows.length })}</Descriptions.Item>
          <Descriptions.Item label={t('quotation.compare.selectedRecommendation')}>{Object.keys(inquiry.selectedSupplierMap).length} {t('quotation.compare.itemsUnit')}</Descriptions.Item>
          <Descriptions.Item label={t('quotation.compare.paymentTerms')}>{inquiry.paymentTerms}</Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 评分规则说明 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, borderRadius: 8 }}
        message={<Text strong>{t('quotation.compare.scoreRule')}</Text>}
        description={
          <span style={{ fontSize: 13 }}>
            {t('quotation.compare.scoreRuleDesc')}
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('quotation.compare.scoreRuleDetail')}
            </Text>
          </span>
        }
      />

      {/* 三项最优 */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>{t('quotation.compare.lowestTotalSupplier')}</Text>}
              valueRender={() => (
                <div>
                  <Text strong style={{ fontSize: 16 }}>{lowestRow?.supplier.name ?? '-'}</Text>
                  {lowestRow && (
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                        {formatCurrency(lowestRow.totalAmount, inquiry.currency)}
                      </Text>
                    </div>
                  )}
                </div>
              )}
              prefix={<Tag color="success" style={{ marginInlineEnd: 4 }}>{t('quotation.compare.lowestPrice')}</Tag>}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>{t('quotation.compare.fastestDeliverySupplier')}</Text>}
              valueRender={() => (
                <div>
                  <Text strong style={{ fontSize: 16 }}>{fastestRow?.supplier.name ?? '-'}</Text>
                  {fastestRow && (
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                        {t('quotation.compare.avgDays', { count: fastestRow.avgDeliveryDays.toFixed(1) })}
                      </Text>
                    </div>
                  )}
                </div>
              )}
              prefix={<Tag color="blue" style={{ marginInlineEnd: 4 }}>{t('quotation.compare.fastestDelivery')}</Tag>}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title={<Text type="secondary" style={{ fontSize: 12 }}>{t('quotation.compare.topScoreSupplier')}</Text>}
              valueRender={() => (
                <div>
                  <Text strong style={{ fontSize: 16 }}>{topRow?.supplier.name ?? '-'}</Text>
                  {topScore && (
                    <div style={{ marginTop: 4 }}>
                      <Text style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                        {t('quotation.compare.scoreValue', { score: topScore.total.toFixed(2) })}
                      </Text>
                    </div>
                  )}
                </div>
              )}
              prefix={<TrophyOutlined style={{ color: 'var(--color-warning)' }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* 控制栏 */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
        <Space wrap size="middle">
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            options={[
              { label: t('quotation.compare.byMaterial'), value: 'material' },
              { label: t('quotation.compare.bySupplier'), value: 'supplier' },
            ]}
          />
          <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>{t('quotation.compare.sortBy')}</span>
          <Segmented
            value={sortMode}
            onChange={(v) => setSortMode(v as SortMode)}
            options={[
              { label: t('quotation.compare.sortTotalAsc'), value: 'totalAsc' },
              { label: t('quotation.compare.sortDeliveryAsc'), value: 'deliveryAsc' },
              { label: t('quotation.compare.sortScoreDesc'), value: 'scoreDesc' },
            ]}
          />
          <Space size="small">
            <Switch size="small" checked={hideUnquoted} onChange={setHideUnquoted} />
            <Text style={{ fontSize: 13 }}>{t('quotation.compare.hideUnquoted')}</Text>
          </Space>
        </Space>
      </Card>

      {/* AI 异常分析结果 */}
      {aiAnalysis && (
        <Alert
          message={
            <Space>
              <RobotOutlined />
              <Text strong>{aiAnalysis.hasAnomaly ? t('quotation.compare.aiResult', { count: aiAnalysis.anomalyCount }) : t('quotation.compare.aiResultNoAnomaly')}</Text>
              <Tag color="purple" style={{ marginInlineStart: 4 }}>{t('quotation.compare.aiGenerated')}</Tag>
            </Space>
          }
          description={
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13, margin: 0, lineHeight: 1.7 }}>
              {aiAnalysis.summary}
            </pre>
          }
          type={aiAnalysis.hasAnomaly ? 'warning' : 'success'}
          showIcon
          closable
          onClose={() => setAiAnalysis(null)}
          style={{ marginBottom: 12, borderRadius: 8, alignItems: 'flex-start' }}
        />
      )}

      {/* 对比表格 */}
      <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }} styles={{ body: { padding: 0 } }}>
        {viewMode === 'material' ? (
          <CompareByMaterialTable
            inquiry={inquiry}
            data={data}
            rows={visibleRows}
            selectedSupplierMap={inquiry.selectedSupplierMap}
            onSelectSupplier={(itemId, supplierId) => {
              selectSupplier(inquiry.id, itemId, supplierId);
              notifySuccess(i18n.t('quotation.compare.selectedSupplierSuccess'));
            }}
            onOpenDrawer={(sid) => setDrawerSupplierId(sid)}
          />
        ) : (
          <CompareBySupplierTable
            inquiry={inquiry}
            data={data}
            rows={visibleRows}
            onOpenDrawer={(sid) => setDrawerSupplierId(sid)}
          />
        )}
      </Card>

      {/* 采购评语 */}
      <Card
        size="small"
        title={<Text strong>{t('quotation.compare.purchaserCommentTitle')}</Text>}
        extra={<Text type="secondary" style={{ fontSize: 12 }}>{t('quotation.compare.autoSaveOnBlur')}</Text>}
        style={{ borderRadius: 8 }}
      >
        <Row gutter={[16, 16]}>
          {visibleRows.map((r) => (
            <Col xs={24} lg={12} key={r.supplier.id}>
              <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text strong style={{ fontSize: 13 }}>{r.supplier.name}</Text>
                <SupplierLevelTag level={r.supplier.level} />
              </div>
              <TextArea
                value={commentDraft[r.supplier.id] ?? ''}
                onChange={(e) => handleCommentChange(r.supplier.id, e.target.value)}
                onBlur={() => handleCommentBlur(r.supplier.id)}
                rows={2}
                placeholder={t('quotation.compare.commentPlaceholder')}
                maxLength={500}
                showCount
              />
            </Col>
          ))}
        </Row>
      </Card>

      {/* 供应商报价详情 Drawer */}
      <SupplierQuotationDrawer
        open={!!drawerSupplierId}
        row={drawerRow}
        inquiry={inquiry}
        comment={drawerSupplierId ? commentDraft[drawerSupplierId] ?? '' : ''}
        onCommentChange={(val) => drawerSupplierId && handleCommentChange(drawerSupplierId, val)}
        onCommentBlur={() => drawerSupplierId && handleCommentBlur(drawerSupplierId)}
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
    </div>
  );
}
