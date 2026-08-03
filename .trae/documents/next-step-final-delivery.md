# 下一步：企业级交付收尾计划

> 承接 `a-b-finalization.md`：B4~B7 + B-V 已 ✅ 完成（lint/tsc/vitest/build 全过，122 测试通过，前端达企业级交付态）。
> 本计划覆盖剩余 **联调验证 + 工程化部署 + E2E + 可观测性 + 文档同步**，目标：从「代码完成」到「可上线交付」闭环。

---

## 一、当前精确状态盘点

| 维度 | 状态 | 说明 |
|---|---|---|
| 后端代码 | ✅ | FastAPI + 38 端点 + RBAC + 种子数据 + run.sh + requirements.txt |
| 前端代码 | ✅ | React 18 + TS + Vite + Antd 5 + i18n + 暗色主题 + 5 图表 + PDF 导出 + 移动端 |
| 单元测试 | ✅ | 9 文件 / 122 测试通过（Vitest + @testing-library/react） |
| 联调配置 | ✅ | vite.config.ts proxy + .env.* 三件套就绪 |
| **端到端联调验证** | ❌ | MSW 仍默认启用（`.env.development: VITE_ENABLE_MSW=true`），前后端未实测跑通 |
| **部署配置** | ❌ | 无 Dockerfile / docker-compose.yml / nginx.conf / .github/workflows |
| **E2E 测试** | ❌ | 无 Playwright / Cypress，仅单测 |
| **可观测性** | ❌ | 无 Sentry / Web Vitals / 错误上报 |
| **README 同步** | ❌ | README 仍写"纯前端 + localStorage 方案"，与已实现的后端严重脱节 |
| 文档 | ⚠️ | 仅 README + docs/api-contract.md，缺部署/架构文档 |

---

## 二、执行总顺序（依赖链）

```
P1  联调验证（启动后端 + 前端关 MSW + 修断点）
   │   └─ 暴露的字段映射/状态机/CORS 问题就地修复
   ▼
P2  工程化部署（Dockerfile×2 + docker-compose + nginx + 健康检查）
   │   └─ 依赖 P1 验证过的真实后端行为
   ▼
P3  CI/CD（GitHub Actions：lint/tsc/vitest/build/镜像推送）
   │   └─ 依赖 P2 的 Dockerfile
   ▼
P4  E2E 测试（Playwright 覆盖 5 条核心流）
   │   └─ 依赖 P2 的 docker-compose 提供完整环境
   ▼
P5  可观测性（Sentry 错误上报 + Web Vitals 上报）
   │   └─ 独立，但建议在 E2E 之后以便测试覆盖
   ▼
P6  文档同步（README 重写 + 部署文档 + 架构文档）
   │   └─ 最后做，反映最终状态
   ▼
P7  最终验证（全套 lint/tsc/vitest/build/E2E + 容器化冒烟）
```

> **依赖说明**：P1 阻塞 P2（需真实后端行为）；P2 阻塞 P3/P4（需容器环境）；P5/P6 可与 P4 并行但为串行避免冲突。

---

## 三、详细任务分解

### P1：端到端联调验证

**目标**：确认 FastAPI 后端 + 前端（关 MSW）全流程跑通

**步骤**：
1. 启动后端：`cd backend && bash run.sh`（uvicorn :8080）
2. 前端配置：创建 `.env.development.local` 设 `VITE_ENABLE_MSW=false`（保留 `.env.development` 不动，避免污染默认）
3. 启动前端：`npm run dev`
4. 全流程验证（6 项实测）：
   - **登录**：5 种子用户（u-1~u-6）登录 → 工作台数据加载
   - **询价全流程**：创建询价 → 保存草稿 → 发送 → 供应商报价（供应商端）→ 对比 → 审批 → 定标
   - **通知中心**：截止时间提醒、报价提交通知生成
   - **设置持久化**：PUT /settings → GET 返回更新值
   - **物料批量导入**：POST /materials/batch → DB 实际写入
   - **供应商启停**：POST /suppliers/:id/toggle-status → cooperationStatus 变化
5. 401/403 验证：无 token → 401；采购人员访问 settings → 403
6. 修复联调中暴露的断点（字段映射、状态机、CORS 等），就地修

**预期产出**：联调通过，或发现断点并修复

---

### P2：工程化部署（单机 Docker Compose 方案）

**目标**：一份 `docker compose up -d` 启动完整系统

#### P2.1：前端 Dockerfile（多阶段构建）
- **文件**：新建 `Dockerfile.frontend`
- **实现**：
  - Stage 1（builder）：`node:20-alpine` → `npm ci` → `npm run build`
  - Stage 2（runtime）：`nginx:alpine` → 拷贝 `dist/` 到 `/usr/share/nginx/html` → 拷贝 nginx.conf
- **环境变量**：构建时 `VITE_ENABLE_MSW=false` `VITE_API_BASE_URL=/api`

#### P2.2：后端 Dockerfile
- **文件**：新建 `backend/Dockerfile`
- **实现**：
  - Stage 1（builder）：`python:3.11-slim` → `pip install -r requirements.txt`
  - Stage 2（runtime）：`python:3.11-slim` → 拷贝 `.venv` 与 `app/` → `CMD uvicorn app.main:app --host 0.0.0.0 --port 8080`
- **注意**：SQLite 数据卷挂载 `/app/procurement.db`，requirements.txt 锁版本

#### P2.3：nginx 反代配置
- **文件**：新建 `nginx.conf`
- **实现**：
  - 监听 80 端口
  - `location /` → 静态文件 `root /usr/share/nginx/html`，SPA `try_files $uri /index.html`
  - `location /api` → `proxy_pass http://backend:8080`，带 `Host`/`X-Real-IP` 头
  - gzip 压缩（js/css/json）
  - 静态资源缓存（1y immutable）

#### P2.4：docker-compose.yml
- **文件**：新建 `docker-compose.yml`
- **服务**：
  - `frontend`：build `Dockerfile.frontend`，端口 `80:80`，依赖 `backend`
  - `backend`：build `backend/Dockerfile`，端口 `8080`（内部），卷 `./data:/app/data`（SQLite 持久化）
  - 环境变量：`DB_PATH=/app/data/procurement.db`
- **健康检查**：backend `GET /api/health`（需新增端点）；frontend `wget --spider http://localhost`

#### P2.5：后端健康检查端点
- **文件**：修改 `backend/app/main.py` + `backend/app/routers/`（或直接 main.py 加 `@app.get("/api/health")`）
- **实现**：返回 `{"status": "ok", "version": "0.1.0", "db": "connected"}`，无认证

#### P2.6：.dockerignore
- **文件**：新建 `.dockerignore`（根目录）+ `backend/.dockerignore`
- **内容**：`node_modules` `dist` `.venv` `__pycache__` `*.db` `.git` 等

**验证**：`docker compose up -d --build` → 访问 `http://localhost` → 登录跑通

---

### P3：CI/CD（GitHub Actions）

**目标**：PR/push 自动跑 lint/test/build + 镜像构建

#### P3.1：CI 工作流
- **文件**：新建 `.github/workflows/ci.yml`
- **触发**：push to main / PR to main
- **Jobs**：
  - `quality`：Node 20 → `npm ci` → `npm run lint` → `npx tsc --noEmit` → `npx vitest run`
  - `build`：依赖 quality → `npm run build` → 上传 `dist/` artifact
  - `backend-test`：Python 3.11 → `cd backend && pip install -r requirements.txt` → `python -c "from app.main import app"` 冒烟
- **缓存**：npm cache + pip cache

#### P3.2：镜像构建工作流（可选，按 tag 触发）
- **文件**：新建 `.github/workflows/docker.yml`
- **触发**：push tag `v*`
- **Jobs**：构建前后端镜像 → 推送 GHCR（`ghcr.io/<user>/procurement-frontend:v*`）

**验证**：推一个测试 PR，CI 全绿

---

### P4：E2E 测试（Playwright）

**目标**：5 条核心业务流自动化验证

#### P4.1：安装与配置
- `npm install -D @playwright/test`
- **文件**：新建 `playwright.config.ts`
- **配置**：baseURL `http://localhost:80`，webServer 启动 `docker compose up`（或单独 dev server）
- **目录**：新建 `e2e/`

#### P4.2：5 条核心测试用例
- **文件**：新建 `e2e/auth.spec.ts` —— 登录/登出/切换用户
- **文件**：新建 `e2e/inquiry-flow.spec.ts` —— 创建询价 → 发送 → 供应商报价 → 对比 → 审批 → 定标
- **文件**：新建 `e2e/supplier-portal.spec.ts` —— 供应商填报端报价提交
- **文件**：新建 `e2e/permission.spec.ts` —— RBAC：采购人员访问 settings → 403 提示
- **文件**：新建 `e2e/i18n-theme.spec.ts` —— 语言切换 + 暗色主题切换 + 持久化

#### P4.3：package.json scripts
- 新增：`"e2e": "playwright test"` `"e2e:ui": "playwright test --ui"`

**验证**：`npm run e2e` 全过

---

### P5：可观测性（Sentry + Web Vitals）

**目标**：线上错误可追踪，性能可量化

#### P5.1：Sentry 接入
- `npm install @sentry/react`
- **文件**：修改 `src/main.tsx`
- **实现**：
  - `Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, integrations: [browserTracingIntegration()], tracesSampleRate: 0.1 })`
  - 仅当 `VITE_SENTRY_DSN` 存在时初始化（开发环境不报）
- **文件**：修改 `.env.example` 加 `VITE_SENTRY_DSN`
- **ErrorBoundary**：用 `Sentry.ErrorBoundary` 包裹 `<App />`

#### P5.2：Web Vitals 上报
- `npm install web-vitals`
- **文件**：新建 `src/utils/webVitals.ts`
- **实现**：`onCLS/onLCP/onFCP/onTTFB/onINP` → `Sentry.captureMessage` 或 `navigator.sendBeacon`
- **文件**：修改 `src/main.tsx` 调用 `initWebVitals()`

#### P5.3：后端日志（轻量）
- **文件**：修改 `backend/app/main.py`
- **实现**：加 `logging.basicConfig` + 中间件记录请求耗时/状态码（不引入 loguru，保持依赖精简）

**验证**：前端触发一个错误 → Sentry dashboard 可见；后端日志格式正常

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

1. **部署方案**：单机 Docker Compose（前端 nginx + 后端 uvicorn + SQLite 卷），适合中小规模快速上线；K8s 不在本计划范围
2. **E2E 框架**：Playwright（跨浏览器、官方支持 React、TS 友好），不用 Cypress
3. **可观测性**：Sentry（错误上报 + Performance），不引入 Prometheus/Grafana（后端 SQLite 单机无需）
4. **CI/CD 平台**：GitHub Actions（项目托管 GitHub 假设），不用 GitLab CI
5. **Sentry DSN**：通过 `VITE_SENTRY_DSN` 环境变量注入，不存在时跳过初始化（开发环境不报）
6. **后端日志**：用标准库 `logging`，不引入 loguru（保持 requirements.txt 精简）
7. **E2E 测试数据**：用后端种子数据（u-1~u-6 + sup-1~sup-8 + inq-1~inq-6），不单独造测试数据
8. **.env.development 不动**：保持 MSW 默认启用便于纯前端开发；联调用 `.env.development.local` 覆盖
9. **执行顺序**：P1 → P2 → P3 → P4 → P5 → P6 → P7，串行避免冲突
10. **联调断点修复**：P1 中发现的断点就地修复，不单独开任务

---

## 五、验证清单

- [ ] P1：后端启动 + 前端关 MSW 全流程跑通，6 项实测通过
- [ ] P2：`docker compose up -d` 启动完整系统，访问 http://localhost 可用
- [ ] P2：后端 `/api/health` 健康检查端点可用
- [ ] P3：GitHub Actions CI 全绿（lint/tsc/vitest/build）
- [ ] P4：`npm run e2e` 5 用例全过
- [ ] P5：Sentry 接入，错误可上报；Web Vitals 采集
- [ ] P6：README 无过时描述，docs/deployment.md + docs/architecture.md 可执行
- [ ] P7：lint=0 / tsc=0 / vitest 全过 / build 通过 / E2E 全过 / 容器化冒烟通过
