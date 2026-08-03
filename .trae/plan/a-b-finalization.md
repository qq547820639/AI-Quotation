# A+B 收尾执行计划

> 更新时间：2026-08-04 | 状态已核对实际代码：A 联调验证 ✅、B4 主题色迁移 ✅、B5 PDF 导出 ✅、B6 图表增强 ✅、B7 移动端 ✅、B-V 最终验证 ✅（lint/tsc/vitest/build 全过）

> 承接 `backend-implementation-and-frontend-enhancement.md`：Phase A（FastAPI 后端）✅ 完成；Phase B 中 B1 i18n 基建 ✅、B2 i18n 迁移 ✅、B3 主题切换基建 ✅ 完成。
> 本计划覆盖剩余 **A 联调验证 + B4~B7 + B-V 最终验证**，目标：真实后端联调通过 + 暗色主题全站生效 + PDF 导出 + 增强图表 + 移动端细化，达到企业级交付态。

---

## 一、当前精确状态盘点

| 阶段 | 子任务 | 状态 | 说明 |
|---|---|---|---|
| A | 后端 38 端点 | ✅ | FastAPI + SQLAlchemy + SQLite，7 router 文件，RBAC，种子数据 |
| A | token 持久化 | ✅ | `useAuthStore.ts:65` 已写 `procurement_token` |
| A | 4 stub 端点补完整 | ✅ | toggle-status / quotation submit / materials batch / settings PUT |
| A | 联调配置 | ✅ | vite.config.ts proxy + .env 环境变量就绪 |
| A | **端到端联调验证** | ❌ | 未实际启动后端 + 前端跑通全流程 |
| B1 | i18n 基建 | ✅ | i18next + react-i18next + zh-CN/en-US locale |
| B2 | i18n 文案迁移 | ✅ | 20+ 页面 + 枚举 LABEL 已迁移 |
| B3 | 主题切换基建 | ✅ | useThemeStore + antd darkAlgorithm + CSS 变量双轨 + MainLayout 切换按钮 |
| B4 | 主题色值迁移 | ❌ | **160 处硬编码色值** 分布 23 文件；无 `useChartColors` hook |
| B5 | PDF 导出升级 | ❌ | 仅 `inquiry/detail:549` 1 处 `window.print()`；未装 jspdf/html2canvas |
| B6 | 图表增强 | ❌ | echarts.ts 仅注册 Pie/Line；dashboard 仅 2 图；缺 Bar/Funnel |
| B7 | 移动端细化 | ❌ | 无 useBreakpoint/useIsMobile；仅 768px 单断点；表格未卡片化 |
| B-V | 最终验证 | ❌ | lint/tsc/vitest/build + 五项实测未跑 |

---

## 二、执行总顺序（依赖链）

```
A-Verify  联调验证（后端启动 + 前端关 MSW 跑全流程 + 修联调断点）
   │
   ▼
B4  主题色值迁移（160 处 → CSS 变量 + useChartColors hook）
   │   └─ 先建 useChartColors，再批量替换，最后 ECharts 接入
   ▼
B6  图表增强（依赖 B4 的 useChartColors）
   │   └─ 注册 Bar/Funnel，dashboard 新增 3 图
   ▼
B5  PDF 导出升级（独立，装依赖 + 封装 pdf.ts + 替换 window.print）
   │
   ▼
B7  移动端细化（独立，建 useIsMobile + 断点 + 表格卡片化 + Drawer 全屏）
   │
   ▼
B-V 最终验证（lint/tsc/vitest/build + i18n/主题/PDF/图表/移动端/联调实测）
```

> **依赖说明**：B6 依赖 B4（图表颜色需 useChartColors）；其余可并行。A-Verify 放首位因联调可能暴露后端/前端断点需修。

---

## 三、详细任务分解

### A-Verify：端到端联调验证

**目标**：确认 FastAPI 后端 + 前端（关 MSW）全流程跑通

**步骤**：
1. 启动后端：`cd backend && bash run.sh`（uvicorn :8080）
2. 前端配置：`.env.development.local` 设 `VITE_ENABLE_MSW=false` + `VITE_API_PROXY_TARGET=http://localhost:8080`
3. 启动前端：`npm run dev`
4. 全流程验证：
   - 登录（5 种子用户）→ 工作台数据加载
   - 创建询价 → 保存草稿 → 发送 → 供应商报价 → 对比 → 审批 → 定标
   - 通知中心、设置持久化、物料批量导入、供应商启停
5. 4 stub 端点重点验证：
   - `POST /suppliers/:id/toggle-status` → cooperationStatus 实际变化
   - `POST /quotations/:id/submit` → status=SUBMITTED + inquiry 日志含 SUBMIT_QUOTATION
   - `POST /materials/batch` → DB 实际写入
   - `PUT /settings` → GET 返回更新值
6. 401/403 验证：无 token → 401；采购人员访问 settings → 403
7. 修复联调中暴露的断点（字段映射、状态机、CORS 等）

**预期产出**：联调通过，或发现断点并修复

---

### B4：主题色值迁移（160 处 → CSS 变量）

**目标**：暗色模式全站生效，无亮色残留

**步骤**：

#### B4.1：创建 `useChartColors` hook
- **文件**：新建 `src/utils/useChartColors.ts`
- **内容**：从 `useThemeStore` 读取 mode，返回对应主题的 8 色色板数组
- **色板来源**：读取 `global.css` 中 `--chart-color-1` ~ `--chart-color-8` CSS 变量（通过 `getComputedStyle`），或直接映射 themeStore.mode 到硬编码色板数组（更可靠，避免 Canvas 读 CSS 变量问题）
- **实现**：
  ```typescript
  const LIGHT_COLORS = ['#165dff', '#00b42a', '#ff7d00', '#f53f3f', '#722ed1', '#0fc6c2', '#eb2f96', '#faad14'];
  const DARK_COLORS = ['#4080ff', '#23c343', '#ff9a2e', '#f76965', '#a471f5', '#37d4cf', '#f77ebe', '#ffc60a'];
  export function useChartColors(): string[] {
    const mode = useThemeStore((s) => s.mode);
    return mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  }
  ```

#### B4.2：批量替换硬编码色值（23 文件，160 处）
- **替换映射**（主要）：
  | 硬编码 | CSS 变量 |
  |---|---|
  | `#165DFF` / `#165dff` | `var(--color-primary)` |
  | `#00B42A` / `#00b42a` | `var(--color-success)` |
  | `#FF7D00` / `#ff7d00` | `var(--color-warning)` |
  | `#F53F3F` / `#f53f3f` | `var(--color-error)` |
  | `#4E5969` / `#86909C` | `var(--color-text-secondary)` |
  | `#E5E6EB` / `#F2F3F5` | `var(--color-border)` / `var(--color-bg)` |
  | `#FFFFFF` / `#fff`（背景） | `var(--color-card)` |
  | `#F5F7FA` / `#F7F8FA` | `var(--color-bg)` |
  | `rgba(22,93,255,0.x)` | `var(--color-primary-bg)`（新增变量） |
- **重点文件**（按色值密度）：
  - `dashboard/index.tsx`（24 处，含 ECharts 配色）
  - `settings/index.tsx`（21 处）
  - `inquiry/list/index.tsx`（11 处）
  - `MainLayout.tsx`（5 处）
  - `approval/index.tsx`（5 处）
  - `quotation/pending/index.tsx`（5 处）
  - `quotation/compare/index.tsx`（5 处）
  - `supplier/index.tsx`（4 处）
  - 其余 15 文件各 1-7 处
- **ECharts 特殊处理**：dashboard 中 ECharts color 数组改用 `useChartColors()` 返回值，不用 CSS 变量（Canvas 限制）
- **antd 内置色**：`#001529`（Sider dark 主题）保留，属 antd Menu theme="dark" 固定色

#### B4.3：global.css 补充缺失变量
- 新增 `--color-primary-bg`（主色浅底）、`--color-card-border` 等中间变量
- 确保暗色模式下所有变量都有覆盖

**验证**：切换暗色模式，全站无亮色残留（含 ECharts 图表）

---

### B6：图表增强（依赖 B4）

**目标**：dashboard 从 2 图增至 5 图，数据可视化丰富

**步骤**：

#### B6.1：echarts.ts 补注册
- **文件**：`src/utils/echarts.ts`
- **新增**：`BarChart`、`FunnelChart` + `VisualMapComponent`（如需）
- **保留**：Pie/Line/Grid/Title/Tooltip/Legend/CanvasRenderer

#### B6.2：dashboard 新增 3 个图表
- **文件**：`src/pages/dashboard/index.tsx`
- **新增图表**：
  1. **供应商报价频次 Top10**（横向 BarChart）
     - 数据源：`inquiries.flatMap(i => i.invitedSupplierIds)` 统计频次，取 Top10
     - 配色：`useChartColors()` 渐变
  2. **物料品类分布**（PieChart / Rose 模式）
     - 数据源：`inquiries.flatMap(i => i.items).map(it => it.category)` 统计
     - 复用现有 Pie 注册
  3. **询价审批漏斗**（FunnelChart）
     - 数据源：按 InquiryStatus 流转统计（DRAFT→PENDING_SEND→INQUIRING→ALL_QUOTED→PENDING_APPROVAL→COMPLETED）
     - 展示转化率
- **布局**：原有 2 图占第一行，新增 3 图占第二行（或 3+2 布局，antd Row/Col 响应式）
- **复用**：现有 ECharts resize/dispose 模式（useEffect + ResizeObserver）

**验证**：dashboard 显示 5 图，暗色下颜色正确

---

### B5：PDF 导出升级

**目标**：真实导出 PDF 文件，非浏览器打印对话框

**步骤**：

#### B5.1：安装依赖
- `npm install jspdf html2canvas`

#### B5.2：封装 `src/utils/pdf.ts`
- **API**：`exportElementToPDF(element: HTMLElement, filename: string): Promise<void>`
- **实现**：
  ```typescript
  import jsPDF from 'jspdf';
  import html2canvas from 'html2canvas';

  export async function exportElementToPDF(element: HTMLElement, filename: string) {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#fff',
      logging: false,
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(filename);
  }
  ```

#### B5.3：替换 inquiry/detail 的 window.print
- **文件**：`src/pages/inquiry/detail/index.tsx:549`
- **改动**：
  - `else if (key === 'pdf') exportElementToPDF(detailRef.current, `询价单-${inquiry.code}.pdf`)`
  - 用 `useRef` 标记需导出的 DOM 区域（询价详情卡片）
  - 添加 loading 态（Spin）防重复点击
- **保留**：`print.css` 作为降级方案（window.print 仍可通过其他入口触发）

**局限**：html2canvas 对 box-shadow 支持不佳，需实测调优

**验证**：inquiry/detail 导出 PDF，内容完整含图表

---

### B7：移动端细化

**目标**：移动端各页面布局正常，表格卡片化，Drawer 全屏

**步骤**：

#### B7.1：创建 `useIsMobile` hook
- **文件**：新建 `src/utils/useIsMobile.ts`
- **实现**：封装 antd `Grid.useBreakpoint`，返回 `isMobile`（xs/sm 以下）+ `isTablet`
  ```typescript
  import { Grid } from 'antd';
  export function useIsMobile() {
    const screens = Grid.useBreakpoint();
    return !screens.md; // md=768 以下为 mobile
  }
  ```

#### B7.2：global.css 补断点与安全区
- **文件**：`src/styles/global.css`
- **新增**：
  - 576px / 992px / 1200px 三档断点媒体查询
  - `body { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }`
  - mobile-first 字号 token（`--font-size-sm`、`--font-size-base` 等）

#### B7.3：MainLayout 移动端优化
- **文件**：`src/layouts/MainLayout.tsx`
- **改动**：
  - Header 工具栏移动端折叠：组织选择/消息/通知/头像收进「更多」Dropdown
  - 替换现有 `window.matchMedia('(max-width: 768px)')` 为 `useIsMobile()`
  - 搜索框移动端改为图标触发（点击展开 Input）

#### B7.4：列表页表格卡片化
- **文件**：`inquiry/list`、`supplier/index`、`material/index`、`quotation/pending`
- **改动**：用 `useIsMobile()` 判断，xs 以下渲染 Card 列表（提取关键字段），md 以上渲染原 Table
- **实现**：条件渲染两套，不替换 antd Table
  ```tsx
  {isMobile ? <CardList data={data} /> : <Table columns={columns} />}
  ```

#### B7.5：Modal/Drawer 移动端全屏化
- **文件**：各页面的 Modal/Drawer（SupplierQuotationDrawer、SummaryModal、创建询价预览等）
- **改动**：`width={isMobile ? '100%' : 720}`、`style={{ top: isMobile ? 0 : 100 }}`

#### B7.6：SupplierLayout + supplier-portal 响应式
- **文件**：`src/layouts/SupplierLayout.tsx`、`src/pages/supplier-portal/index.tsx`
- **改动**：
  - SupplierLayout：Header 高度/padding 移动端缩小
  - supplier-portal：报价表单用 antd栅格，移动端单列

**验证**：Chrome DevTools 移动端模拟，各页面布局正常

---

### B-V：最终验证

**目标**：lint/tsc/vitest/build 全过 + 六项实测

**步骤**：

1. **代码质量**：
   - `npm run lint` — 0 error / 0 warning
   - `npx tsc --noEmit` — 0 error
   - `npx vitest run` — 全部通过（i18n/主题/PDF/移动端改造后测试不回归）
   - `npm run build` — 通过

2. **功能实测**：
   - **i18n**：切 English 全站无中文残留（除 mock 业务数据）；切回中文正常
   - **主题**：切暗色全站无亮色残留（含 ECharts 5 图）；刷新保持
   - **PDF**：inquiry/detail 导出 PDF 文件，内容完整含图表
   - **图表**：dashboard 显示 5 图（原 2 + 新 3），暗色下颜色正确
   - **移动端**：DevTools 模拟，各页面布局正常，表格卡片化，Drawer 全屏
   - **联调**：后端 + 前端（关 MSW）全流程跑通

3. **修复验证中发现的回归**

**预期产出**：全部通过，系统达企业级交付态

---

## 四、假设与决策

1. **useChartColors 色板**：硬编码 light/dark 两套色板数组（不读 CSS 变量），因 Canvas 不解析 `var()`，且 `getComputedStyle` 在 SSR/初始化时可能为空
2. **表格卡片化**：useIsMobile 条件渲染两套（Card + Table），不替换 antd Table，保留桌面端完整功能
3. **PDF 降级**：保留 print.css + window.print 作为 PDF 导出失败的降级方案
4. **移动端断点**：沿用 antd Grid 断点（xs<576, sm≥576, md≥768, lg≥992, xl≥1200），useIsMobile = !md
5. **B4 色值替换范围**：仅替换业务组件内联样式中的硬编码色值；antd 组件自带色值（如 Sider #001529）不动；ECharts 用 useChartColors
6. **执行顺序**：A-Verify → B4 → B6（依赖 B4）→ B5 → B7 → B-V。B5/B7 可与 B4/B6 并行但为串行执行避免冲突
7. **联调断点修复**：A-Verify 中发现的断点就地修复，不单独开任务

---

## 五、验证清单

- [ ] A-Verify：后端启动 + 前端关 MSW 全流程跑通
- [ ] B4：160 处色值替换完成，useChartColors hook 可用
- [ ] B6：dashboard 5 图显示，echarts.ts 注册 Bar/Funnel
- [ ] B5：pdf.ts 封装完成，inquiry/detail 导出 PDF
- [ ] B7：useIsMobile hook，4 列表页卡片化，Drawer 全屏，安全区适配
- [ ] B-V：lint=0 / tsc=0 / vitest 全过 / build 通过
- [ ] B-V：i18n / 主题 / PDF / 图表 / 移动端 / 联调 六项实测通过
