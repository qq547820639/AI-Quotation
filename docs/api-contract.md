# API 契约文档

企业采购自动询价 Web 系统前后端联调基线。本文档基于 [src/mocks/handlers.ts](../src/mocks/handlers.ts) 与 [src/api/](../src/api/) 下的 API 模块提取，作为真实后端实现的对齐参考。

- **MSW 行为**：开发环境由 [handlers.ts](../src/mocks/handlers.ts) 拦截并返回 mock 数据，行为接近真实后端（写操作会更新内存数据副本与服务端状态字段）
- **真实后端**：按本文档实现端点后，设置 `VITE_ENABLE_MSW=false`，请求将走真实后端

---

## 通用约定

### BaseURL

| 环境 | `VITE_API_BASE_URL` | 说明 |
|---|---|---|
| 开发（MSW 启用） | `/api` | 由 MSW 拦截，不发真实请求 |
| 开发（MSW 关闭） | `/api` | 由 `vite.config.ts` proxy 转发至 `VITE_API_PROXY_TARGET` |
| 生产 | `/api` | 由部署环境反向代理转发至真实后端 |

### 认证

- 除 `POST /auth/login` 外，所有端点需在请求头携带 `Authorization: Bearer <token>`
- token 由登录端点返回，前端存于 `localStorage.procurement_token`
- 401 响应触发前端登出，403 提示无权限（见 [client.ts](../src/api/client.ts) 拦截器）

### 错误响应

统一格式（前端 [client.ts](../src/api/client.ts) 已按此处理）：

```json
{
  "message": "错误描述"
}
```

| HTTP 状态 | 含义 |
|---|---|
| 200 | 成功 |
| 401 | 未认证 / token 失效 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 500 | 服务端错误 |

### 数据时间格式

- 日期时间字符串统一 `YYYY-MM-DD HH:mm:ss`（如 `2026-08-05 10:00:00`）
- 部分字段使用 ISO 字符串（如 `Notification.time`）

---

## 认证模块

| Method | Path | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| POST | `/auth/login` | `{ userId: string }` | `{ user: User, token: string }` | 按 userId 登录，返回用户与 token |
| POST | `/auth/logout` | 无 | `{ success: true }` | 登出 |
| GET | `/auth/me` | 无 | `User` | 获取当前登录用户 |

> 参考实现：[authApi.ts](../src/api/authApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 认证段

---

## 询价单模块

| Method | Path | 请求体 | 响应体 | 服务端副作用 |
|---|---|---|---|---|
| GET | `/inquiries` | 无 | `Inquiry[]` | — |
| GET | `/inquiries/:id` | 无 | `Inquiry`（404 if not found） | — |
| POST | `/inquiries` | `Inquiry` | `Inquiry` | 列表前置新增 |
| PUT | `/inquiries/:id` | `Partial<Inquiry>` | `Inquiry`（404） | 合并字段 + 更新 `updatedAt` |
| DELETE | `/inquiries/:id` | 无 | `{ success: true }` | 列表移除 |
| POST | `/inquiries/:id/send` | 无 | `Inquiry` | status→`INQUIRING` + 追加 `SEND_INQUIRY` 日志 |
| POST | `/inquiries/:id/cancel` | 无 | `Inquiry` | status→`CANCELLED` + 追加 `CANCEL` 日志 |
| POST | `/inquiries/:id/confirm` | 无 | `Inquiry` | status→`COMPLETED` + 追加 `CONFIRM_RESULT` 日志 |
| POST | `/inquiries/:id/submit-approval` | 无 | `Inquiry` | status→`PENDING_APPROVAL` + 新增 `PENDING` 审批节点 + 追加 `SUBMIT_APPROVAL` 日志 |
| POST | `/inquiries/:id/approve` | `{ comment?: string }` | `Inquiry` | status→`PENDING_CONFIRM` + `PENDING` 节点转 `APPROVED` + 追加 `APPROVE` 日志 |
| POST | `/inquiries/:id/reject` | `{ comment?: string }` | `Inquiry` | `PENDING` 节点转 `REJECTED` + 追加 `REJECT` 日志 |

> 参考实现：[inquiryApi.ts](../src/api/inquiryApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 询价段

### 状态流转

```
DRAFT → PENDING_SEND → INQUIRING → PARTIAL_QUOTED → ALL_QUOTED
                          ↓                              ↓
                       TIMEOUT                     PENDING_CONFIRM
                                                       ↓
                                              PENDING_APPROVAL
                                                       ↓
                                              PENDING_CONFIRM
                                                       ↓
                                                   COMPLETED

任意非终态 → CANCELLED
```

---

## 供应商模块

| Method | Path | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| GET | `/suppliers` | 无 | `Supplier[]` | 列表 |
| GET | `/suppliers/:id` | 无 | `Supplier`（404） | 详情 |
| POST | `/suppliers` | `Supplier` | `Supplier` | 新建（服务端生成 `id`：`sup-<timestamp>`） |
| PUT | `/suppliers/:id` | `Partial<Supplier>` | `Supplier`（404） | 更新 |
| DELETE | `/suppliers/:id` | 无 | `{ success: true }` | 删除 |
| POST | `/suppliers/:id/toggle-status` | 无 | `Supplier`（404） | 启用/停用切换 |

> 参考实现：[supplierApi.ts](../src/api/supplierApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 供应商段

---

## 物料模块

| Method | Path | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| GET | `/materials` | 无 | `Material[]` | 列表 |
| GET | `/materials/:id` | 无 | `Material`（404） | 详情 |
| POST | `/materials` | `Material` | `Material` | 新建（服务端生成 `id`：`mat-<timestamp>`） |
| PUT | `/materials/:id` | `Partial<Material>` | `Material`（404） | 更新 |
| DELETE | `/materials/:id` | 无 | `{ success: true }` | 删除 |
| POST | `/materials/batch` | `{ items: Material[] }` | `{ success: number }` | 批量导入，返回成功条数 |

> 参考实现：[materialApi.ts](../src/api/materialApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 物料段

---

## 报价单模块

| Method | Path | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| GET | `/quotations` | 无 | `Quotation[]` | 全部报价 |
| GET | `/inquiries/:inquiryId/quotations` | 无 | `Quotation[]` | 按询价单筛选报价 |
| GET | `/quotations/:id` | 无 | `Quotation`（404） | 详情 |
| POST | `/quotations` | `Quotation` | `Quotation` | 新建（`id` 可选，缺省 `q-<timestamp>`） |
| PUT | `/quotations/:id/draft` | `Partial<Quotation>` | `Quotation`（404） | 草稿保存 |
| POST | `/quotations/:id/submit` | 无 | `Quotation`（404） | 提交报价 |

> 参考实现：[quotationApi.ts](../src/api/quotationApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 报价段

---

## 通知模块

通知由服务端存储，运行时由客户端通过 `POST /notifications` 写入（如询价发送、审批结果等业务事件触发）。

| Method | Path | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| GET | `/notifications` | 无 | `Notification[]` | 列表（初始为空） |
| POST | `/notifications` | `Partial<Notification>` | `Notification` | 新建（服务端生成 `id`、默认 `read:false`、`time` 缺省当前时间；列表上限 100 条） |
| POST | `/notifications/:id/read` | 无 | `{ success: true }` | 标记单条已读 |
| POST | `/notifications/read-all` | 无 | `{ success: true }` | 全部标记已读 |

> 参考实现：[notificationApi.ts](../src/api/notificationApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 通知段

---

## 设置模块

| Method | Path | 请求体 | 响应体 | 说明 |
|---|---|---|---|---|
| GET | `/settings` | 无 | `AppSettings` | 获取系统设置 |
| PUT | `/settings` | `Partial<AppSettings>` | `AppSettings` | 更新设置（整体回显） |

### AppSettings 结构

```typescript
interface AppSettings {
  approval: {
    enabled: boolean;          // 是否启用审批
    amountThreshold: number;   // 审批金额阈值
    approverId: string;        // 默认审批人 id
  };
  notification: {
    deadlineReminder: boolean;       // 截止提醒
    deadlineReminderHours: number;   // 提前提醒小时数
    quotationSubmitted: boolean;     // 报价提交通知
    approvalResult: boolean;         // 审批结果通知
  };
}
```

> 参考实现：[settingsApi.ts](../src/api/settingsApi.ts)、[handlers.ts](../src/mocks/handlers.ts) 设置段
> 注意：前端 `useSettingsStore.Settings` 结构与 `AppSettings` 略有差异（store 含 `notifications` Record 与基本/规则配置），`loadFromApi` 仅覆盖 `approval` 部分，其余保留本地

---

## 端点统计

| 模块 | 端点数 |
|---|---|
| 认证 | 3 |
| 询价单 | 11 |
| 供应商 | 6 |
| 物料 | 6 |
| 报价单 | 6 |
| 通知 | 4 |
| 设置 | 2 |
| **合计** | **38** |

---

## 附录：核心类型定义索引

类型定义集中在 [src/types/index.ts](../src/types/index.ts)，以下为关键 interface 索引（详细字段以源文件为准，避免本文档与代码漂移）：

| 类型 | 定义位置 | 说明 |
|---|---|---|
| `User` | [types/index.ts](../src/types/index.ts) | 用户（含 id/name/role/organization） |
| `Inquiry` | types/index.ts:443 | 询价单（含 items/invitedSupplierIds/quotations/logs/approvalNodes/selectedSupplierMap） |
| `InquiryItem` | types/index.ts | 询价明细（含 name/code/category/brand/spec/quantity/targetPrice） |
| `InquiryLog` | types/index.ts:428 | 操作日志（含 time/operator/type/content/result） |
| `ApprovalNode` | types/index.ts | 审批节点（含 nodeOrder/approverId/status/comment/time） |
| `Supplier` | types/index.ts | 供应商（含 level/cooperationStatus/qualified/historyFulfillmentRate） |
| `Material` | types/index.ts | 物料（含 code/name/category/unit） |
| `Quotation` | types/index.ts:411 | 报价单（含 items/totalAmount/attachments） |
| `QuotationItem` | types/index.ts:379 | 报价明细（含 unitPrice/taxRate/taxIncludedTotal/deliveryDays/techDeviation） |
| `Notification` | types/index.ts | 通知（含 type/title/content/time/read） |
| `Attachment` | types/index.ts | 附件（含 name/url/size） |

### 关键枚举

- `InquiryStatus`：DRAFT / PENDING_SEND / INQUIRING / PARTIAL_QUOTED / ALL_QUOTED / TIMEOUT / PENDING_CONFIRM / PENDING_APPROVAL / COMPLETED / CANCELLED
- `QuotationStatus`：报价状态
- `ApprovalNodeStatus`：PENDING / APPROVED / REJECTED
- `LogType`：CREATE / SEND_INQUIRY / SUBMIT_QUOTATION / SELECT_SUPPLIER / CONFIRM_RESULT / CANCEL / SUBMIT_APPROVAL / APPROVE / REJECT
- `SupplierLevel`：供应商等级
- `CooperationStatus`：合作状态
- `Currency`：币种
