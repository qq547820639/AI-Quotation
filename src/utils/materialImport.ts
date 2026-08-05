/**
 * 物料批量导入工具（B6 / P2 Task 16）
 * - parseMaterialFile: 解析 Excel/CSV → Material 主数据（供物料管理页批量导入）
 * - parseMaterialFileDetailed: 解析并返回逐行错误（错误行/列/原因），支持部分有效数据导入
 * - buildMaterials: 为解析结果生成完整 Material（含 id）
 * - parseInquiryItems: 解析 Excel/CSV → InquiryItem[]（供创建询价单 MaterialStep 复用）
 * - sanitizeCellValue: 公式注入防护（= + - @ 前缀中和）
 * - findDuplicateCodes / isImportFileTooLarge / buildImportErrorReport: 幂等、大文件、错误报告
 *
 * normalizeCategory 复用自 inquiry/create/shared，保证与 MaterialStep 行为 1:1 一致。
 */
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import type { InquiryItem, Material } from '@/types';
import { normalizeCategory } from '@/pages/inquiry/create/shared';

/** 通用文件导入大小上限（默认 5MB 内为合理交互体积；超大文件应走异步任务） */
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

/** 单个导入错误（行、列、原因） */
export interface ImportCellError {
  /** 数据行号（1 起，不含表头） */
  row: number;
  /** 列标识（物料编码/物料名称/品类/品牌/规格/技术参数/单位/库存） */
  column: string;
  /** 错误原因（已 i18n 化文案） */
  message: string;
}

/** 详细解析结果：有效行 + 逐行错误 */
export interface MaterialImportDetailed {
  items: Partial<Material>[];
  errors: ImportCellError[];
}

/** 判定单值是否可能构成公式注入（以 = + - @ 开头且后续含非数字/非日期内容） */
export function isFormulaCell(value: string): boolean {
  if (!value) return false;
  const first = value.trim()[0];
  if (first !== '=' && first !== '+' && first !== '-' && first !== '@') return false;
  // 纯数字（如 -5）或合法日期不算注入；其余视为潜在公式
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return false;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value.trim())) return false;
  return true;
}

/**
 * 中和公式注入：将 = + - @ 开头的可疑单元格前面加单引号，
 * 使结果显示为文本而不是被 Excel 当作公式执行。
 */
export function sanitizeCellValue(value: string): string {
  if (!value) return value;
  return isFormulaCell(value) ? `'${value}` : value;
}

/** 从行对象中按别名取值（首个非空命中，并对文本做公式注入中和） */
function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return sanitizeCellValue(String(row[k]));
  }
  return '';
}

/** 判断文件是否为 CSV（按扩展名或 MIME 类型） */
function isCsvFile(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.csv') || file.type === 'text/csv';
}

/** 解析 CSV 文本为标准二维数组（支持引号转义与 \r\n） */
function parseCsvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      out.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === '\r') {
      row.push(field);
      field = '';
      out.push(row);
      row = [];
      i += 1;
      if (text[i] === '\n') i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** 将二维数组（首行为表头，空单元格按 defval:'' 语义取空字符串）转为行对象数组 */
function aoaToRowObjects(cells: string[][]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const [headerRow, ...dataRows] = cells;
  if (!headerRow || !headerRow.length) return rows;
  const header = headerRow.map((h) => String(h ?? ''));
  for (const dataRow of dataRows) {
    if (!dataRow.length) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      obj[h] = dataRow[idx] ?? '';
    });
    rows.push(obj);
  }
  return rows;
}

/** 读取 CSV 文件为行对象数组 */
function readCsvRows(file: File): Promise<Record<string, unknown>[]> {
  return file.arrayBuffer().then((ab) => {
    // TextDecoder 默认去除 UTF-8 BOM（Excel 导出的 CSV 常带 BOM）
    const text = new TextDecoder('utf-8').decode(ab);
    return aoaToRowObjects(parseCsvRows(text));
  });
}

/** 读取首个工作表为行数组 */
async function readRows(file: File): Promise<Record<string, unknown>[]> {
  if (isCsvFile(file)) {
    const rows = await readCsvRows(file);
    if (!rows.length) throw new Error(i18n.t('material.import.noRows'));
    return rows;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(i18n.t('material.import.parseFailed'));
  const rows: Record<string, unknown>[] = [];
  let header: string[] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = (row.values as unknown[]).slice(1); // exceljs 索引 0 为空占位
    if (rowNumber === 1) {
      header = values.map((v) => String(v ?? ''));
      return;
    }
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    rows.push(obj);
  });
  if (!rows.length) throw new Error(i18n.t('material.import.noRows'));
  return rows;
}

/** 解析 Excel/CSV → 物料主数据（不含 id，由 buildMaterials 生成） */
export async function parseMaterialFile(file: File): Promise<Partial<Material>[]> {
  const { items } = await parseMaterialFileDetailed(file);
  if (!items.length) throw new Error(i18n.t('material.import.noValidRows'));
  return items;
}

/**
 * 解析 Excel/CSV → 物料主数据 + 逐行错误（P2 Task 16）
 * - 空文件/无表头 → errors 标记
 * - 无物料名称 → 该行计入错误（列=物料名称）而非静默丢弃
 * - 库存非数字 → 该行计入错误（列=库存）
 * - 支持部分有效数据导入：有效行进入 items，错误行进入 errors
 */
export async function parseMaterialFileDetailed(file: File): Promise<MaterialImportDetailed> {
  let rows: Record<string, unknown>[];
  try {
    rows = await readRows(file);
  } catch (_e) {
    return {
      items: [],
      errors: [{ row: 0, column: 'file', message: i18n.t('material.import.parseFailed') }],
    };
  }
  const errors: ImportCellError[] = [];
  const items: Partial<Material>[] = [];
  rows.forEach((row, idx) => {
    const lineNo = idx + 1; // 数据行号（1 起，不含表头——sheet_to_json 已跳过表头）
    const name = pick(row, ['物料名称', '名称', 'name']);
    const code = pick(row, ['物料编码', '编码', 'code']);
    const stockRaw = pick(row, ['库存', 'stockQty']);
    if (!name) {
      errors.push({
        row: lineNo,
        column: 'name',
        message: i18n.t('material.import.errorNoName'),
      });
      return;
    }
    let stockQty: number | undefined;
    if (stockRaw) {
      const n = Number(stockRaw);
      if (Number.isFinite(n) && n >= 0) {
        stockQty = n;
      } else {
        errors.push({
          row: lineNo,
          column: 'stockQty',
          message: i18n.t('material.import.errorInvalidNumber', { value: stockRaw }),
        });
      }
    }
    items.push({
      code,
      name,
      category: normalizeCategory(pick(row, ['物料品类', '品类', 'category'])),
      brand: pick(row, ['品牌', 'brand']),
      spec: pick(row, ['规格型号', '规格', 'spec']),
      techParams: pick(row, ['技术参数', 'techParams']),
      unit: pick(row, ['单位', 'unit']) || '个',
      stockQty,
    });
  });
  return { items, errors };
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

/** 幂等：找出重复的物料编码（返回重复项集合，用于导入前去重/提示） */
export function findDuplicateCodes(items: Partial<Material>[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const m of items) {
    const c = (m.code || '').trim();
    if (!c) continue;
    if (seen.has(c)) dups.add(c);
    else seen.add(c);
  }
  return [...dups];
}

/** 大文件判定：超过上限时应改走异步任务，避免阻塞主线程 */
export function isImportFileTooLarge(file: File, maxBytes: number = MAX_IMPORT_FILE_SIZE): boolean {
  return file.size > maxBytes;
}

/** 生成错误报告 CSV 文本（供前端下载），含表头与逐行错误 */
export function buildImportErrorReport(errors: ImportCellError[]): string {
  const header = [
    i18n.t('material.import.reportRow'),
    i18n.t('material.import.reportColumn'),
    i18n.t('material.import.reportReason'),
  ];
  const lines = [header.join(',')];
  for (const e of errors) {
    lines.push([e.row, wrapCsv(e.column), wrapCsv(e.message)].join(','));
  }
  return lines.join('\n');
}

/** CSV 单元格转义（含逗号/引号/换行时加引号包裹） */
function wrapCsv(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
