# 系统架构文档

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      浏览器（用户端）                      │
│  React SPA（React 18 + TypeScript + Ant Design 5）      │
├─────────────────────────────────────────────────────────┤
│  路由层     │  状态层（Zustand）  │  API 层（axios）      │
│  React      │  10 个 store         │  8 个 API 模块        │
│  Router 6   │  + localStorage      │  + MSW mock（开发）   │
├─────────────────────────────────────────────────────────┤
│                    nginx（反代 + 静态）                   │
│  :80 → /api/* → backend:8080                            │
│      → /*     → SPA 静态文件                             │
├─────────────────────────────────────────────────────────┤
│               FastAPI 后端（uvicorn :8080）              │
│  8 路由模块 / 38 端点 / RBAC / Bearer token             │
├─────────────────────────────────────────────────────────┤
│           SQLAlchemy ORM + SQLite（持久化）              │
│  13 个 ORM 模型 / 种子数据 / 数据卷挂载                  │
└─────────────────────────────────────────────────────────┘
```

## 前端模块划分

### 页面层（13 页面，懒加载）
| 模块 | 页面 | 功能 |
|---|---|---|
| 工作台 | dashboard | 统计卡片 + 5 图表 + 待办 + 最近询价 |
| 询价管理 | inquiry/list、create、detail | 列表/创建（分步）/详情 |
| 报价管理 | quotation/pending、compare | 待处理/对比（双视图+评分） |
| 供应商 | supplier/index、detail | 列表/详情/启停 |
| 物料 | material/index | 主数据/批量导入 |
| 审批 | approval/index | 审批待办/通过/驳回 |
| 通知 | notification/index | 通知列表/标记已读 |
| 日志 | log/index | 全流程时间轴 |
| 设置 | settings/index | 审批规则/通知开关 |
| 登录 | login | 用户选择登录 |
| 供应商门户 | supplier-portal | 独立报价填报端 |

### 状态层（10 个 Zustand store）
- `useAuthStore`：用户认证 + 权限判断 + token 持久化
- `useInquiryStore`：询价单 CRUD + 状态机流转
- `useSupplierStore`：供应商管理
- `useMaterialStore`：物料主数据
- `useQuotationStore`：报价管理
- `useNotificationStore`：通知中心
- `useSettingsStore`：系统设置
- `useThemeStore`：明暗主题
- `useUIStore`：UI 状态（全局搜索/侧边栏等）
- `useLogStore`：操作日志

### 数据流
```
UI 交互 → store action → set() 同步更新 + saveJSON 持久化
                     → xxxApi.method().catch() 异步走 API（失败降级本地）
```

启动时：`App.tsx` → `bootstrapStores()` → `Promise.allSettled` 并行加载 7 个 store

## 后端模块划分

### 路由层（8 模块 / 38 端点）
| 模块 | 端点数 | 功能 |
|---|---|---|
| auth | 3 | 登录/登出/当前用户 |
| inquiries | 12 | CRUD + 6 动作（发送/取消/确认/提交审批/通过/驳回） |
| suppliers | 6 | CRUD + 启停 |
| materials | 6 | CRUD + 批量导入 |
| quotations | 5 | 列表/详情/创建/暂存/提交 |
| notifications | 4 | 列表/创建/标记已读/全部已读 |
| settings | 2 | 获取/更新 |
| metrics | 1 | Web Vitals 上报（接收 sendBeacon） |

### 数据模型（13 个 ORM 模型）
- `User`：用户（含角色 + 权限 JSON）
- `Token`：登录令牌
- `Supplier`：供应商
- `Material`：物料主数据
- `Inquiry`：询价单
- `InquiryItem`：询价物料明细
- `InquirySupplier`：询价-供应商关联（多对多）
- `InquiryLog`：询价操作日志
- `ApprovalNode`：审批节点
- `Quotation`：报价单
- `QuotationItem`：报价明细
- `Notification`：通知
- `AppSettings`：系统设置（单行表）
- `Attachment`：附件（多态）

## RBAC 权限模型

### 3 角色
| 角色 | 说明 | 典型操作 |
|---|---|---|
| 采购人员 | 日常询价操作 | 创建/编辑询价、查看报价 |
| 采购主管 | 审批 + 管理 | 审批超阈值定标、查看全部 |
| 管理员 | 系统管理 | 供应商启停、系统设置、物料管理 |

### 12 权限点
`INQUIRY_CREATE` / `INQUIRY_EDIT` / `INQUIRY_DELETE` / `INQUIRY_SEND`
`SUPPLIER_VIEW` / `SUPPLIER_DISABLE`
`MATERIAL_MANAGE`
`QUOTATION_VIEW` / `QUOTATION_APPROVE`
`SETTINGS_MANAGE` / `APPROVAL_MANAGE` / `LOG_VIEW`

### 权限控制实现
- 后端：`require_permission(perm)` 装饰器工厂，校验 Bearer token → User.permissions
- 前端：`<Permission perm="XXX">` 组件包裹按钮 + 路由守卫

## 询价状态机

```
DRAFT → PENDING_SEND → INQUIRING → PARTIAL_QUOTED → ALL_QUOTED
                                                          ↓
                                              PENDING_CONFIRM ← (无审批)
                                                    ↓
                                              COMPLETED

ALL_QUOTED → PENDING_APPROVAL → PENDING_CONFIRM → COMPLETED
                              (超阈值审批)   (审批通过)

任意状态 → CANCELLED
```

### 状态流转触发条件
- `DRAFT → PENDING_SEND`：保存草稿
- `PENDING_SEND → INQUIRING`：发送询价（POST /inquiries/:id/send）
- `INQUIRING → PARTIAL_QUOTED/ALL_QUOTED`：供应商提交报价（自动）
- `ALL_QUOTED → PENDING_APPROVAL`：超阈值定标提交审批
- `PENDING_APPROVAL → PENDING_CONFIRM`：审批通过/驳回
- `PENDING_CONFIRM → COMPLETED`：确认定标结果

## Mock 与真实后端切换

### 开发模式（默认 MSW）
```
浏览器 → Service Worker → MSW handlers → 内存 mock 数据
```

### 联调/生产模式（真实后端）
```
浏览器 → vite proxy（dev）/ nginx（prod） → FastAPI → SQLite
```

切换方式：`.env.development.local` 设 `VITE_ENABLE_MSW=false`

## 可观测性

### 前端
- **Sentry**：错误上报 + 性能追踪（通过 `VITE_SENTRY_DSN` 启用）
- **Web Vitals**：CLS/LCP/FCP/TTFB/INP 五项指标采集
- **ErrorBoundary**：Sentry.ErrorBoundary 包裹 App

### 后端
- **logging**：标准库 logging，INFO 级别
- **请求日志中间件**：记录 method/path/status/duration

### 健康检查
- `GET /api/health` → `{"status":"ok","version":"1.0.0","db":"connected"}`
- Docker healthcheck 自动探测

## CI/CD

```
push/PR → GitHub Actions
  ├─ quality: lint + tsc + vitest
  ├─ build: npm run build → dist artifact
  ├─ backend-test: pip install + import smoke + pytest（API 集成 / 权限 / 状态流转）
  └─ docker-e2e: docker compose up → 健康检查 → Playwright E2E（真实前后端联调）→ 失败日志 + 清理
```

CI 覆盖：前端 lint / TypeScript / 单元测试 / 生产构建；后端导入冒烟 + 单元 + API 集成测试；Docker 镜像构建 + Compose 启动 + 健康检查 + 数据库初始化；Playwright E2E 真实前后端联调。测试失败时上传日志产物，并在 `always()` 中 `docker compose down -v` 清理环境。
