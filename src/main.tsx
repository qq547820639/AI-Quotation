import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queryClient } from '@/lib/queryClient';
import * as Sentry from '@sentry/react';
import App from './App';
import './i18n'; // i18n 初始化（B1）
import './styles/global.css';
import './styles/print.css';
import { useThemeStore } from '@/store/useThemeStore';
import { initWebVitals } from '@/utils/webVitals';

// Sentry 初始化（仅当 DSN 存在时，P5.1）
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}

// antd 主题 token 配置
const themeToken = {
  colorPrimary: '#165DFF',
  colorSuccess: '#00B42A',
  colorWarning: '#FF7D00',
  colorError: '#F53F3F',
  borderRadius: 8,
};

// React Query 客户端（W7.3 + P1-10 Task 15 统一服务端缓存职责，模块化于 lib/queryClient.ts）

// MSW 启动逻辑（W7.3）
async function enableMocking() {
  if (import.meta.env.VITE_ENABLE_MSW !== 'true') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: {
      url: '/mockServiceWorker.js',
    },
  });
}

/** antd ConfigProvider 包装：随 i18n 语言切换 locale + 随 themeStore 切换明暗（B1 + B3） */
// eslint-disable-next-line react-refresh/only-export-components
function AntdConfigProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation();
  const mode = useThemeStore((s) => s.mode);
  const locale = i18n.language === 'en-US' ? enUS : zhCN;
  return (
    <ConfigProvider
      locale={locale}
      theme={{
        token: themeToken,
        algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      {children}
    </ConfigProvider>
  );
}

enableMocking().then(() => {
  // Web Vitals 采集（P5.2）
  initWebVitals();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <AntdConfigProvider>
        <QueryClientProvider client={queryClient}>
          <Sentry.ErrorBoundary fallback={<p>应用程序发生错误，请刷新页面重试</p>} showDialog>
            <App />
          </Sentry.ErrorBoundary>
        </QueryClientProvider>
      </AntdConfigProvider>
    </React.StrictMode>,
  );
});
