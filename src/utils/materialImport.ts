/**
 * 物料批量导入工具（B6）
 * - parseMaterialFile: 解析 Excel/CSV → Material 主数据（供物料管理页批量导入）
 * - buildMaterials: 为解析结果生成完整 Material（含 id）
 * - parseInquiryItems: 解析 Excel/CSV → InquiryItem[]（供创建询价单 MaterialStep 复用）
 *
 * normalizeCategory 复用自 inquiry/create/shared，保证与 MaterialStep 行为 1:1 一致。
 */
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import type { InquiryItem, Material } from '@/types';
import { normalizeCategory } from '@/pages/inquiry/create/shared';

/** 从行对象中按别名取值（首个非空命中） */
function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return String(row[k]);
  }
  return '';
}

/** 读取首个工作表为行数组 */
async function readRows(file: File): Promise<Record<string, unknown>[]> {
  const data = await file.arrayBuffer();
  // raw: true 防止 CSV 自动检测日期/数字类型（Excel 二进制格式不受影响）
  const wb = XLSX.read(data, { type: 'array', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (!rows.length) throw new Error(i18n.t('material.import.noRows'));
  return rows;
}

/** 解析 Excel/CSV → 物料主数据（不含 id，由 buildMaterials 生成） */
export async function parseMaterialFile(file: File): Promise<Partial<Material>[]> {
  const rows = await readRows(file);
  const items = rows
    .map((row): Partial<Material> => ({
      code: pick(row, ['物料编码', '编码', 'code']),
      name: pick(row, ['物料名称', '名称', 'name']),
      category: normalizeCategory(pick(row, ['物料品类', '品类', 'category'])),
      brand: pick(row, ['品牌', 'brand']),
      spec: pick(row, ['规格型号', '规格', 'spec']),
      techParams: pick(row, ['技术参数', 'techParams']),
      unit: pick(row, ['单位', 'unit']) || '个',
      stockQty: Number(pick(row, ['库存', 'stockQty'])) || undefined,
    }))
    .filter((m) => m.name);
  if (!items.length) throw new Error(i18n.t('material.import.noValidRows'));
  return items;
}

/** 为解析结果生成完整 Material（带 id 与缺省值） */
export function buildMaterials(parsed: Partial<Material>[]): Material[] {
  const now = dayjs().valueOf();
  return parsed.map((m, i) => ({
    id: `mat-${now}-${i}`,
    code: m.code || `MAT${String(now).slice(-6)}${i}`,
    name: m.name!,
    category: m.category!,
    brand: m.brand ?? '',
    spec: m.spec ?? '',
    techParams: m.techParams ?? '',
    unit: m.unit!,
    stockQty: m.stockQty,
  }));
}

/**
 * 解析 Excel/CSV → InquiryItem[]（供 MaterialStep 复用，1:1 还原原内联逻辑）
 * 与 MaterialStep 原 handleImport 行为完全一致。
 */
export async function parseInquiryItems(file: File, inquiryId: string): Promise<InquiryItem[]> {
  const rows = await readRows(file);
  const now = Date.now();
  const items = rows
    .map((row, idx): InquiryItem => {
      const qtyRaw = pick(row, ['采购数量', '数量', 'quantity']);
      const priceRaw = pick(row, ['目标价格', '目标价', 'targetPrice']);
      return {
        id: `item-imp-${now}-${idx}`,
        inquiryId,
        name: pick(row, ['物料名称', '名称', 'name']),
        code: pick(row, ['物料编码', '编码', 'code']),
        category: normalizeCategory(pick(row, ['物料品类', '品类', 'category'])),
        brand: pick(row, ['品牌', 'brand']),
        spec: pick(row, ['规格型号', '规格', 'spec']),
        techParams: pick(row, ['技术参数', 'techParams']),
        unit: pick(row, ['单位', 'unit']),
        quantity: qtyRaw ? Number(qtyRaw) || 0 : 0,
        targetPrice: priceRaw ? Number(priceRaw) || undefined : undefined,
        expectedDeliveryDate:
          pick(row, ['期望交货日期', '交货日期', 'expectedDeliveryDate']) || undefined,
        remark: pick(row, ['备注', 'remark']),
        attachments: [],
      };
    })
    .filter((it) => it.name);
  if (!items.length) throw new Error(i18n.t('material.import.noValidRows'));
  return items;
}
