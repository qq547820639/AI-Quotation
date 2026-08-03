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
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import {
  ApprovalNodeStatus,
  APPROVAL_NODE_STATUS_COLOR,
  InquiryStatus,
  type ApprovalNode,
  type Inquiry,
} from '@/types';
import { formatCurrency, formatDateTime } from '@/utils/format';
import { notifySuccess } from '@/utils/confirm';
import i18n from '@/i18n';

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
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
  const approveInquiry = useInquiryStore((s) => s.approveInquiry);
  const rejectInquiry = useInquiryStore((s) => s.rejectInquiry);
  const currentUser = useAuthStore((s) => s.currentUser);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [tab, setTab] = useState<Tab>('pending');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'approve' | 'reject'>('approve');
  const [modalInquiryId, setModalInquiryId] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const inquiries = useMemo(
    () => getVisibleInquiries(currentOrganization),
    [getVisibleInquiries, currentOrganization],
  );

  const pendingList = useMemo(
    () => inquiries.filter((i) => i.status === InquiryStatus.PENDING_APPROVAL),
    [inquiries],
  );
  const historyList = useMemo(
    () =>
      inquiries.filter((i) =>
        i.approvalNodes.some(
          (n) => n.status === ApprovalNodeStatus.APPROVED || n.status === ApprovalNodeStatus.REJECTED,
        ),
      ),
    [inquiries],
  );

  const stats = useMemo(() => {
    const pending = pendingList.length;
    const approved = inquiries.filter((i) =>
      i.approvalNodes.some((n) => n.status === ApprovalNodeStatus.APPROVED),
    ).length;
    const rejected = inquiries.filter((i) =>
      i.approvalNodes.some((n) => n.status === ApprovalNodeStatus.REJECTED),
    ).length;
    return { pending, approved, rejected };
  }, [pendingList, inquiries]);

  const openModal = (action: 'approve' | 'reject', inquiryId: string) => {
    setModalAction(action);
    setModalInquiryId(inquiryId);
    setComment('');
    setModalOpen(true);
  };

  const handleModalOk = () => {
    if (!modalInquiryId) return;
    const action = modalAction === 'approve' ? approveInquiry : rejectInquiry;
    action(modalInquiryId, comment.trim());
    setModalOpen(false);
    notifySuccess(modalAction === 'approve' ? i18n.t('approval.approvePassed') : i18n.t('approval.rejectPassed'));
  };

  const columns: ColumnsType<Inquiry> = [
    {
      title: t('approval.inquiry'),
      dataIndex: 'code',
      key: 'code',
      width: 200,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate(`/inquiry/detail/${r.id}`)}>
            {r.code}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.subject}</Text>
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
        return <Text strong style={{ color: 'var(--color-primary)' }}>{formatCurrency(total, r.currency)}</Text>;
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
      <PageHeader
        title={t('approval.managementTitle')}
        description={t('approval.description')}
      />

      <Permission perm="INQUIRY_APPROVE" fallback={<Empty description={t('approval.noPermission')} style={{ padding: 80 }} />}>
        {/* 统计卡片 */}
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic
                title={t('approval.pending')}
                value={stats.pending}
                prefix={<SafetyCertificateOutlined style={{ color: 'var(--color-warning)' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic
                title={t('approval.approved')}
                value={stats.approved}
                prefix={<CheckCircleOutlined style={{ color: 'var(--color-success)' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic
                title={t('approval.rejected')}
                value={stats.rejected}
                prefix={<CloseCircleOutlined style={{ color: 'var(--color-error)' }} />}
              />
            </Card>
          </Col>
        </Row>

        <Card style={{ borderRadius: 8 }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Segmented
              value={tab}
              onChange={(v) => setTab(v as Tab)}
              options={[
                { label: t('approval.pendingWithCount', { count: pendingList.length }), value: 'pending' },
                { label: t('approval.historyWithCount', { count: historyList.length }), value: 'history' },
              ]}
            />

            <Table
              rowKey="id"
              size="middle"
              columns={columns}
              dataSource={tab === 'pending' ? pendingList : historyList}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              scroll={{ x: 980 }}
              locale={{
                emptyText: (
                  <Empty
                    image={<FileTextOutlined style={{ fontSize: 48, color: 'var(--color-text-tertiary)' }} />}
                    description={tab === 'pending' ? t('approval.emptyPending') : t('approval.emptyHistory')}
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
        title={modalAction === 'approve' ? t('approval.approveModalTitle') : t('approval.rejectModalTitle')}
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={() => setModalOpen(false)}
        okText={t('common.ok')}
        cancelText={t('common.cancel')}
        okButtonProps={modalAction === 'reject' ? { danger: true } : {}}
      >
        <Form layout="vertical">
          <Form.Item label={t('approval.comment')}>
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder={modalAction === 'approve' ? t('approval.commentOptionalPlaceholder') : t('approval.rejectReasonPlaceholder')}
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
          <Descriptions.Item label={t('approval.inquiryCodeLabel')}>{inquiry.code}</Descriptions.Item>
          <Descriptions.Item label={t('approval.subject')}>{inquiry.subject}</Descriptions.Item>
          <Descriptions.Item label={t('approval.selectedAmount')}>
            {formatCurrency(getSelectedTotal(inquiry), inquiry.currency)}
          </Descriptions.Item>
          <Descriptions.Item label={t('approval.submittedAt')}>{formatDateTime(inquiry.updatedAt)}</Descriptions.Item>
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
