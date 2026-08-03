# 企业采购询价系统 — 下一步全面增强计划

## 概述

当前系统 P0 + P1 核心功能 100% 完成（构建通过、浏览器实测可用）。本计划在已有基础上一次性处理全部已识别问题并补齐 P2 能力，覆盖 8 个工作流：工程化补全、性能优化、占位/假交互修复、权限角色、审批流程、消息通知、真实后端接入、AI 智能化、数据层健壮性、其他增强。

目标：将系统从"可运行的前端 Demo"升级为"工程化达标、企业级能力完备、可接后端、含 AI 差异化"的完整产品。

## 当前状态分析（基于探索）

**已完成**：12 个页面全部真实实现（非占位），无 any，组件拆分合理，Zustand + localStorage 持久化，ECharts 数据驱动，SheetJS Excel 导出真实可用，二次确认规范，响应式到 768px。

**核心短板**：
1. 工程化裸奔：无 ESLint/Prettier/测试/README/Husky
2. 性能未优化：13 页面静态 import 无懒加载，dist 单 chunk 3MB，无 manualChunks
3. 占位假交互：全局搜索、采购组织切换、通知、设置持久化、loading 状态、物料页批量导入
4. P2 全空：权限/审批/消息/多组织/AI 均未做
5. 数据层：localStorage 无版本号，schema 升级会冲突；无重置入口
6. 无后端层：纯 mock + localStorage，无 API 抽象

## 假设与决策

- **不回滚**用户已有改动；新增为主，必要时就地编辑
- **后端接入**用 MSW（Mock Service Worker）做本地 mock server，保持零后端依赖即可运行，同时提供真实 API 切换开关（环境变量 `VITE_USE_MOCK`）
- **AI 能力**用本地规则引擎 + 预设模板模拟（无真实 LLM 调用，保持零密钥依赖），但接口层预留 `aiService`，后续可替换为真实 LLM
- **测试**优先覆盖核心纯函数（评分算法、合并逻辑、格式化、匹配算法），UI 测试用 Testing Library 覆盖关键交互
- **权限模型**：3 角色（采购员/采购主管/管理员）+ 路由守卫 + 按钮级权限指令
- **审批流**：询价单"确认定标"前增加可选多级审批（采购员提交 → 主管审批 → 定标），时间轴扩展
- **多组织**：每条询价单带 organization，切换组织时过滤；管理员可看全部
- **技术栈新增依赖**：eslint、prettier、eslint-config-prettier、eslint-plugin-react-hooks、eslint-plugin-react-refresh、@typescript-eslint/*、husky、lint-staged、vitest、@testing-library/react、@testing-library/jest-dom、jsdom、axios、@tanstack/react-query、msw

---

## 工作流 W1：工程化补全（低投入高回报，先行打底）

### W1.1 代码规范工具链
- 新建 `eslint.config.js`（flat config）：集成 `@typescript-eslint`、`react-hooks`、`react-refresh`、`prettier`（关掉与 Prettier 冲突的格式规则）
- 新建 `.prettierrc.json`：`singleQuote: true, semi: true, printWidth: 100, trailingComma: 'all'`
- 新建 `.prettierignore`、`.eslintignore`
- `package.json` 增加 scripts：`lint`（eslint . --max-warnings=0）、`lint:fix`、`format`（prettier --write）、`format:check`

### W1.2 Git Hooks
- 安装 husky + lint-staged
- 新建 `.husky/pre-commit`：执行 `lint-staged`
- `package.json` 增加 `lint-staged` 配置：`*.{ts,tsx}` → `eslint --fix` + `prettier --write`
- 新建 `.gitattributes`（统一换行符）

### W1.3 单元测试框架
- 安装 vitest + @testing-library/react + @testing-library/jest-dom + jsdom + @vitejs/plugin-react（dev）
- 新建 `vitest.config.ts`：复用 vite alias `@`，environment jsdom，setupFiles `src/test/setup.ts`
- 新建 `src/test/setup.ts`：引入 jest-dom matchers
- `package.json` 增加 scripts：`test`（vitest run）、`test:watch`、`test:coverage`
- `tsconfig.json` 增加 types: ["vitest/globals"] 或在 vitest config 配 globals

### W1.4 核心单元测试
- `src/utils/__tests__/format.test.ts`：formatCurrency/formatDate/formatPercent/getRemainingTime
- `src/utils/__tests__/excel.test.ts`：exportAOA 生成 sheet 结构（mock XLSX.writeFile）
- `src/components/quotation/__tests__/scoreUtils.test.ts`：评分算法（金额/交货/等级/履约四项 + 总分）、最低价/最快交货/异常判定、排序
- `src/pages/inquiry/create/__tests__/shared.test.ts`：computeSupplierMatches 匹配评分、buildInquiryCode、序列化/反序列化
- `src/utils/__tests__/storage.test.ts`：loadJSON/saveJSON/removeKey + 版本号机制（见 W8）

### W1.5 README 与文档
- 新建 `README.md`：项目简介、技术栈、目录结构、安装运行（dev/build/test/lint）、环境变量说明、功能清单、模拟数据说明、后端/AI 切换说明、许可证
- 不创建其他 md 文档（遵循约束）

---

## 工作流 W2：性能优化

### W2.1 路由懒加载
- 改造 `src/router/index.tsx`：13 个页面组件改为 `React.lazy(() => import(...))`
- 新建 `src/components/RouteSuspense.tsx`：包裹 `<Suspense fallback={<Spin 全屏/>}>`，配合 `App.tsx` 的 RouterProvider
- 主布局与 SupplierLayout 保持静态 import（骨架需立即渲染）

### W2.2 代码分割
- 修改 `vite.config.ts`：增加 `build.rollupOptions.output.manualChunks`，拆分 `react/react-dom/react-router`、`antd/@ant-design/icons`、`echarts`、`xlsx`、`zustand/dayjs` 为独立 chunk
- 增加 `build.chunkSizeWarningLimit: 1500`
- 生产构建 `esbuild.drop: ['console','debugger']`

### W2.3 ECharts 按需引入
- 新建 `src/utils/echarts.ts`：用 `echarts/core` + `use([PieChart, LineChart, CanvasRenderer, ...])` 按需注册，导出 `echarts` 实例
- 修改 `src/pages/dashboard/index.tsx`：从 `@/utils/echarts` 导入替代全量 `echarts`

### W2.4 验证
- `npm run build` 检查 chunk 分布，首屏 chunk 应 < 500KB
- 浏览器实测各路由切换正常加载

---

## 工作流 W3：修复占位/假交互（用户明确要求一并修复）

### W3.1 全局搜索
- 新建 `src/components/GlobalSearch.tsx`：用 antd `AutoComplete` + `Modal`，搜索范围=询价单(编号/主题)+供应商(名称)+物料(名称/编码)
- 集成到 `MainLayout` 顶部 Input.Search：onSearch 弹出结果 Modal，点击跳转对应详情页
- 用 `useInquiryStore`/`useSupplierStore`/`useMaterialStore` 聚合搜索

### W3.2 采购组织数据隔离
- 修改 `useUIStore`：`currentOrganization` 已存在
- 修改 `useInquiryStore`：增加 `visibleInquiries` selector（按 currentOrganization 过滤，管理员不过滤——见 W4）
- 修改各列表页（dashboard/list/pending/compare 无 id 入口）：用 `visibleInquiries` 替代 `inquiries`
- `MainLayout` 顶部组织 Select 切换时刷新各页（因 store 驱动，自动生效）

### W3.3 通知系统真实化
- 新建 `src/store/useNotificationStore.ts`：状态 `notifications: Notification[]`，actions `addNotification/markRead/markAllRead/getUnreadCount`
- `Notification` 类型加入 `src/types/index.ts`：id/inquiryId/type/title/content/time/read
- 询价单状态变化时（sendInquiry/submitQuotation/selectSupplier/confirmInquiry/cancelInquiry）联动 `addNotification`
- 修改 `MainLayout`：铃铛 Badge count 用 `getUnreadCount`，Popover 用 store 数据，提供"全部已读"按钮，点击通知跳转对应询价详情
- 待办消息 Badge 用"待处理询价数 + 未读通知数"

### W3.4 系统设置持久化
- 修改 `src/pages/settings/index.tsx`：4 张卡片表单值用 `useSettingsStore`（新建，持久化到 localStorage key `settings`）
- 新建 `src/store/useSettingsStore.ts`：基本信息/询价规则/通知开关，`updateSettings(patch)` + saveJSON
- 询价规则值（默认有效期/截止提前天数/超时阈值）被创建询价单 BasicInfoStep 读取作为默认值
- 综合评分权重可编辑（受 W3.5 约束，见下）

### W3.5 loading 状态真实化
- 修改 `material/index.tsx`/`supplier/index.tsx`/`log/index.tsx`：`useState(false)` 改为 `useState(true)`，在 `useEffect` 中 setTimeout 300ms 模拟异步加载后置 false（模拟后端延迟，为 W6 真实异步做准备）
- list/dashboard/pending 已有数据驱动，补充初始 loading

### W3.6 物料管理页批量导入
- 修改 `src/pages/material/index.tsx`：增加"批量导入"按钮，复用 inquiry/create/MaterialStep 的 Excel 解析逻辑（抽到 `src/utils/materialImport.ts` 公共工具）
- 抽取 `src/utils/materialImport.ts`：`parseMaterialFile(file): Promise<Material[]>`
- 导入弹窗：上传文件 → 预览解析结果 → 确认批量 addMaterial

### W3.7 采购评语持久化校验
- 验证 `quotation/compare` 的评语 onBlur 已用 `updateInquiry` 持久化（探索显示已实现），补充防抖与错误提示

---

## 工作流 W4：权限与角色（P2）

### W4.1 权限模型与 store
- `src/types/index.ts` 增加 `Role = 'BUYER'|'MANAGER'|'ADMIN'`、`Permission` 联合类型、`PermissionMap`
- `src/mock/users.ts` 扩展：多用户含不同 role，`permissions: Permission[]`
- 新建 `src/store/useAuthStore.ts`：`currentUser`、`login(userId)`、`logout`、`hasPermission(perm)`、`isRole(role)`，持久化当前登录用户
- 新建 `src/utils/permissions.ts`：权限常量定义（INQUIRY_CREATE/INQUIRY_APPROVE/INQUIRY_CANCEL/SUPPLIER_MANAGE/SETTINGS_MANAGE/VIEW_ALL_ORG 等）+ 角色默认权限矩阵

### W4.2 登录页
- 新建 `src/pages/login/index.tsx`：用户选择（Select 现有 mock 用户）+ 简单密码（任意）登录，登录后写 useAuthStore 跳 dashboard
- 路由增加 `/login`（独立，不套 MainLayout）
- 新建 `src/components/RequireAuth.tsx`：路由守卫，未登录跳 `/login`，无权限跳 `/403`

### W4.3 路由守卫与按钮级权限
- 修改 `src/router/index.tsx`：主端路由外层包 `<RequireAuth>`，敏感路由（settings/supplier 管理）加 permission 校验
- 新建 `src/components/Permission.tsx`：`<Permission perm="INQUIRY_APPROVE">{children}</Permission>` 无权限不渲染
- 各页面按钮用 Permission 包裹：创建询价单（BUYER+）、确认定标/审批（MANAGER+）、启用/停用供应商（ADMIN）、系统设置（ADMIN）
- `MainLayout` 用户菜单显示角色，切换用户（演示用）

### W4.4 多组织与管理员视角
- 管理员（ADMIN）`hasPermission('VIEW_ALL_ORG')` 时 `visibleInquiries` 不过滤组织
- 采购主管可看下属采购员的询价单（简化：同组织全部可见）

### W4.5 无权限页
- 新建 `src/pages/forbidden/index.tsx`：403 Result
- 路由 `/403`

---

## 工作流 W5：审批流程（P2）

### W5.1 审批数据模型
- `src/types/index.ts` 增加 `ApprovalNode`：id/inquiryId/nodeOrder/approverId/approverName/approverRole/status(PENDING/APPROVED/REJECTED/SKIPPED)/comment/time
- `Inquiry` 增加 `approvalNodes: ApprovalNode[]`、`approvalConfig: { enabled: boolean; approverIds: string[] }`
- 询价单状态增加中间态（复用 PENDING_CONFIRM 或新增 PENDING_APPROVAL——决策：新增 `InquiryStatus.PENDING_APPROVAL`）

### W5.2 审批配置
- `src/pages/settings/index.tsx` 增加"审批流程设置"Card：开关 + 审批人选择（多选用户）
- 配置存入 `useSettingsStore`

### W5.3 审批操作
- 报价对比页"确认定标"前：若审批开启，改为"提交审批"，生成 approvalNodes，状态置 PENDING_APPROVAL，记录日志 + 通知
- 新建 `src/pages/approval/index.tsx`：待我审批列表（approvalNodes 中 approverId===currentUser 且 status=PENDING 的询价单）
- 审批操作：同意（推进下一节点）/驳回（置回询价中或取消）/加签（可选，简化不做）
- 路由 `/approval`，加入 MainLayout 菜单"审批管理"（仅 MANAGER+ 可见）

### W5.4 时间轴扩展
- 修改 `inquiry/detail` 的 Timeline：增加审批节点（提交审批/审批通过/审批驳回），按 LogType 扩展 APPROVE/REJECT

### W5.5 store 扩展
- `useInquiryStore` 增加 `submitForApproval(inquiryId, approverIds)`、`approveNode(inquiryId, comment)`、`rejectApproval(inquiryId, comment)`
- 联动 `useNotificationStore`

---

## 工作流 W6：消息通知系统（P2，W3.3 已建基础）

### W6.1 通知中心页
- 新建 `src/pages/notification/index.tsx`：全部通知列表，筛选（未读/全部/按类型），标记已读，批量已读，点击跳转
- 路由 `/notification`，加入 MainLayout 菜单（或在顶部铃铛"查看全部"跳转）

### W6.2 通知触发点全覆盖
- 询价发送、供应商报价提交、报价截止临近（定时检查）、审批提交/通过/驳回、选择供应商、确认定标、取消——均 addNotification
- 即将超时通知：新建 `src/utils/deadlineWatcher.ts`，在 dashboard 加载时检查 24h 内截止的询价单，补发通知（去重）

### W6.3 通知偏好
- `useSettingsStore` 通知开关生效：关闭的类型不生成通知（在 addNotification 前判断）

---

## 工作流 W7：接入真实后端（W3/W4/W5 之后做，避免重复改动）

### W7.1 API 抽象层
- 安装 axios + @tanstack/react-query
- 新建 `src/api/client.ts`：axios 实例，baseURL 用 `import.meta.env.VITE_API_BASE`，拦截器（错误统一 notifyError）
- 新建 `src/api/inquiryApi.ts`/`supplierApi.ts`/`quotationApi.ts`/`materialApi.ts`/`authApi.ts`/`notificationApi.ts`：CRUD 接口函数
- 新建 `src/api/types.ts`：接口请求/响应类型（与 src/types 对齐，可复用）

### W7.2 React Query 集成
- `main.tsx` 包 `QueryClientProvider`
- 各 store 改造：保留 zustand 做本地状态/缓存，数据获取改用 `useQuery`/`useMutation` 调 api 层
- 决策：store 不立即删除，作为 Query 的本地缓存层过渡；mutation 成功后 invalidate query

### W7.3 MSW Mock Server
- 安装 msw
- 新建 `src/mocks/handlers.ts`：覆盖全部 api 接口，用现有 mock 数据返回
- 新建 `src/mocks/browser.ts`：`setupWorker(handlers)`
- `main.tsx` 根据 `import.meta.env.VITE_USE_MOCK !== 'false'` 启用 worker
- 新建 `.env.development`（VITE_USE_MOCK=true）、`.env.production`（VITE_USE_MOCK=false）
- `package.json` 增加 `msw init public/` 已执行

### W7.4 环境变量与切换
- `src/api/client.ts` 根据 `VITE_USE_MOCK` 决定走 MSW 还是真实 baseURL
- README 说明切换方式

### W7.5 真实异步加载
- W3.5 的 setTimeout 模拟 loading 替换为真实 `useQuery` 的 `isLoading`
- 错误态用 antd Result + 重试按钮（网络异常态，补齐 checklist 的"网络异常状态"）

---

## 工作流 W8：数据层健壮性

### W8.1 localStorage 版本号
- 修改 `src/utils/storage.ts`：增加 `SCHEMA_VERSION = 2`，每个 key 存 `{ v: number, data: T }`
- `loadJSON` 检测版本不匹配时返回 fallback（丢弃旧数据）并 console.warn
- 新建 `src/utils/migration.ts`：可选的迁移函数注册表（为未来 schema 变更预留）

### W8.2 数据重置入口
- `src/pages/settings/index.tsx` 增加"数据管理"Card：清空本地草稿、重置全部数据到初始 mock（清空 localStorage 所有 procurement_ 前缀 key 后 reload）
- 用 `confirmAction` 二次确认

### W8.3 store 初始化健壮性
- 各 store 的 merge 函数改为带版本号 loadJSON，旧数据自动失效

---

## 工作流 W9：AI 智能化（P2，用本地规则引擎模拟，接口预留真实 LLM）

### W9.1 AI 服务层
- 新建 `src/services/aiService.ts`：三个方法 `generateInquiryDescription(items, subject)`、`analyzeQuotationAnomalies(inquiry, quotations)`、`generateCompareConclusion(compareData)`
- 实现：基于规则的中文文本生成（模板 + 数据填充），非真实 LLM；接口签名预留 async，后续可替换为 fetch LLM
- 新建 `src/services/aiService.real.ts`（占位，注释说明如何接入真实 LLM，不启用）

### W9.2 询价说明生成
- `src/pages/inquiry/create/BasicInfoStep.tsx`：询价说明 textarea 旁加"AI 生成"按钮，点击调 aiService，loading 生成后填入 textarea，可编辑

### W9.3 报价异常分析
- `src/pages/quotation/compare/index.tsx`：增加"AI 分析异常"按钮，调 aiService.analyzeQuotationAnomalies，弹 Modal 展示分析报告（异常高价/低价/交货周期异常/偏离项汇总 + 建议）

### W9.4 比价结论生成
- `SummaryModal` 增强：现有模板摘要改为调 aiService.generateCompareConclusion，生成更自然的中文结论段落（推荐供应商 + 理由 + 风险提示），可复制可导出

### W9.5 AI 标识与降级
- AI 生成内容用 Tag 标注"AI 生成"
- aiService 失败时降级为模板文本 + notifyWarning

---

## 工作流 W10：其他增强

### W10.1 导出功能增强
- 询价详情页增加"导出 PDF"：用浏览器 `window.print()` + 打印样式（新建 `src/styles/print.css`），或用 html2canvas+jsPDF（决策：先用 print 样式，零新依赖）
- 报价对比导出 Excel 增加更多维度（已有 3 sheet，补充采购评语 sheet）

### W10.2 移动端适配
- 全局 `src/styles/global.css` 增加 < 768px 断点：侧边栏改为抽屉式（Drawer），表格卡片化（antd Table 的 `responsive` 属性），表单单列
- 各页面栅格补充 xs 断点

### W10.3 抽取重复工具
- 新建 `src/utils/inquiryStatus.ts`：`isEditable(status)`/`isCancelable(status)`/`isInProgress(status)`，替换 list 与 detail 中的重复定义
- 新建 `src/utils/file.ts`：`formatFileSize`/`fileToAttachment`，从 detail 与 create/shared 中提取

### W10.4 工作台增强
- 增加"快捷操作"区（新建询价/待回收报价/审批待办入口卡片）
- 统计卡片增加环比（本月 vs 上月，用 mock 数据模拟）

---

## 执行顺序与依赖

1. **W1 工程化补全**（无依赖，先行）→ 为后续改动提供 lint/test 保障
2. **W8 数据层健壮性**（无依赖）→ 版本号机制保护后续 schema 变更
3. **W2 性能优化**（无依赖）
4. **W3 占位修复**（依赖 W8 的 settings store）
5. **W4 权限**（依赖 W3.2 组织隔离）
6. **W6 消息通知**（依赖 W3.3 通知 store 基础）
7. **W5 审批流程**（依赖 W4 权限 + W6 通知）
8. **W9 AI**（无强依赖，可与 W5/W6 并行）
9. **W10 其他增强**（收尾）
10. **W7 接后端**（最后，将前面所有本地逻辑迁到 API 层）—— 决策：W7 放最后，避免与 W3-W6 的本地逻辑改造重复冲突

## 验证步骤

每个工作流完成后：
1. `npm run lint`（0 error 0 warning）
2. `npm run test`（新增测试通过）
3. `npm run build`（通过，chunk 体积下降）
4. `npm run dev` 浏览器实测关键路径：
   - W3 后：全局搜索可跳转、组织切换过滤、通知联动、设置持久化刷新生效
   - W4 后：登录/登出、无权限按钮隐藏、403 页
   - W5 后：提交审批→主管审批→定标全流程
   - W6 后：通知中心、未读计数
   - W9 后：AI 生成说明/分析/结论
   - W7 后：MSW 启用下全流程跑通，关闭 MSW 切真实 baseURL 可用
5. 全部完成后对照 `checklist.md` 二次复核 + 更新 README

## 关键文件清单（新增/修改）

**新增**：
- `eslint.config.js`、`.prettierrc.json`、`.prettierignore`、`.husky/pre-commit`、`.gitattributes`
- `vitest.config.ts`、`src/test/setup.ts`、`src/**/__tests__/*.test.ts(x)`
- `README.md`
- `src/components/RouteSuspense.tsx`、`GlobalSearch.tsx`、`RequireAuth.tsx`、`Permission.tsx`
- `src/utils/echarts.ts`、`materialImport.ts`、`permissions.ts`、`inquiryStatus.ts`、`file.ts`、`migration.ts`、`deadlineWatcher.ts`
- `src/store/useAuthStore.ts`、`useNotificationStore.ts`、`useSettingsStore.ts`
- `src/pages/login/index.tsx`、`approval/index.tsx`、`notification/index.tsx`、`forbidden/index.tsx`
- `src/api/client.ts`、`inquiryApi.ts`、`supplierApi.ts`、`quotationApi.ts`、`materialApi.ts`、`authApi.ts`、`notificationApi.ts`、`types.ts`
- `src/mocks/handlers.ts`、`browser.ts`
- `src/services/aiService.ts`、`aiService.real.ts`
- `src/styles/print.css`
- `.env.development`、`.env.production`

**修改**：
- `package.json`（依赖 + scripts）
- `vite.config.ts`（manualChunks + chunkSizeWarningLimit + drop console）
- `tsconfig.json`（vitest types）
- `src/router/index.tsx`（懒加载 + 守卫 + 新路由）
- `src/utils/storage.ts`（版本号）
- `src/types/index.ts`（Role/Permission/Notification/ApprovalNode/新状态）
- `src/store/useInquiryStore.ts`（审批 actions + 组织过滤 + 通知联动）
- `src/store/useUIStore.ts`、`useSupplierStore.ts`、`useQuotationStore.ts`、`useMaterialStore.ts`（版本号 + 组织）
- `src/layouts/MainLayout.tsx`（全局搜索 + 通知联动 + 权限菜单）
- `src/pages/dashboard/index.tsx`（echarts 按需 + 组织过滤 + 快捷操作）
- `src/pages/inquiry/list/index.tsx`、`detail/index.tsx`、`create/index.tsx`、`create/BasicInfoStep.tsx`、`create/shared.ts`（权限 + AI + 组织）
- `src/pages/quotation/compare/index.tsx`、`pending/index.tsx`（权限 + AI + 组织）
- `src/pages/supplier/index.tsx`、`detail/index.tsx`、`material/index.tsx`、`log/index.tsx`、`settings/index.tsx`（权限 + 持久化 + 批量导入 + loading）
- `src/pages/supplier-portal/index.tsx`（权限）
- `src/main.tsx`（QueryClientProvider + MSW + Auth 初始化）
