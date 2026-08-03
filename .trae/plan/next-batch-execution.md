# 下一批次执行计划：W1 工程化补全 + W3 占位修复

> 更新时间：2026-08-04 | 状态已核对实际代码：W1 工程化 ✅（ESLint/Prettier/Husky/Vitest/README）、W3 占位修复 ✅（假 loading 清理、MSW stub 修复）

## 一、当前进度盘点

| 工作流 | 状态 | 完成内容 |
|---|---|---|
| W2 性能优化 | ✅ 完成 | 路由懒加载、manualChunks 代码分割、ECharts 按需引入、生产 drop console |
| W8 数据层健壮性 | ✅ 完成 | storage.ts 版本号机制（SCHEMA_VERSION=2）、migration.ts 迁移注册表、settings 数据重置入口 |
| W1 工程化补全 | ❌ 未开始 | 无 ESLint/Prettier/Husky/Vitest/测试用例/README |
| W3 占位修复 | ❌ 未开始 | 见下方"已识别占位点" |

### 已识别的占位/假交互（W3 范围）

| 位置 | 占位表现 | 修复方向 |
|---|---|---|
| `MainLayout.tsx` L211-215 | `Input.Search` 无 onSearch，全局搜索无逻辑 | 接 GlobalSearch 组件 + Modal 结果跳转 |
| `MainLayout.tsx` L218-225 | 消息/通知 Badge count 硬编码 5/3，通知 List 硬编码 3 条 | 接 useNotificationStore 真实数据 |
| `MainLayout.tsx` L203-208 | 组织 Select 切换无数据过滤 | useInquiryStore 增加 visibleInquiries 选择器 |
| `settings/index.tsx` L50-82 | 4 张卡片全用 useState，保存只 notifySuccess 不持久化 | 接 useSettingsStore 持久化到 localStorage |
| `material/index.tsx` L71 | loading 恒 false | 初始 true + useEffect 模拟异步 |
| `material/index.tsx` | 无批量导入 | 增加"批量导入"按钮 + materialImport.ts 工具 |
| `supplier/index.tsx`、`log/index.tsx` | loading 恒 false | 同上，loading 真实化 |
| 各列表页 | 未按 currentOrganization 过滤 | 用 visibleInquiries 替代 inquiries |

---

## 二、本批次目标

1. **W1 工程化打底**：建立 lint + format + test + git hook 闭环，为后续大规模改动提供质量保障；补齐 README。
2. **W3 占位修复**：消灭全部已识别的假交互，让现有页面"真"起来——全局搜索可用、组织隔离生效、通知联动、设置持久化、loading 真实、物料批量导入可用。

完成后系统达到"工程化达标 + 无假交互"状态，为 W4 权限 / W5 审批 / W6 通知中心 铺平道路。

---

## 三、批次 A：W1 工程化补全

### A1. 代码规范工具链

**新增文件：**
- `eslint.config.js`（flat config）
  - 继承：`@typescript-eslint`、`react-hooks`、`react-refresh`、`prettier`（关闭与 Prettier 冲突的格式规则）
  - 规则：`no-unused-vars` warn、`react-hooks/exhaustive-deps` warn、`@typescript-eslint/no-explicit-any` error
  - 忽略 `dist/`、`node_modules/`、`vite.config.*`、`**/*.js`（保持 ts/tsx 主力）
- `.prettierrc.json`：`{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }`
- `.prettierignore`：`dist/`、`node_modules/`、`package-lock.json`、`*.tsbuildinfo`
- `.eslintignore`：`dist/`、`node_modules/`

**修改 `package.json`：**
- scripts 增加：`lint`、`lint:fix`、`format`、`format:check`
- devDependencies 增加：`eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`、`eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`、`eslint-config-prettier`、`prettier`

**验证：** `npm run lint` 初次运行可能有既有 warning，目标是 0 error；运行后用 `lint:fix` 自动修可修复项。

### A2. Git Hooks

**新增文件：**
- `.husky/pre-commit`：执行 `npx lint-staged`
- `.gitattributes`：`* text=auto eol=lf`

**修改 `package.json`：**
- devDependencies 增加：`husky`、`lint-staged`
- scripts 增加：`prepare`（`husky`）
- `lint-staged` 配置：`*.{ts,tsx}` → `eslint --fix` + `prettier --write`；`*.{json,css,md}` → `prettier --write`

### A3. 单元测试框架

**新增文件：**
- `vitest.config.ts`：复用 vite alias `@`，environment: jsdom，setupFiles: `src/test/setup.ts`，globals: true
- `src/test/setup.ts`：引入 `@testing-library/jest-dom`，扩展 expect matchers

**修改 `package.json`：**
- devDependencies 增加：`vitest`、`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`、`jsdom`
- scripts 增加：`test`（`vitest run`）、`test:watch`、`test:coverage`

**修改 `tsconfig.json`：** compilerOptions.types 增加 `"vitest/globals"`

### A4. 核心单元测试

**新增测试文件：**
- `src/utils/__tests__/format.test.ts`：formatCurrency / formatDate / formatPercent / getRemainingTime 边界用例
- `src/utils/__tests__/storage.test.ts`：loadJSON / saveJSON / removeKey / clearAll + 版本号不匹配回退 fallback
- `src/components/quotation/__tests__/scoreUtils.test.ts`：评分四项 + 总分、最低价 / 最快交货 / 异常判定、排序稳定性
- `src/pages/inquiry/create/__tests__/shared.test.ts`：computeSupplierMatches 匹配评分、buildInquiryCode、草稿序列化 / 反序列化

**验证：** `npm run test` 全部通过，覆盖率核心 utils > 80%。

### A5. README

**新增 `README.md`：** 项目简介、技术栈、目录结构、安装运行（dev/build/test/lint/preview）、环境变量说明、功能清单、模拟数据说明、后端 / AI 切换说明（指向 enhancement.md）、许可证 MIT。

### A6. W1 验证清单

- [ ] `npm run lint` 0 error
- [ ] `npm run test` 全绿
- [ ] `npm run build` 通过
- [ ] `git commit` 触发 pre-commit（lint-staged 执行）
- [ ] README 渲染正常

---

## 四、批次 B：W3 占位修复

### B1. 通知 store（W3.3 基础）

**新增 `src/types/index.ts` 扩展：**
```ts
export interface Notification {
  id: string;
  inquiryId?: string;
  type: 'inquiry_sent' | 'quotation_submitted' | 'deadline_approaching' | 'approval' | 'system';
  title: string;
  content: string;
  time: string; // ISO
  read: boolean;
}
```

**新增 `src/store/useNotificationStore.ts`：**
- 状态：`notifications: Notification[]`（初始化从 localStorage 加载，无则空数组）
- actions：`addNotification(payload)`（带去重：同 inquiryId+type 10 分钟内不重复）、`markRead(id)`、`markAllRead()`、`getUnreadCount()` selector
- 持久化到 localStorage key `notifications`

**修改 `src/store/useInquiryStore.ts`：** 在 `sendInquiry` / `submitQuotation` / `selectSupplier` / `confirmInquiry` / `cancelInquiry` 内部联动 `useNotificationStore.getState().addNotification(...)`（直接调 getState 避免循环依赖）。

### B2. 全局搜索（W3.1）

**新增 `src/components/GlobalSearch.tsx`：**
- 组件形态：受控 Modal，props `{ open, onClose }`
- 搜索范围：询价单（编号 / 主题）、供应商（名称）、物料（名称 / 编码）
- 数据来源：聚合 useInquiryStore / useSupplierStore / useMaterialStore
- 交互：输入关键词 → 实时过滤 → 分组展示（询价单 / 供应商 / 物料）→ 点击项跳转对应详情页并关闭 Modal
- 空状态：Empty

**修改 `src/layouts/MainLayout.tsx`：**
- `Input.Search` 增加 onSearch → 打开 GlobalSearch Modal（同时支持点击输入框直接打开）
- 移除占位，接入真实组件

### B3. 采购组织数据隔离（W3.2）

**修改 `src/store/useInquiryStore.ts`：**
- 新增 selector `visibleInquiries(currentOrganization: string)`：按 `inquiry.organization === currentOrganization` 过滤
- 预留：W4 完成后管理员角色在此 selector 内不再过滤（届时通过 useAuthStore 判断）

**修改各列表页：** 
- `dashboard/index.tsx`、`inquiry/list/index.tsx`、`quotation/pending/index.tsx`、`quotation/compare/index.tsx`（无 id 入口时）
- 从 `useUIStore` 取 `currentOrganization`，用 `visibleInquiries(currentOrganization)` 替代直接读 `inquiries`
- `MainLayout` 组织 Select 切换时，因 store 驱动自动生效，无需额外处理

### B4. 系统设置持久化（W3.4）

**新增 `src/store/useSettingsStore.ts`：**
```ts
interface Settings {
  organization: string;
  systemName: string;
  currency: Currency;
  validDays: number;
  deadlineLeadDays: number;
  timeoutThresholdHours: number;
  notifications: Record<string, boolean>;
}
```
- actions：`updateSettings(patch: Partial<Settings>)`
- 持久化到 localStorage key `settings`，带版本号

**修改 `src/pages/settings/index.tsx`：**
- 4 张卡片表单值全部从 `useSettingsStore` 读取，onChange 调 `updateSettings`
- 3 个"保存"按钮改为统一 `updateSettings` 后 notifySuccess
- "保存"语义优化：可改为 onChange 即时持久化 + 顶部统一"已保存"提示（决策：保留显式保存按钮，点击批量提交）
- 综合评分权重暂保持只读（W9 再开放）

**联动（轻量）：** `src/pages/inquiry/create/BasicInfoStep.tsx` 读取 `useSettingsStore` 的 `validDays` 作为默认报价有效期。

### B5. loading 状态真实化（W3.5）

**修改以下页面：**
- `material/index.tsx`、`supplier/index.tsx`、`log/index.tsx`
- `loading` 初始值改 `true`，`useEffect` 中 `setTimeout(() => setLoading(false), 300)` 模拟异步加载（为 W7 真实异步做准备）
- `dashboard/index.tsx`、`inquiry/list/index.tsx`、`quotation/pending/index.tsx`：补充初始 loading（已有数据驱动的保持，仅在首屏加 300ms skeleton）

### B6. 物料管理页批量导入（W3.6）

**新增 `src/utils/materialImport.ts`：**
```ts
export async function parseMaterialFile(file: File): Promise<Material[]> {
  // 复用 inquiry/create/MaterialStep 的 Excel 解析逻辑
  // 返回标准化 Material[]（不含 id，由调用方生成）
}
```

**抽取：** 将 `inquiry/create/MaterialStep.tsx` 中的 XLSX 解析逻辑抽到 `materialImport.ts`，原文件改为引用。

**修改 `src/pages/material/index.tsx`：**
- PageHeader extra 增加"批量导入"按钮
- 点击弹出 Modal：Upload（accept .xlsx,.xls）→ 解析 → 预览表格（前 10 行）→ 确认批量 `addMaterial`
- 解析失败：notifyError + 错误行号提示

### B7. 通知系统真实化（W3.3 剩余）

**修改 `src/layouts/MainLayout.tsx`：**
- 铃铛 Badge count 改用 `useNotificationStore.getUnreadCount()`
- Popover 内 List 改用 store 真实通知（最近 10 条），点击项跳转对应询价详情
- 增加"全部已读"按钮
- 消息图标 Badge：改用"待处理询价数"（pending 状态询价数）+ 未读通知数合并显示

### B8. W3 验证清单

- [ ] 全局搜索：输入关键词能出现询价单 / 供应商 / 物料分组，点击跳转
- [ ] 组织切换：切换后工作台 / 列表 / 待回收 / 对比页数据随之过滤
- [ ] 通知：发送询价后铃铛出现未读 + 列表新增条目，点击跳转，全部已读清零
- [ ] 设置持久化：修改设置 → 刷新页面 → 值保留
- [ ] loading：物料 / 供应商 / 日志页首屏 300ms 内有 loading 态
- [ ] 物料批量导入：上传 Excel → 预览 → 确认后物料列表新增
- [ ] `npm run lint` 0 error
- [ ] `npm run test` 全绿
- [ ] `npm run build` 通过

---

## 五、执行顺序（批次内）

1. **A1 → A2 → A3 → A4**：工程化工具链先就位，A4 测试用例可验证 utils 正确性
2. **A5**：README 最后写（包含最终状态）
3. **B1 通知 store** → **B3 组织隔离** → **B4 设置持久化**：store 层先改完
4. **B2 全局搜索** → **B7 通知真实化** → **B5 loading** → **B6 批量导入**：UI 层逐个修复
5. 每个子任务完成后 `npm run lint && npm run test && npm run build` 三连验证

---

## 六、后续批次预告（本批次完成后）

| 顺序 | 工作流 | 依赖 | 主要产出 |
|---|---|---|---|
| 1 | W4 权限与角色 | W3.2 组织隔离 | 登录页 / 路由守卫 / 按钮级权限 / RBAC |
| 2 | W6 消息通知系统 | W3.3 通知 store | 通知中心页 / 触发点全覆盖 / 通知偏好 / 超时巡检 |
| 3 | W5 审批流程 | W4 权限 + W6 通知 | 审批数据模型 / 审批操作 / 时间轴扩展 / 审批管理页 |
| 4 | W9 AI 智能化 | 无强依赖 | aiService / 询价说明生成 / 异常分析 / 比价结论 |
| 5 | W10 其他增强 | 收尾 | PDF 导出 / 移动端适配 / 工具抽取 / 工作台增强 |
| 6 | W7 接入真实后端 | 最后 | axios + React Query + MSW + 环境变量切换 |

---

## 七、风险与决策

1. **ESLint 初次运行可能有既有 warning**：目标 0 error，warning 逐步清零；`no-explicit-any` 设 error（项目已无 any）。
2. **组织隔离与权限耦合**：W3.3 阶段 visibleInquiries 先按组织过滤；W4 完成后管理员视角再放开，避免现在引入 auth 依赖。
3. **通知联动 store 循环依赖风险**：useInquiryStore 内部用 `useNotificationStore.getState()` 直接调用，不在模块顶层 import 实例，规避循环。
4. **物料批量导入与 create/MaterialStep 复用**：抽公共工具后两端共用，保证解析逻辑一致。
5. **loading 模拟延迟**：W7 接入真实后端后替换为 useQuery 的 isLoading，当前 300ms 仅作过渡。
