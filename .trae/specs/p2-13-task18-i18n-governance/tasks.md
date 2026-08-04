# Tasks

## Task 1: 硬编码文案扫描确认与 i18n 键新增
- [x] SubTask 1.1: 确认扫描出的硬编码文案清单（RouteSuspense、materialCategories、deadlineWatcher、materialImport、material 页、create/shared 页）
- [x] SubTask 1.2: 在 `src/locales/zh-CN.json` 与 `src/locales/en-US.json` 新增对应 i18n 键，中英文一一对应

## Task 2: 硬编码文案替换为 i18n 键
- [x] SubTask 2.1: `src/components/RouteSuspense.tsx` 的 "加载中..." 替换为 i18n 键
- [x] SubTask 2.2: `src/constants/materialCategories.ts` 品类标签替换为 i18n 键（保持 value 不变）
- [x] SubTask 2.3: `src/utils/deadlineWatcher.ts` 的即将截止通知标题/内容替换为 i18n 键（含插值）
- [x] SubTask 2.4: `src/utils/materialImport.ts` 的导入错误提示替换为 i18n 键
- [x] SubTask 2.5: `src/pages/material/index.tsx` 与 `src/pages/inquiry/create/shared.ts` 的品类选项替换为 i18n 键
- [x] SubTask 2.6: 不删除/adjust 现有测试断言；若测试依赖具体文案，确保测试仍通过或同步更新

## Task 3: 接入 i18n:check 脚本与 CI
- [x] SubTask 3.1: `package.json` 新增 `"i18n:check": "node scripts/check-i18n.mjs"` 脚本
- [x] SubTask 3.2: `.github/workflows/ci.yml` 的 quality job 新增 `npm run i18n:check` 步骤
- [x] SubTask 3.3: 运行 `npm run i18n:check` 确认通过（无缺失/多余键、无缺失引用键）

## Task 4: 拆分报价对比页超大组件
- [x] SubTask 4.1: 阅读 `src/pages/quotation/compare/index.tsx`（839 行），识别可下沉的对比表格、评分说明、摘要等子组件
- [x] SubTask 4.2: 将常量、类型、工具逻辑抽取到独立文件，主入口聚焦状态与编排
- [x] SubTask 4.3: 保持功能与现有测试不变，运行相关测试确认通过

## Task 5: 抽取公共模块与确认工程能力
- [x] SubTask 5.1: 确认/抽取共用格式化（`src/utils/format.ts`）、权限守卫、hooks 等公共逻辑供复用
- [x] SubTask 5.2: 确认 Error Boundary（Sentry）、路由级懒加载（React.lazy）、Web Vitals 性能监控已就位
- [x] SubTask 5.3: `src/lib/queryClient.ts` 确认 React Query 缓存/去重配置生效，减少重复请求

## Task 6: 减少重复渲染
- [x] SubTask 6.1: 检查供应商报价填报页与报价对比页的表格/列表是否可使用 memo/useCallback 减少无谓重渲染
- [x] SubTask 6.2: 仅对必要场景优化，避免过度工程

## Task 7: 运行验证
- [x] SubTask 7.1: `npx tsc --noEmit` 通过
- [x] SubTask 7.2: `npm run lint` 通过
- [x] SubTask 7.3: `npm run build` 通过
- [x] SubTask 7.4: `npm run test` 通过
- [x] SubTask 7.5: `npm run i18n:check` 通过

# Task Dependencies
- Task 1 依赖清理扫描结果
- Task 2 依赖 Task 1（先有键再替换）
- Task 3 可与 Task 2 并行
- Task 4/5/6 相互独立，可并行
- Task 7 依赖 Task 1~6 完成