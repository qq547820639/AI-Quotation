# W7 全量迁移收口 + 质量硬化计划

## 摘要

在 W1-W10 完成的基础上，执行最后一轮收口工作，解决探索发现的 5 类问题：
1. **W7 全量迁移**：useInquiryStore 11 个写操作走 API；useSettingsStore/useAuthStore 接入 API；修复 sendInquiry 业务断点与 upsertQuotation 新建路径
2. **补关键模块测试**：为 useInquiryStore/aiService/materialImport/deadlineWatcher/inquiryStatus 补单元测试，作为迁移安全网
3. **清理假交互与 mock 残留**：修复 3 个装饰性"查询"按钮、3 处 setTimeout 假 loading、4 处直接 import mock 数据、7 处 as never、删除死代码
4. **权限与流程入口补全**：应用 INQUIRY_SEND 权限点、询价详情页补审批入口
5. **真实后端联调准备**：替换 .env.production 占位、补 API 契约文档、修复 authApi 参数语义

**数据层模式决策**：延续现有 Zustand + 手动 loadFromApi + 写操作走 API + .catch 降级模式（与已迁移的 4 个 store 一致），不引入 React Query 重写（装了不用属于可接受技术债，重写风险高于收益）。

---

## 当前状态分析

### W7 迁移缺口（P0）

| Store | loadFromApi | 写操作走 API | 状态 |
|---|---|---|---|
| useInquiryStore | ✓ | ✗ 11 个写操作全部仅 set+saveJSON | **未迁移** |
| useSupplierStore | ✓ | ✓ | 完整 |
| useMaterialStore | ✓ | ✓ | 完整 |
| useQuotationStore | ✓ | 部分（upsertQuotation 新建路径未走 API） | **部分** |
| useNotificationStore | ✓ | ✓ | 完整 |
| useSettingsStore | ✗ 无此方法 | ✗ settingsApi 完全未集成 | **未迁移** |
| useAuthStore | ✗ 无此方法 | ✗ authApi 完全未集成 | **未迁移** |

### 业务流程断点（P0）

1. **sendInquiry 死代码**：`useInquiryStore.sendInquiry(id)` 定义于 line 199，全局 0 次调用。`inquiry/create` 的 `handleSend` 直接 `addInquiry(InquiryStatus.INQUIRING)` 绕过它，导致 `INQUIRY_SENT` 通知永远不发送
2. **upsertQuotation 新建路径**：`exists=false` 时仅 saveJSON，未调 API，供应商首次报价无法同步服务端
3. **INQUIRY_SEND 权限点**：12 个权限点中唯一 0 处使用的

### 假交互与 stub 残留（P1）

- 3 个"查询"按钮无 onClick：`inquiry/list:481`、`material:390`、`supplier:318`
- 3 处 setTimeout 假 loading：`material:80`、`supplier:67`、`log:90`
- 4 处直接 import mock：`inquiry/create:24`、`dashboard:42`、`MainLayout:43`、`login:10`、`settings:24`
- 7 处 `as never`：`handlers.ts:48,56,113,121,148,156,189`
- 死代码：`PagePlaceholder.tsx` 全局 0 引用
- 重复实现：`compare/index.tsx:670` formatDateTimeLocal 重复 formatDateTime

### 测试覆盖盲区（P1）

当前仅 4 个测试文件 60 用例，覆盖 storage/format/scoreUtils/shared。完全无测试的关键模块：
- useInquiryStore（11 个写操作状态机，迁移前必须有测试保护）
- aiService（W9 卖点，4 类阈值判断）
- materialImport（Excel 解析）
- deadlineWatcher（截止通知触发）
- inquiryStatus（状态判断工具，多页共用）

### 联调准备缺口（P1）

- `.env.production` 的 `VITE_API_BASE_URL=https://api.example.com` 仍是占位
- `authApi.login({username,password})` vs `useAuthStore.login(userId)` 参数语义不一致
- 无 API 契约文档
- handlers 中 inquiry 写操作未更新服务端状态字段（半 stub）

---

## 提议变更

### 阶段 1：补测试安全网（先行，保护后续迁移）

#### 1.1 useInquiryStore 状态机测试
- **文件**：`src/store/__tests__/useInquiryStore.test.ts`（新建）
- **What**：测试 11 个写操作的状态转换与副作用
  - addInquiry → 列表前置、logs 含 CREATE
  - updateInquiry → updatedAt 更新
  - deleteInquiry → 列表移除
  - copyInquiry → 新 id + DRAFT 状态 + 复制日志
  - cancelInquiry → CANCELLED 状态 + CANCEL 日志 + SYSTEM 通知
  - sendInquiry → INQUIRING 状态 + SEND_INQUIRY 日志 + INQUIRY_SENT 通知
  - selectSupplier → selectedSupplierMap 更新 + 状态转 PENDING_CONFIRM（当 ALL_QUOTED）
  - confirmInquiry → COMPLETED 状态 + CONFIRM_RESULT 日志 + 通知
  - submitForApproval → PENDING_APPROVAL + approvalNodes 新增 PENDING 节点 + APPROVAL 通知
  - approveInquiry → PENDING_CONFIRM + 节点转 APPROVED + 通知
  - rejectInquiry → PENDING_CONFIRM + 节点转 REJECTED + 通知
- **Why**：迁移写操作到 API 前必须有测试保护，防止状态机回归
- **How**：在每个测试前 `useInquiryStore.setState({ inquiries: [...] })` 重置状态；mock useNotificationStore.addNotification 验证调用；mock useAuthStore.currentUser 验证日志操作人

#### 1.2 aiService 测试
- **文件**：`src/utils/__tests__/aiService.test.ts`（新建）
- **What**：测试 3 个 AI 函数
  - generateInquiryDescription（输入物料清单 → 输出说明文本）
  - analyzeQuotationAnomalies（构造单价异常/总价离散/交货长/技术偏离 4 类场景 → 断言异常标记）
  - generateCompareConclusion（构造比价数据 → 断言结论包含最低价/最快交货/推荐）
- **Why**：W9 核心卖点，规则引擎无测试无法安全重构

#### 1.3 inquiryStatus 测试
- **文件**：`src/utils/__tests__/inquiryStatus.test.ts`（新建）
- **What**：测试 isEditable/isCancelable/isInProgress 对所有 InquiryStatus 枚举值的返回
- **Why**：纯函数易测，多页共用，性价比高

#### 1.4 materialImport 测试
- **文件**：`src/utils/__tests__/materialImport.test.ts`（新建）
- **What**：测试 parseMaterialFile（CSV/Excel 解析、列别名匹配、品类归一化）+ buildMaterials（去重、code 生成）
- **How**：构造 mock File 对象，测试正常/缺列/空行/重复 code 场景

#### 1.5 deadlineWatcher 测试
- **文件**：`src/utils/__tests__/deadlineWatcher.test.ts`（新建）
- **What**：测试 scanDeadlines（thresholdHours 过滤、状态过滤 INQUIRING/PARTIAL_QUOTED、去重）
- **How**：mock useInquiryStore.getState、mock useSettingsStore、mock useNotificationStore.addNotification，验证调用次数

### 阶段 2：W7 全量迁移

#### 2.1 useInquiryStore 11 个写操作走 API
- **文件**：`src/store/useInquiryStore.ts`（修改）
- **What**：为每个写操作补 inquiryApi 调用 + .catch 降级，模式参考 useSupplierStore:61-75
  - addInquiry → `inquiryApi.create(inquiry)`
  - updateInquiry → `inquiryApi.update(id, patch)`
  - deleteInquiry → `inquiryApi.delete(id)`
  - copyInquiry → `inquiryApi.create(copy)`（复制本质是新建）
  - cancelInquiry → `inquiryApi.cancel(id)`（已有 handler 端点）
  - sendInquiry → `inquiryApi.send(id)`（已有 handler 端点）
  - selectSupplier → `inquiryApi.update(id, { selectedSupplierMap })`
  - confirmInquiry → `inquiryApi.confirm(id)`（已有 handler 端点）
  - submitForApproval → `inquiryApi.submitApproval(id)`（已有 handler 端点）
  - approveInquiry → `inquiryApi.approve(id, comment)`（已有 handler 端点）
  - rejectInquiry → `inquiryApi.reject(id, comment)`（已有 handler 端点）
- **Why**：W7 核心缺口，11 个写操作未走 API 导致前端修改无法同步服务端
- **How**：保持"先 set 更新本地保证 UI 响应 → 异步 inquiryApi.xxx().catch(() => {}) 降级"模式

#### 2.2 补齐 inquiryApi 方法
- **文件**：`src/api/inquiryApi.ts`（修改）
- **What**：补齐缺失的 API 方法（对照 handlers 端点）
  - `create(data)` → POST /inquiries
  - `update(id, data)` → PUT /inquiries/:id
  - `delete(id)` → DELETE /inquiries/:id
  - `send(id)` → POST /inquiries/:id/send
  - `cancel(id)` → POST /inquiries/:id/cancel
  - `confirm(id)` → POST /inquiries/:id/confirm
  - `submitApproval(id)` → POST /inquiries/:id/submit-approval
  - `approve(id, comment)` → POST /inquiries/:id/approve
  - `reject(id, comment)` → POST /inquiries/:id/reject
- **Why**：当前 inquiryApi 只有 list/get，无法支撑写操作迁移

#### 2.3 修复 upsertQuotation 新建路径
- **文件**：`src/store/useQuotationStore.ts`（修改）、`src/api/quotationApi.ts`（修改）、`src/mocks/handlers.ts`（修改）
- **What**：
  - quotationApi 补 `create(data)` → POST /quotations
  - handlers 补 `POST /api/quotations` 端点
  - useQuotationStore.upsertQuotation 的 `exists=false` 分支调 `quotationApi.create(quotation)`
- **Why**：供应商首次报价无法同步服务端

#### 2.4 useSettingsStore 接入 API
- **文件**：`src/store/useSettingsStore.ts`（修改）
- **What**：
  - 补 `loadFromApi` 方法，调 `settingsApi.get()`，失败降级到 localStorage
  - `updateSettings` 先 set+persist，再 `settingsApi.update(next).catch(() => {})`
  - `resetSettings` 同理
  - 注意：settingsApi.AppSettings 字段（approval + notification）与 store.Settings 字段（approval + notifications + 基本/规则配置）不完全一致，loadFromApi 需做字段映射合并：仅覆盖 approval 部分，notifications 保留本地（因为 API 的 notification 结构与 store 的 notifications Record 不同）
- **Why**：settingsApi 完全未集成

#### 2.5 useAuthStore 接入 API
- **文件**：`src/store/useAuthStore.ts`（修改）、`src/api/authApi.ts`（修改）、`src/mocks/handlers.ts`（修改）
- **What**：
  - 统一参数语义：authApi.login 改为接收 `{ userId }`（与 store 一致，简化迁移），handlers 同步调整
  - useAuthStore.login 调 `authApi.login({ userId })`，成功后 set user + saveJSON，失败返回 false
  - useAuthStore.logout 调 `authApi.logout()`，失败静默
  - 补 `loadFromApi`：调 `authApi.me()` 获取当前用户，失败降级到 localStorage
  - switchUser 保持本地（演示用，不走 API）
- **Why**：authApi 完全未集成，参数语义不一致

#### 2.6 App.tsx bootstrapStores 补 settings/auth
- **文件**：`src/App.tsx`（修改）
- **What**：在 Promise.allSettled 中补 `useSettingsStore.getState().loadFromApi()` 和 `useAuthStore.getState().loadFromApi()`
- **Why**：当前只加载 5 个 store，settings/auth 永远不从 API 拉取

### 阶段 3：修复业务流程断点

#### 3.1 修复 sendInquiry 通知断点
- **文件**：`src/pages/inquiry/create/index.tsx`（修改）
- **What**：修改 `handleSend` 逻辑
  - 当前：`buildInquiry(InquiryStatus.INQUIRING)` + `addInquiry/updateInquiry` → 绕过 sendInquiry
  - 改为：先 `addInquiry/buildInquiry(InquiryStatus.PENDING_SEND)` 保存草稿，再调 `sendInquiry(newInquiry.id)` 触发 INQUIRING 状态转换 + INQUIRY_SENT 通知
  - 或：保持当前 addInquiry(INQUIRING)，但在 addInquiry 后立即调 `sendInquiry(id)`（会重复设状态但保证通知发送）
  - **推荐方案**：handleSend 改为两步——先创建为 PENDING_SEND，再调 sendInquiry，语义清晰
- **Why**：INQUIRY_SENT 通知永远不发送，供应商收不到询价通知

#### 3.2 应用 INQUIRY_SEND 权限点
- **文件**：`src/pages/inquiry/create/index.tsx`（修改）、`src/pages/inquiry/detail/index.tsx`（修改）
- **What**：
  - create 页"一键批量发送"按钮加 `hasPermission('INQUIRY_SEND')` 守卫
  - detail 页增加"重新发送询价"按钮（当状态为 PENDING_SEND 时），调用 `sendInquiry(id)`，受 INQUIRY_SEND 权限守卫
- **Why**：INQUIRY_SEND 是 12 个权限点中唯一 0 处使用的

#### 3.3 询价详情页补审批入口
- **文件**：`src/pages/inquiry/detail/index.tsx`（修改）
- **What**：在操作按钮区增加
  - "提交审批"按钮（当状态为 PENDING_CONFIRM 且有 INQUIRY_APPROVE 权限时），调用 `submitForApproval(id)`
  - "审批通过"/"审批驳回"按钮（当状态为 PENDING_APPROVAL 且有 INQUIRY_APPROVE 权限时），弹出输入审批意见的 Modal
- **Why**：detail 页只读展示审批 Timeline，用户需跳转 /approval 才能操作，体验不闭环

### 阶段 4：清理假交互与代码质量

#### 4.1 修复装饰性"查询"按钮
- **文件**：`src/pages/inquiry/list/index.tsx`、`src/pages/material/index.tsx`、`src/pages/supplier/index.tsx`（修改）
- **What**：3 个"查询"按钮当前无 onClick，筛选靠 useMemo 响应输入。改为显式查询模式：
  - 引入 `applied` 状态（参考 log/index.tsx:96 的模式），点击"查询"后才 setApplied
  - 或：删除"查询"按钮，改为纯实时筛选（输入即过滤，antd 常见模式）
  - **推荐**：采用 log 页的 applied 模式，保持查询交互一致性
- **Why**：装饰性按钮误导用户

#### 4.2 替换 setTimeout 假 loading
- **文件**：`src/pages/material/index.tsx`、`src/pages/supplier/index.tsx`、`src/pages/log/index.tsx`（修改）
- **What**：移除 `setTimeout(() => setLoading(false), 300)`，改为基于 store 的 `loaded` 状态或直接 `loading={false}`（数据已在 store 中同步）
- **Why**：stub 行为，掩盖真实加载状态

#### 4.3 修复直接 import mock 数据
- **文件**：`src/pages/inquiry/create/index.tsx`、`src/pages/dashboard/index.tsx`、`src/layouts/MainLayout.tsx`、`src/pages/login/index.tsx`、`src/pages/settings/index.tsx`（修改）
- **What**：
  - `inquiry/create:24`、`dashboard:42` 的 `currentUser` → `useAuthStore.getState().currentUser` 或 `useAuthStore((s) => s.currentUser)`
  - `MainLayout:43`、`login:10`、`settings:24` 的 `users`/`organizations` → 新增 `useAuthStore.getState().users` 或通过 `authApi.listUsers()`（需补端点）
  - **简化方案**：在 useAuthStore 中补 `users: User[]` 字段（初始化从 mock 加载，loadFromApi 时从 API 更新），各页面改用 store
- **Why**：绕过 store 直接 import mock，破坏数据层一致性

#### 4.4 修复 handlers as never
- **文件**：`src/mocks/handlers.ts`（修改）
- **What**：7 处 `as never` 改为显式类型注解
  - `let inquiries = [...mockInquiries]` → `let inquiries: Inquiry[] = [...mockInquiries]`
  - `let suppliers = [...mockSuppliers]` → `let suppliers: Supplier[] = [...]`
  - `let materials = [...mockMaterials]` → `let materials: Material[] = [...]`
  - 移除 push/赋值处的 `as never`
- **Why**：类型逃逸，应显式注解

#### 4.5 删除死代码与重复实现
- **文件**：`src/components/PagePlaceholder.tsx`（删除）、`src/pages/quotation/compare/index.tsx`（修改）
- **What**：
  - 删除 PagePlaceholder.tsx（全局 0 引用）
  - compare/index.tsx:670 的 `formatDateTimeLocal` 改为 `import { formatDateTime } from '@/utils/format'`
- **Why**：死代码与 DRY 违反

#### 4.6 handlers 补齐 inquiry 写操作状态更新
- **文件**：`src/mocks/handlers.ts`（修改）
- **What**：当前 submit-approval/approve/reject/confirm/cancel/send 端点只返回 inquiries[idx]，未更新服务端状态字段
  - send → 更新 status 为 INQUIRING
  - cancel → 更新 status 为 CANCELLED
  - confirm → 更新 status 为 COMPLETED
  - submit-approval → 更新 status 为 PENDING_APPROVAL + 新增 approvalNode
  - approve → 更新 status 为 PENDING_CONFIRM + approvalNode.status 为 APPROVED
  - reject → 更新 status 为 PENDING_CONFIRM + approvalNode.status 为 REJECTED
- **Why**：让 MSW 行为更接近真实后端

### 阶段 5：真实后端联调准备

#### 5.1 替换 .env.production 占位
- **文件**：`.env.production`（修改）
- **What**：`VITE_API_BASE_URL=https://api.example.com` 改为 `/api`（相对路径，由部署环境的反向代理转发）
- **Why**：占位符部署前必须替换，相对路径更灵活

#### 5.2 补 API 契约文档
- **文件**：`docs/api-contract.md`（新建）
- **What**：列出所有端点（method + path + 请求体 + 响应体 schema），从 handlers.ts + 各 API 文件提取
  - 认证：POST /auth/login、POST /auth/logout、GET /auth/me
  - 询价：GET/POST/PUT/DELETE /inquiries、POST /inquiries/:id/{send,cancel,confirm,submit-approval,approve,reject}
  - 供应商：GET/POST/PUT/DELETE /suppliers、POST /suppliers/:id/toggle-status
  - 物料：GET/POST/PUT/DELETE /materials、POST /materials/batch
  - 报价：GET /quotations、GET /inquiries/:id/quotations、GET/PUT/POST /quotations/:id/{draft,submit}
  - 通知：GET/POST /notifications、POST /notifications/:id/read、POST /notifications/read-all
  - 设置：GET/PUT /settings
- **Why**：前后端联调基线文档

#### 5.3 补 .env 联调示例
- **文件**：`.env.example`（新建）
- **What**：列出所有环境变量及说明
  - VITE_API_BASE_URL（说明：dev 用 /api，prod 用真实地址）
  - VITE_ENABLE_MSW（true/false）
  - VITE_API_PROXY_TARGET（MSW 关闭时代理目标）
- **Why**：方便切换联调环境

---

## 假设与决策

### 决策
1. **数据层模式**：延续 Zustand + 手动 loadFromApi + 写操作走 API + .catch 降级，不引入 React Query 重写（与已迁移 4 个 store 一致，风险低）
2. **测试先行**：阶段 1 补测试作为阶段 2 迁移的安全网，特别是 useInquiryStore 状态机测试
3. **sendInquiry 修复方案**：create 页 handleSend 改为两步（先建 PENDING_SEND 草稿，再调 sendInquiry），语义清晰且复用现有流程
4. **authApi 参数统一**：改为接收 `{ userId }`（与 store 一致），简化迁移，避免 username↔userId 转换
5. **查询按钮方案**：采用 log 页的 applied 状态模式，保持查询交互一致性
6. **users 数据源**：在 useAuthStore 中补 users 字段，避免各页面直接 import mock
7. **.env.production**：改为 `/api` 相对路径，由部署环境反向代理转发，比硬编码域名灵活
8. **handlers 半 stub**：补齐 inquiry 写操作的服务端状态更新，让 MSW 行为接近真实后端

### 假设
1. 现有 60 个测试在迁移后保持通过（mock 方式未变，store 内部 API 调用在测试中会失败但 .catch 降级，不影响状态机断言）
2. handlers 的 mock 数据与 src/mock/* 保持一致
3. API 契约文档基于当前 handlers 端点提取，真实后端实现时需对齐
4. useSettingsStore.loadFromApi 仅覆盖 approval 部分，notifications 保留本地（因 API 与 store 的通知设置结构不同）

---

## 验证步骤

### 阶段 1 验证（测试）
1. `npm run test` — 新增 5 个测试文件全部通过，总用例数从 60 增至 ~100+

### 阶段 2 验证（W7 迁移）
1. `npm run lint` — 0 error 0 warning
2. `npm run test` — 全部通过（含新增测试）
3. `npm run build` — 通过
4. 浏览器实测（MSW 启用）：
   - 网络面板可见 inquiry 写操作触发的 API 请求
   - 询价 CRUD 后刷新页面，数据从 API 加载保持一致
   - 设置页修改审批阈值，刷新后保持
   - 登录/登出走 API

### 阶段 3 验证（业务断点）
1. 创建询价单并一键发送 → 通知中心出现"询价单已发送"通知
2. detail 页"重新发送询价"按钮受 INQUIRY_SEND 权限控制
3. detail 页"提交审批"按钮在 PENDING_CONFIRM 状态可见，点击后状态转 PENDING_APPROVAL
4. detail 页"审批通过/驳回"在 PENDING_APPROVAL 状态可见，操作后状态转 PENDING_CONFIRM

### 阶段 4 验证（清理）
1. `npm run lint` — 0 error 0 warning，无 as never
2. 3 个查询按钮点击后显式触发筛选
3. 无 setTimeout 假 loading
4. 无直接 import mock 数据（除 store 内部）
5. PagePlaceholder.tsx 已删除
6. compare 页 formatDateTimeLocal 已替换

### 阶段 5 验证（联调准备）
1. `.env.production` 无 example.com 占位
2. `docs/api-contract.md` 存在且列全端点
3. `.env.example` 存在且说明完整

### 最终验证
1. `npm run lint` — 0 error 0 warning
2. `npm run test` — 全部通过
3. `npm run build` — 通过
4. 全流程跑通：登录→工作台→创建询价（发送）→供应商报价→对比→提交审批→审批→定标→通知中心

---

## 执行顺序

```
阶段 1：补测试安全网（5 个测试文件）
  → 阶段 2：W7 全量迁移（inquiryApi 补齐 → useInquiryStore 11 写操作 → upsertQuotation → useSettingsStore → useAuthStore → bootstrap）
  → 阶段 3：修复业务断点（sendInquiry 通知 → INQUIRY_SEND 权限 → detail 审批入口）
  → 阶段 4：清理（查询按钮 → setTimeout → mock import → as never → 死代码 → handlers 半 stub）
  → 阶段 5：联调准备（.env.production → API 契约文档 → .env.example）
  → 最终验证（lint + test + build + 全流程）
```
