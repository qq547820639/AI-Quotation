/**
 * PDF 导出工具（B5）
 * - 基于 jsPDF + html2canvas，将指定 DOM 元素导出为多页 A4 PDF
 * - 暗色主题导出时自动切换为亮色背景，避免 canvas 黑底
 * - 导出失败时回退到 window.print()
 */
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface ExportPDFOptions {
  /** 文件名（无需扩展名，自动追加 .pdf） */
  filename: string;
  /** 页边距（mm），默认 8 */
  margin?: number;
  /** canvas 缩放，默认 2（高清） */
  scale?: number;
  /** 强制背景色（默认白色，避免暗色主题黑底） */
  backgroundColor?: string;
  /** 导出过程中临时隐藏的元素选择器（如操作按钮区），默认 '.no-print' */
  hideSelector?: string;
}

/**
 * 将一个 DOM 元素导出为多页 A4 PDF
 * @throws 当 html2canvas 失败时抛出，调用方应 catch 并回退到 window.print()
 */
export async function exportElementToPDF(
  element: HTMLElement,
  options: ExportPDFOptions,
): Promise<void> {
  const {
    filename,
    margin = 8,
    scale = 2,
    backgroundColor = '#ffffff',
    hideSelector = '.no-print',
  } = options;

  // 1. 临时隐藏标记元素（按钮区/导航等）
  const hiddenEls: Array<{ el: HTMLElement; prev: string }> = [];
  if (hideSelector) {
    element.querySelectorAll<HTMLElement>(hideSelector).forEach((el) => {
      hiddenEls.push({ el, prev: el.style.display });
      el.style.display = 'none';
    });
  }
  // 还原函数
  const restore = () => {
    hiddenEls.forEach(({ el, prev }) => {
      el.style.display = prev;
    });
  };

  try {
    // 2. 渲染 canvas
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      backgroundColor,
      logging: false,
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    // 3. 创建 A4 PDF，按比例分页
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - margin * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'JPEG', margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  } finally {
    restore();
  }
}

/**
 * 导出 PDF，失败时回退到浏览器打印。
 * 返回**实际走了哪条通道**：'pdf' = jsPDF 生成并交给浏览器下载，'print' = 只打开了打印对话框。
 * 存在这个返回值的原因很具体——本函数在回退分支上从不 reject（原样写时调用方的 `.catch`
 * 是死代码，而 `.then` 那句"PDF 导出成功"在只弹出打印框时同样是说谎）。
 */
export async function exportPDFWithFallback(
  element: HTMLElement | null,
  options: ExportPDFOptions,
): Promise<'pdf' | 'print'> {
  if (!element) {
    window.print();
    return 'print';
  }
  try {
    await exportElementToPDF(element, options);
    return 'pdf';
  } catch (err) {
    console.warn('[PDF] exportElementToPDF failed, fallback to window.print:', err);
    window.print();
    return 'print';
  }
}
