import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // 起跑前先验"装树 == 锁文件"（见 e2e/global-setup.ts 的理由）：
  // 依赖漂移会让最后起跑的那个 project 整批红、先跑完的照旧绿，读起来像产品回归。
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // 串行避免数据冲突
  // 实测同一台机器、同一份代码、同一 60s 挂钟预算下跑满 5 个项目（180 用例）：
  //   workers=2 → 9 个用例重试后仍红（18.7 分钟）；workers=1 → 0 红、8 个首跑抖动靠重试兜住（21.2 分钟）。
  // 后端是单进程 uvicorn + SQLite，两个 worker 并发会把冷启动页面挤出 10s 期望预算，
  // 换来的只是 2.5 分钟的时间节省 —— 结论是稳定性优先，固定为 1。
  workers: 1,
  // 整链路用例（创建→发送→两家门户报价→对比→审批→定标）在各引擎的实测耗时：
  // chromium 11.7s / firefox 19.3s / webkit 30.3~34.8s。默认 30s 的"测试总预算"
  // 会把 webkit 上的正常长流程判成超时，因此按实测最慢值放大到 60s。
  // 这只放宽挂钟预算，不降低任何断言强度。
  timeout: 60_000,
  expect: { timeout: 10000 },
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
