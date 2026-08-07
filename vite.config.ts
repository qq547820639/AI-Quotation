import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vite 配置：启用 React 插件、设置端口与 @ 别名
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const enableMsw = env.VITE_ENABLE_MSW === 'true';
  // MSW 关闭时 /api 代理到的真实后端地址（可通过 .env.* 的 VITE_API_PROXY_TARGET 覆盖）
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8080';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      // 忽略重型非源码目录，避免超出文件监听数上限（inotify ENOSPC）
      watch: {
        ignored: ['**/backend/**', '**/.venv/**', '**/.git/**', '**/dist/**', '**/node_modules/**'],
      },
      // W7.5：MSW 启用时由 Service Worker 拦截请求，代理不生效；
      // MSW 关闭（联调真实后端）时，/api 代理到 VITE_API_PROXY_TARGET
      proxy: enableMsw
        ? undefined
        : {
            '/api': {
              target: apiProxyTarget,
              changeOrigin: true,
            },
          },
    },
    esbuild: {
      // 生产构建移除 console / debugger，dev 不受影响
      drop: ['console', 'debugger'],
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          // 拆分 node_modules 为独立 vendor chunk，缩小主包体积
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react-router-dom')) {
                return 'react-vendor';
              }
              // react / react-dom 需在 react-router-dom 之后匹配
              if (id.includes('/react/') || id.includes('/react-dom/')) {
                return 'react-vendor';
              }
              if (id.includes('@ant-design/icons') || id.includes('/antd/')) {
                return 'antd-vendor';
              }
              if (id.includes('/echarts/') || id.includes('zrender')) {
                return 'echarts-vendor';
              }
              if (id.includes('/xlsx/')) {
                return 'xlsx-vendor';
              }
              if (id.includes('/zustand/') || id.includes('/dayjs/')) {
                return 'utils-vendor';
              }
            }
            return undefined;
          },
        },
      },
    },
  };
});
