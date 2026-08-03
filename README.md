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

| 类别 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6 |
| 状态 | Zustand 4（持久化到 localStorage） |
| 数据请求 | axios + MSW 2（本地 mock） |
| 图表 | ECharts 5（按需引入） |
| Excel / PDF | SheetJS (xlsx) / jsPDF + html2canvas |
| 日期 | dayjs |
| 国际化 | i18next + react-i18next |
| 错误监控 | Sentry（可选） + web-vitals |
| 测试 | Vitest 2（单元）+ Playwright（E2E） |
| 规范 | ESLint 9 (flat) + Prettier 3 + Husky + lint-staged |
| 后端 | FastAPI 0.115 + SQLAlchemy 2.0 + SQLite |
| 部署 | Docker Compose（nginx + uvicorn） |

---

## 🚀 快速开始

### 📋 环境要求

| 工具 | 版本 |
|---|---|
| Node.js | >= 18 |
| npm | >= 9 |
| Python | >= 3.11（仅本地后端开发需要） |

### 方式一：Docker Compose 一键部署（推荐 🐳）

```bash
docker compose up -d --build
```

启动完成后访问 👉 **http://localhost**

### 方式二：本地开发

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

默认使用 MSW 本地 mock 数据。需要对接真实后端时：

```bash
# 在项目根目录创建 .env.development.local
echo "VITE_ENABLE_MSW=false" > .env.development.local
echo "VITE_API_PROXY_TARGET=http://localhost:8080" >> .env.development.local
npm run dev
```

---

## ✅ 质量检查

```bash
npm run lint       # ESLint 代码检查
npx tsc --noEmit   # TypeScript 类型检查
npm run test       # 单元测试（Vitest）
npm run build      # 生产构建
npm run e2e        # E2E 测试（Playwright，需先启动 Docker）
```

> 💡 提交代码时会自动触发 `lint-staged`：对暂存的 `*.{ts,tsx}` 文件运行 `eslint --fix` + `prettier --write`。

---

## 🔐 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `VITE_API_BASE_URL` | 后端 API 基地址 | `/api` |
| `VITE_ENABLE_MSW` | 是否启用 MSW 本地 mock（`true` / `false`） | `true` |
| `VITE_API_PROXY_TARGET` | 关闭 MSW 时的代理目标（仅 dev） | `http://localhost:8080` |
| `VITE_SENTRY_DSN` | Sentry DSN（可选，留空则不启用） | - |
| `DB_PATH` | 后端 SQLite 数据库路径 | `backend/procurement.db` |

---

## 🧪 测试

### 单元测试（Vitest）

- 9 个测试文件 / 122 条用例
- 覆盖：评分算法、格式化、存储、供应商匹配、物料导入、AI 服务、截止监听、状态机

### E2E 测试（Playwright）

- 5 条核心流程
- 覆盖：认证、询价流程、供应商门户、权限控制、国际化与主题

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
