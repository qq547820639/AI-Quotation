/**
 * i18n 国际化测试（Task 17）
 * - 所有用户可见文案 key 在 zh-CN 与 en-US 中一一对应（遍历扁平化 key 对比）
 * - 切换语言后翻译文案跟随变化
 * - 语言持久化到 localStorage
 */
import { describe, it, expect, afterEach } from 'vitest';
import i18n, { changeLanguage, getCurrentLanguage } from '@/i18n';
import zhCN from '@/locales/zh-CN.json';
import enUS from '@/locales/en-US.json';

/** 将嵌套 JSON 扁平化为 { 'a.b.c': value } 映射 */
function flatten(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Record<string, unknown>, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

describe('i18n 资源 key 一致性', () => {
  it('zh-CN 与 en-US 具有完全相同的 key 集合', () => {
    const zh = flatten(zhCN as Record<string, unknown>);
    const en = flatten(enUS as Record<string, unknown>);
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('每个 key 在 zh-CN 与 en-US 中均有对应翻译（非缺 key 占位）', () => {
    const zh = flatten(zhCN as Record<string, unknown>);
    const en = flatten(enUS as Record<string, unknown>);
    for (const key of Object.keys(zh)) {
      // 翻译值不应是 key 本身（缺失翻译时 i18next 会回退为 key）
      expect(zh[key], `${key} 在 zh-CN 中缺失翻译`).not.toBe(key);
      expect(en[key], `${key} 在 en-US 中缺失翻译`).not.toBe(key);
    }
  });
});

describe('i18n 语言切换', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('切换语言后翻译文案变化', async () => {
    await i18n.changeLanguage('zh-CN');
    const zhTitle = i18n.t('dashboard.title');
    const zhEmpty = i18n.t('dashboard.recent.empty');

    await i18n.changeLanguage('en-US');
    const enTitle = i18n.t('dashboard.title');
    const enEmpty = i18n.t('dashboard.recent.empty');

    // 中英文文案不同且均为真实翻译（非 key 本身）
    expect(zhTitle).not.toBe(enTitle);
    expect(enTitle).not.toBe('dashboard.title');
    expect(zhEmpty).not.toBe(enEmpty);
    expect(enEmpty).not.toBe('dashboard.recent.empty');
  });

  it('changeLanguage 持久化到 localStorage 且 getCurrentLanguage 返回正确', async () => {
    changeLanguage('en-US');
    expect(getCurrentLanguage()).toBe('en-US');
    expect(localStorage.getItem('lang')).toBe('en-US');

    changeLanguage('zh-CN');
    expect(getCurrentLanguage()).toBe('zh-CN');
    expect(localStorage.getItem('lang')).toBe('zh-CN');
  });

  it('切换语言后 i18n.language 更新', async () => {
    await i18n.changeLanguage('en-US');
    expect(i18n.language).toBe('en-US');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.language).toBe('zh-CN');
  });
});