/**
 * 状态标签组件：根据类型渲染对应的状态 Tag
 * B1 i18n：枚举 LABEL 通过 t() 翻译
 */
import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  COOPERATION_STATUS_COLOR,
  CooperationStatus,
  INQUIRY_STATUS_COLOR,
  InquiryStatus,
  QUOTATION_STATUS_COLOR,
  QuotationStatus,
  SUPPLIER_LEVEL_COLOR,
  SupplierLevel,
} from '@/types';

/** 询价单状态标签 */
export function InquiryStatusTag({ status }: { status: InquiryStatus }) {
  const { t } = useTranslation();
  const label = t(`enum.inquiryStatus.${status}`);
  return <Tag color={INQUIRY_STATUS_COLOR[status]} aria-label={label}>{label}</Tag>;
}

/** 供应商等级标签 */
export function SupplierLevelTag({ level }: { level: SupplierLevel }) {
  const { t } = useTranslation();
  const label = t(`enum.supplierLevel.${level}`);
  return <Tag color={SUPPLIER_LEVEL_COLOR[level]} aria-label={label}>{label}</Tag>;
}

/** 合作状态标签 */
export function CooperationStatusTag({ status }: { status: CooperationStatus }) {
  const { t } = useTranslation();
  const label = t(`enum.cooperationStatus.${status}`);
  return <Tag color={COOPERATION_STATUS_COLOR[status]} aria-label={label}>{label}</Tag>;
}

/** 报价状态标签 */
export function QuotationStatusTag({ status }: { status: QuotationStatus }) {
  const { t } = useTranslation();
  const label = t(`enum.quotationStatus.${status}`);
  return <Tag color={QUOTATION_STATUS_COLOR[status]} aria-label={label}>{label}</Tag>;
}
