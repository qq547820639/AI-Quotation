# 企业采购自动询价 Web 系统

覆盖询价单创建、供应商智能匹配、批量发送、报价回收、对比分析、流程追溯的完整采购询价管理平台。

## 技术栈

| 类别 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6 |
| 状态 | Zustand 4（持久化到 localStorage） |
| 数据请求 | axios + MSW 2（本地 mock） |
| 图表 | ECharts 5（按需引入） |
| Excel | SheetJS (xlsx) |
| PDF | jsPDF + html2canvas |
| 日期 | dayjs |
| 国际化 | i18next + react-i18next |
| 错误监控 | Sentry（可选） |
| 性能采集 | web-vitals |
| 测试 | Vitest 2（单元）+ Playwright（E2E） |
| 规范 | ESLint 9 (flat config) + Prettier 3 + Husky + lint-staged |
| 后端 | FastAPI 0.115 + SQLAlchemy 2.0 + SQLite |
| 部署 | Docker Compose（nginx + uvicorn） |

## 功能清单

### P0 核心功能
- 工作台：询价/报价/供应商统计、5 图表（状态分布/趋势/供应商频次/品类/审批漏斗）、待办、最近询价
- 询价单管理：列表、创建（分步表单）、详情、编辑、复制、取消
- 创建询价单：基本信息 / 物料明细 / 供应商智能匹配 / 预览提交
- 报价对比：按供应商 / 按物料双视图、综合评分（金额 50% + 交货 20% + 等级 15% + 履约 15%）、Excel 导出、PDF 导出
- 供应商报价填报端（独立路由 `/supplier-portal/:inquiryId/:supplierId`）

### P1 扩展功能
- 供应商管理：列表、详情、启用/停用、等级与合作状态
- 物料管理：主数据维护、多维度筛选、新增/编辑/删除、批量导入（Excel/CSV）
- 操作日志：全流程时间轴追溯
- 系统设置：审批规则、通知开关、数据管理
- RBAC 权限：3 角色（采购人员/采购主管/管理员）、12 权限点、路由守卫 + 按钮级控制
- 审批流程：超阈值定标审批（提交/通过/驳回）
- 通知中心：截止提醒、报价提交、审批结果通知
- AI 智能服务：询价说明生成、报价异常分析、比价结论（规则引擎模拟）

### 企业级增强
- 国际化：中英文双语（react-i18next）
- 暗色主题：antd darkAlgorithm + CSS 变量双轨制
- 移动端适配：响应式布局、表格卡片化、Drawer 全屏、安全区适配
- PDF 导出：jsPDF + html2canvas 封装
- Sentry 错误监控（可选）
- Web Vitals 性能采集

## 目录结构

```
├── src/                    # 前端源码
│   ├── api/               # axios client + 7 业务 API 模块
│   ├── components/         # 通用组件 + 报价对比子组件
│   ├── layouts/            # MainLayout / SupplierLayout
│   ├── locales/            # zh-CN / en-US
│   ├── mock/               # 静态 mock 数据
│   ├── mocks/              # MSW handlers
│   ├── pages/              # 13 个页面（懒加载）
│   ├── router/             # 路由配置
│   ├── store/              # 10 个 Zustand store
│   ├── styles/             # 全局样式
│   ├── types/              # 类型与枚举
│   └── utils/              # 工具函数
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── routers/        # 7 个路由模块（38 端点）
│   │   ├── main.py         # FastAPI 入口
│   │   ├── models.py       # ORM 模型
│   │   ├── schemas.py      # Pydantic 模型
│   │   ├── serializers.py  # 序列化
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

## 快速开始

### 环境要求
- Node.js >= 18
- npm >= 9
- Python >= 3.11（后端）

### 方式一：Docker Compose 一键部署（推荐）

```bash
docker compose up -d --build
```

访问 http://localhost 即可使用。

### 方式二：本地开发

**启动后端**：
```bash
cd backend && bash run.sh
# 首次自动创建 .venv + 安装依赖
# 启动在 http://localhost:8080，文档 http://localhost:8080/docs
```

**启动前端**：
```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器（http://localhost:5173）
```

### 联调真实后端

默认使用 MSW mock 数据。联调真实后端：

```bash
# 创建 .env.development.local 关闭 MSW
echo "VITE_ENABLE_MSW=false" > .env.development.local
echo "VITE_API_PROXY_TARGET=http://localhost:8080" >> .env.development.local
npm run dev
```

### 质量检查

```bash
npm run lint       # ESLint 检查
npx tsc --noEmit   # TypeScript 类型检查
npm run test       # 单元测试（Vitest）
npm run build      # 生产构建
npm run e2e        # E2E 测试（Playwright，需先启动 Docker）
```

### Git 钩子

提交时自动触发 `lint-staged`：对暂存的 `*.{ts,tsx}` 运行 eslint --fix + prettier --write。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `VITE_API_BASE_URL` | 后端 API 基地址 | `/api` |
| `VITE_ENABLE_MSW` | 是否启用 MSW 本地 mock（`true`/`false`） | `true` |
| `VITE_API_PROXY_TARGET` | MSW 关闭时的代理目标（仅 dev） | `http://localhost:8080` |
| `VITE_SENTRY_DSN` | Sentry DSN（可选，留空则不启用） | - |
| `DB_PATH` | 后端 SQLite 数据库路径（仅后端） | `backend/procurement.db` |

## 测试

### 单元测试
- 9 文件 / 122 测试用例
- 覆盖：评分算法、格式化、存储、供应商匹配、物料导入、AI 服务、截止监听、状态机

### E2E 测试
- Playwright 5 条核心流
- 覆盖：认证、询价流程、供应商门户、权限控制、国际化与主题

## 部署

详见 [docs/deployment.md](docs/deployment.md)

## 架构

详见 [docs/architecture.md](docs/architecture.md)

## 许可证

MIT
