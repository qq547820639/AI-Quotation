# 审批页与日志页 i18n 迁移计划

## 摘要

将 `src/pages/approval/index.tsx` 与 `src/pages/log/index.tsx` 中剩余的硬编码中文文案迁移到 `react-i18next`，复用 `src/locales/zh-CN.json` 与 `src/locales/en-US.json` 中已存在的 `approval` / `log` / `enum` / `common` 模块 key。迁移完毕后执行 `npx tsc --noEmit` 验证类型零错误。

## 当前状态分析

### 已完成（前置工作）
- `compare/index.tsx`、`pending/index.tsx`、`notification/index.tsx`、`settings/index.tsx` 已完成迁移，建立了统一模式：
  - 顶部 `import { useTranslation } from 'react-i18next';`
  - 组件内 `const { t } = useTranslation();`
  - 枚举 label 替换为 `` t(`enum.xxx.${value}`) ``
  - 模板字符串使用 `t('key', { var: value })`
  - 命令式 API（`notifySuccess` 等）在组件内调用时直接用 `t()`

### 现存 i18n 基建
- `src/i18n/index.ts`：默认导出 `i18n` 实例，命名导出 `changeLanguage` / `getCurrentLanguage` / `AppLanguage`
- locale 文件已预置 `approval`（含 `managementTitle` / `description` / `noPermission` / `pending` / `approved` / `rejected` / `pendingWithCount` / `historyWithCount` / `emptyPending` / `emptyHistory` / `approveModalTitle` / `rejectModalTitle` / `comment` / `commentOptionalPlaceholder` / `rejectReasonPlaceholder` / `approvePassed` / `rejectPassed` / `inquiryInfo` / `inquiryCodeLabel` / `subject` / `selectedAmount` / `submittedAt` / `flow` / `approver` / `inquiry` 等）与 `log`（含 `title` / `description` / `time` / `operator` / `operatorRole` / `operationType` / `operationContent` / `result` / `operationTime` / `keyword` / `operatorPlaceholder` / `typePlaceholder` / `contentSearchPlaceholder` / `query` / `totalRecords` / `noSearchResult` / `empty`）模块，中英双语均已存在
- `enum.approvalNodeStatus.{PENDING,APPROVED,REJECTED}` 与 `enum.logType.*` 已存在
- `common.{status,actions,confirm,cancel,reset}` 已存在

### 待迁移文件

#### `src/pages/approval/index.tsx`（392 行）
硬编码中文点位：
- 第 126 行：`notifySuccess(modalAction === 'approve' ? '审批已通过' : '审批已驳回')`
- 第 131/145/151/157/166/175/181 行：表格列标题（询价单 / 采购组织 / 负责人 / 已选金额 / 审批人 / 状态 / 操作）
- 第 200/208 行：通过 / 驳回 按钮文字
- 第 214 行：`<Tag color="processing">待审批</Tag>`
- 第 219-221 行：`APPROVAL_NODE_STATUS_LABEL[lastNode.status]`
- 第 232-233 行：PageHeader 标题与描述
- 第 236 行：Permission fallback Empty 描述
- 第 242/251/260 行：Statistic 标题（待审批 / 已通过 / 已驳回）
- 第 274-275 行：Segmented 选项 label 模板字符串
- 第 290 行：Table emptyText 三元描述
- 第 306 行：Modal title 三元
- 第 310-311 行：Modal okText / cancelText
- 第 315 行：Form.Item label "审批意见"
- 第 320 行：TextArea placeholder 三元
- 第 336 行：Descriptions title "询价信息"
- 第 337-342 行：Descriptions.Item label（询价编号 / 主题 / 已选金额 / 提交时间）
- 第 347 行：Text "审批流程"
- 第 371-372 行：`APPROVAL_NODE_STATUS_LABEL[node.status]`

未迁移保留点：`APPROVAL_NODE_STATUS_COLOR`（颜色映射，非文案）；`formatCurrency` / `formatDateTime` 输出（数据格式化，非 UI 标签）。

#### `src/pages/log/index.tsx`（255 行）
硬编码中文点位：
- 第 138/145/152/164/173/179 行：表格列标题（时间 / 操作人 / 操作人角色 / 操作类型 / 操作内容 / 操作结果）
- 第 169 行：`LOG_TYPE_LABEL[type]`
- 第 190 行：PageHeader 标题与描述
- 第 197 行：Form.Item label "操作时间"
- 第 202/207/217 行：Form.Item label（操作人 / 操作类型 / 关键字）
- 第 203 行：Input placeholder "请输入操作人"
- 第 209 行：Select placeholder "请选择操作类型"
- 第 211 行：`options={LOG_TYPE_OPTIONS}`（静态常量，需在组件内动态构建）
- 第 218 行：Input placeholder "搜索操作内容"
- 第 224-225 行：查询按钮
- 第 227 行：重置按钮
- 第 246 行：`showTotal: (total) => \`共 ${total} 条记录\``
- 第 249 行：Table emptyText 三元描述

未迁移保留点：第 158 行 `role === '系统'` 是与数据值比较（log.operatorRole 实际值为 "系统" 字符串），属业务判断而非 UI 文案，保留原样。

## 拟定改动

### 文件 1：`src/pages/approval/index.tsx`

**What**：
1. 在 `react-router-dom` import 之后追加 `import { useTranslation } from 'react-i18next';`
2. 在 `ApprovalPage` 组件内 `const navigate = useNavigate();` 之后加 `const { t } = useTranslation();`
3. 从 `@/types` 的 import 中移除 `APPROVAL_NODE_STATUS_LABEL`（保留 `APPROVAL_NODE_STATUS_COLOR` 与 `ApprovalNodeStatus` 枚举）
4. 替换全部硬编码文案（见下方映射表）
5. `ApprovalDetail` 与 `ApprovalNodeItem` 子组件各自需要 `useTranslation`：因为它们是独立函数组件，需各自 `const { t } = useTranslation();`

**Why**：与已迁移的 4 个页面保持一致；`APPROVAL_NODE_STATUS_LABEL` 不再被引用，移除以避免 lint unused 警告。

**How**（key 映射）：

| 原文案 | 替换 |
|---|---|
| `'审批已通过'` / `'审批已驳回'`（notifySuccess 入参） | `t('approval.approvePassed')` / `t('approval.rejectPassed')` |
| 列标题 `'询价单'` | `t('approval.inquiry')` |
| 列标题 `'采购组织'` | `t('inquiry.list.organization')`（复用现有"采购组织" key） |
| 列标题 `'负责人'` | `t('inquiry.list.owner')`（复用现有"负责人" key） |
| 列标题 `'已选金额'` | `t('approval.selectedAmount')` |
| 列标题 `'审批人'` | `t('approval.approver')` |
| 列标题 `'状态'` | `t('common.status')` |
| 列标题 `'操作'` | `t('common.actions')` |
| 按钮 `通过` | `t('approval.approve')` |
| 按钮 `驳回` | `t('approval.reject')` |
| `<Tag>待审批</Tag>` | `<Tag>{t('approval.pending')}</Tag>` |
| `APPROVAL_NODE_STATUS_LABEL[x]` | `` t(`enum.approvalNodeStatus.${x}`) `` |
| PageHeader title `审批管理` | `t('approval.managementTitle')` |
| PageHeader description `对超阈值询价定标结果进行审批，确保流程合规可追溯` | `t('approval.description')` |
| Empty `您没有审批权限` | `t('approval.noPermission')` |
| Statistic `待审批` / `已通过` / `已驳回` | `t('approval.pending')` / `t('approval.approved')` / `t('approval.rejected')` |
| `` `待审批（${pendingList.length}）` `` | `t('approval.pendingWithCount', { count: pendingList.length })` |
| `` `审批历史（${historyList.length}）` `` | `t('approval.historyWithCount', { count: historyList.length })` |
| `'暂无待审批询价单'` / `'暂无审批历史'` | `t('approval.emptyPending')` / `t('approval.emptyHistory')` |
| Modal title `'审批通过'` / `'审批驳回'` | `t('approval.approveModalTitle')` / `t('approval.rejectModalTitle')` |
| Modal `okText="确认"` | `okText={t('common.confirm')}` |
| Modal `cancelText="取消"` | `cancelText={t('common.cancel')}` |
| Form.Item label `审批意见` | `t('approval.comment')` |
| TextArea placeholder `'可填写审批意见（选填）'` / `'请填写驳回原因'` | `t('approval.commentOptionalPlaceholder')` / `t('approval.rejectReasonPlaceholder')` |
| Descriptions title `询价信息` | `t('approval.inquiryInfo')` |
| Descriptions.Item `询价编号` | `t('approval.inquiryCodeLabel')` |
| Descriptions.Item `主题` | `t('approval.subject')` |
| Descriptions.Item `已选金额` | `t('approval.selectedAmount')` |
| Descriptions.Item `提交时间` | `t('approval.submittedAt')` |
| Text `审批流程` | `t('approval.flow')` |

### 文件 2：`src/pages/log/index.tsx`

**What**：
1. 在 `import dayjs from 'dayjs';` 之后追加 `import { useTranslation } from 'react-i18next';`
2. 在 `LogPage` 组件内 `const currentOrganization = useUIStore(...)` 之前加 `const { t } = useTranslation();`
3. 从 `@/types` 的 import 中移除 `LOG_TYPE_LABEL` 与 `LOG_TYPE_OPTIONS`（保留 `LogType` 枚举与 `InquiryLog` 类型）
4. 在组件内构建动态选项：`const logTypeOptions = (Object.keys(LogType) as LogType[]).map((value) => ({ label: t(\`enum.logType.${value}\`), value }));`
5. 替换全部硬编码文案（见下方映射表）

**Why**：`LOG_TYPE_LABEL` / `LOG_TYPE_OPTIONS` 改用 `t()` 后不再被引用，移除以避免 unused；动态选项保证语言切换时下拉同步刷新。

**How**（key 映射）：

| 原文案 | 替换 |
|---|---|
| 列标题 `'时间'` | `t('log.time')` |
| 列标题 `'操作人'` | `t('log.operator')` |
| 列标题 `'操作人角色'` | `t('log.operatorRole')` |
| 列标题 `'操作类型'` | `t('log.operationType')` |
| 列标题 `'操作内容'` | `t('log.operationContent')` |
| 列标题 `'操作结果'` | `t('log.result')` |
| `LOG_TYPE_LABEL[type]` | `` t(`enum.logType.${type}`) `` |
| PageHeader title `操作日志` | `t('log.title')` |
| PageHeader description `记录全部询价流程操作` | `t('log.description')` |
| Form.Item label `操作时间` | `t('log.operationTime')` |
| Form.Item label `操作人` | `t('log.operator')` |
| Form.Item label `操作类型` | `t('log.operationType')` |
| Form.Item label `关键字` | `t('log.keyword')` |
| Input placeholder `请输入操作人` | `t('log.operatorPlaceholder')` |
| Select placeholder `请选择操作类型` | `t('log.typePlaceholder')` |
| Select `options={LOG_TYPE_OPTIONS}` | `options={logTypeOptions}` |
| Input placeholder `搜索操作内容` | `t('log.contentSearchPlaceholder')` |
| Button `查询` | `t('log.query')` |
| Button `重置` | `t('common.reset')` |
| `` `共 ${total} 条记录` `` | `t('log.totalRecords', { count: total })` |
| `'搜索无结果'` / `'暂无操作日志'` | `t('log.noSearchResult')` / `t('log.empty')` |

### 文件 3：locale 文件（无需改动）

`src/locales/zh-CN.json` 与 `src/locales/en-US.json` 中 `approval` / `log` / `enum.approvalNodeStatus` / `enum.logType` 模块已包含本次所需全部 key，无需新增。

## 假设与决策

1. **复用跨模块 key**：`'采购组织'` 复用 `inquiry.list.organization`、`'负责人'` 复用 `inquiry.list.owner`，避免在 `approval` 模块重复定义同义 key（与现有 locale 结构一致：`inquiry.list` 已是"采购组织/负责人"的规范来源）。
2. **命令式 API 在组件内调用**：`notifySuccess(...)` 在 `handleModalOk` 内被调用，处于组件闭包，可直接用 hook 的 `t()`；无需引入 `i18n.t()`（与 `compare/index.tsx` 中 `notifySuccess` 调用模式一致）。
3. **子组件独立 hook**：`ApprovalDetail` 与 `ApprovalNodeItem` 是独立函数组件，需各自调用 `useTranslation()`，不能依赖父组件 `t`。
4. **数据值比较保留**：log/index.tsx 第 158 行 `role === '系统'` 是与实际数据字符串比对（mock 数据中 `operatorRole: '系统'`），属业务判断，不迁移。
5. **颜色映射保留**：`APPROVAL_NODE_STATUS_COLOR` / `LOG_TYPE_TAG_COLOR` 是 Tag 颜色映射，非文案，保留原样。
6. **不动业务逻辑**：不修改表格列宽、查询逻辑、Modal 状态管理、权限校验等任何业务行为，仅替换文案与移除已无引用的 label 常量 import。

## 验证步骤

1. `npx tsc --noEmit`：确认无类型错误（重点检查移除 `LOG_TYPE_LABEL` / `LOG_TYPE_OPTIONS` / `APPROVAL_NODE_STATUS_LABEL` import 后无残留引用）。
2. （可选，如时间允许）`npm run lint`：确认无 unused import 警告。
3. （可选）`npm run build`：确认构建通过。

## 执行顺序

1. 编辑 `src/pages/approval/index.tsx`（含 `ApprovalPage` / `ApprovalDetail` / `ApprovalNodeItem` 三个组件）
2. 编辑 `src/pages/log/index.tsx`
3. 运行 `npx tsc --noEmit` 验证
