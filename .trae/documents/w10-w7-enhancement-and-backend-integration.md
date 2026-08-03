# W10 前端增强 + W7 接入真实后端 实施计划

## 摘要

在 W1-W6、W8、W9 全部完成（工程化达标 + P2 能力完备 + AI 差异化）的基础上，执行最后两个工作流：
- **W10 前端增强收尾**：PDF 导出、移动端适配、工具抽取、工作台增强
- **W7 接入真实后端**：axios + React Query + MSW 架构升级，预留真实 API baseURL

执行顺序：W10 先行（低风险纯前端增强）→ W7 最后（架构升级，将 localStorage 数据层迁移到 API 层）。

---

## 当前状态分析

### 已完成（W1-W6, W8, W9）
- 16 个路由全部真实实现，无占位/stub
- 9 个 Zustand store，数据流：`src/mock/*` → store → localStorage 持久化（`procurement_` 前缀，SCHEMA_VERSION=2）
- RBAC 权限模型（3角色 + 12权限点 + 6页面按钮级权限）
- 审批流程、通知中心、AI 智能化（规则引擎模拟）
- 工程化：ESLint 0 warning、Vitest 60 passed、Vite manualChunks 分包

### 待完成缺口
| 缺口 | 当前状态 | 所属工作流 |
|---|---|---|
| PDF 导出 | 仅有 Excel 导出（xlsx 库），无 PDF | W10.1 |
| 移动端适配 | 仅 antd 栅格断点 + < 1024 折叠侧边栏，无 @media/抽屉式/表格卡片化 | W10.2 |
| 工具抽取 | isEditable/isCancelable 内联在 list/detail；formatFileSize 内联在 detail | W10.3 |
| 工作台快捷操作 | 无快捷操作卡片，无环比统计 | W10.4 |
| 真实后端接入 | 纯前端 + localStorage，无 axios/React Query/MSW | W7 |

---

## W10：前端增强收尾

### W10.1 导出功能增强

#### W10.1.1 询价详情页 PDF 导出
- **文件**：`src/pages/inquiry/detail/index.tsx`（修改）、`src/styles/print.css`（新建）
- **方案**：浏览器 `window.print()` + 打印样式（零新依赖）
- **What**：
  1. 新建 `src/styles/print.css`，定义 `@media print` 规则：隐藏侧边栏/顶部栏/操作按钮/分页器，内容区全宽，表格不换行截断
  2. `main.tsx` 导入 `import './styles/print.css'`
  3. detail 页面"导出"按钮改为 Dropdown，包含"导出 Excel"和"导出 PDF"两个选项
  4. "导出 PDF"调用 `window.print()`
- **Why**：零新依赖，利用浏览器原生打印能力，用户可选择"保存为 PDF"
- **How**：print.css 用 `@media print { .no-print { display: none !important; } }` 隐藏不需要打印的元素；detail 页面操作按钮区加 `className="no-print"`

#### W10.1.2 报价对比 Excel 导出增加评语 sheet
- **文件**：`src/pages/quotation/compare/index.tsx`（修改）
- **What**：在 `handleExport` 函数中，于现有 3 个 sheet 之后追加第 4 个 sheet "采购评语"
- **Why**：定标时评语是重要决策记录，需随对比表一起导出
- **How**：从 `inquiry.purchaserComments` 取数据，构造 `[{供应商名称, 评语}]` 行数组

### W10.2 移动端适配

#### W10.2.1 全局响应式样式
- **文件**：`src/styles/global.css`（修改）
- **What**：增加 `@media (max-width: 768px)` 断点规则
  - 隐藏侧边栏 Sider，改为 Drawer 抽屉式
  - 顶部工具栏元素垂直排列
  - 内容区 padding 缩小
- **How**：新增 `.mobile-hide` 工具类 + @media 规则

#### W10.2.2 MainLayout 侧边栏抽屉化
- **文件**：`src/layouts/MainLayout.tsx`（修改）
- **What**：
  1. 新增 `useBreakpoint` 自定义 Hook（监听 `window.matchMedia('(max-width: 768px)')`）
  2. 移动端时 Sider 改为 `<Drawer>` 组件，通过顶部菜单按钮控制开关
  3. 桌面端保持原有 Sider 行为
- **Why**：移动端屏幕窄，固定侧边栏占据过多空间
- **How**：`isMobile` 状态控制渲染 `<Sider>` 或 `<Drawer>`；Drawer placement="left"

#### W10.2.3 表格响应式
- **文件**：各页面表格组件（inquiry/list、supplier、material、log）
- **What**：antd Table 添加 `scroll={{ x: 'max-content' }}` 确保横向滚动；关键表格添加 `responsive` 属性
- **Why**：移动端表格列多时无法显示，需横向滚动而非挤压

### W10.3 抽取重复工具

#### W10.3.1 inquiryStatus 工具
- **文件**：`src/utils/inquiryStatus.ts`（新建）、`src/pages/inquiry/list/index.tsx`（修改）、`src/pages/inquiry/detail/index.tsx`（修改）
- **What**：抽取 `isEditable(status)`、`isCancelable(status)`、`isInProgress(status)` 到独立工具文件
- **Why**：list 和 detail 中有相同的内联定义，违反 DRY
- **How**：新建工具文件，list/detail 改为 import

#### W10.3.2 file 工具
- **文件**：`src/utils/file.ts`（新建）、`src/pages/inquiry/detail/index.tsx`（修改）
- **What**：抽取 `formatFileSize(bytes)` 到独立工具文件
- **Why**：detail 中有内联定义，可复用

### W10.4 工作台增强

#### W10.4.1 快捷操作卡片
- **文件**：`src/pages/dashboard/index.tsx`（修改）
- **What**：在统计卡片行下方、最近询价单上方，新增"快捷操作"卡片行（3-4 个入口）
  - 新建询价单（跳 /inquiry/create）
  - 待回收报价（跳 /quotation/pending）
  - 审批待办（跳 /approval，仅 INQUIRY_APPROVE 权限可见）
  - 通知中心（跳 /notification）
- **Why**：提升操作效率，减少导航层级

#### W10.4.2 统计卡片环比
- **文件**：`src/pages/dashboard/index.tsx`（修改）
- **What**：本月询价单数卡片增加环比指标（本月 vs 上月）
- **Why**：展示趋势变化，辅助决策
- **How**：从 inquiries 中按 createdAt 月份分组计算上月数量，显示 `+N%` 或 `-N%` Tag

---

## W7：接入真实后端

### 架构决策
- **开发环境**：MSW 拦截请求返回 mock 数据（保持零后端依赖）
- **生产环境**：通过 `VITE_API_BASE_URL` 环境变量切换到真实 API
- **数据层**：React Query 管理服务端状态（cache + invalidation），Zustand 仅保留 UI 状态
- **迁移策略**：渐进式迁移，store 保留作为 React Query 的缓存层适配器，降低改造风险

### W7.1 依赖安装与环境配置

#### W7.1.1 安装依赖
- **文件**：`package.json`（修改）
- **What**：安装 `axios`、`@tanstack/react-query`、`msw`（devDependency）
- **命令**：`npm install axios @tanstack/react-query && npm install -D msw`

#### W7.1.2 环境变量文件
- **文件**：`.env.development`（新建）、`.env.production`（新建）
- **What**：
  - `.env.development`：`VITE_API_BASE_URL=/api`、`VITE_ENABLE_MSW=true`
  - `.env.production`：`VITE_API_BASE_URL=https://api.example.com`、`VITE_ENABLE_MSW=false`

#### W7.1.3 MSW 初始化
- **文件**：`src/mocks/browser.ts`（新建）、`src/mocks/handlers.ts`（新建）
- **What**：
  - `browser.ts`：`setupWorker(...handlers)` 导出 worker
  - `handlers.ts`：定义各 API 端点的 mock handler（GET/POST/PUT/DELETE）
- **How**：handler 读取现有 `src/mock/*` 数据返回

### W7.2 API 层搭建

#### W7.2.1 axios client
- **文件**：`src/api/client.ts`（新建）
- **What**：创建 axios 实例，配置 baseURL（`import.meta.env.VITE_API_BASE_URL`）、请求/响应拦截器
- **Why**：统一错误处理、loading 状态、认证 token 注入

#### W7.2.2 各模块 API
- **文件**：`src/api/inquiryApi.ts`、`supplierApi.ts`、`quotationApi.ts`、`materialApi.ts`、`authApi.ts`、`notificationApi.ts`、`settingsApi.ts`、`logApi.ts`（新建）
- **What**：每个 API 文件导出 CRUD 函数，调用 axios client
- **Example**：
  ```typescript
  // src/api/inquiryApi.ts
  import { client } from './client';
  import type { Inquiry } from '@/types';
  
  export const inquiryApi = {
    list: () => client.get<Inquiry[]>('/inquiries').then(r => r.data),
    get: (id: string) => client.get<Inquiry>(`/inquiries/${id}`).then(r => r.data),
    create: (data: Omit<Inquiry, 'id'>) => client.post<Inquiry>('/inquiries', data).then(r => r.data),
    update: (id: string, data: Partial<Inquiry>) => client.put<Inquiry>(`/inquiries/${id}`, data).then(r => r.data),
    delete: (id: string) => client.delete(`/inquiries/${id}`),
  };
  ```

### W7.3 React Query 集成

#### W7.3.1 QueryClient 配置
- **文件**：`src/main.tsx`（修改）
- **What**：用 `QueryClientProvider` 包裹 App，配置 QueryClient（staleTime、refetchOnWindowFocus）

#### W7.3.2 MSW 启动逻辑
- **文件**：`src/main.tsx`（修改）
- **What**：开发环境下（`VITE_ENABLE_MSW=true`）异步启动 MSW worker 后再渲染应用
- **How**：
  ```typescript
  async function enableMocking() {
    if (import.meta.env.VITE_ENABLE_MSW !== 'true') return;
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
  
  enableMocking().then(() => {
    ReactDOM.createRoot(...).render(...);
  });
  ```

### W7.4 Store 迁移

#### 迁移策略（渐进式）
不一次性重写所有 store，而是**逐个迁移**，每个 store 迁移后立即验证：

1. **useInquiryStore**（最核心，先迁移）
   - 保留 store 结构，但初始化改为调用 `inquiryApi.list()`
   - 写操作（create/update/delete）先调 API，成功后更新 store 状态
   - 用 React Query 的 `useQuery` 包装读取、`useMutation` 包装写入
   
2. **useSupplierStore**、**useMaterialStore**、**useQuotationStore**（CRUD 类，一并迁移）
   
3. **useNotificationStore**、**useSettingsStore**（小数据量，最后迁移）

4. **useAuthStore**、**useUIStore**、**useLogStore**（UI 状态，保留 Zustand 不迁移）

#### 迁移后 localStorage 处理
- 保留 `useSettingsStore` 的 localStorage 持久化（用户偏好设置）
- 保留 `useAuthStore` 的 token 持久化
- 移除业务数据的 localStorage 持久化（inquiries/suppliers/materials/quotations 等改由 React Query 缓存管理）

### W7.5 vite.config.ts 代理配置
- **文件**：`vite.config.ts`（修改）
- **What**：开发环境添加 `/api` 代理到 MSW 或真实后端
- **How**：
  ```typescript
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5173', // MSW 拦截
        changeOrigin: true,
      },
    },
  },
  ```

---

## 假设与决策

### 决策
1. **PDF 导出方案**：`window.print()` + print.css（零新依赖），不引入 jspdf/html2canvas
2. **移动端断点**：768px（与 antd md 断点一致）
3. **侧边栏移动端方案**：Drawer 抽屉式，通过顶部按钮控制
4. **W7 数据源**：MSW 开发环境 mock + 生产环境预留 baseURL
5. **W7 迁移策略**：渐进式迁移，不一次性重写所有 store
6. **W7 React Query 范围**：仅业务数据（inquiries/suppliers/materials/quotations），UI 状态保留 Zustand

### 假设
1. 现有 60 个单元测试在迁移后需更新（mock 方式变化）
2. MSW handler 复用现有 `src/mock/*` 数据
3. 生产环境真实后端 API 契约需与 MSW handler 保持一致（本次不实现真实后端）

---

## 验证步骤

### W10 验证
1. `npm run lint` — 0 error 0 warning
2. `npm run test` — 全部通过
3. `npm run build` — 通过
4. 浏览器实测：
   - 询价详情页"导出 PDF"调用浏览器打印
   - 报价对比 Excel 导出包含评语 sheet
   - 移动端（< 768px）侧边栏变抽屉式
   - 工作台显示快捷操作卡片 + 环比指标

### W7 验证
1. `npm run lint` — 0 error 0 warning
2. `npm run test` — 全部通过（更新 mock 方式）
3. `npm run build` — 通过
4. 浏览器实测（MSW 启用）：
   - 网络面板可见 MSW 拦截的请求
   - 全流程跑通：登录→工作台→询价 CRUD→报价对比→审批→通知
5. 环境变量切换：`VITE_ENABLE_MSW=false` 时不启动 MSW，请求发往 `VITE_API_BASE_URL`

---

## 执行顺序

```
W10.3 工具抽取（无依赖，先行）
  → W10.1 导出增强（PDF + Excel评语）
  → W10.4 工作台增强
  → W10.2 移动端适配
  → W10 验证
  → W7.1 依赖安装 + 环境配置
  → W7.2 API 层搭建
  → W7.3 React Query 集成 + MSW
  → W7.4 Store 渐进式迁移
  → W7.5 代理配置 + 最终验证
```
