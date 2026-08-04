/**
 * 格式化工具：货币、日期、百分比、剩余时间
 */
import dayjs from 'dayjs';
import i18n from '@/i18n';
import { CURRENCY_SYMBOL, Currency, type Currency as CurrencyType, type RemainingTime } from '@/types';

/** 根据当前语言选择数字 locale */
function getLocale(): string {
  return i18n.language === 'en-US' ? 'en-US' : 'zh-CN';
}

/** 格式化货币金额（含千分位与币种符号），金额格式与当前语言一致 */
export function formatCurrency(amount: number, currency: CurrencyType = Currency.CNY): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? '¥';
  const formatted = Number(amount || 0).toLocaleString(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

/** 格式化日期，默认 YYYY-MM-DD */
export function formatDate(date?: string | number | Date | null, format = 'YYYY-MM-DD'): string {
  if (!date) return '-';
  const d = dayjs(date);
  if (!d.isValid()) return '-';
  return d.format(format);
}

/** 格式化日期时间，YYYY-MM-DD HH:mm */
export function formatDateTime(date?: string | number | Date | null): string {
  return formatDate(date, 'YYYY-MM-DD HH:mm');
}

/** 格式化百分比，rate 为 0-1 的小数 */
export function formatPercent(rate: number, digits = 1): string {
  if (Number.isNaN(rate)) return '-';
  return `${(rate * 100).toFixed(digits)}%`;
}

/** 计算询价单剩余时间（文案经 i18n 国际化） */
export function getRemainingTime(deadline: string): RemainingTime {
  const now = dayjs();
  const end = dayjs(deadline);
  if (!end.isValid()) {
    return { text: '-', urgent: false, expired: false };
  }
  const diffMs = end.valueOf() - now.valueOf();
  const expired = diffMs <= 0;
  if (expired) {
    return { text: i18n.t('format.expired'), urgent: true, expired: true };
  }
  const diffDay = end.diff(now, 'day');
  const diffHour = end.diff(now, 'hour');
  const diffMin = end.diff(now, 'minute');
  const urgent = diffDay <= 1;
  let text: string;
  if (diffDay >= 1) {
    text = i18n.t('format.remainingDays', { count: diffDay });
  } else if (diffHour >= 1) {
    text = i18n.t('format.remainingHours', { count: diffHour });
  } else {
    text = i18n.t('format.remainingMinutes', { count: Math.max(diffMin, 0) });
  }
  return { text, urgent, expired };
}
