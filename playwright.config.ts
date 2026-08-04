import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // 串行避免数据冲突
  retries: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:80',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 10000,
  },
  // P2-14 Task 19：多浏览器 + 移动设备 E2E 项目
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-android', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-ios', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'docker compose up -d --build',
    url: 'http://localhost:80',
    reuseExistingServer: true,
    timeout: 180000,
  },
});
