# 收口计划：修复 tsc 阻断 + 补 API 契约文档 + 最终验证

## 摘要

上一轮「W7 全量迁移收口 + 质量硬化」5 阶段计划执行到阶段 5（联调准备）时，总结误判为「只剩 API 契约文档 + 最终验证」，实际最终验证未真正通过。本次核验暴露：

- **lint**：✅ 0 error / 0 warning
- **vitest**：✅ 122 passed（9 files）
- **tsc --noEmit**：❌ **10 errors（阻断 build）**
- **npm run build**：❌ 被 tsc 阻断（vite build 前置 tsc）
- **docs/api-contract.md**：❌ 未创建（docs/ 目录不存在）

本计划为收口尾巴，目标：让 lint + tsc + vitest + build 四连通过，并补齐 API 契约文档，彻底关闭上一轮 5 阶段计划。

---

## 当前状态分析

### 10 个 tsc 错误根因

#### 错误组 1：detail/index.tsx 缺少 InquiryStatus 导入（3 处）

[detail/index.tsx](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/pages/inquiry/detail/index.tsx) 第 491/508/516 行使用 `InquiryStatus.PENDING_SEND`、`InquiryStatus.PENDING_CONFIRM`、`InquiryStatus.PENDING_APPROVAL`，但第 51-63 行的 `@/types` import 块只导入了 `ApprovalNodeStatus`、`QuotationStatus`、`LogType`，**漏掉 `InquiryStatus`**。

这是阶段 3.3「detail 页补审批入口」时新增 `inquiry.status === InquiryStatus.PENDING_CONFIRM` 等判断引入的回归——当时补了审批按钮逻辑，但未同步补类型导入。lint（eslint）不查未定义的全局枚举引用（因 `InquiryStatusTag` 在同作用域，eslint 误判为可能拼写），vitest 不覆盖该页，故此前未暴露。

```
TS2552: Cannot find name 'InquiryStatus'. Did you mean 'InquiryStatusTag'?
  detail/index.tsx(491,44)  inquiry.status === InquiryStatus.PENDING_SEND
  detail/index.tsx(508,47)  inquiry.status === InquiryStatus.PENDING_CONFIRM
  detail/index.tsx(516,47)  inquiry.status === InquiryStatus.PENDING_APPROVAL
```

#### 错误组 2：aiService.test.ts 冗余 totalPrice 字段（7 处）

[aiService.test.ts](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/utils/__tests__/aiService.test.ts) 第 108/198/205/244/251/268/275 行构造 `QuotationItem` 对象时写入 `totalPrice: 1000`，但 [QuotationItem 类型](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/types/index.ts#L379) 定义的是 `taxIncludedTotal`（无 `totalPrice` 字段）。

**关键确认**：[aiService.ts](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/utils/aiService.ts) 只读取 `qi.unitPrice`（line 127/129/133）和 `r.totalAmount`（来自 `SupplierQuoteRow`，非 `QuotationItem`），**从不读 `totalPrice`**。故测试中的 `totalPrice` 是纯冗余字段，删除不影响测试断言。

**TS 行为注意**：当前因 `totalPrice` 触发 TS2353（excess property），TS 据此将该对象判定为「与目标类型不匹配」并抑制同对象内 `taxRate`/`attachments` 必填字段缺失错误（TS2741）。一旦移除 `totalPrice`，TS 将重新检查必填字段，可能暴露 `taxRate`（必填）和 `attachments`（必填）的缺失。因此修复需保证对象类型完整，不能仅删 `totalPrice`。

vitest 运行时能过（不做类型检查 + aiService 不读该字段），故此前未暴露。

### API 契约文档缺口

[docs/api-contract.md](file:///Volumes/Extra/CodeProj/自动询价Web系统/docs/api-contract.md) 未创建（`docs/` 目录不存在）。阶段 5.2 的待办项，需从 [handlers.ts](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/mocks/handlers.ts) + 7 个 API 文件（[authApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/authApi.ts)、[inquiryApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/inquiryApi.ts)、[supplierApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/supplierApi.ts)、[materialApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/materialApi.ts)、[quotationApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/quotationApi.ts)、[notificationApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/notificationApi.ts)、[settingsApi](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/api/settingsApi.ts)）提取全部端点，作为前后端联调基线。

---

## 提议变更

### Step 1：修复 detail/index.tsx 缺失导入（P0）

- **文件**：[src/pages/inquiry/detail/index.tsx](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/pages/inquiry/detail/index.tsx)
- **What**：在第 51-63 行的 `@/types` import 块中，将 `ApprovalNodeStatus,` 那一行后补入 `InquiryStatus,`（保持字母序，与文件其他 import 风格一致）
- **Why**：阶段 3.3 补审批入口时遗漏类型导入，导致 3 处 TS2552
- **How**：定位 import 块（line 51-63），在 `ApprovalNodeStatus,` 与 `CURRENCY_LABEL,` 之间插入 `InquiryStatus,`。修改后 491/508/516 三处引用即可解析
- **影响范围**：仅 1 行新增，零运行时行为变化

### Step 2：修复 aiService.test.ts QuotationItem 对象类型（P0）

- **文件**：[src/utils/__tests__/aiService.test.ts](file:///Volumes/Extra/CodeProj/自动询价Web系统/src/utils/__tests__/aiService.test.ts)
- **What**：修复 7 处 `QuotationItem` 对象字面量（line 102-116 及另 6 处），使其类型完整：
  - 删除 `totalPrice: 1000,`（冗余字段，aiService 不读）
  - 改为 `taxIncludedTotal: 1000,`
  - 补 `taxRate: 0.13,`（必填，类型 `number`）
  - 补 `attachments: [],`（必填，类型 `Attachment[]`）
- **Why**：移除 `totalPrice` 后 TS 将重新校验必填字段，必须同时补齐 `taxRate` 与 `attachments` 才能彻底消错；否则会从 TS2353 转为 TS2741
- **How**：对 7 处对象字面量逐一执行相同替换。若 7 处字段结构一致，可统一用 Edit 的 replace_all 处理 `totalPrice: 1000,` → `taxIncludedTotal: 1000,\n        taxRate: 0.13,\n        attachments: [],`（注意缩进对齐）；若各处值不同则逐一处理。修改后 aiService 测试断言不受影响（不读这些字段）
- **验证**：修改后立即 `npx tsc --noEmit` 确认 7 处 TS2353 消失且无新 TS2741 暴露

### Step 3：创建 API 契约文档（阶段 5.2）

- **文件**：[docs/api-contract.md](file:///Volumes/Extra/CodeProj/自动询价Web系统/docs/api-contract.md)（新建，需先建 docs/ 目录）
- **What**：列出全部端点（method + path + 请求体 + 响应体 schema），从 handlers.ts + 7 个 API 文件提取。结构如下：
  - **概述**：baseURL（dev `/api` 由 MSW 拦截，prod `/api` 由反向代理转发）、认证（Bearer token，`localStorage.procurement_token`）、错误响应统一格式
  - **认证模块**（3 端点）：
    - `POST /auth/login` — body `{ userId: string }` → `{ user: User, token: string }`
    - `POST /auth/logout` → `{ success: true }`
    - `GET /auth/me` → `User`
  - **询价单模块**（10 端点）：
    - `GET /inquiries` → `Inquiry[]`
    - `GET /inquiries/:id` → `Inquiry`（404 if not found）
    - `POST /inquiries` — body `Inquiry` → `Inquiry`
    - `PUT /inquiries/:id` — body `Partial<Inquiry>` → `Inquiry`（404）
    - `DELETE /inquiries/:id` → `{ success: true }`
    - `POST /inquiries/:id/send` → `Inquiry`（status→INQUIRING + SEND_INQUIRY 日志）
    - `POST /inquiries/:id/cancel` → `Inquiry`（status→CANCELLED + CANCEL 日志）
    - `POST /inquiries/:id/confirm` → `Inquiry`（status→COMPLETED + CONFIRM_RESULT 日志）
    - `POST /inquiries/:id/submit-approval` → `Inquiry`（status→PENDING_APPROVAL + 新增 PENDING 审批节点）
    - `POST /inquiries/:id/approve` — body `{ comment?: string }` → `Inquiry`（status→PENDING_CONFIRM + 节点→APPROVED）
    - `POST /inquiries/:id/reject` — body `{ comment?: string }` → `Inquiry`（节点→REJECTED）
  - **供应商模块**（6 端点）：`GET/POST/PUT/DELETE /suppliers`、`GET /suppliers/:id`、`POST /suppliers/:id/toggle-status`
  - **物料模块**（6 端点）：`GET/POST/PUT/DELETE /materials`、`GET /materials/:id`、`POST /materials/batch` — body `{ items: Material[] }` → `{ success: number }`
  - **报价单模块**（5 端点）：`GET /quotations`、`GET /inquiries/:inquiryId/quotations`、`GET /quotations/:id`、`POST /quotations`、`PUT /quotations/:id/draft`、`POST /quotations/:id/submit`
  - **通知模块**（4 端点）：`GET /notifications`、`POST /notifications`、`POST /notifications/:id/read`、`POST /notifications/read-all`
  - **设置模块**（2 端点）：`GET /settings` → `AppSettings`、`PUT /settings` — body `Partial<AppSettings>` → `AppSettings`
  - **附录**：核心类型 schema（`User`、`Inquiry`、`Supplier`、`Material`、`Quotation`、`QuotationItem`、`Notification`、`AppSettings`、`ApprovalNode`、`InquiryLog`）的 TypeScript 定义摘要，引用 `src/types/index.ts` 与 `src/api/settingsApi.ts`
- **Why**：前后端联调基线文档，阶段 5.2 唯一未完成项；真实后端实现时按此对齐
- **How**：Write 工具新建文件；端点信息以 handlers.ts 为准（已读全文），类型以 types/index.ts 为准；保持与现有 `.trae/documents/*.md` 文档风格一致（中文、表格、代码块）

### Step 4：最终验证（四连通过）

依次执行（任一失败即定位修复）：

1. `npm run lint` — 期望 0 error / 0 warning
2. `npx tsc --noEmit` — 期望 0 error（Step 1+2 修复后应全绿）
3. `npx vitest run` — 期望 9 files / 122 tests passed（aiService.test.ts 修改不影响断言，应保持 122 通过）
4. `npm run build` — 期望成功，`dist/` 产物更新

---

## 假设与决策

### 决策

1. **detail/index.tsx 修复方案**：仅补 `InquiryStatus` 导入，不改任何运行时逻辑。这是阶段 3.3 回归的最小修复，符合「do nothing more than asked」原则
2. **aiService.test.ts 修复方案**：删除冗余 `totalPrice` + 补齐 `taxIncludedTotal`/`taxRate`/`attachments`，使对象类型完整。不重构为 helper 函数（7 处虽重复，但重构超出收口范围，保持 proportional）
3. **API 契约文档范围**：以 handlers.ts 现有端点为基线（不含真实后端才有的分页/鉴权细化），附录引用类型定义而非复制全文，避免类型变更后文档失真
4. **不引入新测试**：收口阶段只修复阻断，不为 detail/index.tsx 补测试（页面组件，vitest 当前不覆盖，超出收口范围）

### 假设

1. Step 2 修复后 vitest 仍 122 通过（aiService 不读 `totalPrice`/`taxIncludedTotal`/`taxRate`/`attachments`，断言不依赖这些字段）
2. handlers.ts 端点与 7 个 API 文件方法一一对应（已核验：authApi 3、inquiryApi 11、supplierApi 6、materialApi 6、quotationApi 6、notificationApi 4、settingsApi 2 = 38 端点，handlers 实现 38 端点）
3. `npm run build` 命令前置 `tsc`（vite-plugin-checker 或 build 脚本调用），故 tsc 修复后 build 即通过

---

## 验证步骤

| 步骤 | 命令 | 期望结果 |
|---|---|---|
| 1 | `npm run lint` | 0 error / 0 warning |
| 2 | `npx tsc --noEmit` | 0 error |
| 3 | `npx vitest run` | 9 files / 122 tests passed |
| 4 | `npm run build` | 成功，dist/ 产物更新 |
| 5 | `ls docs/api-contract.md` | 文件存在 |

---

## 执行顺序

```
Step 1：detail/index.tsx 补 InquiryStatus 导入
  → Step 2：aiService.test.ts 修复 7 处 QuotationItem 对象（删 totalPrice + 补 3 字段）
  → Step 3：创建 docs/api-contract.md（38 端点 + 类型附录）
  → Step 4：最终验证（lint → tsc → vitest → build 四连）
```

---

## 后续方向（收口完成后，独立规划，不在本计划执行范围）

W4-W10 + W7 全量迁移 + 联调准备全部收口后，前端为「MSW 驱动的完整可演示系统」。下一阶段三选一：

- **A. 真实后端实现**：按 API 契约文档实现 Node/Java/Python 后端，替换 MSW
- **B. 前端体验深化**：国际化、主题、PDF 导出优化、更多图表、移动端细化
- **C. 工程化与部署**：Dockerfile、CI/CD、nginx 反代配置、E2E 测试

本计划完成后，建议单独发起对应方向的 /plan。
