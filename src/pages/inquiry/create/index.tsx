/**
 * 创建/编辑询价单页面
 * - 4 步：基本信息 → 物料明细 → 供应商匹配 → 预览发送
 * - 路由 /inquiry/create 与 /inquiry/edit/:id 复用
 * - 草稿自动保存（debounce 2s）+ 离开未保存拦截（useBlocker + beforeunload）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Form,
  Modal,
  Result,
  Space,
  Steps,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '@/components/PageHeader';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  Currency,
  InquiryStatus,
  LogType,
  type Inquiry,
  type InquiryItem,
  type InquiryLog,
} from '@/types';
import {
  confirmAction,
  notifyError,
  notifySuccess,
  notifyWarning,
} from '@/utils/confirm';
import { loadJSON, removeKey, saveJSON } from '@/utils/storage';
import BasicInfoStep from './BasicInfoStep';
import MaterialStep from './MaterialStep';
import SupplierMatchStep from './SupplierMatchStep';
import PreviewStep from './PreviewStep';
import {
  buildInquiryCode,
  buildLog,
  deserializeBasicInfo,
  inquiryToBasicInfo,
  serializeBasicInfo,
  type BasicInfoForm,
  type DraftSnapshot,
} from './shared';

const { Text } = Typography;

const DRAFT_KEY = 'inquiry_draft';

/** 默认基本信息（报价截止时间取自系统设置 deadlineLeadDays） */
function defaultBasicInfo(): BasicInfoForm {
  const { deadlineLeadDays } = useSettingsStore.getState();
  const user = useAuthStore.getState().currentUser;
  return {
    subject: '',
    organization: user.organization,
    ownerName: user.name,
    currency: Currency.CNY,
    deadline: dayjs().add(deadlineLeadDays, 'day'),
    expectedDeliveryDate: null,
    deliveryAddress: '',
    contact: user.name,
    paymentTerms: '款到发货',
    invoiceRequirement: '增值税专用发票13%',
    description: '',
    attachments: [],
  };
}

export default function InquiryCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const editingId = params.id;
  const editMode = !!editingId;

  const [form] = Form.useForm<BasicInfoForm>();

  const STEP_ITEMS = [
    { title: t('inquiry.create.steps.basic'), description: t('inquiry.create.steps.basicDesc') },
    { title: t('inquiry.create.steps.material'), description: t('inquiry.create.steps.materialDesc') },
    { title: t('inquiry.create.steps.supplier'), description: t('inquiry.create.steps.supplierDesc') },
    { title: t('inquiry.create.steps.preview'), description: t('inquiry.create.steps.previewDesc') },
  ];

  const addInquiry = useInquiryStore((s) => s.addInquiry);
  const updateInquiry = useInquiryStore((s) => s.updateInquiry);
  const sendInquiry = useInquiryStore((s) => s.sendInquiry);
  const getInquiryById = useInquiryStore((s) => s.getInquiryById);
  const canSend = useAuthStore((s) => s.hasPermission('INQUIRY_SEND'));

  const editingInquiry = useMemo(
    () => (editingId ? getInquiryById(editingId) : undefined),
    [editingId, getInquiryById],
  );

  const readOnly = useMemo(() => {
    if (!editMode) return false;
    if (!editingInquiry) return false;
    return ![InquiryStatus.DRAFT, InquiryStatus.PENDING_SEND].includes(editingInquiry.status);
  }, [editMode, editingInquiry]);

  const [basicInfo, setBasicInfo] = useState<BasicInfoForm>(() => {
    if (editingInquiry) return inquiryToBasicInfo(editingInquiry);
    return defaultBasicInfo();
  });
  const [items, setItems] = useState<InquiryItem[]>(() => editingInquiry?.items ?? []);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>(
    () => editingInquiry?.invitedSupplierIds ?? [],
  );
  const [current, setCurrent] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState<string>('');

  /** dirty 同步 ref：避免「置脏后立即 navigate」被 blocker 拦截 */
  const dirtyRef = useRef(false);
  const markDirty = useCallback((v: boolean) => {
    dirtyRef.current = v;
    setDirty(v);
  }, []);

  /** 变更回调：置脏 */
  const handleBasicChange = useCallback(
    (values: BasicInfoForm) => {
      setBasicInfo(values);
      markDirty(true);
    },
    [markDirty],
  );
  const handleItemsChange = useCallback(
    (next: InquiryItem[]) => {
      setItems(next);
      markDirty(true);
    },
    [markDirty],
  );
  const handleSupplierChange = useCallback(
    (ids: string[]) => {
      setSelectedSupplierIds(ids);
      markDirty(true);
    },
    [markDirty],
  );

  /** 草稿自动保存（debounce 2s） */
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSave = useCallback(() => {
    if (readOnly) return;
    // 仅在有未保存改动时自动暂存，避免初始化空状态覆盖已有草稿
    if (!dirtyRef.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const snapshot: DraftSnapshot = {
        basicInfo: serializeBasicInfo(basicInfo),
        items,
        selectedSupplierIds,
        current,
        editingId,
        savedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      };
      saveJSON(DRAFT_KEY, snapshot);
      setLastAutoSave(snapshot.savedAt);
    }, 2000);
  }, [basicInfo, items, selectedSupplierIds, current, editingId, readOnly]);

  useEffect(() => {
    autoSave();
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [autoSave]);

  /** 新建模式：进入时检测未完成草稿，提示恢复 */
  const [restoreChecked, setRestoreChecked] = useState(false);
  useEffect(() => {
    if (editMode || restoreChecked) return;
    setRestoreChecked(true);
    const draft = loadJSON<DraftSnapshot | null>(DRAFT_KEY, null);
    if (draft && !draft.editingId && draft.items?.length) {
      confirmAction({
        title: t('inquiry.create.restoreDraftTitle'),
        content: t('inquiry.create.restoreDraftContent', {
          savedAt: draft.savedAt,
          count: draft.items.length,
        }),
        okText: t('inquiry.create.restoreDraftOk'),
        cancelText: t('inquiry.create.restoreDraftCancel'),
        onOk: () => {
          setBasicInfo(deserializeBasicInfo(draft.basicInfo));
          setItems(draft.items);
          setSelectedSupplierIds(draft.selectedSupplierIds ?? []);
          setCurrent(draft.current ?? 0);
          markDirty(false);
          notifySuccess(t('inquiry.create.restoredDraft'));
        },
        onCancel: () => {
          removeKey(DRAFT_KEY);
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 离开未保存拦截（读取 ref，确保保存/发送后立即导航不被拦截） */
  const blocker = useBlocker(() => dirtyRef.current && !readOnly);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      const modal = Modal.confirm({
        title: t('inquiry.create.leavePageTitle'),
        content: t('inquiry.create.leavePageContent'),
        okText: t('inquiry.create.leave'),
        cancelText: t('inquiry.create.continueEdit'),
        okType: 'danger',
        onOk: () => {
          blocker.proceed();
        },
        onCancel: () => {
          blocker.reset();
        },
      });
      return () => modal.destroy();
    }
  }, [blocker, t]);

  /** 浏览器关闭/刷新提醒 */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current && !readOnly) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [readOnly]);

  /** 步骤校验 */
  const validateStep = useCallback(
    async (step: number): Promise<boolean> => {
      if (readOnly) return true;
      try {
        if (step === 0) {
          await form.validateFields();
          return true;
        }
        if (step === 1) {
          if (items.length === 0) {
            notifyError(t('inquiry.create.atLeastOneItem'));
            return false;
          }
          const noName = items.filter((it) => !it.name?.trim());
          if (noName.length) {
            notifyError(t('inquiry.create.itemsNameMissing', { count: noName.length }));
            return false;
          }
          const noQty = items.filter((it) => !(Number(it.quantity) > 0));
          if (noQty.length) {
            notifyError(t('inquiry.create.itemsQtyInvalid', { count: noQty.length }));
            return false;
          }
          return true;
        }
        return true;
      } catch {
        notifyError(t('inquiry.create.completeRequired'));
        return false;
      }
    },
    [form, items, readOnly, t],
  );

  const handleNext = async () => {
    const ok = await validateStep(current);
    if (!ok) return;
    setCurrent((c) => Math.min(c + 1, STEP_ITEMS.length - 1));
  };

  const handlePrev = () => {
    setCurrent((c) => Math.max(c - 1, 0));
  };

  const handleStepClick = async (target: number) => {
    if (target === current) return;
    if (target > current) {
      for (let s = current; s < target; s++) {
        const ok = await validateStep(s);
        if (!ok) return;
      }
    }
    setCurrent(target);
  };

  /** 构建 Inquiry 对象 */
  const buildInquiry = useCallback(
    (status: InquiryStatus): Inquiry => {
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
      const isEdit = !!editingInquiry;
      const id = isEdit ? editingInquiry!.id : `inq-${Date.now()}`;
      const code = isEdit ? editingInquiry!.code : buildInquiryCode();
      const user = useAuthStore.getState().currentUser;

      const builtItems: InquiryItem[] = items.map((it, idx) => ({
        ...it,
        id: `item-${id}-${idx + 1}`,
        inquiryId: id,
        attachments: it.attachments ? it.attachments.map((a) => ({ ...a })) : [],
      }));

      const logs: InquiryLog[] = isEdit ? [...(editingInquiry!.logs ?? [])] : [];
      if (!isEdit) {
        logs.push(
          buildLog(
            id,
            LogType.CREATE,
            `创建询价单 ${code}`,
            undefined,
            user.name,
            user.role,
          ),
        );
      } else {
        logs.push(
          buildLog(
            id,
            LogType.UPDATE,
            '修改询价单内容',
            undefined,
            user.name,
            user.role,
          ),
        );
      }
      if (status === InquiryStatus.DRAFT) {
        logs.push(
          buildLog(
            id,
            LogType.SAVE_DRAFT,
            '保存询价单草稿',
            undefined,
            user.name,
            user.role,
          ),
        );
      }

      return {
        id,
        code,
        subject: basicInfo.subject,
        organization: basicInfo.organization,
        ownerName: basicInfo.ownerName,
        ownerId: isEdit ? editingInquiry!.ownerId : user.id,
        currency: basicInfo.currency,
        deadline: basicInfo.deadline
          ? basicInfo.deadline.format('YYYY-MM-DD HH:mm:ss')
          : '',
        expectedDeliveryDate: basicInfo.expectedDeliveryDate
          ? basicInfo.expectedDeliveryDate.format('YYYY-MM-DD')
          : undefined,
        deliveryAddress: basicInfo.deliveryAddress,
        contact: basicInfo.contact,
        paymentTerms: basicInfo.paymentTerms,
        invoiceRequirement: basicInfo.invoiceRequirement,
        description: basicInfo.description,
        attachments: basicInfo.attachments ?? [],
        items: builtItems,
        invitedSupplierIds: selectedSupplierIds,
        quotations: isEdit ? editingInquiry!.quotations : [],
        logs,
        status,
        createdById: isEdit ? editingInquiry!.createdById : user.id,
        createdByName: isEdit ? editingInquiry!.createdByName : user.name,
        createdAt: isEdit ? editingInquiry!.createdAt : now,
        updatedAt: now,
        selectedSupplierMap: isEdit ? editingInquiry!.selectedSupplierMap : {},
        purchaserComments: isEdit ? editingInquiry!.purchaserComments : {},
        approvalNodes: isEdit ? editingInquiry!.approvalNodes : [],
      };
    },
    [basicInfo, items, selectedSupplierIds, editingInquiry],
  );

  /** 保存草稿 */
  const handleSaveDraft = useCallback(() => {
    if (readOnly) return;
    if (!basicInfo.subject?.trim()) {
      notifyWarning(t('inquiry.create.subjectRequiredForDraft'));
      return;
    }
    const inquiry = buildInquiry(InquiryStatus.DRAFT);
    if (editingInquiry) {
      updateInquiry(editingInquiry.id, inquiry);
    } else {
      addInquiry(inquiry);
    }
    removeKey(DRAFT_KEY);
    markDirty(false);
    notifySuccess(t('inquiry.create.draftSaved'));
  }, [basicInfo, buildInquiry, editingInquiry, addInquiry, updateInquiry, readOnly, markDirty, t]);

  /** 一键批量发送 */
  const handleSend = useCallback(() => {
    if (readOnly) return;
    if (!canSend) {
      notifyError(t('inquiry.create.noSendPermission'));
      return;
    }
    if (items.length === 0) {
      notifyError(t('inquiry.create.addMaterialFirst'));
      return;
    }
    if (selectedSupplierIds.length === 0) {
      notifyError(t('inquiry.create.selectAtLeastOneSupplier'));
      return;
    }
    const deadlineText = basicInfo.deadline
      ? basicInfo.deadline.format('YYYY-MM-DD HH:mm')
      : t('inquiry.create.deadlineNotSet');
    confirmAction({
      title: t('inquiry.create.confirmSendTitle'),
      content: t('inquiry.create.confirmSendContent', {
        count: selectedSupplierIds.length,
        deadline: deadlineText,
      }),
      okText: t('inquiry.create.confirmSendOk'),
      cancelText: t('common.cancel'),
      onOk: () => {
        // 两步：先以 DRAFT 保存（拿到稳定 id），再调 sendInquiry 触发状态转换 + INQUIRY_SENT 通知
        const draft = buildInquiry(InquiryStatus.DRAFT);
        if (editingInquiry) {
          updateInquiry(editingInquiry.id, draft);
        } else {
          addInquiry(draft);
        }
        sendInquiry(draft.id);
        removeKey(DRAFT_KEY);
        markDirty(false);
        notifySuccess(t('inquiry.create.sent'));
        navigate(`/inquiry/detail/${draft.id}`);
      },
    });
  }, [
    items.length,
    selectedSupplierIds,
    basicInfo.deadline,
    buildInquiry,
    editingInquiry,
    addInquiry,
    updateInquiry,
    sendInquiry,
    canSend,
    navigate,
    readOnly,
    markDirty,
    t,
  ]);

  const handleCancel = () => {
    const perform = () => {
      removeKey(DRAFT_KEY);
      markDirty(false);
      navigate('/inquiry/list');
    };
    if (dirtyRef.current && !readOnly) {
      confirmAction({
        title: t('inquiry.create.confirmCancelTitle'),
        content: t('inquiry.create.confirmCancelContent'),
        okText: t('inquiry.create.confirmCancelOk'),
        cancelText: t('inquiry.create.continueEdit'),
        danger: true,
        onOk: perform,
      });
    } else {
      perform();
    }
  };

  /* ==================== 异常/只读分支 ==================== */
  if (editMode && !editingInquiry) {
    return (
      <Card>
        <Result
          status="warning"
          title={t('inquiry.create.notFoundTitle')}
          subTitle={t('inquiry.create.notFoundSub', { code: editingId })}
          extra={
            <Button type="primary" onClick={() => navigate('/inquiry/list')}>
              {t('inquiry.create.backToList')}
            </Button>
          }
        />
      </Card>
    );
  }

  if (readOnly && editingInquiry) {
    return (
      <Card>
        <Result
          status="info"
          title={t('inquiry.create.notEditableTitle')}
          subTitle={t('inquiry.create.notEditableSub', {
            code: editingInquiry.code,
            status: t(`enum.inquiryStatus.${editingInquiry.status}`),
          })}
          extra={
            <Space>
              <Button
                type="primary"
                onClick={() => navigate(`/inquiry/detail/${editingInquiry.id}`)}
              >
                {t('inquiry.create.viewDetail')}
              </Button>
              <Button onClick={() => navigate('/inquiry/list')}>
                {t('inquiry.create.backToList')}
              </Button>
            </Space>
          }
        />
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 }}>
      <PageHeader
        title={editMode ? t('inquiry.create.editTitle') : t('inquiry.create.newTitle')}
        description={
          editMode && editingInquiry
            ? t('inquiry.create.editDesc', {
                code: editingInquiry.code,
                subject: editingInquiry.subject,
              })
            : t('inquiry.create.createDesc')
        }
        extra={
          lastAutoSave ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('inquiry.create.autoSavedAt', { time: lastAutoSave })}
            </Text>
          ) : null
        }
      />

      {dirty && (
        <Alert
          type="info"
          showIcon
          message={t('inquiry.create.unsavedChanges')}
          description={t('inquiry.create.unsavedChangesDesc')}
          style={{ marginBottom: 0 }}
        />
      )}

      <Card>
        <Steps
          current={current}
          size="small"
          onChange={handleStepClick}
          items={STEP_ITEMS}
        />
      </Card>

      <Card styles={{ body: { paddingTop: 16, paddingBottom: 16 } }}>
        {current === 0 && (
          <BasicInfoStep
            form={form as FormInstance<BasicInfoForm>}
            initialValues={basicInfo}
            onChange={handleBasicChange}
            disabled={readOnly}
            items={items}
          />
        )}
        {current === 1 && (
          <MaterialStep
            items={items}
            onChange={handleItemsChange}
            editingId={editingId}
            disabled={readOnly}
          />
        )}
        {current === 2 && (
          <SupplierMatchStep
            items={items}
            selectedSupplierIds={selectedSupplierIds}
            onChange={handleSupplierChange}
            onSend={handleSend}
            disabled={readOnly}
          />
        )}
        {current === 3 && (
          <PreviewStep
            basicInfo={basicInfo}
            items={items}
            selectedSupplierIds={selectedSupplierIds}
            onSend={handleSend}
            onBack={() => setCurrent(2)}
          />
        )}
      </Card>

      {/* 底部固定操作栏 */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
        </Space>
        <Space size={8} wrap>
          <Button icon={<SaveOutlined />} onClick={handleSaveDraft} disabled={readOnly}>
            {t('common.saveDraft')}
          </Button>
          {current > 0 && (
            <Button onClick={handlePrev}>{t('common.prev')}</Button>
          )}
          {current < STEP_ITEMS.length - 1 ? (
            <Button type="primary" onClick={handleNext}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              disabled={readOnly || !canSend || selectedSupplierIds.length === 0 || items.length === 0}
            >
              {t('inquiry.create.batchSend')}
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}
