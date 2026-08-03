/**
 * i18n 基建（B1）
 * - i18next + react-i18next 初始化
 * - 默认 zh-CN，语言持久化到 localStorage `lang`
 * - locale 按模块嵌套：common / menu / enum / dashboard / inquiry / supplier / material / quotation / notification / settings / approval / log / login / errors / supplierPortal
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '@/locales/zh-CN.json';
import enUS from '@/locales/en-US.json';

export type AppLanguage = 'zh-CN' | 'en-US';

const LANG_STORAGE_KEY = 'lang';

function detectInitialLanguage(): AppLanguage {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (saved === 'zh-CN' || saved === 'en-US') return saved;
  return 'zh-CN';
}

export function changeLanguage(lang: AppLanguage): void {
  i18n.changeLanguage(lang);
  localStorage.setItem(LANG_STORAGE_KEY, lang);
}

export function getCurrentLanguage(): AppLanguage {
  return (i18n.language as AppLanguage) || 'zh-CN';
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false, // React 已防 XSS
  },
  returnNull: false,
});

export default i18n;
