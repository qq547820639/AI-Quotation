/**
 * Excel 导出工具（基于 exceljs）
 * 提供通用二维数组导出与报价对比专用导出
 */
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

/** 计算列宽：取每列最大字符宽度 */
function computeColWidths(header: (string | number)[], rows: (string | number)[][]): number[] {
  return header.map((_, colIdx) => {
    let maxLen = String(header[colIdx] ?? '').length;
    rows.forEach((row) => {
      const cellLen = String(row[colIdx] ?? '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    });
    return Math.min(Math.max(maxLen + 2, 8), 50);
  });
}

/** 将 exceljs 生成的 buffer 通过 Blob 触发浏览器下载 */
function downloadFromBuffer(buffer: ExcelJS.Buffer, filename: string): void {
  const blob = new Blob([buffer as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 通用导出：传入表头与数据行 */
export function exportAOA(
  filename: string,
  header: (string | number)[],
  rows: (string | number)[][],
): void {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(header);
  rows.forEach((row) => ws.addRow(row));
  const colWidths = computeColWidths(header, rows);
  header.forEach((_, colIdx) => {
    ws.getColumn(colIdx + 1).width = colWidths[colIdx];
  });
  const stamp = dayjs().format('YYYYMMDDHHmmss');
  wb.xlsx.writeBuffer().then((buffer) => downloadFromBuffer(buffer, `${filename}_${stamp}.xlsx`));
}

/** 多 sheet 导出 */
export function exportMultiSheet(
  filename: string,
  sheets: { name: string; header: (string | number)[]; rows: (string | number)[][] }[],
): void {
  const wb = new ExcelJS.Workbook();
  sheets.forEach((sheet) => {
    const ws = wb.addWorksheet(sheet.name);
    ws.addRow(sheet.header);
    sheet.rows.forEach((row) => ws.addRow(row));
    const colWidths = computeColWidths(sheet.header, sheet.rows);
    sheet.header.forEach((_, colIdx) => {
      ws.getColumn(colIdx + 1).width = colWidths[colIdx];
    });
  });
  const stamp = dayjs().format('YYYYMMDDHHmmss');
  wb.xlsx.writeBuffer().then((buffer) => downloadFromBuffer(buffer, `${filename}_${stamp}.xlsx`));
}
