# 深化迭代与用户体验优化执行计划

> 目标：一次性完成深度审计发现的 20 项深化点（P0×4 / P1×8 / P2×8），从"代码就绪"升级到"企业级优质体验"。
> 依据：基于 Phase 1 深度审计（读取 15+ 核心文件、Grep 模式扫描、i18n 对比、测试覆盖对比），所有文件路径与行号均来自实际探索。
> 原则：只改审计发现的问题，不新增未请求功能；保持决策完整，执行者无需额外选择。

---

## 一、当前状态分析（基于深度审计）

### 项目优点（无需改动）
- i18n 体系完整（zh-CN/en-US 各 1299 key 对齐）、主页面均用 `t()`
- 路由懒加载覆盖全部 17 页面、ECharts 按需引入、vendor manualChunks 合理
- 无 `alert/confirm` 原生弹窗（已用 Modal.confirm）、无假 loading setTimeout 残留
- `console.log` 仅 6 处 warn 且生产 `drop: ['console']`、`as any` 仅 3 处（测试/Sentry，可接受）
- 状态机测试质量高（useInquiryStore 11 写操作、scoreUtils 评分计算）

### 20 项深化点（按优先级）

| 级别 | # | 问题 | 核心文件 |
|---|---|---|---|
| P0 | 1 | 报价对比 4 组件硬编码中文，i18n 断链（约 120 处） | CompareByMaterialTable/CompareBySupplierTable/SupplierQuotationDrawer/SummaryModal |
| P0 | 2 | Dashboard 空状态永久 Skeleton（L984-997） | dashboard/index.tsx |
| P0 | 3 | 全局几乎无 a11y（仅 1 处 aria-label） | 对比表格/快捷卡片/StatusTag |
| P0 | 4 | API 失败静默吞掉（11+3 处空 catch） | useInquiryStore.ts/useQuotationStore.ts/client.ts |
| P1 | 1 | 列表/详情页无加载态，白屏 | inquiry/list/supplier/inquiry/detail |
| P1 | 2 | 表格无列设置/密度/批量操作 | 5 核心页面表格 |
| P1 | 3 | 筛选条件不持久化 | inquiry/list/supplier |
| P1 | 4 | AI 服务纯模拟 delay(600) | utils/aiService.ts |
| P1 | 5 | 对比组件无 React.memo，重渲染 | quotation/compare + 子组件 |
| P1 | 6 | API 无重试/缓存/去重，401 未跳转 | api/client.ts |
| P1 | 7 | 物料品类硬编码重复 | inquiry/list L59/supplier L47 |
| P1 | 8 | selectSupplier API 传参丢数据 | useInquiryStore.ts L279 |
| P2 | 1 | API/store/组件/页面测试覆盖缺口 | api/store/components/pages |
| P2 | 2 | 评语保存 trim 不一致 + 假成功 | quotation/compare L143-152 |
| P2 | 3 | 图表空状态处理不统一 | dashboard 4 图表 |
| P2 | 4 | useEffect 依赖不全，评语可能丢 | quotation/compare L112-120 |
| P2 | 5 | generateCode 编号碰撞风险 | useInquiryStore.ts L28-32 |
| P2 | 6 | PDF 导出无错误提示 | inquiry/detail L181-189 |
| P2 | 7 | 三项最优卡片冗余 | quotation/compare L438-546 |
| P2 | 8 | 移动端筛选/操作按钮可优化 | inquiry/list/supplier 移动端 |

---

## 二、执行计划（9 阶段，按依赖链）

### 阶段 A：报价对比 i18n 断链修复（P0-1）🔴

**问题**：4 个核心组件约 120 处硬编码中文，切换 en-US 仍显示中文。

**步骤**：
1. 在 `src/locales/zh-CN.json` 和 `en-US.json` 的 `quotation.compare.*` 命名空间下新增 key（约 60 个 key，覆盖物料/供应商/抽屉/摘要四组件全部文案）
2. 修改 4 个组件，引入 `useTranslation`，将硬编码中文替换为 `t('quotation.compare.xxx')`

**关键文件**：
- `src/components/quotation/CompareByMaterialTable.tsx`（L102-220，约 30 处）
- `src/components/quotation/CompareBySupplierTable.tsx`（L32-214，约 40 处）
- `src/components/quotation/SupplierQuotationDrawer.tsx`（L35-239，约 35 处）
- `src/components/quotation/SummaryModal.tsx`（L35-147，约 25 处）
- `src/locales/zh-CN.json`、`src/locales/en-US.json`（新增 key）

**验证**：切换 en-US 后，报价对比页全部文案为英文；`npm run lint` 无未使用 key 警告。

---

### 阶段 B：状态三态修复（P0-2 + P1-1）🔴

**问题**：Dashboard 永久 Skeleton；列表/详情页无加载态白屏。

**步骤**：
1. `useInquiryStore` 增加 `loading: boolean` 字段，`loadFromApi` 前置 `set({loading:true})`，完成后 `set({loading:false})`
2. Dashboard L984-997：区分 `loading`（Skeleton）与 `!loading && !inquiries.length`（Empty + 新建按钮）
3. inquiry/list、supplier：`loading && !inquiries.length` 时显示 Skeleton 表格
4. inquiry/detail L159-172：`loading && !inquiry` 时显示 Skeleton，`!loading && !inquiry` 时显示 404

**关键文件**：
- `src/store/useInquiryStore.ts`（加 loading 字段）
- `src/pages/dashboard/index.tsx`（L984-997）
- `src/pages/inquiry/list/index.tsx`、`src/pages/supplier/index.tsx`
- `src/pages/inquiry/detail/index.tsx`（L159-172）

**验证**：空数据时显示 Empty 而非永久 Skeleton；首次加载显示骨架屏。

---

### 阶段 C：API 容错与反馈（P0-4 + P1-6 + P1-8 + P2-2 + P2-6）🔴

**问题**：API 失败静默吞掉；无重试/缓存/401 跳转；selectSupplier 传参丢数据；评语假成功；PDF 无错误提示。

**步骤**：
1. **client.ts（P1-6）**：引入 `axios-retry`（5xx/网络错误重试 2 次）；响应拦截器 401 时调 `useAuthStore.getState().logout()` + `window.location.href='/login'`
2. **store 容错（P0-4）**：useInquiryStore 11 处、useQuotationStore 3 处空 catch 改为：
   - 网络/5xx：`notifyWarning(t('common.networkDegraded'))` + 保留本地改动
   - 4xx：回滚本地状态 + `notifyError(具体错误)`
3. **selectSupplier bug（P1-8）**：useInquiryStore L279 改为传完整 `selectedSupplierMap`（从 set 后的 state 读取）
4. **评语保存（P2-2）**：quotation/compare L143-152 统一 `trim` 后保存；`updateInquiry` 返回 Promise，await 后再 `notifySuccess`
5. **PDF 错误（P2-6）**：inquiry/detail L181-189 的 `.finally` 前加 `.catch` → `notifyWarning`

**关键文件**：
- `src/api/client.ts`（重试 + 401 跳转）
- `src/store/useInquiryStore.ts`（11 处 catch + L279 selectSupplier）
- `src/store/useQuotationStore.ts`（3 处 catch）
- `src/pages/quotation/compare/index.tsx`（L143-152 评语）
- `src/pages/inquiry/detail/index.tsx`（L181-189 PDF）
- `src/utils/confirm.tsx`（确认 notifyWarning 存在，否则补）

**验证**：模拟 API 500 时显示"网络异常已暂存"；401 跳转登录；selectSupplier 多选不丢数据。

---

### 阶段 D：a11y 支持（P0-3）🔴

**问题**：全局仅 1 处 aria-label，键盘/屏幕阅读器不可用。

**步骤**：
1. **可点击 div**：CompareByMaterialTable L67-75/L99-103/L151-154、CompareBySupplierTable L37-41、dashboard L892-968/L1017-1056 的 `div+onClick` 加 `role="button" tabIndex={0} onKeyDown={enterSpace触发}`
2. **StatusTag**：补 `aria-label={t('status.xxx')}` 描述状态
3. **对比表格 Tag**（最低价/最快/最优）：补 `aria-label`
4. **快捷卡片**：dashboard 快捷操作 Card 加 `role="button"` + 键盘事件

**关键文件**：
- `src/components/quotation/CompareByMaterialTable.tsx`
- `src/components/quotation/CompareBySupplierTable.tsx`
- `src/components/StatusTag.tsx`
- `src/pages/dashboard/index.tsx`

**验证**：Tab 键可遍历可点击元素；Enter/Space 可触发；屏幕阅读器读出状态。

---

### 阶段 E：表格交互与筛选增强（P1-2 + P1-3 + P1-7 + P2-8）

**步骤**：
1. **品类常量（P1-7）**：新建 `src/constants/materialCategories.ts`，导出 `MATERIAL_CATEGORY_OPTIONS`；inquiry/list L59、supplier L47 改为 import
2. **列设置 + 批量（P1-2）**：
   - inquiry/list Table 加 `columnSetting` + `rowSelection`（批量取消/导出）
   - supplier Table 加 `columnSetting` + `rowSelection`（批量启停）
3. **筛选持久化（P1-3）**：inquiry/list、supplier 的 `applied` 筛选状态同步到 `sessionStorage`（key: `inquiryFilter`/`supplierFilter`），重进恢复
4. **移动端（P2-8）**：移动端筛选 Card 包裹 `Collapse` 默认收起；操作按钮超 3 个折叠为 Dropdown "更多"

**关键文件**：
- `src/constants/materialCategories.ts`（新建）
- `src/pages/inquiry/list/index.tsx`（列设置 + 批量 + 筛选持久化 + 移动端）
- `src/pages/supplier/index.tsx`（同上）

**验证**：列设置可隐藏列；批量选择可操作；刷新后筛选保留；移动端筛选默认收起。

---

### 阶段 F：性能优化与 AI 抽象（P1-4 + P1-5 + P2-4 + P2-5 + P2-7）

**步骤**：
1. **AI 抽象（P1-4）**：aiService.ts 抽象 `AIBackend` 接口（generate/analyze/conclude），默认 `LocalRuleBackend`，预留 `RemoteAIBackend`（fetch `/api/ai/*`）注入点；`delay` 改为可配置参数
2. **React.memo（P1-5）**：CompareByMaterialTable、CompareBySupplierTable、QuoteCell、Line 加 `React.memo`；quotation/compare 的 `onSelectSupplier`/`onOpenDrawer` 用 `useCallback`；`supplierCols` 用 `useMemo`
3. **useEffect 依赖（P2-4）**：quotation/compare L112-120 依赖改为 `[inquiryId]`，内部从 `getInquiryById` 取最新值
4. **编号碰撞（P2-5）**：useInquiryStore L28-32 的 `generateCode` 改用 `inquiries.length + 1` 或 store 自增计数器
5. **卡片冗余（P2-7）**：quotation/compare L438-546 仅 1 家报价时折叠为单卡片

**关键文件**：
- `src/utils/aiService.ts`（抽象接口）
- `src/components/quotation/CompareByMaterialTable.tsx`、`CompareBySupplierTable.tsx`（memo）
- `src/pages/quotation/compare/index.tsx`（useCallback/useMemo/依赖/卡片）
- `src/store/useInquiryStore.ts`（generateCode）

**验证**：commentDraft 输入时对比表格不重渲染；编号无碰撞；1 家报价时卡片折叠。

---

### 阶段 G：图表空状态统一（P2-3）

**步骤**：dashboard 4 个图表组件（SupplierFrequencyChart L398-403、CategoryDistributionChart L483-488、ApprovalFunnelChart L594-599）无数据时从 ECharts title 改为 React 层 `<Empty>`，与 StatusPieChart/QuotationTrendChart 一致。

**关键文件**：`src/pages/dashboard/index.tsx`

**验证**：无数据时所有图表显示统一 Empty 组件。

---

### 阶段 H：测试补全（P2-1）

**步骤**：优先补核心模块单测：
1. `src/store/__tests__/useQuotationStore.test.ts`（报价提交/暂存状态机）
2. `src/store/__tests__/useAuthStore.test.ts`（hasPermission 权限判定）
3. `src/api/__tests__/client.test.ts`（拦截器、401/403 处理，用 axios-mock-adapter）
4. `src/components/__tests__/StatusTag.test.tsx`（状态渲染）

**关键文件**：4 个新建测试文件

**验证**：`npx vitest run` 测试数增加，新测试全过。

---

### 阶段 I：最终验证与提交

**验证清单**：
1. `npm run lint` → 0 error / 0 warning
2. `npx tsc --noEmit` → 0 error
3. `npx vitest run` → 全部通过（含新增测试）
4. `npm run build` → 构建成功
5. 手动验证：切换 en-US 报价对比页全英文、空数据 Empty、Tab 键可达、批量操作、筛选持久化
6. `git add . && git commit -m "refactor: deep iteration & UX optimization (20 items)"`

---

## 三、假设与决策

### 假设
1. `axios-retry` 兼容当前 axios ^1.19.0（需 `npm install axios-retry`）
2. `useInquiryStore` 的 `loadFromApi` 可安全加 loading 字段（已有 `loaded` 字段参考）
3. i18n 新增约 60 个 key，zh-CN/en-US 同步对齐
4. `confirm.tsx` 已有 `notifyWarning`（P2-6 PDF 错误用），若无则补
5. antd Table `columnSetting` 是 antd 5.21+ 内置功能，无需额外依赖

### 决策
1. **i18n key 命名**：统一放 `quotation.compare.*` 命名空间，按组件细分（`.materialTable.*` / `.supplierTable.*` / `.drawer.*` / `.summary.*`）
2. **API 容错策略**：5xx/网络错误降级本地 + warning 提示；4xx 回滚 + error 提示；401 跳登录
3. **a11y 范围**：仅处理审计发现的 div+onClick 可点击元素 + StatusTag + Tag，不全面改造（务实优先）
4. **表格交互**：仅询价列表 + 供应商列表加 columnSetting + rowSelection，其他表格保持现状
5. **AI 抽象**：保留本地规则引擎为默认实现，仅抽象接口预留远程注入点，不实际接入 LLM
6. **测试补全**：优先补 store（状态机/权限）+ api（拦截器）+ 1 个组件，不追求全覆盖
7. **不引入新依赖**：除 `axios-retry` 外不新增 npm 包
8. **执行顺序**：A→B→C→D 可部分并行（A 独立、B/C/D 改不同文件但有交叉）；E→F→G 顺序；H 最后；I 验证

---

## 四、文件变更清单

### 新建
- `src/constants/materialCategories.ts`（品类常量）
- `src/store/__tests__/useQuotationStore.test.ts`
- `src/store/__tests__/useAuthStore.test.ts`
- `src/api/__tests__/client.test.ts`
- `src/components/__tests__/StatusTag.test.tsx`

### 修改（按阶段）
- **A**：CompareByMaterialTable/CompareBySupplierTable/SupplierQuotationDrawer/SummaryModal + 2 locale json
- **B**：useInquiryStore/dashboard/inquiry-list/supplier/inquiry-detail
- **C**：client.ts/useInquiryStore/useQuotationStore/quotation-compare/inquiry-detail/confirm.tsx
- **D**：CompareByMaterialTable/CompareBySupplierTable/StatusTag/dashboard
- **E**：inquiry-list/supplier
- **F**：aiService/CompareByMaterialTable/CompareBySupplierTable/quotation-compare/useInquiryStore
- **G**：dashboard
- **H**：4 个新建测试文件

### 依赖安装
- `axios-retry`（API 重试）

---

## 五、验证步骤

1. **代码质量**：`npm run lint` + `npx tsc --noEmit` + `npx vitest run` + `npm run build` 全过
2. **i18n 闭环**：切换 en-US，报价对比页 4 组件全英文
3. **状态三态**：空数据显示 Empty 非永久 Skeleton；首次加载显示骨架屏
4. **API 容错**：模拟 500 显示 warning；401 跳登录；selectSupplier 多选不丢数据
5. **a11y**：Tab 可遍历可点击元素；Enter/Space 可触发；状态有 aria-label
6. **表格交互**：列设置可隐藏列；批量选择可操作；刷新后筛选保留
7. **性能**：commentDraft 输入时对比表格不重渲染（可用 React DevTools 验证）
8. **图表空状态**：无数据时统一 Empty
9. **Git 提交**：`git commit -m "refactor: deep iteration & UX optimization (20 items)"`
