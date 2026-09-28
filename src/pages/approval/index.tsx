import { useVisibleInquiries } from '@/hooks/useVisibleInquiries';
/**
 * 审批管理（W5）
 * - 待审批列表（PENDING_APPROVAL）
 * - 审批历史（已通过/已驳回）
 * - 通过/驳回操作（含审批意见）
 * - 仅 INQUIRY_APPROVE 权限可见菜单，页面内再次校验
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PageHeader from '@/components/PageHeader';
import Permission from '@/components/Permission';
import { InquiryStatusTag } from '@/components/StatusTag';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useEnterRefresh } from '@/hooks/useEnterRefresh';
import { useAuthStore } from '@/store/useAuthStore';
import {
  ApprovalNodeStatus,
  APPROVAL_NODE_STATUS_COLOR,
  InquiryStatus,
  type ApprovalNode,
  type Inquiry,
} from '@/types';
import { formatCurrency, formatDateTime } from '@/utils/format';
import { notifyError, notifySuccess } from '@/utils/confirm';
import i18n from '@/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { inquiryApi } from '@/api/inquiryApi';
import { IS_DEMO_MODE } from '@/config';
import type { PaginatedInquiries } from '@/types';

/** R110：审批页的服务端取数都挂在这个前缀下，便于一次失效（列表 + 计数） */
const APPROVAL_QUERY = ['approvals'] as const;

const { Text } = Typography;
const { TextArea } = Input;

type Tab = 'pending' | 'history';

/** 计算询价单已选供应商的总金额 */
function getSelectedTotal(inquiry: Inquiry): number {
  const supplierIds = new Set(Object.values(inquiry.selectedSupplierMap));
  let total = 0;
  for (const q of inquiry.quotations) {
    if (supplierIds.has(q.supplierId)) {
      total += q.totalAmount;
    }
  }
  return total;
}

export default function ApprovalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const approveInquiry = useInquiryStore((s) => s.approveInquiry);
  const rejectInquiry = useInquiryStore((s) => s.rejectInquiry);
  const inquiriesLoadError = useInquiryStore((s) => s.loadError);
  const queryClient = useQueryClient();
  // R69 → R110：演示模式仍以 store 为数据源，所以进页要补拉一次（每次挂载恰好一次）；
  // 服务端分页那一支不再为了进页拉整份无界数组，改成把本页的查询标脏重取。
  useEnterRefresh(async () => {
    if (IS_DEMO_MODE) return useInquiryStore.getState().loadFromApi();
    await queryClient.invalidateQueries({ queryKey: APPROVAL_QUERY });
    return undefined;
  });

  const currentUser = useAuthStore((s) => s.currentUser);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [tab, setTab] = useState<Tab>('pending');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'approve' | 'reject'>('approve');
  const [modalInquiryId, setModalInquiryId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inquiries = useVisibleInquiries();

  const pendingList = useMemo(
    () => inquiries.filter((i) => i.status === InquiryStatus.PENDING_APPROVAL),
    [inquiries],
  );
  const historyList = useMemo(
    () =>
      inquiries.filter((i) =>
        i.approvalNodes.some(
          (n) =>
            n.status === ApprovalNodeStatus.APPROVED || n.status === ApprovalNodeStatus.REJECTED,
        ),
      ),
    [inquiries],
  );

  const serverEnabled = !IS_DEMO_MODE;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // 分页参数跟着页签走：pending 按询价状态筛，history 按审批节点状态筛
  const listQuery = serverEnabled
    ? tab === 'pending'
      ? { status: InquiryStatus.PENDING_APPROVAL }
      : { nodeStatus: `${ApprovalNodeStatus.APPROVED},${ApprovalNodeStatus.REJECTED}` }
    : {};

  const { data: pageData, isFetching: pageFetching } = useQuery<PaginatedInquiries>({
    queryKey: [...APPROVAL_QUERY, 'list', tab, page, pageSize],
    queryFn: () => inquiryApi.listPage({ page, pageSize, ...listQuery }),
    enabled: serverEnabled,
  });

  /**
   * 三张统计卡 + 两个页签计数：都取服务端 total，不再扫整份数组。
   * R111：四档计数合成一次 `POST /api/inquiries/counts`——原来这里是 4 发
   * `pageSize=1` 的分页请求，每发都要后端把整条筛选再跑一遍并把 4 份响应穿过网络。
   */
  const { data: countData } = useQuery({
    queryKey: [...APPROVAL_QUERY, 'counts'],
    queryFn: async () => {
      const c = await inquiryApi.counts([
        { label: 'pending', filters: { status: InquiryStatus.PENDING_APPROVAL } },
        {
          label: 'history',
          filters: { nodeStatus: `${ApprovalNodeStatus.APPROVED},${ApprovalNodeStatus.REJECTED}` },
        },
        { label: 'approved', filters: { nodeStatus: ApprovalNodeStatus.APPROVED } },
        { label: 'rejected', filters: { nodeStatus: ApprovalNodeStatus.REJECTED } },
      ]);
      return {
        pending: c.pending,
        history: c.history,
        approved: c.approved,
        rejected: c.rejected,
      };
    },
    enabled: serverEnabled,
  });

  const rows = serverEnabled
    ? (pageData?.items ?? [])
    : tab === 'pending'
      ? pendingList
      : historyList;

  const counts = serverEnabled
    ? (countData ?? { pending: 0, history: 0, approved: 0, rejected: 0 })
    : {
        pending: pendingList.length,
        history: historyList.length,
        approved: inquiries.filter((i) =>
          i.approvalNodes.some((n) => n.status === ApprovalNodeStatus.APPROVED),
        ).length,
        rejected: inquiries.filter((i) =>
          i.approvalNodes.some((n) => n.status === ApprovalNodeStatus.REJECTED),
        ).length,
      };

  /** 审批动作落地后必须让表格与计数重取：服务端那一支不再读 store 的乐观结果 */
  const refreshAfterAction = () => {
    if (serverEnabled) {
      void queryClient.invalidateQueries({ queryKey: APPROVAL_QUERY });
    }
  };

  const openModal = (action: 'approve' | 'reject', inquiryId: string) => {
    setModalAction(action);
    setModalInquiryId(inquiryId);
    setComment('');
    setModalOpen(true);
  };

  const handleModalOk = async () => {
    if (!modalInquiryId) return;
    const action = modalAction === 'approve' ? approveInquiry : rejectInquiry;
    setSubmitting(true);
    try {
      const result = await action(modalInquiryId, comment.trim());
      if (result.success) {
        setModalOpen(false);
        refreshAfterAction();
        notifySuccess(
          modalAction === 'approve'
            ? i18n.t('approval.approvePassed')
            : i18n.t('approval.rejectPassed'),
        );
      } else if (result.reason === 'pending') {
        // 重复提交被拦截，静默
      } else {
        notifyError(result.error?.message ?? i18n.t('common.operateFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<Inquiry> = [
    {
      title: t('approval.inquiry'),
      dataIndex: 'code',
      key: 'code',
      width: 200,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => navigate(`/inquiry/detail/${r.id}`)}
          >
            {r.code}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.subject}
          </Text>
        </Space>
      ),
    },
    {
      title: t('approval.organization'),
      dataIndex: 'organization',
      key: 'organization',
      width: 120,
    },
    {
      title: t('approval.owner'),
      dataIndex: 'ownerName',
      key: 'ownerName',
      width: 100,
    },
    {
      title: t('approval.selectedAmount'),
      key: 'amount',
      width: 140,
      render: (_, r) => {
        const total = getSelectedTotal(r);
        return (
          <Text strong style={{ color: 'var(--color-primary)' }}>
            {formatCurrency(total, r.currency)}
          </Text>
        );
      },
    },
    {
      title: t('approval.approver'),
      key: 'approver',
      width: 120,
      render: (_, r) => {
        const node = r.approvalNodes[r.approvalNodes.length - 1];
        return node ? <Text>{node.approverName}</Text> : '-';
      },
    },
    {
      title: t('common.status'),
      key: 'status',
      width: 100,
      render: (_, r) => <InquiryStatusTag status={r.status} />,
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_, r) => {
        const node = r.approvalNodes[r.approvalNodes.length - 1];
        const canApprove =
          node?.status === ApprovalNodeStatus.PENDING &&
          node.approverId === currentUser.id &&
          hasPermission('INQUIRY_APPROVE');
        if (canApprove) {
          return (
            <Space>
              <Button
                type="primary"
                size="small"
                icon={<CheckCircleOutlined />}
                onClick={() => openModal('approve', r.id)}
              >
                {t('approval.approve')}
              </Button>
              <Button
                danger
                size="small"
                icon={<CloseCircleOutlined />}
                onClick={() => openModal('reject', r.id)}
              >
                {t('approval.reject')}
              </Button>
            </Space>
          );
        }
        if (r.status === InquiryStatus.PENDING_APPROVAL) {
          return <Tag color="processing">{t('approval.pending')}</Tag>;
        }
        const lastNode = r.approvalNodes[r.approvalNodes.length - 1];
        if (lastNode) {
          return (
            <Tag color={APPROVAL_NODE_STATUS_COLOR[lastNode.status]}>
              {t(`enum.approvalNodeStatus.${lastNode.status}`)}
            </Tag>
          );
        }
        return '-';
      },
    },
  ];

  return (
    <div>
      <PageHeader title={t('approval.managementTitle')} description={t('approval.description')} />

      <Permission
        perm="INQUIRY_APPROVE"
        fallback={<Empty description={t('approval.noPermission')} style={{ padding: 80 }} />}
      >
        {/* 统计卡片 */}
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic
                title={t('approval.pending')}
                value={counts.pending}
                prefix={<SafetyCertificateOutlined style={{ color: 'var(--color-warning)' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic
                title={t('approval.approved')}
                value={counts.approved}
                prefix={<CheckCircleOutlined style={{ color: 'var(--color-success)' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic
                title={t('approval.rejected')}
                value={counts.rejected}
                prefix={<CloseCircleOutlined style={{ color: 'var(--color-error)' }} />}
              />
            </Card>
          </Col>
        </Row>

        <Card style={{ borderRadius: 8 }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Segmented
              value={tab}
              onChange={(v) => {
                setTab(v as Tab);
                setPage(1);
              }}
              options={[
                {
                  label: t('approval.pendingWithCount', { count: counts.pending }),
                  value: 'pending',
                },
                {
                  label: t('approval.historyWithCount', { count: counts.history }),
                  value: 'history',
                },
              ]}
            />

            <Table
              rowKey="id"
              size="middle"
              columns={columns}
              dataSource={rows}
              loading={serverEnabled && pageFetching}
              pagination={{
                pageSize,
                current: serverEnabled ? page : undefined,
                total: serverEnabled
                  ? tab === 'pending'
                    ? counts.pending
                    : counts.history
                  : undefined,
                showSizeChanger: true,
                onChange: (p, ps) => {
                  setPage(p);
                  if (ps && ps !== pageSize) {
                    setPageSize(ps);
                    setPage(1);
                  }
                },
              }}
              scroll={{ x: 980 }}
              locale={{
                emptyText: (
                  <Empty
                    image={
                      <FileTextOutlined
                        style={{ fontSize: 48, color: 'var(--color-text-tertiary)' }}
                      />
                    }
                    description={
                      // 清单加载失败时不能说「暂无待审批」——那是把一次同步失败说成业务事实（R33）
                      inquiriesLoadError
                        ? t('common.loadFailed')
                        : tab === 'pending'
                          ? t('approval.emptyPending')
                          : t('approval.emptyHistory')
                    }
                    style={{ padding: 48 }}
                  />
                ),
              }}
              expandable={{
                expandedRowRender: (r) => <ApprovalDetail inquiry={r} />,
                rowExpandable: () => true,
              }}
            />
          </Space>
        </Card>
      </Permission>

      {/* 审批意见 Modal */}
      <Modal
        title={
          modalAction === 'approve'
            ? t('approval.approveModalTitle')
            : t('approval.rejectModalTitle')
        }
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText={t('common.ok')}
        cancelText={t('common.cancel')}
        okButtonProps={
          modalAction === 'reject' ? { danger: true, loading: submitting } : { loading: submitting }
        }
      >
        <Form layout="vertical">
          <Form.Item label={t('approval.comment')}>
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder={
                modalAction === 'approve'
                  ? t('approval.commentOptionalPlaceholder')
                  : t('approval.rejectReasonPlaceholder')
              }
              maxLength={500}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 审批详情展开区：审批节点时间轴 + 询价基本信息 */
function ApprovalDetail({ inquiry }: { inquiry: Inquiry }) {
  const { t } = useTranslation();
  return (
    <Row gutter={24}>
      <Col xs={24} lg={12}>
        <Descriptions title={t('approval.inquiryInfo')} size="small" column={1} bordered>
          <Descriptions.Item label={t('approval.inquiryCodeLabel')}>
            {inquiry.code}
          </Descriptions.Item>
          <Descriptions.Item label={t('approval.subject')}>{inquiry.subject}</Descriptions.Item>
          <Descriptions.Item label={t('approval.selectedAmount')}>
            {formatCurrency(getSelectedTotal(inquiry), inquiry.currency)}
          </Descriptions.Item>
          <Descriptions.Item label={t('approval.submittedAt')}>
            {formatDateTime(inquiry.updatedAt)}
          </Descriptions.Item>
        </Descriptions>
      </Col>
      <Col xs={24} lg={12}>
        <Text strong style={{ display: 'block', marginBottom: 12 }}>
          {t('approval.flow')}
        </Text>
        <Timeline
          items={inquiry.approvalNodes.map((n) => ({
            color:
              n.status === ApprovalNodeStatus.APPROVED
                ? 'green'
                : n.status === ApprovalNodeStatus.REJECTED
                  ? 'red'
                  : 'blue',
            children: <ApprovalNodeItem node={n} />,
          }))}
        />
      </Col>
    </Row>
  );
}

/** 审批节点项 */
function ApprovalNodeItem({ node }: { node: ApprovalNode }) {
  const { t } = useTranslation();
  return (
    <div>
      <Space size={8}>
        <Text strong>{node.approverName}</Text>
        <Tag color={APPROVAL_NODE_STATUS_COLOR[node.status]}>
          {t(`enum.approvalNodeStatus.${node.status}`)}
        </Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {node.approverRole}
        </Text>
      </Space>
      {node.time && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatDateTime(node.time)}
          </Text>
        </div>
      )}
      {node.comment && (
        <div style={{ marginTop: 4 }}>
          <Text style={{ fontSize: 13 }}>{node.comment}</Text>
        </div>
      )}
    </div>
  );
}
