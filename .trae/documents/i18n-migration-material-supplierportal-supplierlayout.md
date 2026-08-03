# i18n 迁移计划：material / supplier-portal / SupplierLayout

## Summary

将剩余 3 个 React 文件中的硬编码中文文案迁移到 react-i18next，完成本轮 i18n 迁移任务。
所有需要的 locale key 已存在于 `src/locales/zh-CN.json` 与 `src/locales/en-US.json`（material / supplierPortal / inquiry / common / enum 等 section），无需新增 key（仅需补充 1 个 `material.import.confirmImportWithCount` 用于带数量的导入按钮文案）。

## Current State Analysis

### 已完成（无需改动）
- `src/pages/supplier/index.tsx` — 已迁移完成（含 `useTranslation` import、`const { t } = useTranslation()`、所有文案已替换）
- `src/pages/supplier/detail/index.tsx` — 已迁移完成
- locale 文件 `zh-CN.json` / `en-US.json` — 已包含 material.list / material.form / material.import / supplierPortal / inquiry.detail / inquiry.create.material / enum.currency 等全部所需 key

### 待迁移（本计划范围）
1. `src/pages/material/index.tsx` — 大量硬编码中文（表格列标题、筛选标签、弹窗表单、按钮、通知、确认框等）
2. `src/pages/supplier-portal/index.tsx` — 大量硬编码中文（报价表单列、询价信息描述、Result 提示、Alert、按钮、通知、确认框等）；使用了 `CURRENCY_LABEL` 需替换为 `t('enum.currency.${value}')`
3. `src/layouts/SupplierLayout.tsx` — 少量硬编码（平台标题、当前供应商、返回按钮）

### 关键发现
- `CURRENCY_LABEL` 仅在 `supplier-portal/index.tsx` 中被引用（定义在 `src/types/index.ts`），迁移后该文件不再需要此 import
- `CATEGORY_OPTIONS`（material）与 `PAYMENT_TERMS_OPTIONS`、`TAX_RATE_OPTIONS`（supplier-portal）的 label 与 value 相同且作为数据值存储，按已迁移的 `supplier/index.tsx` 中 `MAIN_CATEGORY_OPTIONS` 的处理方式，保持原样不迁移（数据值需与存储一致）
- 已迁移文件采用整文件 Write 重写以保证原子性，本计划沿用该策略

## Proposed Changes

### 1. 补充 locale key（仅 1 处）

**文件**：`src/locales/zh-CN.json` 与 `src/locales/en-US.json`

在 `material.import` section 末尾新增：
- zh-CN: `"confirmImportWithCount": "确认导入（{{count}}）"`
- en-US: `"confirmImportWithCount": "Confirm Import ({{count}})"`

用于 `material/index.tsx` 导入弹窗 okText 的带数量显示。

### 2. 迁移 `src/pages/material/index.tsx`

**What**：将所有硬编码中文替换为 `t('key')` 调用
**Why**：完成 i18n 迁移，支持多语言
**How**：
- 添加 `import { useTranslation } from 'react-i18next';`
- 组件内添加 `const { t } = useTranslation();`
- PageHeader：`title={t('material.title')}`、`description={t('material.list.description')}`
- 按钮：批量导入 `t('material.list.batchImport')`、新增物料 `t('material.list.create')`
- 筛选标签：物料名称/编码 `t('material.list.nameCodeLabel')`、品类 `t('material.list.categoryShort')`、品牌 `t('material.list.brand')`
- Input/Select placeholder：`t('common.inputPlaceholder')`、`t('common.selectPlaceholder')`
- 查询/重置按钮：`t('common.query')`、`t('common.reset')`
- 表格列标题：`t('material.list.code')`、`t('material.list.name')`、`t('material.list.categoryShort')`、`t('material.list.brand')`、`t('material.list.specModel')`、`t('material.list.techParams')`、`t('material.list.unit')`、`t('material.list.stockQty')`、`t('material.list.actions')`
- 操作按钮：编辑 `t('material.list.edit')`、删除 `t('material.list.delete')`
- 分页 showTotal：`t('material.list.total', { count: total })`
- 空状态：`t('material.list.empty')`、`t('material.list.noMatch')`
- 弹窗标题：`t('material.form.editTitle')` / `t('material.form.createTitle')`
- 弹窗 okText/cancelText：`t('common.save')` / `t('common.cancel')`
- Form.Item label：`t('material.form.code')`、`t('material.form.name')`、`t('material.form.categoryShort')`、`t('material.form.brand')`、`t('material.form.specModel')`、`t('material.form.unit')`、`t('material.form.stockLabel')`、`t('material.form.techParams')`
- Form rules message：`t('material.form.codeRequired')`、`t('material.form.nameRequired')`、`t('material.form.categoryRequired')`、`t('material.form.unitRequired')`
- Input placeholder：`t('material.form.codeExample')`、`t('material.form.namePlaceholder')`、`t('material.form.categorySelectPlaceholder')`、`t('material.form.brandPlaceholder')`、`t('material.form.specModelPlaceholder')`、`t('material.form.unitExample')`、`t('material.form.stockQtyPlaceholder')`、`t('material.form.techParamsDescPlaceholder')`
- 通知：`t('material.form.updated')`、`t('material.form.added')`、`t('material.form.deleted')`、`t('material.import.uploadFirst')`、`t('material.import.importSuccessCount', { count: importPreview.length })`、`t('material.import.parseFailed')`
- 删除确认：title `t('material.list.deleteTitle')`、content `t('material.form.confirmDeleteDetail', { name, code })`、okText `t('common.delete')`
- 导入弹窗：title `t('material.import.title')`、okText `importPreview.length ? t('material.import.confirmImportWithCount', { count: importPreview.length }) : t('material.import.confirmImport')`、cancelText `t('common.cancel')`
- 导入弹窗内容：选择文件按钮 `t('material.import.selectExcel')`、支持列说明 `t('material.import.supportedColumns')`、预览标题 `t('material.import.previewCount', { count: importPreview.length })`
- 预览表格列标题：复用 `material.list.*` 对应 key
- **保持不变**：`CATEGORY_OPTIONS` 常量（数据值，与 supplier/index.tsx 的 MAIN_CATEGORY_OPTIONS 处理一致）

### 3. 迁移 `src/pages/supplier-portal/index.tsx`

**What**：将所有硬编码中文替换为 `t('key')`，移除 `CURRENCY_LABEL` import
**Why**：完成 i18n 迁移，统一货币标签走 `enum.currency.*`
**How**：
- 添加 `import { useTranslation } from 'react-i18next';`
- 组件内添加 `const { t } = useTranslation();`
- 从 `@/types` import 中移除 `CURRENCY_LABEL`
- `CURRENCY_LABEL[inquiry.currency]` → `t(\`enum.currency.${inquiry.currency}\`)`
- 顶部信息卡片：Tag `t('supplierPortal.fillTag')`、询价主题标签 `t('supplierPortal.inquirySubjectLabel')`、编号标签 `t('supplierPortal.codeLabel')`、报价截止标签 `t('supplierPortal.deadlineLabel')`
- Alert 超时：message `t('supplierPortal.deadlinePassedSubmit')`、description `t('supplierPortal.deadlineAlertDesc')`
- Alert 草稿：message `t('supplierPortal.draftLoadedTitle')`、description `t('supplierPortal.draftLoadedDesc')`
- 询价基本信息 Card：title `t('supplierPortal.inquiryBasicInfo')`，Descriptions.Item label 复用 `inquiry.detail.*`（organization/currency/expectedDeliveryDate/contact/paymentTerms/invoiceRequirement/description）与 `supplierPortal.deliveryAddress`
- 采购物料明细 Card：title `t('supplierPortal.purchaseMaterialList')`
- 询价附件 Card：title `t('supplierPortal.inquiryAttachments')`，空状态 `t('supplierPortal.noAttachments')`，收货交付要求 `t('supplierPortal.deliveryRequirement')`
- 填写报价 Card：title `t('supplierPortal.fillQuotation')`、报价总金额标签 `t('supplierPortal.totalAmountLabel')`、报价备注标签 `t('supplierPortal.remarkLabel')`、placeholder `t('supplierPortal.remarkPlaceholder')`
- 操作按钮：重置 `t('common.reset')`、暂存报价 `t('supplierPortal.saveDraft')`、正式提交 `t('supplierPortal.submitBtn')`
- inquiryItemColumns 标题：物料名称 `t('inquiry.create.material.materialName')`、物料编码 `t('inquiry.create.material.materialCode')`、品类 `t('inquiry.detail.category')`、品牌 `t('material.list.brand')`、规格 `t('material.list.spec')`、技术参数 `t('material.list.techParams')`、单位 `t('material.list.unit')`、采购数量 `t('inquiry.create.material.quantity')`、目标价格 `t('supplierPortal.targetPrice')`
- quotationColumns 标题：物料名称 `t('inquiry.create.material.materialName')`、采购数量 `t('inquiry.create.material.quantity')`、物料单价 `t('supplierPortal.materialUnitPrice')`、税率 `t('supplierPortal.taxRate')`、含税总价 `t('supplierPortal.taxIncludedTotal')`、最小起订量 `t('supplierPortal.moq')`、交货周期(天) `t('supplierPortal.deliveryDaysCol')`、可交货日期 `t('supplierPortal.deliveryDateCol')`、品牌 `t('supplierPortal.brand')`、质保期(月) `t('supplierPortal.warrantyMonthsCol')`、付款条件 `t('supplierPortal.paymentTerms')`、报价有效期 `t('supplierPortal.validUntil')`、技术偏离说明 `t('supplierPortal.techDeviationDesc')`、商务偏离说明 `t('supplierPortal.commercialDeviationDesc')`、备注 `t('supplierPortal.remark')`、附件 `t('common.attachments')`
- InputNumber/DatePicker/Input placeholder：必填 `t('common.required')`、可选 `t('supplierPortal.optional')`、选择日期 `t('supplierPortal.selectDate')`、品牌 `t('supplierPortal.brand')`、无偏离可留空 `t('supplierPortal.noDeviationPlaceholder')`、备注 `t('supplierPortal.remark')`
- Upload 按钮：上传 `t('common.upload')`
- Result 不存在：title `t('supplierPortal.notExistTitle')`
- Result 提交成功：title `t('supplierPortal.submitSuccessMsg')`、subTitle `t('supplierPortal.submittedSubTitle', { code: inquiry.code })`、extra 按钮 `t('supplierPortal.viewSubmitted')`
- notifyError：`t('supplierPortal.validateError')`、`t('supplierPortal.deadlinePassedSubmit')`
- notifySuccess：`t('supplierPortal.draftSaved')`、`t('supplierPortal.submitSuccessMsg')`、`t('supplierPortal.resetSuccess')`
- 提交确认：title `t('supplierPortal.confirmSubmitTitle')`、content `t('supplierPortal.confirmSubmitContent')`、okText `t('supplierPortal.confirmSubmitOk')`、cancelText `t('supplierPortal.checkAgain')`
- 重置确认：title `t('supplierPortal.confirmResetTitle')`、content `t('supplierPortal.confirmResetContent')`、okText `t('supplierPortal.confirmResetOk')`
- **保持不变**：`TAX_RATE_OPTIONS`（数字标签）、`PAYMENT_TERMS_OPTIONS`（数据值）、`createEmptyItem` 中默认值 `'货到验收后 30 天付款'`（数据默认值，非 UI 文案）

### 4. 迁移 `src/layouts/SupplierLayout.tsx`

**What**：将 3 处硬编码中文替换为 `t('key')`
**Why**：完成 i18n 迁移
**How**：
- 添加 `import { useTranslation } from 'react-i18next';`
- 组件内添加 `const { t } = useTranslation();`
- 平台标题 `t('supplierPortal.platformTitle')`
- 当前供应商标签 `t('supplierPortal.currentSupplier')`
- 返回按钮 `t('common.back')`

### 5. 验证

运行 `npx tsc --noEmit` 确保无类型错误。

## Assumptions & Decisions

1. **数据值选项不迁移**：`CATEGORY_OPTIONS`、`PAYMENT_TERMS_OPTIONS`、`TAX_RATE_OPTIONS` 的 label 与 value 一致且作为数据存储值，保持原样（与已迁移的 `supplier/index.tsx` 中 `MAIN_CATEGORY_OPTIONS` 处理方式一致）
2. **货币标签走 enum**：`CURRENCY_LABEL[inquiry.currency]` 替换为 `t(\`enum.currency.${inquiry.currency}\`)`，并移除 `CURRENCY_LABEL` import（参考 `StatusTag.tsx` 的 `t(\`enum.cooperationStatus.${status}\`)` 模式）
3. **新增 1 个 locale key**：`material.import.confirmImportWithCount` 用于带数量的导入按钮文案，避免拼接
4. **整文件 Write 重写**：为保证原子性，对每个待迁移文件采用 Write 工具整文件重写（与已迁移的 supplier/index.tsx 策略一致）
5. **不修改业务逻辑**：仅替换文案，保持组件结构、状态管理、事件处理等不变
6. **保持代码格式不变**：缩进、换行、引号风格与原文件一致

## Verification Steps

1. 在 `src/locales/zh-CN.json` 与 `en-US.json` 添加 `material.import.confirmImportWithCount` key
2. 重写 `src/pages/material/index.tsx`（添加 useTranslation、替换所有硬编码中文）
3. 重写 `src/pages/supplier-portal/index.tsx`（添加 useTranslation、替换所有硬编码中文、移除 CURRENCY_LABEL）
4. 重写 `src/layouts/SupplierLayout.tsx`（添加 useTranslation、替换 3 处硬编码中文）
5. 运行 `npx tsc --noEmit` 确保无类型错误
