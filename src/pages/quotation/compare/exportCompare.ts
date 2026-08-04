/**
 * 报价对比页：导出 Excel 多 Sheet 工作簿（按物料 / 按供应商 / 评分说明 / 采购评语）
 */
import type { TFunction } from 'i18next';
import type { Inquiry } from '@/types';
import type { CompareData, SupplierQuoteRow } from '@/components/quotation/scoreUtils';
import { getQuotationItem } from '@/components/quotation/scoreUtils';
import { formatDate, formatPercent } from '@/utils/format';
import { exportMultiSheet } from '@/utils/excel';

export function exportCompareWorkbook(
  t: TFunction,
  inquiry: Inquiry,
  data: CompareData,
  rows: SupplierQuoteRow[],
): void {
  // sheet1 按物料对比
  const s1Header: (string | number)[] = [
    t('quotation.compare.excel.materialName'),
    t('quotation.compare.excel.materialCode'),
    t('common.spec'),
    t('common.unit'),
    t('common.quantity'),
    t('quotation.compare.excel.targetPrice'),
  ];
  rows.forEach((r) => {
    s1Header.push(
      `${r.supplier.name}-${t('quotation.compare.unitPrice')}`,
      `${r.supplier.name}-${t('quotation.compare.excel.totalSuffix')}`,
      `${r.supplier.name}-${t('quotation.compare.excel.deliveryDaysSuffix')}`,
      `${r.supplier.name}-${t('quotation.compare.excel.warrantyMonthsSuffix')}`,
    );
  });
  const s1Rows: (string | number)[][] = data.items.map((item) => {
    const row: (string | number)[] = [
      item.name,
      item.code,
      item.spec || '',
      item.unit,
      item.quantity,
      item.targetPrice ?? '',
    ];
    rows.forEach((r) => {
      const qi = getQuotationItem(r, item.id);
      row.push(
        qi?.unitPrice ?? '',
        qi?.taxIncludedTotal ?? '',
        qi?.deliveryDays ?? '',
        qi?.warrantyMonths ?? '',
      );
    });
    return row;
  });

  // sheet2 按供应商汇总
  const s2Header = [
    t('quotation.compare.supplier'),
    t('common.code'),
    t('common.level'),
    t('quotation.compare.excel.totalAmount'),
    t('quotation.compare.excel.avgDeliveryDays'),
    t('quotation.compare.excel.earliestDeliveryDate'),
    t('quotation.compare.excel.avgWarrantyMonths'),
    t('quotation.compare.paymentTerms'),
    t('quotation.compare.excel.responseRate'),
    t('quotation.compare.excel.fulfillmentRate'),
    t('quotation.compare.score'),
  ];
  const s2Rows: (string | number)[][] = rows.map((r) => {
    const score = data.scores[r.supplier.id]?.total ?? '';
    return [
      r.supplier.name,
      r.supplier.code,
      t(`enum.supplierLevel.${r.supplier.level}`),
      r.totalAmount,
      r.avgDeliveryDays ? Number(r.avgDeliveryDays.toFixed(1)) : '',
      r.earliestDeliveryDate ? formatDate(r.earliestDeliveryDate) : '',
      r.avgWarrantyMonths ? Number(r.avgWarrantyMonths.toFixed(1)) : '',
      r.paymentTerms || inquiry.paymentTerms || '',
      formatPercent(r.supplier.historyResponseRate),
      formatPercent(r.supplier.historyFulfillmentRate),
      score,
    ];
  });

  // sheet3 评分说明
  const s3Header = [
    t('quotation.compare.excel.dimension'),
    t('quotation.compare.excel.weight'),
    t('quotation.compare.excel.explanation'),
  ];
  const s3Rows: (string | number)[][] = [
    [
      t('quotation.compare.excel.amountDimension'),
      '50%',
      t('quotation.compare.excel.amountExplain'),
    ],
    [
      t('quotation.compare.excel.deliveryDimension'),
      '20%',
      t('quotation.compare.excel.deliveryExplain'),
    ],
    [t('quotation.compare.excel.levelDimension'), '15%', t('quotation.compare.excel.levelExplain')],
    [
      t('quotation.compare.excel.fulfillmentDimension'),
      '15%',
      t('quotation.compare.excel.fulfillmentExplain'),
    ],
    [
      t('quotation.compare.excel.totalDimension'),
      '100%',
      t('quotation.compare.excel.totalExplain'),
    ],
  ];

  // sheet4 采购评语
  const s4Header = [t('quotation.compare.supplier'), t('quotation.compare.excel.comment')];
  const s4Rows: (string | number)[][] = rows.map((r) => [
    r.supplier.name,
    inquiry.purchaserComments?.[r.supplier.id] ?? '',
  ]);

  exportMultiSheet(t('quotation.compare.excel.fileName', { code: inquiry.code }), [
    { name: t('quotation.compare.excel.sheet1'), header: s1Header, rows: s1Rows },
    { name: t('quotation.compare.excel.sheet2'), header: s2Header, rows: s2Rows },
    { name: t('quotation.compare.excel.sheet3'), header: s3Header, rows: s3Rows },
    { name: t('quotation.compare.excel.sheet4'), header: s4Header, rows: s4Rows },
  ]);
}
