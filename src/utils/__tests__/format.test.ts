import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
  getRemainingTime,
} from '../format';
import { Currency } from '@/types';

describe('formatCurrency', () => {
  it('默认人民币格式化', () => {
    expect(formatCurrency(1234.5)).toBe('¥1,234.50');
  });

  it('美元格式化', () => {
    expect(formatCurrency(1000, Currency.USD)).toBe('$1,000.00');
  });

  it('欧元格式化', () => {
    expect(formatCurrency(999.999, Currency.EUR)).toBe('€1,000.00');
  });

  it('null/undefined 归零', () => {
    expect(formatCurrency(null as unknown as number)).toBe('¥0.00');
    expect(formatCurrency(undefined as unknown as number)).toBe('¥0.00');
  });

  it('NaN 归零', () => {
    expect(formatCurrency(NaN)).toBe('¥0.00');
  });
});

describe('formatDate', () => {
  it('空值返回 -', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('无效日期返回 -', () => {
    expect(formatDate('not-a-date')).toBe('-');
  });

  it('默认 YYYY-MM-DD', () => {
    expect(formatDate('2026-08-03')).toBe('2026-08-03');
  });

  it('自定义格式', () => {
    expect(formatDate('2026-08-03T10:30:00', 'YYYY/MM/DD')).toBe('2026/08/03');
  });
});

describe('formatDateTime', () => {
  it('返回 YYYY-MM-DD HH:mm', () => {
    expect(formatDateTime('2026-08-03T10:30:00')).toBe('2026-08-03 10:30');
  });
  it('空值返回 -', () => {
    expect(formatDateTime(null)).toBe('-');
  });
});

describe('formatPercent', () => {
  it('默认 1 位小数', () => {
    expect(formatPercent(0.123)).toBe('12.3%');
  });

  it('自定义小数位', () => {
    expect(formatPercent(0.12345, 2)).toBe('12.35%');
  });

  it('NaN 返回 -', () => {
    expect(formatPercent(NaN)).toBe('-');
  });

  it('0 返回 0.0%', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });
});

describe('getRemainingTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('无效 deadline 返回 -', () => {
    const r = getRemainingTime('invalid');
    expect(r.text).toBe('-');
    expect(r.expired).toBe(false);
    expect(r.urgent).toBe(false);
  });

  it('已截止', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00'));
    const r = getRemainingTime('2026-08-03T09:00:00');
    expect(r.expired).toBe(true);
    expect(r.urgent).toBe(true);
    expect(r.text).toBe('已截止');
  });

  it('剩余天数', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00'));
    const r = getRemainingTime('2026-08-05T10:00:00');
    expect(r.expired).toBe(false);
    expect(r.urgent).toBe(false);
    expect(r.text).toBe('剩余 2 天');
  });

  it('紧急（<=1 天）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00'));
    const r = getRemainingTime('2026-08-04T09:00:00');
    expect(r.urgent).toBe(true);
    expect(r.expired).toBe(false);
  });

  it('剩余小时', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T10:00:00'));
    const r = getRemainingTime('2026-08-03T13:00:00');
    expect(r.urgent).toBe(true);
    expect(r.text).toBe('剩余 3 小时');
  });
});
