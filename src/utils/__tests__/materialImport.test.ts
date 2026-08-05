/**
 * materialImport 测试（阶段 1.4）
 * 覆盖 parseMaterialFile / buildMaterials / parseInquiryItems
 * 使用 CSV 文件作为输入（xlsx 库原生支持 CSV 解析）
 */
import { describe, it, expect } from 'vitest';
import {
  parseMaterialFile,
  buildMaterials,
  parseInquiryItems,
  parseMaterialFileDetailed,
  isFormulaCell,
  sanitizeCellValue,
  findDuplicateCodes,
  isImportFileTooLarge,
  buildImportErrorReport,
} from '../materialImport';
import type { Material } from '@/types';

/** 构造 CSV 文件（带可用的 arrayBuffer 方法，兼容 jsdom）
 *  含 UTF-8 BOM，与 Excel 导出的 CSV 行为一致
 */
function makeCsvFile(content: string, filename = 'test.csv'): File {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const textBytes = new TextEncoder().encode(content);
  const all = new Uint8Array(bom.length + textBytes.length);
  all.set(bom);
  all.set(textBytes, bom.length);
  const ab = new ArrayBuffer(all.byteLength);
  new Uint8Array(ab).set(all);
  const file = new File([ab], filename, { type: 'text/csv' });
  file.arrayBuffer = () => Promise.resolve(ab);
  return file;
}

describe('parseMaterialFile', () => {
  it('解析标准 CSV（中文列名）', async () => {
    const csv = [
      '物料编码,物料名称,物料品类,品牌,规格型号,单位,库存',
      'MAT001,物料A,工业电子,品牌X,规格Y,个,100',
      'MAT002,物料B,电子设备,品牌Z,规格W,件,50',
    ].join('\n');
    const result = await parseMaterialFile(makeCsvFile(csv));
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('MAT001');
    expect(result[0].name).toBe('物料A');
    expect(result[0].category).toBe('工业电子');
    expect(result[0].brand).toBe('品牌X');
    expect(result[0].spec).toBe('规格Y');
    expect(result[0].unit).toBe('个');
    expect(result[0].stockQty).toBe(100);
    // "电子设备" 应被 normalizeCategory 归一化为 "工业电子"
    expect(result[1].category).toBe('工业电子');
  });

  it('支持英文列名别名', async () => {
    const csv = ['code,name,category,brand,spec,unit', 'MAT001,MaterialA,工业电子,B,S,U'].join(
      '\n',
    );
    const result = await parseMaterialFile(makeCsvFile(csv));
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('MAT001');
    expect(result[0].name).toBe('MaterialA');
  });

  it('缺单位时默认"个"', async () => {
    const csv = ['物料名称,物料编码', '物料A,MAT001'].join('\n');
    const result = await parseMaterialFile(makeCsvFile(csv));
    expect(result[0].unit).toBe('个');
  });

  it('空行/无名称行被过滤', async () => {
    const csv = [
      '物料名称,物料编码',
      '物料A,MAT001',
      ',MAT002', // 无名称，应被过滤
      '物料B,MAT003',
    ].join('\n');
    const result = await parseMaterialFile(makeCsvFile(csv));
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('物料A');
    expect(result[1].name).toBe('物料B');
  });

  it('无有效行时抛出错误', async () => {
    const csv = ['物料编码,物料品类', 'MAT001,工业电子'].join('\n'); // 无"物料名称"列
    await expect(parseMaterialFile(makeCsvFile(csv))).rejects.toThrow('未解析到有效物料行');
  });

  it('空文件抛出错误', async () => {
    const csv = '';
    await expect(parseMaterialFile(makeCsvFile(csv))).rejects.toThrow();
  });
});

describe('buildMaterials', () => {
  it('为每条记录生成 id 与缺省值', () => {
    const parsed: Partial<Material>[] = [
      { code: 'MAT001', name: '物料A', category: '工业电子', unit: '个' },
      { name: '物料B', category: '五金件', unit: '件' }, // 无 code
    ];
    const materials = buildMaterials(parsed);
    expect(materials).toHaveLength(2);
    expect(materials[0].id).toMatch(/^mat-\d+-0$/);
    expect(materials[0].code).toBe('MAT001');
    expect(materials[0].brand).toBe(''); // 缺省
    expect(materials[0].spec).toBe('');
    expect(materials[1].id).toMatch(/^mat-\d+-1$/);
    expect(materials[1].code).toMatch(/^MAT\d+1$/); // 自动生成 code
  });

  it('保留 stockQty 可选值', () => {
    const materials = buildMaterials([
      { name: 'A', category: 'C', unit: '个', stockQty: 50 },
      { name: 'B', category: 'C', unit: '个' },
    ]);
    expect(materials[0].stockQty).toBe(50);
    expect(materials[1].stockQty).toBeUndefined();
  });
});

describe('parseInquiryItems', () => {
  it('解析询价明细：含数量、目标价、期望交货日期', async () => {
    const csv = [
      '物料名称,物料编码,物料品类,采购数量,目标价格,期望交货日期,备注',
      '物料A,MAT001,工业电子,10,100,2026-08-20,加急',
    ].join('\n');
    const items = await parseInquiryItems(makeCsvFile(csv), 'inq-1');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.inquiryId).toBe('inq-1');
    expect(item.name).toBe('物料A');
    expect(item.code).toBe('MAT001');
    expect(item.quantity).toBe(10);
    expect(item.targetPrice).toBe(100);
    expect(item.expectedDeliveryDate).toBe('2026-08-20');
    expect(item.remark).toBe('加急');
    expect(item.attachments).toEqual([]);
  });

  it('数量/价格为空时分别取 0 / undefined', async () => {
    const csv = ['物料名称', '物料A'].join('\n');
    const items = await parseInquiryItems(makeCsvFile(csv), 'inq-1');
    expect(items[0].quantity).toBe(0);
    expect(items[0].targetPrice).toBeUndefined();
  });

  it('无有效行抛出错误', async () => {
    const csv = '物料编码\nMAT001';
    await expect(parseInquiryItems(makeCsvFile(csv), 'inq-1')).rejects.toThrow(
      '未解析到有效物料行',
    );
  });
});

describe('parseMaterialFileDetailed（部分导入：错误行/列/原因）', () => {
  it('无名称行记为错误而非静默丢弃，有效行进入 items', async () => {
    const csv = [
      '物料名称,物料编码,库存',
      '物料A,MAT001,10',
      ',MAT002,5', // 无名称 → 错误
      '物料B,MAT003,abc', // 库存非数字 → 错误（该行仍保留，仅丢弃非法库存）
    ].join('\n');
    const { items, errors } = await parseMaterialFileDetailed(makeCsvFile(csv));
    // 无名称行被跳过；库存非法行保留但该字段置空
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('物料A');
    expect(items[1].name).toBe('物料B');
    expect(items[1].stockQty).toBeUndefined();
    expect(errors).toHaveLength(2);
    // 错误包含数据行号、出错列标识与原因
    expect(errors[0]).toMatchObject({ row: 2, column: 'name', message: '缺少物料名称' });
    expect(errors[1]).toMatchObject({ row: 3, column: 'stockQty' });
    expect(errors[1].message).toContain('abc');
  });

  it('空文件解析失败时返回首行 file 错误而非抛异常', async () => {
    const { items, errors } = await parseMaterialFileDetailed(makeCsvFile(''));
    expect(items).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 0, column: 'file' });
  });

  it('合法库存数字被解析为 stockQty', async () => {
    const csv = ['物料名称,库存', '物料A,42'].join('\n');
    const { items, errors } = await parseMaterialFileDetailed(makeCsvFile(csv));
    expect(errors).toHaveLength(0);
    expect(items[0].stockQty).toBe(42);
  });
});

describe('公式注入防护', () => {
  it('isFormulaCell 识别 = + - @ 前缀的可疑单元格', () => {
    expect(isFormulaCell('=1+1')).toBe(true);
    expect(isFormulaCell('+SUM(A1)')).toBe(true);
    expect(isFormulaCell('@cmd')).toBe(true);
    expect(isFormulaCell('-5')).toBe(false); // 纯数字
    expect(isFormulaCell('2026-08-01')).toBe(false); // 合法日期
    expect(isFormulaCell('正常文本')).toBe(false);
    expect(isFormulaCell('')).toBe(false);
  });

  it('sanitizeCellValue 为可疑单元格加单引号中和', () => {
    expect(sanitizeCellValue('=cmd')).toBe("'=cmd");
    expect(sanitizeCellValue('普通文本')).toBe('普通文本');
    expect(sanitizeCellValue('')).toBe('');
  });
});

describe('findDuplicateCodes（幂等去重检测）', () => {
  it('返回重复的物料编码集合', () => {
    const dup = findDuplicateCodes([
      { code: 'MAT001' },
      { code: 'MAT001' },
      { code: 'MAT002' },
      { code: 'MAT001' },
      { code: '' },
      { code: '  ' },
    ]);
    expect(dup).toEqual(['MAT001']);
  });

  it('无重复时返回空数组', () => {
    expect(findDuplicateCodes([{ code: 'A' }, { code: 'B' }])).toEqual([]);
  });
});

describe('isImportFileTooLarge', () => {
  it('超过上限判定为过大', () => {
    const big = new File([new Uint8Array(1024)], 'big.csv');
    expect(isImportFileTooLarge(big, 100)).toBe(true);
    const small = new File([new Uint8Array(10)], 'small.csv');
    expect(isImportFileTooLarge(small, 100)).toBe(false);
  });

  it('默认使用 5MB 上限', () => {
    const f = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'f.csv');
    expect(isImportFileTooLarge(f)).toBe(true);
  });
});

describe('buildImportErrorReport（错误报告 CSV）', () => {
  it('生成含表头与逐行错误的 CSV 文本', () => {
    const csv = buildImportErrorReport([{ row: 2, column: 'name', message: '缺少物料名称' }]);
    const lines = csv.split('\n');
    expect(lines[0].split(',')).toEqual(['数据行', '出错列', '错误原因']);
    expect(lines[1]).toContain('2');
    expect(lines[1]).toContain('name');
    expect(lines[1]).toContain('缺少物料名称');
  });

  it('含逗号/引号/换行的单元格被正确转义', () => {
    const csv = buildImportErrorReport([
      { row: 1, column: 'stockQty', message: '含,逗号\n和"引号"' },
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toMatch(/^1,/);
    expect(csv).toContain('"含,逗号');
  });
});
