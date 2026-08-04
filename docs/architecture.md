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

| 模块       | 页面                         | 功能                                |
| ---------- | ---------------------------- | ----------------------------------- |
| 工作台     | dashboard                    | 统计卡片 + 5 图表 + 待办 + 最近询价 |
| 询价管理   | inquiry/list、create、detail | 列表/创建（分步）/详情              |
| 报价管理   | quotation/pending、compare   | 待处理/对比（双视图+评分）          |
| 供应商     | supplier/index、detail       | 列表/详情/启停                      |
| 物料       | material/index               | 主数据/批量导入                     |
| 审批       | approval/index               | 审批待办/通过/驳回                  |
| 通知       | notification/index           | 通知列表/标记已读                   |
| 日志       | log/index                    | 全流程时间轴                        |
| 设置       | settings/index               | 审批规则/通知开关                   |
| 登录       | login                        | 用户选择登录                        |
| 供应商门户 | supplier-portal              | 独立报价填报端                      |

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

| 模块          | 端点数 | 功能                                               |
| ------------- | ------ | -------------------------------------------------- |
| auth          | 3      | 登录/登出/当前用户                                 |
| inquiries     | 12     | CRUD + 6 动作（发送/取消/确认/提交审批/通过/驳回） |
| suppliers     | 6      | CRUD + 启停                                        |
| materials     | 6      | CRUD + 批量导入                                    |
| quotations    | 5      | 列表/详情/创建/暂存/提交                           |
| notifications | 4      | 列表/创建/标记已读/全部已读                        |
| settings      | 2      | 获取/更新                                          |
| metrics       | 1      | Web Vitals 上报（接收 sendBeacon）                 |

### 数据模型（核心 ORM 模型）

- `User`：用户（含角色 + 权限 JSON）
- `Token`：登录令牌（**只存哈希**）
- `RefreshSession`：刷新会话（Access/Refresh 轮换、撤销、重用检测）
- `Supplier`：供应商
- `Material`：物料主数据
- `Inquiry`：询价单（`organization/owner_id/owner_name/created_by_id/created_by_name` 服务端生成）
- `InquiryItem`：询价物料明细
- `InquirySupplier`：询价-供应商关联（多对多）
- `InquiryLog`：询价操作日志
- `ApprovalNode`：审批节点
- `Quotation`：报价单（`supplier_id` 外键；金额用 Decimal/Numeric；含税总额服务端重算）
- `QuotationItem`：报价明细（`inquiry_item_id` 外键）
- `QuotationSnapshot`：定标不可变报价快照
- `SupplierInvitation`：供应商邀请（`token_hash` 唯一、有效期、状态、绑定询价+供应商）
- `Notification`：通知（`user_id` 外键，用户级未读与偏好）
- `Attachment`：附件（归属业务资源 + 病毒扫描状态）
- `DeliveryRecord`：逐供应商询价投递状态（待发送/已发送/已送达/失败/退信/已打开/已提交）
- `AIUsage`：AI 调用成本与 Token 统计
- `UserTablePreference`：用户级表格视图/列配置持久化
- `AppSettings`：系统设置（单行表）

## 权限模型（功能 RBAC + 资源级授权）

### 3 角色

| 角色     | 说明         | 典型操作                       |
| -------- | ------------ | ------------------------------ |
| 采购人员 | 日常询价操作 | 创建/编辑询价、查看报价        |
| 采购主管 | 审批 + 管理  | 审批超阈值定标、查看全部       |
| 管理员   | 系统管理     | 供应商启停、系统设置、物料管理 |

### 12 权限点

`INQUIRY_CREATE` / `INQUIRY_EDIT` / `INQUIRY_DELETE` / `INQUIRY_SEND`
`SUPPLIER_VIEW` / `SUPPLIER_DISABLE`
`MATERIAL_MANAGE`
`QUOTATION_VIEW` / `QUOTATION_APPROVE`
`SETTINGS_MANAGE` / `APPROVAL_MANAGE` / `LOG_VIEW`

### 双层校验：功能权限 + 资源授权

- **功能权限**：`require_permission(perm)` 装饰器工厂，校验 Bearer token → `User.permissions`。
- **资源授权**（P0-3 新增，`backend/app/policy.py`）：
  - 统一 Policy 层 `require_inquiry_access(user, inquiry)`，普通采购默认仅可访问**自己创建 / 自己负责 / 作为协作者加入 / 所属组织允许共享**的询价。
  - 采购主管/管理员的 `VIEW_ALL_ORG` 等数据范围显式定义。
  - 所有 `list/get/update/delete/action` 都执行资源级校验，跨组织/跨用户访问返回 403。
  - 创建询价的 `organization/owner_id/owner_name/created_by_id/created_by_name` 由服务端从当前登录用户生成，**不信任前端提交**。
  - 普通更新接口不得修改 `status/organization/created_by/code`；供应商只能操作邀**请 Token 绑定**的报价；审批人只能操作**分配给自己的当前待审批节点**。
- **供应商门户**：使用邀请 Token 专用鉴权（`backend/app/routers/portal.py`），**不依赖内部采购 Bearer Token**；字段级最小化输出（隐藏其他受邀供应商/报价/内部备注/目标价/审批/日志）。

## 鉴权与会话安全（P1-6）

- 库中只存 Token 哈希，不存明文；登出先携带有效凭据**撤销服务端会话**再清除本地状态。
- 短期 Access Token + 可轮换 Refresh Token + HttpOnly/Secure/SameSite Cookie。
- 支持会话列表、单会话撤销、全部设备退出与 Refresh Token 重用检测。
- 登录限流与幂等数据迁移到 Redis（可多实例）；`X-Forwarded-For` 仅可信代理读取。
- 安全响应头：CSP / HSTS / X-Content-Type-Options / Referrer-Policy / Permissions-Policy。

## 询价状态机（服务端强约束，`backend/app/state_machine.py`）

```
DRAFT → PENDING_SEND → INQUIRING → PARTIAL_QUOTED → ALL_QUOTED
                                                          │
                              （达到审批条件）              │（未达审批条件）
                                                          ▼
                                             PENDING_APPROVAL ──通过──▶ PENDING_CONFIRM
                                                          │下级退回        │
                                                          ▼              ▼
                                                    返回修改(REVISING)   COMPLETED
任意状态 → CANCELLED
```

### 状态流转规则（非法转换返回结构化 409）

- `DRAFT → PENDING_SEND`：保存草稿（仅草稿可发送）
- `PENDING_SEND → INQUIRING`：发送询价（已取消/已完成不得再次发送；未邀请供应商不能进入询价中）
- `INQUIRING → PARTIAL_QUOTED / ALL_QUOTED`：供应商提交报价（自动）
- `ALL_QUOTED → PENDING_APPROVAL`：达到审批条件时提交审批（未达条件按配置跳过审批）
- `PENDING_APPROVAL → PENDING_CONFIRM`：审批通过；`→ REVISING`：审批驳回（进入明确"退回修改"，**不进入"待确认"**）
- `PENDING_CONFIRM → COMPLETED`：确认定标（所有物料完成供应商选择；已提交审批不得重复创建待审批节点；仅当前指定审批人可审批）
- 普通 PUT/PATCH **不得直接修改状态**；动作接口幂等并支持 `Idempotency-Key`（发送邀请/提交报价/提交审批/确认定标）。

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
