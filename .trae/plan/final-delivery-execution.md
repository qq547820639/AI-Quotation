# 最终交付收尾执行计划

> 承接 `a-b-finalization.md`：A+B 全部完成（后端 38 端点 + 前端 i18n/主题/PDF/图表/移动端 + 122 单测全过）。
> 本计划覆盖剩余 **联调验证 + 技术债务清理 + 工程化部署 + CI/CD + E2E + 可观测性 + 文档同步**，目标：从「代码完成」到「可上线交付」闭环。

---

## 一、当前精确状态盘点

| 维度 | 状态 | 说明 |
|---|---|---|
| 后端代码 | ✅ | FastAPI + 38 端点 + RBAC + 种子数据 + run.sh |
| 前端代码 | ✅ | React 18 + 13 页面 + 10 store + 8 API 模块 + i18n + 暗色主题 + 5 图表 + PDF + 移动端 |
| 单元测试 | ✅ | 9 文件 / 122 测试通过 |
| 联调配置 | ✅ | vite.config.ts proxy + .env.* 三件套就绪 |
| **端到端联调验证** | ❌ | MSW 仍默认启用，前后端未实测跑通 |
| **部署配置** | ❌ | 无 Dockerfile / docker-compose / nginx.conf |
| **CI/CD** | ❌ | 无 .github/workflows |
| **E2E 测试** | ❌ | 无 Playwright |
| **可观测性** | ❌ | 无 Sentry / Web Vitals / 后端日志 |
| **README 同步** | ❌ | 仍写"纯前端 + localStorage"，与后端严重脱节 |
| **健康检查端点** | ❌ | 后端无 /api/health |
| **假 loading** | ⚠️ | material/supplier/log 三页 300ms setTimeout |
| **概念重叠** | ⚠️ | settings.organization 与 UI.currentOrganization |

---

## 二、执行总顺序（依赖链）

```
P1  联调验证 + 技术债务清理
    │   ├─ 启动后端 + 前端关 MSW + 修联调断点
    │   └─ 清理假 loading / 概念重叠 / MSW stub 残留
    ▼
P2  工程化部署（Dockerfile×2 + compose + nginx + 健康检查）
    │   └─ 依赖 P1 验证过的真实后端行为
    ▼
P3  CI/CD（GitHub Actions：lint/tsc/vitest/build）
    │   └─ 依赖 P2 的 Dockerfile
    ▼
P4  E2E 测试（Playwright 5 条核心流）
    │   └─ 依赖 P2 的 docker-compose
    ▼
P5  可观测性（Sentry + Web Vitals + 后端日志）
    │   └─ 独立，但放 E2E 之后以便测试覆盖
    ▼
P6  文档同步（README 重写 + 部署文档 + 架构文档）
    │   └─ 最后做，反映最终状态
    ▼
P7  最终验证（全套 lint/tsc/vitest/build/E2E + 容器化冒烟）
```

---

## 三、详细任务分解

### P1：端到端联调验证 + 技术债务清理

#### P1.1：联调验证
- **启动后端**：`cd backend && bash run.sh`（uvicorn :8080）
- **前端配置**：创建 `.env.development.local` 设 `VITE_ENABLE_MSW=false`（保留 `.env.development` 不动）
- **启动前端**：`npm run dev`
- **6 项实测**：
  1. 登录（u-1~u-6 五种子用户）→ 工作台数据加载
  2. 询价全流程：创建 → 保存草稿 → 发送 → 供应商报价（供应商端）→ 对比 → 审批 → 定标
  3. 通知中心：截止时间提醒、报价提交通知
  4. 设置持久化：PUT /settings → GET 返回更新值
  5. 物料批量导入：POST /materials/batch → DB 实际写入
  6. 供应商启停：POST /suppliers/:id/toggle-status → cooperationStatus 变化
- **401/403 验证**：无 token → 401；采购人员访问 settings → 403
- **断点修复**：就地修字段映射/状态机/CORS 问题

#### P1.2：清理假 loading（3 文件）
- **文件**：
  - `src/pages/material/index.tsx`
  - `src/pages/supplier/index.tsx`
  - `src/pages/log/index.tsx`
- **改动**：移除 `setTimeout(300ms)` 假 loading，直接使用 store 数据（真实后端时由 API 响应时间自然体现 loading）
- **保留**：若需 loading 态，用 `useInquiryStore.loading` 等真实状态标志

#### P1.3：清理 MSW handlers 4 个 stub 端点
- **文件**：`src/mocks/handlers.ts`
- **改动**：
  1. `POST /suppliers/:id/toggle-status`（约 L243-247）：实际切换 cooperationStatus 并写回内存
  2. `POST /quotations/:id/submit`（约 L313-317）：更新 status=SUBMITTED + submittedAt
  3. `POST /materials/batch`（约 L278-282）：实际写入内存数据
  4. `PUT /settings`（约 L366-369）：实际持久化到内存 settings 对象
- **目的**：MSW 模式下行为完整，与真实后端一致

#### P1.4：合并 settings.organization 与 UI.currentOrganization（可选）
- **文件**：`src/store/useSettingsStore.ts` + `src/store/useUIStore.ts`
- **改动**：统一以 `useSettingsStore.organization` 为单一数据源，`useUIStore` 移除 `currentOrganization`，消费方改读 settings store
- **风险**：影响面较大，若联调无问题可推迟

**验证**：联调全流程跑通，无假 loading，MSW 模式下 4 端点行为完整

---

### P2：工程化部署（单机 Docker Compose）

#### P2.1：后端健康检查端点
- **文件**：`backend/app/main.py`
- **改动**：在路由注册后新增
  ```python
  @app.get("/api/health")
  def health_check():
      return {"status": "ok", "version": "1.0.0", "db": "connected"}
  ```
- **无认证**：健康检查端点不require token

#### P2.2：前端 Dockerfile（多阶段构建）
- **文件**：新建 `Dockerfile.frontend`
- **实现**：
  ```dockerfile
  # Stage 1: builder
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN VITE_ENABLE_MSW=false VITE_API_BASE_URL=/api npm run build

  # Stage 2: runtime
  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]
  ```

#### P2.3：后端 Dockerfile
- **文件**：新建 `backend/Dockerfile`
- **实现**：
  ```dockerfile
  FROM python:3.11-slim
  WORKDIR /app
  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  ENV DB_PATH=/app/data/procurement.db
  EXPOSE 8080
  CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
  ```
- **注意**：SQLite 数据卷挂载到 `/app/data/`

#### P2.4：nginx 反代配置
- **文件**：新建 `nginx.conf`
- **实现**：
  ```nginx
  server {
      listen 80;
      server_name _;

      gzip on;
      gzip_types text/css application/javascript application/json image/svg+xml;
      gzip_min_length 1024;

      location /api/ {
          proxy_pass http://backend:8080;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      }

      location / {
          root /usr/share/nginx/html;
          try_files $uri $uri/ /index.html;
      }

      location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
          root /usr/share/nginx/html;
          expires 1y;
          add_header Cache-Control "public, immutable";
      }
  }
  ```

#### P2.5：docker-compose.yml
- **文件**：新建 `docker-compose.yml`
- **实现**：
  ```yaml
  version: '3.8'
  services:
    backend:
      build: ./backend
      ports:
        - "8080:8080"
      volumes:
        - ./data:/app/data
      environment:
        - DB_PATH=/app/data/procurement.db
      healthcheck:
        test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/api/health"]
        interval: 30s
        timeout: 5s
        retries: 3

    frontend:
      build:
        context: .
        dockerfile: Dockerfile.frontend
      ports:
        - "80:80"
      depends_on:
        - backend
      healthcheck:
        test: ["CMD", "wget", "--spider", "-q", "http://localhost"]
        interval: 30s
        timeout: 5s
        retries: 3
  ```

#### P2.6：.dockerignore
- **文件**：新建根目录 `.dockerignore` + `backend/.dockerignore`
- **内容**：
  ```
  node_modules
  dist
  .venv
  __pycache__
  *.db
  .git
  .trae
  data
  ```

**验证**：`docker compose up -d --build` → 访问 `http://localhost` → 登录跑通

---

### P3：CI/CD（GitHub Actions）

#### P3.1：CI 工作流
- **文件**：新建 `.github/workflows/ci.yml`
- **触发**：push to main / PR to main
- **Jobs**：
  ```yaml
  name: CI
  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]

  jobs:
    quality:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npm run lint
        - run: npx tsc --noEmit
        - run: npx vitest run

    build:
      needs: quality
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
            cache: npm
        - run: npm ci
        - run: npm run build
        - uses: actions/upload-artifact@v4
          with:
            name: dist
            path: dist/

    backend-test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with:
            python-version: '3.11'
            cache: pip
        - run: cd backend && pip install -r requirements.txt
        - run: cd backend && python -c "from app.main import app; print('Backend import OK')"
  ```

**验证**：推一个测试 PR，CI 全绿

---

### P4：E2E 测试（Playwright）

#### P4.1：安装与配置
- `npm install -D @playwright/test`
- **文件**：新建 `playwright.config.ts`
- **配置**：
  ```typescript
  import { defineConfig } from '@playwright/test';
  export default defineConfig({
    testDir: './e2e',
    fullyParallel: false, // 串行避免数据冲突
    retries: 1,
    use: {
      baseURL: 'http://localhost:80',
      trace: 'on-first-retry',
    },
    projects: [
      { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    webServer: {
      command: 'docker compose up -d --build',
      url: 'http://localhost:80',
      reuseExistingServer: true,
      timeout: 120000,
    },
  });
  ```

#### P4.2：5 条核心测试用例
- **文件**：新建 `e2e/auth.spec.ts`
  - 登录 u-1（采购人员）→ 验证工作台加载 → 登出 → 登录 u-6（管理员）
- **文件**：新建 `e2e/inquiry-flow.spec.ts`
  - 创建询价 → 添加物料 → 匹配供应商 → 发送 → 供应商端报价 → 对比 → 审批 → 定标
- **文件**：新建 `e2e/supplier-portal.spec.ts`
  - 访问 `/supplier-portal/:inquiryId/:supplierId` → 填报报价 → 提交
- **文件**：新建 `e2e/permission.spec.ts`
  - u-1（采购人员）访问 /settings → 验证 403 提示
  - u-6（管理员）访问 /settings → 正常加载
- **文件**：新建 `e2e/i18n-theme.spec.ts`
  - 切换 English → 验证菜单文案 → 切换暗色主题 → 验证持久化

#### P4.3：package.json scripts
- 新增：`"e2e": "playwright test"` `"e2e:ui": "playwright test --ui"`

**验证**：`npm run e2e` 全过

---

### P5：可观测性（Sentry + Web Vitals + 后端日志）

#### P5.1：Sentry 接入
- `npm install @sentry/react`
- **文件**：修改 `src/main.tsx`
- **实现**：
  ```typescript
  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
    });
  }
  ```
- **ErrorBoundary**：用 `Sentry.ErrorBoundary` 包裹 `<App />`
- **文件**：修改 `.env.example` 加 `VITE_SENTRY_DSN=`

#### P5.2：Web Vitals 上报
- `npm install web-vitals`
- **文件**：新建 `src/utils/webVitals.ts`
- **实现**：`onCLS/onLCP/onFCP/onTTFB/onINP` → `navigator.sendBeacon` 或 `Sentry.captureMessage`
- **文件**：修改 `src/main.tsx` 调用 `initWebVitals()`

#### P5.3：后端日志（轻量）
- **文件**：修改 `backend/app/main.py`
- **实现**：
  ```python
  import logging
  logging.basicConfig(
      level=logging.INFO,
      format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
  )

  @app.middleware("http")
  async def log_requests(request, call_next):
      start = time.time()
      response = await call_next(request)
      duration = (time.time() - start) * 1000
      logging.info(f"{request.method} {request.url.path} {response.status_code} {duration:.0f}ms")
      return response
  ```
- **不引入 loguru**：保持 requirements.txt 精简

**验证**：前端触发错误 → Sentry dashboard 可见；后端日志格式正常

---

### P6：文档同步

#### P6.1：README 重写
- **文件**：修改 `README.md`
- **改动**：
  - 技术栈表加：FastAPI + SQLAlchemy + SQLite（后端）
  - 功能清单加：RBAC 权限、审批流程、通知中心、AI 智能服务、i18n、暗色主题、PDF 导出、移动端
  - 快速开始加后端启动：`cd backend && bash run.sh`
  - 环境变量表更新为真实变量（VITE_API_BASE_URL / VITE_ENABLE_MSW / VITE_API_PROXY_TARGET / VITE_SENTRY_DSN）
  - 新增「部署」章节：`docker compose up -d`
  - 新增「测试」章节：单测 + E2E
  - 删除「当前为纯前端 + localStorage 方案」过时描述

#### P6.2：部署文档
- **文件**：新建 `docs/deployment.md`
- **内容**：Docker Compose 部署、环境变量说明、nginx 配置说明、数据备份、升级流程

#### P6.3：架构文档
- **文件**：新建 `docs/architecture.md`
- **内容**：系统架构图（前端/后端/DB/nginx）、模块划分、数据流、RBAC 模型、状态机

**验证**：README 与实际状态一致，无过时描述

---

### P7：最终验证

1. **代码质量**：`npm run lint` `npx tsc --noEmit` `npx vitest run` `npm run build` 全过
2. **E2E**：`npm run e2e` 5 用例全过
3. **容器化**：`docker compose up -d --build` → 访问 `http://localhost` 全流程跑通
4. **CI**：推 PR → GitHub Actions 全绿
5. **文档**：README 无过时描述，部署文档可执行

---

## 四、假设与决策

1. **部署方案**：单机 Docker Compose（前端 nginx + 后端 uvicorn + SQLite 卷），适合中小规模快速上线
2. **E2E 框架**：Playwright（跨浏览器、官方支持 React、TS 友好）
3. **可观测性**：Sentry SaaS（错误上报 + Performance），通过 VITE_SENTRY_DSN 注入，不存在时跳过
4. **CI/CD 平台**：GitHub Actions
5. **后端日志**：用标准库 `logging`，不引入 loguru
6. **E2E 测试数据**：用后端种子数据（u-1~u-6 + sup-1~sup-8 + inq-1~inq-6）
7. **.env.development 不动**：保持 MSW 默认启用便于纯前端开发；联调用 `.env.development.local` 覆盖
8. **执行顺序**：P1 → P2 → P3 → P4 → P5 → P6 → P7，串行避免冲突
9. **联调断点修复**：P1 中发现的断点就地修复
10. **P1.4 概念合并**：可选任务，若联调无问题可跳过避免引入风险
11. **React Query 不动**：保持决策性技术债，重写风险高于收益
12. **MSW stub 修复**：P1.3 修复 4 个 stub 端点，使 MSW 模式行为与真实后端一致

---

## 五、验证清单

- [ ] P1.1：后端启动 + 前端关 MSW 全流程跑通，6 项实测通过
- [ ] P1.2：3 文件假 loading 清理完成
- [ ] P1.3：MSW handlers 4 个 stub 端点行为完整
- [ ] P2.1：后端 /api/health 健康检查端点可用
- [ ] P2.2-P2.6：docker compose up -d 启动完整系统
- [ ] P3：GitHub Actions CI 全绿
- [ ] P4：npm run e2e 5 用例全过
- [ ] P5：Sentry 接入，错误可上报；Web Vitals 采集；后端日志格式正常
- [ ] P6：README 无过时描述，docs/deployment.md + docs/architecture.md 可执行
- [ ] P7：lint=0 / tsc=0 / vitest 全过 / build 通过 / E2E 全过 / 容器化冒烟通过
