# P2-13 Task 18 国际化与前端工程治理 Spec

## Why

系统已具备 react-i18next 国际化基础（zh-CN / en-US 两份 locale，共 1562 键），但仍有大量硬编码中文/英文文案散落在组件与工具函数中，导致切换语言后部分界面仍显示中文。同时存在超大页面组件（供应商门户报价页、报价对比页）难以维护、公共逻辑重复、重复请求与重复渲染等问题。需要系统化治理：硬编码文案入 i18n、引入 CI 翻译键一致性检查、拆分超大组件、抽取公共模块、确认 Error Boundary/懒加载/性能监控、减少重复请求与渲染。

## What Changes

- 将扫描出的用户可见硬编码文案替换为 i18n 键（RouteSuspense、materialCategories、deadlineWatcher、materialImport、material 页、create/shared 页等）
- 在 `package.json` 新增 `i18n:check` 脚本，接入 `scripts/check-i18n.mjs`（已存在，校验 zh/en 键一致性、源码引用键存在性、未使用键提示）
- 在 `.github/workflows/ci.yml` 的 quality job 中新增 i18n 键检查步骤
- 拆分超大页面组件：报价对比页 `src/pages/quotation/compare/index.tsx`（839 行）拆分为 index + 子组件 + 常量/类型
- 抽取公共模块：格式化/常量/权限守卫/hooks 等通用逻辑复用
- 验证 Error Boundary、路由级懒加载（React.lazy）、关键页面性能监控（Web Vitals）已就位
- 检查并减少不必要的重复请求与重复渲染（React Query key 缓存、memo/useCallback）

## Impact

- Affected specs: 无（前端工程治理增量）
- Affected code:
  - 前端：`src/components/RouteSuspense.tsx`、`src/constants/materialCategories.ts`、`src/utils/deadlineWatcher.ts`、`src/utils/materialImport.ts`、`src/pages/material/index.tsx`、`src/pages/inquiry/create/shared.ts`、`src/pages/quotation/compare/index.tsx`、`src/locales/zh-CN.json`、`src/locales/en-US.json`
  - 配置：`package.json`、`.github/workflows/ci.yml`
  - 已就位（确认即可）：`scripts/check-i18n.mjs`、`src/lib/queryClient.ts`、`src/pages/supplier-portal/{components,types}.tsx/ts`

## ADDED Requirements

### Requirement: 硬编码文案国际化
系统 SHALL 将用户可见的硬编码中文/英文文案替换为 i18n 键，中英文文案保持一致。

#### Scenario: 切换语言后无中文残留
- **WHEN** 用户将界面语言切换为英文
- **THEN** 原硬编码文案（加载中、物料品类、即将截止通知、导入错误提示等）均显示英文
- **AND** 中文 locale 与英文 locale 文案一一对应

#### Scenario: 物料品类常量支持国际化
- **WHEN** 物资品类选项（工业电子/五金件/自动化/办公设备/包材/劳保）在界面展示
- **THEN** 使用 i18n 键渲染，切换语言时同步翻译

### Requirement: CI 翻译键检查
系统 SHALL 在 CI 中校验 zh-CN 与 en-US 翻译键集合一致，且源码引用的翻译键均存在。

#### Scenario: 新增翻译键不同步
- **WHEN** 开发者只修改 zh-CN.json 而未同步 en-US.json
- **THEN** `npm run i18n:check` 失败并明确指出缺失/多余键

#### Scenario: 引用不存在的翻译键
- **WHEN** 源码中 `t('some.missing.key')` 引用了 locale 中不存在的键
- **THEN** `npm run i18n:check` 失败并列出缺失键

### Requirement: 超大页面组件拆分
系统 SHALL 将报价对比页超大组件拆分为可维护的子组件与常量/类型模块。

#### Scenario: 报价对比页拆分
- **WHEN** 开发人员维护报价对比页
- **THEN** 页面主入口聚焦状态与编排，对比表格、评分说明、摘要等逻辑下沉到子组件/工具模块

### Requirement: 公共模块抽取
系统 SHALL 抽取跨页面复用的格式化、常量、权限守卫、hooks 等公共逻辑，避免重复实现。

### Requirement: 重复请求与重复渲染治理
系统 SHALL 检查并减少不必要的重复 API 请求与无谓的重渲染，充分利用 React Query 缓存与 memo/useCallback。

## MODIFIED Requirements

无（增量治理，不改动既有功能契约）。

## REMOVED Requirements

无。