# 🛒 企业采购自动询价 Web 系统

> 一个覆盖「询价 → 匹配 → 发送 → 报价 → 对比 → 定标」全流程的现代化采购询价管理平台。

欢迎来到 **AI-Quotation**！💡 本项目致力于让企业采购询价变得简单、透明、可追溯。无论你是采购人员、供应商还是开发者，都能在这里找到顺手的工具。

---

## ✨ 项目简介

**AI-Quotation** 是一套开箱即用的采购询价解决方案，帮助你：

- 📝 **快速创建询价单**：分步向导式表单，智能匹配供应商
- 🤝 **供应商协同**：独立供应商填报门户，批量回收报价
- 📊 **智能比价**：按供应商 / 按物料双视图对比，综合评分自动排序
- 🔍 **全流程追溯**：操作日志时间轴 + 审批流，一切有迹可循
- 🌐 **国际化 & 主题**：中英文双语、明暗双主题、移动端适配
- 🤖 **AI 辅助**：询价说明生成、报价异常分析、比价结论（规则引擎模拟）

---

## 🧰 技术栈

| 类别        | 技术                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| 前端框架    | React 18 + TypeScript 5                                                |
| 构建        | Vite 5                                                                 |
| UI          | Ant Design 5 + @ant-design/icons                                       |
| 路由        | React Router 6                                                         |
| 状态        | Zustand 4（持久化到 localStorage）                                     |
| 数据请求    | axios + MSW 2（本地 mock）                                             |
| 图表        | ECharts 5（按需引入）                                                  |
| Excel / PDF | SheetJS (xlsx) / jsPDF + html2canvas                                   |
| 日期        | dayjs                                                                  |
| 国际化      | i18next + react-i18next                                                |
| 错误监控    | Sentry（可选） + web-vitals                                            |
| 测试        | Vitest 2（单元）+ Playwright（E2E）                                    |
| 规范        | ESLint 9 (flat) + Prettier 3 + Husky + lint-staged                     |
| 后端        | FastAPI 0.115 + SQLAlchemy 2.0 + SQLite（开发）/ PostgreSQL 16（生产） |
| 部署        | Docker Compose（nginx + uvicorn）                                      |

---

## 🚀 快速开始

### 📋 环境要求

| 工具    | 版本                          |
| ------- | ----------------------------- |
| Node.js | >= 18                         |
| npm     | >= 9                          |
| Python  | >= 3.11（仅本地后端开发需要） |

### 方式一：Docker Compose 快速体验（推荐 🐳，零配置）

使用 `docker-compose.dev.yml`（dev 形态：SQLite + 进程内任务队列 + noop 扫描器 + 演示种子数据），无需任何 `.env` 配置即可一键启动：

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

启动完成后访问 👉 **http://localhost**

> 演示种子账号统一密码为 `dev-demo-pass-12345678`（可在 `docker-compose.dev.yml` 中通过 `DEMO_USER_PASSWORD` 覆盖）。该形态仅用于本地快速体验与开发调试，**不用于生产**。

### 方式二：Docker Compose 生产部署

生产形态（`docker-compose.yml`）启用强 fail-closed 守卫：后端在 `APP_ENV=prod` 下会校验强密钥、ClamAV、S3/MinIO、Redis、通知渠道等，配置不满足会**拒绝启动**。因此生产部署前必须先配置 `.env`：

```bash
# 1. 从示例创建 .env 并填入强密钥/白名单（详见 backend/.env.example）
cp backend/.env.example .env
#    至少修改：SECRET_KEY（≥32 位随机值）、DEMO_USER_PASSWORD、CORS_ORIGINS（生产域名）、
#    NOTIFY_CHANNEL=email + SMTP_*（或视需求调整）
# 2. 启动全套服务（postgres/redis/minio/clamav/celery/outbox/backend/frontend）
docker compose up -d --build
```

> 注意：ClamAV 首次启动需下载病毒库（约 10–20 分钟），期间后端 `/api/ready` 返回 503，属正常现象；就绪后访问 👉 **http://localhost**。

### 方式三：本地开发

**1. 启动后端**

```bash
cd backend && bash run.sh
# 首次运行会自动创建 .venv 并安装依赖
# 服务地址：http://localhost:8080  接口文档：http://localhost:8080/docs
```

**2. 启动前端**

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器（http://localhost:5173）
```

### 🔗 联调真实后端

dev 默认使用 MSW 本地 mock + 演示模式（见 `.env.development`）。需要对接真实后端时，在项目根目录创建 `.env.development.local` 覆盖：

```bash
echo "VITE_ENABLE_MSW=false" > .env.development.local
echo "VITE_DEMO_MODE=false" >> .env.development.local     # 退出演示模式，走真实密码认证
echo "VITE_API_PROXY_TARGET=http://localhost:8080" >> .env.development.local
npm run dev
```

---

## ✅ 质量检查

```bash
npm run lint        # ESLint 代码检查
npx tsc --noEmit    # TypeScript 类型检查
npm run test        # 单元测试（Vitest）
npm run build       # 生产构建
cd backend && .venv/bin/python -m pytest   # 后端测试（API 集成 / 权限 / 状态流转）
cd backend && .venv/bin/python -m alembic upgrade head   # 数据库迁移（Alembic）
npm run e2e         # E2E 测试（Playwright，需先启动 Docker）
```

> 💡 提交代码时会自动触发 `lint-staged`：对暂存的 `*.{ts,tsx}` 文件运行 `eslint --fix` + `prettier --write`。

---

## 🔐 环境变量

| 变量                    | 说明                                                                                                                             | 默认                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `VITE_API_BASE_URL`     | 后端 API 基地址                                                                                                                  | `/api`                     |
| `VITE_ENABLE_MSW`       | 是否启用 MSW 本地 mock（`true` / `false`）。dev 默认开（见 `.env.development`）；生产构建由 `Dockerfile.frontend` 强制置 `false` | `true`（仅 dev）           |
| `VITE_DEMO_MODE`        | 是否允许演示模式（快捷登录 / mock 回退）。dev 默认开（见 `.env.development`）                                                    | `true`（仅 dev）           |
| `VITE_API_PROXY_TARGET` | 关闭 MSW 时的代理目标（仅 dev）                                                                                                  | `http://localhost:8080`    |
| `VITE_SENTRY_DSN`       | Sentry DSN（可选，留空则不启用）                                                                                                 | -                          |
| `DATABASE_URL`          | 后端数据库连接串。含 `postgresql://` 走 PostgreSQL（生产），否则回退 SQLite                                                      | `sqlite:///<DB_PATH>`      |
| `DB_PATH`               | 后端 SQLite 数据库路径（仅 SQLite 场景）                                                                                         | `backend/procurement.db`   |
| `SECRET_KEY`            | 后端签名/加密密钥（**生产必须通过环境变量注入**）                                                                                | `dev-secret-key-change-me` |

> 🔐 **密钥不入库**：`SECRET_KEY`、`POSTGRES_PASSWORD`、JWT 密钥等所有敏感信息一律通过环境变量 / docker-compose `environment` 注入，**绝不写入源码或提交到仓库**。完整后端环境变量示例见 `backend/.env.example`。

---

## 🔒 安全附件上传（P1-8 Task 13）

供应商门户附件上传已实现完整的**安全校验**与**存储抽象**：

### 校验链路

- **大小**：≤ 10MB（`MAX_UPLOAD_SIZE`）
- **MIME / 扩展名**：白名单校验（`ALLOWED_UPLOAD_MIME_TYPES` / `ALLOWED_UPLOAD_EXTENSIONS`）
- **文件名清洗**：`sanitize_filename` 去除路径分隔符与危险字符，物理文件使用随机 `gen_id` 命名，**不信任原始文件名**
- **归属鉴权**：上传/删除/下载均校验附件归属该邀请对应供应商的报价（`quotation` / `quotation_item`）

### 存储抽象（`backend/app/storage.py`）

- `Storage` 接口：`save / delete / read / url_for`
- **LocalStorage**：默认本地存储（`UPLOAD_DIR`）
- **S3Storage**：预留的 S3/MinIO 实现（boto3），配置完整即可启用：

| 变量            | 说明              |
| --------------- | ----------------- |
| `S3_ENDPOINT`   | S3/MinIO 端点 URL |
| `S3_BUCKET`     | 存储桶名称        |
| `S3_ACCESS_KEY` | 访问密钥 ID       |
| `S3_SECRET_KEY` | 密钥              |

> 未配置 S3 时自动回退本地存储。**下载鉴权**：沿用现有邀请 token 鉴权下载端点（`GET /api/portal/attachments/{id}/download`），不暴露静态文件路径；S3 模式可生成 15 分钟预签名 URL。

### 病毒扫描预留

- `Attachment` 新增 `scan_status`（`pending/scanned/clean/infected/error`）与 `scan_result` 字段
- 预留接口 `POST /api/portal/attachments/{id}/scan`（占位扫描器 `app/scanner.py`，可替换为 ClamAV / VirusTotal）
- 迁移：`backend/alembic/versions/0005_attachment_scan.py`

### 孤儿文件清理

```bash
cd backend && python3 -m app.scripts.cleanup_orphans            # 删除无数据库记录的孤儿文件
cd backend && python3 -m app.scripts.cleanup_orphans --dry-run  # 仅列出不删除
```

### 审计日志

附件上传 / 删除 / 下载 / 扫描均写入结构化审计日志（`audit_logger`，`extra_fields` 记录 `action / attachment_id / owner`）。

---

## 🧪 测试

### 单元测试（Vitest）

- 26 个测试文件 / 297 条用例（实测 `npx vitest run` 全过）
- 覆盖：API Client 重试与错误解析、Store 写操作回滚与防重复提交、评分算法、格式化、存储、供应商匹配、物料导入、AI 服务、截止监听、状态机、表格设置、权限定义、供应商门户、无障碍（axe）

### 后端测试（pytest）

运行方式：

```bash
cd backend && python3 -m pytest -q
```

- 实测 **163 passed, 1 skipped**，覆盖率 **81.18%（≥ 80% 门禁）**
- 覆盖：认证与会话安全、询价/报价/供应商核心 API 集成、权限与资源越权矩阵、状态机合法/非法转换、金额精度、并发/乐观锁/幂等、邀请 Token 安全、供应商门户安全、AI 超时/回退/结构校验、数据库迁移 round-trip、PostgreSQL 集成（条件跳过）、可观测性（request_id / 健康检查 / 日志脱敏）

数据库迁移（Alembic）：

```bash
cd backend && python3 -m alembic upgrade head
```

### E2E 测试（Playwright）

- 7 个文件 / 28 条用例，覆盖 5 个浏览器项目：**chromium / firefox / webkit / mobile-android / mobile-ios**
- 覆盖：核心业务链路（询价→报价→审批→定标）、异常场景（超时/网络中断/500/401/403/重复点击/部分批量失败/表单校验/数据冲突/刷新/返回/保存失败重试/不同权限）、认证与会话、供应商门户（邀请 Token 路由）、权限控制、国际化与主题
- 供应商门户走**不可预测邀请 Token** 路由（`/supplier-portal/:invitationToken`），不再依赖内部登录 Token 或可枚举 ID
- 运行：`npm run e2e`（需先 `docker compose up -d --build` 启动真实前后端；CI 的 `docker-e2e` 任务在 Docker 环境执行并上传 trace/截图/视频产物）

---

## 📦 交付说明（供应商安全参与与生产部署闭环）

本轮将项目从"高完成度演示/试用系统"提升为"真实供应商可安全参与、关键业务流程可信、可生产部署"的询报价系统。核心能力：

- **供应商安全邀请闭环**：`supplier_invitations` 表 + 密码学安全邀请 Token（库中只存哈希）+ 专用邀请鉴权 + 字段级最小化 + 7 种页面状态，枚举 ID 无法越权。
- **组织级与资源级数据权限**：统一 Policy 层，创建询价的 `organization/owner/created_by` 由服务端强制生成，所有 list/get/update/delete/action 做资源级校验。
- **服务端强约束状态机**：询价/报价/审批状态机，非法转换返回结构化 409，动作接口幂等并支持 `Idempotency-Key`。
- **金额精度**：Decimal/Numeric 存储，服务端重算未税/税额/含税/总额。
- **鉴权会话安全**：短期 Access + 可轮换 Refresh + HttpOnly/Secure/SameSite Cookie，会话列表/单会话撤销/全部退出/Refresh 重用检测，安全响应头。
- **PostgreSQL + Alembic**：生产仅 Alembic 管理 schema，Docker 健康检查 `/api/ready`，健康条件控制依赖。
- **真实通知与附件**：异步可重试发送（邮件等可扩展渠道）+ 逐供应商交付状态；安全附件上传（本地/S3/MinIO）+ 病毒扫描预留 + 下载鉴权。
- **服务端 AI**：`/api/ai/*` 可插拔 Provider，超时/重试/熔断/成本统计/结构校验/脱敏/审计，不可用回退本地规则。
- **mock 隔离**：演示模式显式环境变量，生产构建默认禁止 mock fallback，后端不可用显示离线状态。

详细迁移、环境变量、API 变更、安全/权限模型、状态机转换表见 `docs/deployment.md` 与 `docs/architecture.md`。

---

## 📁 目录结构

```
├── src/                    # 前端源码
│   ├── api/               # axios client + 业务 API 模块
│   ├── components/         # 通用组件 + 报价对比子组件
│   ├── layouts/            # MainLayout / SupplierLayout
│   ├── locales/            # zh-CN / en-US
│   ├── mock/               # 静态 mock 数据
│   ├── mocks/              # MSW handlers
│   ├── pages/              # 页面（懒加载）
│   ├── router/             # 路由配置
│   ├── store/              # Zustand store
│   ├── styles/             # 全局样式
│   ├── types/              # 类型与枚举
│   └── utils/              # 工具函数
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── routers/        # 路由模块（38 端点）
│   │   ├── main.py         # FastAPI 入口
│   │   ├── models.py       # ORM 模型
│   │   ├── schemas.py      # Pydantic 模型
│   │   ├── auth.py         # RBAC + Bearer token
│   │   ├── config.py       # 配置
│   │   ├── database.py     # SQLAlchemy engine
│   │   └── seed.py         # 种子数据
│   ├── requirements.txt
│   └── run.sh              # 启动脚本
├── e2e/                    # Playwright E2E 测试
├── docs/                   # 文档
├── Dockerfile.frontend     # 前端 Docker 构建
├── nginx.conf              # nginx 反代配置
├── docker-compose.yml      # 一键部署
└── .github/workflows/      # CI/CD
```

---

## 🤝 贡献指南

我们非常欢迎社区的每一份贡献！🎉 无论是修复 bug、完善文档还是提出新想法，都值得被看见。

### 提交流程

1. **Fork** 本仓库并克隆到本地
2. 创建特性分支：`git checkout -b feat/your-feature`
3. 提交改动：`git commit -m "feat: 简短描述"`
4. 推送分支：`git push origin feat/your-feature`
5. 提交 **Pull Request**，并在描述中说明改动内容

### 提交规范

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 风格，例如：

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档改动
- `chore:` 构建/工具链变动

### 开发约定

- 代码风格由 ESLint + Prettier 统一，提交前会自动格式化
- 新增功能请同步补充单元测试
- 涉及 API 变动请更新 `docs/api-contract.md`

---

## 📄 许可证

本项目基于 **[MIT 许可证](https://opensource.org/licenses/MIT)** 开源，可自由用于商业与非商业用途。

---

<p align="center">用 ❤️ 打造 · 欢迎 Star ⭐ 与 Issue 💬</p>
