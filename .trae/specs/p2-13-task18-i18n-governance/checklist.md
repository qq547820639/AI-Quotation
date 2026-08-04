# Checklist

## 国际化
- [x] 硬编码文案扫描清单确认（RouteSuspense、materialCategories、deadlineWatcher、materialImport、material 页、create/shared 页）
- [x] 新增 i18n 键在 zh-CN 与 en-US 中一一对应
- [x] RouteSuspense "加载中..." 已替换为 i18n 键
- [x] materialCategories 品类标签已替换为 i18n 键（value 不变）
- [x] deadlineWatcher 即将截止通知已替换为 i18n 键（含插值）
- [x] materialImport 导入错误提示已替换为 i18n 键
- [x] material 页与 create/shared 页品类选项已替换为 i18n 键
- [x] 现有测试未被破坏，依赖具体文案的测试同步更新后通过

## CI 翻译键检查
- [x] package.json 存在 `i18n:check` 脚本
- [x] ci.yml quality job 新增 `npm run i18n:check` 步骤
- [x] `npm run i18n:check` 本地运行通过（键集合一致、无缺失引用键）

## 组件拆分
- [x] 报价对比页 `src/pages/quotation/compare/index.tsx` 已拆分为主入口 + 子组件 + 常量/类型
- [x] 拆分后功能与测试保持通过

## 公共模块与工程能力
- [x] 公共格式化/常量/权限守卫/hooks 已抽取复用
- [x] Error Boundary（Sentry）已确认
- [x] 路由级懒加载（React.lazy）已确认
- [x] Web Vitals 性能监控已确认
- [x] React Query 缓存/去重配置生效（`src/lib/queryClient.ts`）

## 渲染优化
- [x] 供应商报价填报页与报价对比页已按需使用 memo/useCallback 减少重复渲染

## 验证
- [x] `npx tsc --noEmit` 通过
- [x] `npm run lint` 通过
- [x] `npm run build` 通过
- [x] `npm run test` 通过
- [x] `npm run i18n:check` 通过