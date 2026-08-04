import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/config.ts',
        'src/mock/**',
        'src/mocks/**',
        'src/test/**',
        'src/types/**',
        'src/**/__tests__/**',
        'src/**/*.{test,spec}.{ts,tsx}',
      ],
      thresholds: {
        // 当前前端单测覆盖整体约 33%（大量页面组件仅由 E2E 覆盖、无单测）。
        // 设 30% 作为回归门禁：低于当前水平即失败；提升需补充页面级单测。
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
    },
  },
});
