# A 真实后端 + B 前端体验深化 计划

## 摘要

在前端已为「MSW 驱动完整可演示系统」的基础上，执行两大方向：

- **A 真实后端**：Python FastAPI + SQLAlchemy + SQLite，实现 38 端点（对齐 [docs/api-contract.md](../docs/api-contract.md)），补全 4 个 stub 端点（toggle-status / quotation submit / materials batch / settings 持久化），修复前端 token 持久化断点，实现 RBAC 鉴权，注入种子数据。后端代码置于项目根 `backend/` 子目录，与前端解耦。
- **B 前端体验深化**：①i18n 中英双语（react-i18next）②亮暗主题切换（antd darkAlgorithm + CSS 变量）③PDF 导出升级（jsPDF + html2canvas）④移动端细化 + 图表增强。

完成后系统具备「真实后端 + 国际化 + 主题 + PDF + 移动端 + 增强图表」的企业级体验。

---

## 当前状态分析

### A 后端缺口

- **无后端**：当前全部由 [handlers.ts](../src/mocks/handlers.ts) 38 端点 mock 驱动，无真实服务端
- **4 个 stub 端点**需后端补完整业务逻辑：
  - `POST /suppliers/:id/toggle-status` — 当前空操作，未切换 cooperationStatus
  - `POST /quotations/:id/submit` — 当前空操作，未置 status=SUBMITTED / submittedAt / 未追加 SUBMIT_QUOTATION 日志到对应 inquiry
  - `POST /materials/batch` — 当前不持久化，仅返回 success 数量
  - `PUT /settings` — 当前不持久化，原样回显
- **token 持久化断点**：[useAuthStore.ts](../src/store/useAuthStore.ts) login 后未将 token 写入 `localStorage.procurement_token`，但 [client.ts](../src/api/client.ts) 拦截器读取该 key —— 后端上线后真实鉴权会失败
- **数据模型复杂**：Inquiry 含 items/quotations/logs/approvalNodes/attachments 嵌套数组；QuotationItem 含 12 字段；5 类种子数据（5 用户 / 8 供应商 / 8 物料 / 8 询价 / 8 报价）
- **状态机**：InquiryStatus 10 态，6 个动作端点驱动转换（send/submit-approval/approve/reject/confirm/cancel），approve 与 reject 都转 PENDING_CONFIRM（沿用现有业务语义）
- **RBAC**：3 角色（采购人员/采购主管/管理员）+ 12 权限点 + 角色权限矩阵；UserRole 用中文枚举值（后端 SQLAlchemy 用 String 存）
- **AppSettings vs Settings**：后端只存 7 个标量（approval 3 + notification 4），前端独有的 organization/systemName/currency/validDays 等不入后端
- **id 命名**：业务 code（INQ/SUP/MAT+数字）与主键 id（inq-/sup-/mat-+数字）并存，分别建模

### B 前端缺口

- **i18n**：无任何 i18n 基建，3000~4000 条业务文案硬编码于 87 文件；antd locale 仅 main.tsx 一处硬编码 zhCN；confirm.tsx 封装了确定/取消可集中改造；types/index.ts 枚举 LABEL 含大量中文（属展示文案需迁移）
- **主题**：[main.tsx](../src/main.tsx) themeToken 硬编码 5 token；[global.css](../src/styles/global.css) 定义了 CSS 变量但业务组件未消费；151 处硬编码色值分布 24 文件（dashboard 34 处最多）；无暗色模式基建
- **PDF**：仅 [inquiry/detail/index.tsx:549](../src/pages/inquiry/detail/index.tsx) 1 处 `window.print()`；[print.css](../src/styles/print.css) 单一 @media print 块；无法控制页眉页脚/分页/元信息；ECharts Canvas 打印效果未处理
- **图表**：[echarts.ts](../src/utils/echarts.ts) 仅注册 Pie/Line；仅 [dashboard](../src/pages/dashboard/index.tsx) 1 页 2 图（状态饼图 + 7 天报价趋势折线）；可扩展供应商分布/品类分布/中标率/审批漏斗等
- **移动端**：仅 1 个 768px 断点（[global.css:91](../src/styles/global.css)）；未用 antd Grid.useBreakpoint；表格仅横向滚动；[SupplierLayout](../src/layouts/SupplierLayout.tsx) 与 [supplier-portal](../src/pages/supplier-portal/index.tsx) 完全无响应式；Modal/Drawer 未全屏化；无安全区适配

---

## 提议变更

### Phase A：FastAPI 后端实现

后端代码结构（新建 `backend/` 目录）：

```
backend/
├── app/
│   ├── main.py              # FastAPI 应用入口 + CORS + 路由注册
│   ├── config.py            # 配置（SQLite 路径、CORS 白名单）
│   ├── database.py          # SQLAlchemy engine + session
│   ├── models.py            # 12 个 SQLAlchemy ORM 模型
│   ├── schemas.py           # Pydantic 请求/响应 schema
│   ├── auth.py              # 认证依赖（Bearer token 解析）+ RBAC 依赖
│   ├── seed.py              # 种子数据初始化（首次启动注入）
│   └── routers/
│       ├── auth.py          # /auth/* 3 端点
│       ├── inquiries.py     # /inquiries/* 11 端点
│       ├── suppliers.py     # /suppliers/* 6 端点
│       ├── materials.py     # /materials/* 6 端点
│       ├── quotations.py    # /quotations/* + /inquiries/:id/quotations 6 端点
│       ├── notifications.py # /notifications/* 4 端点
│       └── settings.py      # /settings 2 端点
├── requirements.txt         # fastapi, uvicorn, sqlalchemy, pydantic
├── run.sh                   # uvicorn 启动脚本（port 8080，对齐 vite proxy 默认）
└── README.md                # 后端启动说明
```

#### A1：SQLAlchemy 模型（`backend/app/models.py`）

- **What**：定义 12 个 ORM 模型，对应前端 [types/index.ts](../src/types/index.ts)
  - `User`（id, name, avatar, role, department, organization, permissions JSON）
  - `Organization`（name）—— 或直接用 User.organization 字段，单表简化
  - `Material`（id, code 唯一索引, name, category, brand, spec, techParams, unit, stockQty nullable）
  - `Supplier`（id, code 唯一索引, name, region, contact, phone, email, mainCategories JSON, level, cooperationStatus, qualified, historyResponseRate, historyFulfillmentRate, avgDeliveryDays, lastCooperateTime nullable, historyCoopCount）
  - `Attachment`（id, name, url, size, uploadTime, owner_type, owner_id）—— 多态归属（Inquiry/InquiryItem/Quotation/QuotationItem）
  - `Inquiry`（id, code 唯一索引, subject, organization, ownerName, ownerId, currency, deadline, expectedDeliveryDate nullable, deliveryAddress, contact, paymentTerms, invoiceRequirement nullable, description nullable, status, createdById, createdByName, createdAt, updatedAt, selectedSupplierMap JSON, purchaserComments JSON）+ relationship: items, logs, approvalNodes, quotations, attachments, invitedSupplierIds（多对多关联表 InquirySupplier）
  - `InquiryItem`（id, inquiryId FK, materialId FK nullable, name, code, category, brand, spec, techParams, unit, quantity, targetPrice nullable, expectedDeliveryDate nullable, remark nullable）+ attachments relationship
  - `InquiryLog`（id, inquiryId FK, time, operator, operatorRole nullable, type, content, result nullable）
  - `ApprovalNode`（id, inquiryId FK, nodeOrder, approverId, approverName, approverRole, status, comment nullable, time nullable）
  - `Quotation`（id, inquiryId FK, supplierId FK, supplierName, status, submittedAt nullable, totalAmount, remark nullable, createdAt, updatedAt）+ items + attachments relationship
  - `QuotationItem`（id, quotationId FK, inquiryItemId FK, unitPrice, taxRate, taxIncludedTotal, moq nullable, deliveryDays, deliveryDate nullable, brand nullable, warrantyMonths nullable, paymentTerms nullable, validUntil nullable, techDeviation nullable, commercialDeviation nullable, remark nullable）+ attachments relationship
  - `Notification`（id, inquiryId nullable, type, title, content, time, read）—— 单表，无关联
  - `AppSettings`（id=1 单行, approval_enabled, approval_amountThreshold, approval_approverId, notification_deadlineReminder, notification_deadlineReminderHours, notification_quotationSubmitted, notification_approvalResult）
  - `Token`（token PK, userId FK, createdAt）—— 简单 token 表，登录写入
- **Why**：完整对齐前端类型，支持嵌套关系查询
- **How**：SQLAlchemy 2.0 声明式；relationship 用 cascade="all, delete-orphan"；JSON 字段用 `sqlalchemy.JSON`；中文角色用 `String` 不用 `Enum`（避免迁移痛点）

#### A2：Pydantic Schema（`backend/app/schemas.py`）

- **What**：为每个模型定义响应 schema（含嵌套），与 TS 类型字段一一对应；请求 schema 用 `Partial[T]` 风格（Pydantic v2 用 `Optional` + `model_config = ConfigDict(extra='forbid')` 或允许 extra）
- **关键**：时间字段统一 `str`（保持 `YYYY-MM-DD HH:mm:ss` 格式，与前端一致，不用 datetime）；id 字段统一 `str`
- **Why**：FastAPI 自动生成 OpenAPI 文档，可直接对照 [api-contract.md](../docs/api-contract.md) 校验

#### A3：认证 + RBAC（`backend/app/auth.py`）

- **What**：
  - `get_current_user(token: str = Depends(oauth2_scheme))` 依赖：查 Token 表 → User，401 if invalid
  - `require_permission(perm: str)` 工厂：返回依赖，校验 `user.permissions ?? ROLE_PERMISSIONS[user.role]` 含 perm，403 if 无
  - `ROLE_PERMISSIONS` 字典（Python 端复制 [types/index.ts](../src/types/index.ts) 矩阵）
  - 登录端点：POST /auth/login，body `{userId}` → 查 User → 生成 token（`token-{userId}-{uuid8}`）→ 写 Token 表 → 返回 `{user, token}`
- **Why**：替代 mock 的 `mock-token-{userId}`，真实鉴权；RBAC 对齐前端 12 权限点
- **How**：FastAPI `HTTPBearer`；权限矩阵硬编码 Python dict（与前端 ROLE_PERMISSIONS 一致）

#### A4：路由实现（7 个 router 文件）

- **What**：实现 38 端点，对齐 handlers.ts 业务逻辑
  - **auth.py**：login / logout（删 Token 表记录）/ me
  - **inquiries.py**：list / get / create / update / delete + 6 动作端点（send/cancel/confirm/submit-approval/approve/reject）
    - 动作端点均：更新 status + 追加 InquiryLog + 更新 updatedAt + 审批端点追加 ApprovalNode
    - submit-approval 用 AppSettings.approval_approverId 作为审批人（默认 u-2）
  - **suppliers.py**：list / get / create / update / delete + toggle-status（**补完整**：COOPERATING ↔ DISABLED 切换）
  - **materials.py**：list / get / create / update / delete + batch（**补完整**：upsert by code，返回成功数）
  - **quotations.py**：list / listByInquiry / get / create / saveDraft + submit（**补完整**：status→SUBMITTED, submittedAt=now, 追加 SUBMIT_QUOTATION 日志到对应 inquiry）
  - **notifications.py**：list / create（上限 100 条，FIFO）/ markRead / markAllRead
  - **settings.py**：get（读 AppSettings 单行）/ update（**补完整**：写回 DB）
- **Why**：38 端点全实现，4 个 stub 补完整
- **How**：每个 router 用 `APIRouter`；动作端点用事务确保状态+日志+节点原子更新；时间用 `datetime.now().strftime('%Y-%m-%d %H:%M:%S')`；id 生成沿用 `sup-{ms}` / `mat-{ms}` / `q-{ms}` / `ntf-{ms}-{rand4}` 规则

#### A5：种子数据（`backend/app/seed.py`）

- **What**：首次启动时若 DB 为空，注入种子数据（从 [src/mock/](../src/mock/) 转写为 Python 字典 → ORM 实例）
  - 5 用户（含 ROLE_PERMISSIONS 解析后写入 permissions 字段，或留空走默认）
  - 3 组织
  - 8 物料（mat-1~mat-8）
  - 8 供应商（sup-1~sup-8）
  - 8 询价（inq-1~inq-8，含 items/logs/invitedSupplierIds/selectedSupplierMap/purchaserComments/approvalNodes）
  - 8 报价（quo-4-5 等，含 items）
  - AppSettings 单行默认值（approval.enabled=true, amountThreshold=50000, approverId=u-2, notification 全默认）
- **Why**：联调即有数据可演示，对齐 MSW 行为
- **How**：`seed.py` 提供 `init_db()` 函数，main.py 启动时调用（检查 `select count(*) from users` 为 0 才注入）；种子数据硬编码 Python 字典（不读 JSON 文件，避免跨语言格式问题）

#### A6：前端 token 持久化修复

- **文件**：[src/store/useAuthStore.ts](../src/store/useAuthStore.ts)
- **What**：`login(userId)` 调用 `authApi.login({userId})` 成功后，`localStorage.setItem('procurement_token', result.token)`；`logout()` 时 `localStorage.removeItem('procurement_token')`
- **Why**：当前 client.ts 拦截器读 `procurement_token` 但 useAuthStore 未写入，真实后端鉴权会 401
- **How**：在 login 方法的 authApi 调用成功分支补 setItem；logout 补 removeItem。注意保持现有「本地先 set + 异步 API + 失败降级」模式，token 持久化只在 API 成功时执行

#### A7：联调配置

- **What**：更新 [.env.example](../.env.example) 与 [.env.development](../.env.development) 说明，新增 `.env.development.local` 示例：`VITE_ENABLE_MSW=false` + `VITE_API_PROXY_TARGET=http://localhost:8080`
- **Why**：联调时关闭 MSW，走 vite proxy 到 FastAPI
- **How**：文档说明，不改代码逻辑（vite.config.ts proxy 已就绪）

---

### Phase B：前端体验深化

#### B1：i18n 基建搭建

- **文件**：[package.json](../package.json)（加依赖）、新建 `src/i18n/index.ts`、`src/locales/zh-CN.json`、`src/locales/en-US.json`、[src/main.tsx](../src/main.tsx)（接入 provider）
- **What**：
  - 安装 `i18next` + `react-i18next`
  - `src/i18n/index.ts`：初始化 i18next，resources 加载 zh-CN/en-US，默认 zh-CN，language 持久化到 localStorage `lang`
  - locale 文件结构：按模块嵌套（`common` / `menu` / `dashboard` / `inquiry` / `supplier` / `material` / `quotation` / `notification` / `settings` / `approval` / `log` / `login` / `errors`）
  - main.tsx 包裹 `<I18nextProvider i18n={i18n}>`
  - antd locale 联动：根据 i18n.language 切换 `zhCN` / `enUS`
- **Why**：从 0 搭建 i18n 基建
- **How**：i18next 浏览器默认导出；useTranslation hook；语言切换 store（复用 useUIStore 或新建 useI18nStore）

#### B2：i18n 文案迁移（分批）

- **文件**：87 个 .tsx/.ts 文件，分批迁移
- **What**：将硬编码中文替换为 `t('module.key')`，模板字符串改 `t('module.key', { var: value })`
  - **批次1（基建）**：[confirm.tsx](../src/utils/confirm.tsx)（确定/取消/成功/失败集中改造）、[PageHeader](../src/components/PageHeader.tsx)、[StatusTag](../src/components/StatusTag.tsx)（枚举 LABEL 迁移）、[types/index.ts](../src/types/index.ts)（`*_LABEL` 常量改为函数接收 t，或保留中文 label 作为 fallback + 提供 i18n key 映射）
  - **批次2（核心页）**：dashboard / inquiry(list,create,detail) / quotation(compare,pending) / supplier(list,detail) / material / notification / settings / approval / log / login / supplier-portal / forbidden / not-found
  - **批次3（mock 与 utils）**：aiService 生成的文本（询价说明/异常分析/比价结论）迁移为 i18n key；materialImport 的列别名匹配保留中文（业务数据），错误提示迁移
- **Why**：3000~4000 文案迁移
- **How**：每文件 import useTranslation，替换字符串；常量数组（如 settings 的通知项、评分权重）改为 `t()` 调用；表格 `locale={{ emptyText: t('common.noData') }}` 统一
- **注意**：mock 数据中的中文（供应商名、物料名）不迁移（属业务数据）；枚举 LABEL 迁移为 `t('enum.inquiryStatus.DRAFT')` 等

#### B3：主题切换基建

- **文件**：新建 `src/store/useThemeStore.ts`、[src/main.tsx](../src/main.tsx)（接入动态主题）、[src/styles/global.css](../src/styles/global.css)（补暗色变量）
- **What**：
  - `useThemeStore`：mode 字段（'light' | 'dark'），persist 到 localStorage `theme`，toggle 方法
  - main.tsx：根据 mode 切换 antd `theme.algorithm`（light=defaultAlgorithm，dark=darkAlgorithm），token 保持不变（colorPrimary 等）
  - global.css：扩展 `:root` 变量为 light/dark 两套，用 `[data-theme="dark"]` 选择器覆盖；document.documentElement.dataset.theme = mode
  - 新增变量：`--color-bg-dark`、`--color-card-dark`、`--color-text-dark` 等
- **Why**：主题切换基建
- **How**：antd v5 `theme.darkAlgorithm`；CSS 变量双轨（antd 组件由 algorithm 驱动，自定义组件由 CSS 变量驱动）

#### B4：主题色值迁移

- **文件**：24 个含硬编码色值的文件
- **What**：将 151 处 `#165DFF` / `rgba(22,93,255,0.x)` / `#4E5969` 等替换为 CSS 变量 `var(--color-primary)` / `var(--color-text-secondary)` 等
  - 重点：[dashboard](../src/pages/dashboard/index.tsx) 34 处（ECharts 颜色需动态读取 CSS 变量或主题 store）、[settings](../src/pages/settings/index.tsx) 21 处、[inquiry/list](../src/pages/inquiry/list/index.tsx) 11 处、[MainLayout](../src/layouts/MainLayout.tsx) 7 处
  - ECharts 特殊处理：图表颜色不能直接用 CSS 变量（Canvas 不解析 var），需从 themeStore 读取当前主题对应的色值数组
- **Why**：让暗色模式生效
- **How**：全局搜索替换 `#165DFF` → `var(--color-primary)` 等；ECharts 封装一个 `useChartColors()` hook 返回当前主题色板

#### B5：PDF 导出升级

- **文件**：[package.json](../package.json)（加 jspdf + html2canvas）、新建 `src/utils/pdf.ts`、[src/pages/inquiry/detail/index.tsx](../src/pages/inquiry/detail/index.tsx)（替换 window.print）
- **What**：
  - 安装 `jspdf` + `html2canvas`
  - `src/utils/pdf.ts`：封装 `exportElementToPDF(element: HTMLElement, filename: string)` —— html2canvas 截图 → jsPDF 分页拼接 → 保存
  - inquiry/detail 的"导出 PDF"按钮改调 `exportElementToPDF`，不再用 window.print
  - 保留 [print.css](../src/styles/print.css)（window.print 作为降级方案）
- **Why**：真实导出 PDF 文件，非浏览器打印对话框
- **How**：html2canvas `{scale: 2, useCORS: true, backgroundColor: '#fff'}`；jsPDF A4 纵向分页；ECharts Canvas 由 html2canvas 直接截图（无需特殊处理）
- **局限**：html2canvas 对部分 CSS（如 box-shadow）支持不佳，需测试

#### B6：图表增强

- **文件**：[src/utils/echarts.ts](../src/utils/echarts.ts)（补注册）、[src/pages/dashboard/index.tsx](../src/pages/dashboard/index.tsx)（新增图表组件）
- **What**：
  - echarts.ts 补注册：`BarChart`、`FunnelChart`、`GaugeChart`、`TreemapChart` + `VisualMapComponent`、`DataZoomComponent`
  - dashboard 新增 3 个图表：
    - **供应商报价频次 Top10**（横向 Bar）：从 inquiries.invitedSupplierIds 统计
    - **物料品类分布**（Pie/Rose）：从 inquiries.items[].category 统计
    - **询价审批漏斗**（Funnel）：按状态流转统计（DRAFT→PENDING_SEND→INQUIRING→...→COMPLETED）
  - 图表颜色用 B4 的 `useChartColors()` 适配主题
- **Why**：增强数据可视化
- **How**：复用 dashboard 现有 resize/dispose 模式；新增图表组件独立函数

#### B7：移动端细化

- **文件**：[src/styles/global.css](../src/styles/global.css)（补断点）、[src/layouts/MainLayout.tsx](../src/layouts/MainLayout.tsx)、[src/layouts/SupplierLayout.tsx](../src/layouts/SupplierLayout.tsx)、各列表页（表格卡片化）、[src/pages/supplier-portal/index.tsx](../src/pages/supplier-portal/index.tsx)
- **What**：
  - global.css 补 576px / 992px / 1200px 断点，建立 mobile-first 字号 token
  - MainLayout：Header 工具栏移动端折叠到 Drawer（组织选择/消息/通知/头像收进 More 菜单）
  - SupplierLayout：补响应式（Header 高度 / Title 缩小 / padding 调整）
  - supplier-portal：补 antd 栅格响应式（报价表单移动端单列）
  - 列表页（inquiry/supplier/material/quotation）：移动端表格切换为卡片列表模式（用 `useBreakpoint` 判断，xs 以下渲染 Card 列表）
  - Modal/Drawer：移动端 Drawer 全屏化（`width: '100%'` when isMobile）
  - 触控热区：移动端按钮 size 切换为 default
  - 安全区：`body { padding: env(safe-area-inset-*) }`
- **Why**：移动端体验细化
- **How**：引入 antd `Grid.useBreakpoint`（封装成 `useIsMobile()` hook 复用）；表格卡片化用条件渲染（不替换 antd Table，并列两套）

---

## 假设与决策

### 决策

1. **后端目录**：置于项目根 `backend/` 子目录，与前端解耦，独立 requirements.txt 与 run.sh
2. **认证方案**：简单 token 表（token-{userId}-{uuid8}），不引入 JWT（开发联调阶段足够，避免过度工程化）
3. **RBAC**：Python 端硬编码 ROLE_PERMISSIONS 字典，与前端 [types/index.ts](../src/types/index.ts) 矩阵一致
4. **时间格式**：后端统一返回 `YYYY-MM-DD HH:mm:ss` 字符串（与前端一致），不用 datetime 对象
5. **id 生成**：沿用 mock 的 `sup-{ms}` / `mat-{ms}` 规则，保证与现有数据风格一致
6. **approve/reject 状态**：都转 PENDING_CONFIRM（沿用 handlers.ts 现有语义，不改业务逻辑）
7. **i18n 枚举 LABEL**：迁移为 `t('enum.inquiryStatus.DRAFT')` 形式，types/index.ts 的 `INQUIRY_STATUS_LABEL` 改为 `Record<InquiryStatus, string>` 返回 i18n key，由组件层调 `t()` 翻译
8. **主题 ECharts**：用 `useChartColors()` hook 从 themeStore 读取色板，不用 CSS 变量（Canvas 限制）
9. **PDF 方案**：jsPDF + html2canvas，保留 print.css 作降级
10. **移动端表格**：useBreakpoint 条件渲染卡片列表，不替换 antd Table
11. **mock 数据中文不迁移**：供应商名/物料名等属业务数据，不进 i18n
12. **执行顺序**：A 先（后端就绪后前端可真实联调）→ B1-B2（i18n）→ B3-B4（主题）→ B5（PDF）→ B6（图表）→ B7（移动端）。i18n 优先因其他改造会新增文案，先建基建避免二次翻译

### 假设

1. 后端 SQLite 文件置于 `backend/procurement.db`，首次启动自动创建 + 注入种子
2. 前端联调时设 `VITE_ENABLE_MSW=false` + `VITE_API_PROXY_TARGET=http://localhost:8080`，vite proxy 已就绪
3. i18n 英文翻译由 AI 生成初稿，后续可人工校对
4. html2canvas 对 ECharts Canvas 截图可用（需 useCORS + 测试）
5. 移动端卡片列表模式不替换原 Table，并列两套渲染（isMobile 判断）

---

## 验证步骤

### Phase A 验证（后端）

1. `cd backend && pip install -r requirements.txt && bash run.sh` — FastAPI 启动在 :8080
2. 浏览器访问 `http://localhost:8080/docs` — OpenAPI 文档显示 38 端点
3. 前端 `.env.local` 设 `VITE_ENABLE_MSW=false`，`npm run dev` — 走真实后端
4. 登录 → 工作台 → 创建询价 → 发送 → 供应商报价 → 对比 → 审批 → 定标 → 通知中心全流程跑通
5. 4 个 stub 端点验证：
   - toggle-status 后供应商 cooperationStatus 实际变化
   - quotation submit 后 status=SUBMITTED + inquiry 日志含 SUBMIT_QUOTATION
   - materials batch 后 DB 实际写入
   - settings PUT 后 GET 返回更新值
6. 401/403 验证：无 token 请求 → 401；无权限请求（如采购人员访问 settings）→ 403

### Phase B 验证（前端）

1. `npm run lint` — 0 error / 0 warning
2. `npx tsc --noEmit` — 0 error
3. `npx vitest run` — 全部通过（i18n/主题/PDF 改造后测试不回归）
4. `npm run build` — 通过
5. i18n：切换到 English，全站无中文残留（除 mock 业务数据）；切回中文正常
6. 主题：切换暗色，全站无亮色残留（含 ECharts）；刷新保持
7. PDF：inquiry/detail 导出 PDF 文件，内容完整含图表
8. 图表：dashboard 显示 5 个图表（原 2 + 新 3），暗色下颜色正确
9. 移动端：Chrome DevTools 移动端模拟，各页面布局正常，表格卡片化，Drawer 全屏

---

## 执行顺序

```
Phase A：后端
  A1 模型 → A2 schema → A3 auth/RBAC → A4 路由（7 文件）→ A5 种子 → A6 前端 token 修复 → A7 联调配置
  → A 验证（OpenAPI + 全流程 + 4 stub + 401/403）

Phase B：前端
  B1 i18n 基建 → B2 i18n 迁移（3 批次）→ B3 主题基建 → B4 色值迁移 → B5 PDF 升级 → B6 图表增强 → B7 移动端细化
  → B 验证（lint/tsc/test/build + i18n/主题/PDF/图表/移动端实测）
```

---

## 后续方向（本计划完成后）

- E2E 测试（Playwright）覆盖核心流程
- Dockerfile + docker-compose（前后端一键启动）
- CI/CD 流水线
- 性能优化（路由懒加载细化、图表按需加载、PDF 异步生成）
