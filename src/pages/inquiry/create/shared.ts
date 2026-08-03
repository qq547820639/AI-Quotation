/**
 * 创建询价单：共享常量、类型与辅助函数
 */
import dayjs, { type Dayjs } from 'dayjs';
import {
  CooperationStatus,
  Currency,
  type Attachment,
  type InquiryItem,
  type Inquiry,
  type InquiryLog,
  type LogType,
  type Supplier,
  type SupplierMatch,
} from '@/types';

/* ==================== 选项常量 ==================== */

/** 物料品类选项（aliases 用于与供应商主营品类做匹配映射） */
export interface CategoryOption {
  label: string;
  value: string;
  aliases: string[];
}

export const MATERIAL_CATEGORY_OPTIONS: CategoryOption[] = [
  { label: '工业电子', value: '工业电子', aliases: ['电子设备', '工业设备', '工业电子'] },
  { label: '五金件', value: '五金件', aliases: ['五金件'] },
  { label: '自动化', value: '自动化', aliases: ['自动化设备', '自动化'] },
  { label: '办公设备', value: '办公设备', aliases: ['办公设备'] },
  { label: '包材', value: '包材', aliases: ['包装材料', '包材'] },
  { label: '劳保', value: '劳保', aliases: ['劳保用品', '劳保'] },
  { label: '传动件', value: '传动件', aliases: ['传动件'] },
  { label: '化工', value: '化工', aliases: ['化工'] },
];

export const PAYMENT_TERM_OPTIONS = [
  '款到发货',
  '月结30天',
  '月结60天',
  '预付30%货到付清',
].map((v) => ({ label: v, value: v }));

export const INVOICE_OPTIONS = [
  '增值税专用发票13%',
  '增值税普通发票',
  '增值税专用发票6%',
].map((v) => ({ label: v, value: v }));

/* ==================== 类型 ==================== */

/** 基本信息表单状态（日期为 Dayjs，便于 DatePicker 直接使用） */
export interface BasicInfoForm {
  subject: string;
  organization: string;
  ownerName: string;
  currency: Currency;
  deadline: Dayjs | null;
  expectedDeliveryDate: Dayjs | null;
  deliveryAddress: string;
  contact: string;
  paymentTerms: string;
  invoiceRequirement?: string;
  description?: string;
  attachments: Attachment[];
}

/** 可序列化的基本信息（日期为字符串，用于 localStorage） */
export interface SerializedBasicInfo extends Omit<BasicInfoForm, 'deadline' | 'expectedDeliveryDate'> {
  deadline: string | null;
  expectedDeliveryDate: string | null;
}

/** 草稿快照 */
export interface DraftSnapshot {
  basicInfo: SerializedBasicInfo;
  items: InquiryItem[];
  selectedSupplierIds: string[];
  current: number;
  editingId?: string;
  savedAt: string;
}

/* ==================== 辅助函数 ==================== */

/** 把物料库的原始品类归一化为本页面选项中的品类 */
export function normalizeCategory(raw: string): string {
  if (!raw) return '';
  const found = MATERIAL_CATEGORY_OPTIONS.find(
    (o) => o.value === raw || o.aliases.includes(raw),
  );
  return found?.value ?? raw;
}

/** 品类命中：物料品类（任一别名）出现在供应商主营品类中 */
export function categoryMatch(
  materialCategory: string,
  supplierMainCategories: string[],
): boolean {
  if (!materialCategory) return false;
  const opt = MATERIAL_CATEGORY_OPTIONS.find((o) => o.value === materialCategory);
  const aliases = opt?.aliases ?? [materialCategory];
  return supplierMainCategories.some((c) => aliases.includes(c));
}

/** 文件大小格式化 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 模拟附件：从 File 生成 Attachment 对象（不上传真实文件） */
export function fileToAttachment(file: File): Attachment {
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    url: URL.createObjectURL(file),
    size: file.size,
    uploadTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  };
}

/** 生成询价单编号：INQYYYYMMDD + 3 位序号 */
export function buildInquiryCode(): string {
  const date = dayjs().format('YYYYMMDD');
  const seq = String(dayjs().valueOf()).slice(-3);
  return `INQ${date}${seq}`;
}

/** 生成日志条目 */
export function buildLog(
  inquiryId: string,
  type: LogType,
  content: string,
  result?: string,
  operator?: string,
  operatorRole?: string,
): InquiryLog {
  return {
    id: `log-${inquiryId}-${dayjs().valueOf()}-${Math.random().toString(36).slice(2, 6)}`,
    inquiryId,
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    operator: operator ?? '',
    operatorRole,
    type,
    content,
    result,
  };
}

/* ==================== 供应商智能匹配 ==================== */

/**
 * 根据物料品类集合与供应商列表计算推荐匹配
 * - 品类命中 +40
 * - 合作状态合格且 qualified +20
 * - 历史响应率 +rate*20
 * - 历史合作次数 +min(count,20)
 * - DISABLED/BLACKLIST 标记禁用
 */
export function computeSupplierMatches(
  suppliers: Supplier[],
  categories: string[],
): SupplierMatch[] {
  const uniqueCats = Array.from(new Set(categories.filter(Boolean)));
  return suppliers
    .map((supplier): SupplierMatch => {
      let disabled = false;
      let disabledReason: string | undefined;
      if (supplier.cooperationStatus === CooperationStatus.DISABLED) {
        disabled = true;
        disabledReason = '供应商已停用';
      } else if (supplier.cooperationStatus === CooperationStatus.BLACKLIST) {
        disabled = true;
        disabledReason = '供应商不合格（黑名单）';
      }

      const matchedCats = uniqueCats.filter((c) =>
        categoryMatch(c, supplier.mainCategories),
      );
      const categoryHit = matchedCats.length > 0;

      let score = 0;
      const parts: string[] = [];
      if (categoryHit) {
        score += 40;
        parts.push('主营品类匹配');
      }
      const statusOk =
        (supplier.cooperationStatus === CooperationStatus.COOPERATING ||
          supplier.cooperationStatus === CooperationStatus.QUALIFIED) &&
        supplier.qualified;
      if (statusOk) {
        score += 20;
      }
      score += Math.round(supplier.historyResponseRate * 20);
      score += Math.min(supplier.historyCoopCount, 20);
      score = Math.max(0, Math.min(100, score));

      parts.push(`历史响应率 ${Math.round(supplier.historyResponseRate * 100)}%`);
      parts.push(`合作 ${supplier.historyCoopCount} 次`);

      return {
        supplier,
        reason: parts.join('·'),
        matchScore: score,
        selected: false,
        disabled,
        disabledReason,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

/* ==================== 草稿序列化 ==================== */

export function serializeBasicInfo(b: BasicInfoForm): SerializedBasicInfo {
  return {
    ...b,
    deadline: b.deadline ? b.deadline.format('YYYY-MM-DD HH:mm:ss') : null,
    expectedDeliveryDate: b.expectedDeliveryDate
      ? b.expectedDeliveryDate.format('YYYY-MM-DD')
      : null,
  };
}

export function deserializeBasicInfo(s: SerializedBasicInfo): BasicInfoForm {
  return {
    ...s,
    deadline: s.deadline ? dayjs(s.deadline) : null,
    expectedDeliveryDate: s.expectedDeliveryDate ? dayjs(s.expectedDeliveryDate) : null,
  };
}

/** 从 Inquiry 实体回填基本信息表单 */
export function inquiryToBasicInfo(inquiry: Inquiry): BasicInfoForm {
  return {
    subject: inquiry.subject,
    organization: inquiry.organization,
    ownerName: inquiry.ownerName,
    currency: inquiry.currency,
    deadline: dayjs(inquiry.deadline),
    expectedDeliveryDate: inquiry.expectedDeliveryDate
      ? dayjs(inquiry.expectedDeliveryDate)
      : null,
    deliveryAddress: inquiry.deliveryAddress,
    contact: inquiry.contact,
    paymentTerms: inquiry.paymentTerms,
    invoiceRequirement: inquiry.invoiceRequirement,
    description: inquiry.description,
    attachments: inquiry.attachments ?? [],
  };
}

/** 深拷贝物料明细并重置 id（用于复制行/历史复制） */
export function cloneItem(item: InquiryItem, inquiryId: string, index: number): InquiryItem {
  return {
    ...item,
    id: `item-${inquiryId || 'new'}-${Date.now()}-${index}`,
    inquiryId,
    attachments: item.attachments ? item.attachments.map((a) => ({ ...a })) : [],
  };
}
