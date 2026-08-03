/**
 * Excel 导出工具（基于 SheetJS / xlsx）
 * 提供通用二维数组导出与报价对比专用导出
 */
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

/** 通用导出：传入表头与数据行 */
export function exportAOA(
  filename: string,
  header: (string | number)[],
  rows: (string | number)[][],
): void {
  const aoa: (string | number)[][] = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 简单列宽自适应：取每列最大字符宽度
  const colWidths = header.map((_, colIdx) => {
    let maxLen = String(header[colIdx] ?? '').length;
    rows.forEach((row) => {
      const cellLen = String(row[colIdx] ?? '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    });
    return { wch: Math.min(Math.max(maxLen + 2, 8), 50) };
  });
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const stamp = dayjs().format('YYYYMMDDHHmmss');
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
}

/** 多 sheet 导出 */
export function exportMultiSheet(
  filename: string,
  sheets: { name: string; header: (string | number)[]; rows: (string | number)[][] }[],
): void {
  const wb = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const aoa: (string | number)[][] = [sheet.header, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const colWidths = sheet.header.map((_, colIdx) => {
      let maxLen = String(sheet.header[colIdx] ?? '').length;
      sheet.rows.forEach((row) => {
        const cellLen = String(row[colIdx] ?? '').length;
        if (cellLen > maxLen) maxLen = cellLen;
      });
      return { wch: Math.min(Math.max(maxLen + 2, 8), 50) };
    });
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  });
  const stamp = dayjs().format('YYYYMMDDHHmmss');
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
}
