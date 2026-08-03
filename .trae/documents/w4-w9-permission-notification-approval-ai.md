# W4-W9 四工作流执行计划：权限 + 通知中心 + 审批 + AI

> 承接 `remaining-execution.md`：B2~B7 + 最终验证 ✅ 完成，系统已达「工程化达标 + 无假交互」交付态。
> 本计划覆盖 **W4 权限与角色 → W6 通知中心 → W5 审批流程 → W9 AI 智能化** 四个工作流，一次性落地全部 P2 能力，达到「企业级能力完备 + AI 差异化」产品态。

---

## 一、当前状态分析（基于 Phase 1 探索）

### 已就绪依托
| 依托 | 状态 | 位置 |
|---|---|---|
| `UserRole` 类型 | ⚠️ 仅 2 角色（采购人员/采购主管） | `types/index.ts:218` |
| `User` 接口 | ✅ 已有 id/name/avatar/role/department/organization | `types/index.ts:230-237` |
| mock 用户 5 个 + 3 组织 | ✅ | `mock/users.ts:27-57` |
| `getVisibleInquiries(organization)` | ✅ 已预留管理员视角注释 | `useInquiryStore.ts:65-66,92-93` |
| `useUIStore.currentOrganization` | ✅ 已被 5 个列表页消费 | `useUIStore.ts` |
| `useNotificationStore` | ✅ 完整（add/markRead/markAllRead/getUnreadCount） | `useNotificationStore.ts` |
| 通知触发点 5 处 | ✅ sendInquiry/cancelInquiry/selectSupplier/confirmInquiry/submitQuotation | `useInquiryStore.ts:163,191,221,248` + `useQuotationStore.ts:85` |
| `useSettingsStore.notifications` 开关 | ✅ 4 个开关已持久化 | `useSettingsStore.ts:26,36-41` |
| MainLayout 铃铛 Popover | ✅ 真实数据 + 全部已读 + 点击跳转 | `MainLayout.tsx:148-204,283-291` |
| `NotificationType.APPROVAL` 枚举 | ⚠️ 已定义但无触发点 | `types/index.ts:448` |
| `Inquiry` 接口 | ✅ 完整（无审批字段） | `types/index.ts:384-424` |
| detail 时间轴 | ✅ getTimelineColor + Timeline 渲染 | `detail/index.tsx:82-93,640-657` |
| BasicInfoStep description TextArea | ✅ L180-183 | `BasicInfoStep.tsx:180-183` |
| SummaryModal buildSummary | ✅ 模板摘要 | `SummaryModal.tsx:27-94` |
| compare headerExtra | ✅ L316-339（导出/摘要/定标按钮） | `quotation/compare/index.tsx:316-339` |

### 关键缺口
| 工作流 | 缺口 |
|---|---|
| **W4** | 无 useAuthStore / 无登录页 / 无 RequireAuth / 无 Permission 组件 / 无 permissions.ts / 菜单未按角色过滤 / 用户菜单无切换 / "退出登录"无行为 / 无 403 页 / 管理员视角未实现 |
| **W6** | 无独立通知中心页/路由/菜单 / 无 deadlineWatcher 超时巡检 / 通知开关未在 addNotification 前生效 / 无筛选批量已读分页 / 铃铛无"查看全部"链接 |
| **W5** | 无 ApprovalNode 类型 / Inquiry 无 approvalNodes/approvalConfig 字段 / 无 PENDING_APPROVAL 状态 / 无 LogType.APPROVE/REJECT / 无 submitForApproval/approveNode/rejectApproval actions / 无审批页 / settings 无审批配置 Card / detail 时间轴无审批节点 |
| **W9** | 无 src/services/ / 无 aiService / BasicInfoStep 无 AI 生成按钮 / compare 无 AI 分析按钮 / SummaryModal 无 AI 结论 / 无 AI 标识 Tag |

---

## 二、执行顺序与依赖链

```
W4 权限与角色（地基：useAuthStore + RequireAuth + Permission + 登录页 + 403 + 菜单过滤 + 管理员视角）
   └─> W6 通知中心（独立页 + deadlineWatcher + 开关生效 + 铃铛"查看全部"）
         └─> W5 审批流程（ApprovalNode + PENDING_APPROVAL + 审批 actions + 审批页 + 时间轴扩展 + settings 审批 Card）
               └─> W9 AI 智能化（aiService + BasicInfoStep AI 按钮 + compare AI 按钮 + SummaryModal AI 结论）
                     └─> 最终验证（lint/test/build + 手动回归）
```

> **依赖说明**：
> - W5 审批人 = MANAGER+，强依赖 W4 的角色权限模型
> - W5 审批通知用 `NotificationType.APPROVAL`，依赖 W6 的通知开关生效机制
> - W9 无强依赖，放最后可与 W5 收尾并行，但为避免 merge 冲突串行执行
> - 每完成一个工作流立即跑 `npm run lint && npm run test`，全部完成后再跑 build

---

## 三、W4 权限与角色

### W4.1 类型扩展（`src/types/index.ts`）

在 `UserRole`（L218）处扩展为 3 角色 + 新增 Permission 联合类型：

```ts
/** 用户角色（W4 扩展为 3 角色） */
export type UserRole = '采购人员' | '采购主管' | '管理员';

/** 权限点 */
export type Permission =
  | 'INQUIRY_CREATE'      // 创建询价单
  | 'INQUIRY_EDIT'        // 编辑询价单
  | 'INQUIRY_SEND'        // 发送询价
  | 'INQUIRY_APPROVE'     // 审批询价（W5 用）
  | 'INQUIRY_CONFIRM'     // 确认定标
  | 'INQUIRY_CANCEL'      // 取消询价
  | 'SUPPLIER_MANAGE'     // 供应商管理（增删改）
  | 'SUPPLIER_DISABLE'    // 启用/停用供应商（仅 ADMIN）
  | 'MATERIAL_MANAGE'     // 物料管理
  | 'SETTINGS_MANAGE'     // 系统设置（仅 ADMIN）
  | 'VIEW_ALL_ORG'        // 查看全部组织（仅 ADMIN）
  | 'VIEW_LOG';           // 查看操作日志

/** 角色默认权限矩阵 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  采购人员: ['INQUIRY_CREATE', 'INQUIRY_EDIT', 'INQUIRY_SEND', 'MATERIAL_MANAGE'],
  采购主管: [
    'INQUIRY_CREATE', 'INQUIRY_EDIT', 'INQUIRY_SEND', 'INQUIRY_APPROVE',
    'INQUIRY_CONFIRM', 'INQUIRY_CANCEL', 'MATERIAL_MANAGE', 'VIEW_LOG',
  ],
  管理员: [
    'INQUIRY_CREATE', 'INQUIRY_EDIT', 'INQUIRY_SEND', 'INQUIRY_APPROVE',
    'INQUIRY_CONFIRM', 'INQUIRY_CANCEL', 'SUPPLIER_MANAGE', 'SUPPLIER_DISABLE',
    'MATERIAL_MANAGE', 'SETTINGS_MANAGE', 'VIEW_ALL_ORG', 'VIEW_LOG',
  ],
};
```

`User` 接口（L230）扩展可选 `permissions` 字段（覆盖角色默认）：
```ts
export interface User {
  id: string;
  name: string;
  avatar?: string;
  role: UserRole;
  department: string;
  organization: string;
  /** 可选：覆盖角色默认权限（不填则用 ROLE_PERMISSIONS[role]） */
  permissions?: Permission[];
}
```

### W4.2 mock 用户扩展（`src/mock/users.ts`）

- 现有 5 用户保持，新增 1 个管理员用户：
```ts
/** 管理员 周大海 */
export const adminUser: User = {
  id: 'u-6',
  name: '周大海',
  avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=ZDH&backgroundColor=722ED1',
  role: '管理员',
  department: '信息中心',
  organization: '总部采购中心',
};
```
- `users` 数组追加 `adminUser`（共 6 用户）。
- `currentUser` 保持导出（作为 useAuthStore 未登录时的 fallback），但运行时登录态以 useAuthStore 为准。

### W4.3 useAuthStore（新建 `src/store/useAuthStore.ts`）

```ts
import { create } from 'zustand';
import { loadJSON, saveJSON, removeKey } from '@/utils/storage';
import { ROLE_PERMISSIONS, type Permission, type User, type UserRole } from '@/types';
import { currentUser, users } from '@/mock/users';

const STORAGE_KEY = 'auth';

interface AuthState {
  currentUser: User;
  isAuthenticated: boolean;
  login: (userId: string) => boolean;
  logout: () => void;
  hasPermission: (perm: Permission) => boolean;
  isRole: (role: UserRole | UserRole[]) => boolean;
  switchUser: (userId: string) => void; // 演示用快速切换
}

function loadAuthUser(): User {
  const saved = loadJSON<{ userId: string } | null>(STORAGE_KEY, null);
  if (saved?.userId) {
    const u = users.find((x) => x.id === saved.userId);
    if (u) return u;
  }
  return currentUser; // fallback
}

function resolvePermissions(user: User): Permission[] {
  return user.permissions ?? ROLE_PERMISSIONS[user.role] ?? [];
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: loadAuthUser(),
  isAuthenticated: loadJSON<{ userId: string } | null>(STORAGE_KEY, null) !== null,

  login: (userId) => {
    const u = users.find((x) => x.id === userId);
    if (!u) return false;
    saveJSON(STORAGE_KEY, { userId });
    set({ currentUser: u, isAuthenticated: true });
    return true;
  },

  logout: () => {
    removeKey(STORAGE_KEY);
    set({ currentUser, isAuthenticated: false });
  },

  hasPermission: (perm) => resolvePermissions(get().currentUser).includes(perm),

  isRole: (role) => {
    const r = get().currentUser.role;
    return Array.isArray(role) ? role.includes(r) : r === role;
  },

  switchUser: (userId) => {
    const u = users.find((x) => x.id === userId);
    if (u) {
      saveJSON(STORAGE_KEY, { userId });
      set({ currentUser: u, isAuthenticated: true });
    }
  },
}));
```

### W4.4 RequireAuth 守卫（新建 `src/components/RequireAuth.tsx`）

```tsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
```

### W4.5 Permission 组件（新建 `src/components/Permission.tsx`）

```tsx
import { useAuthStore } from '@/store/useAuthStore';
import type { Permission } from '@/types';

interface Props {
  perm: Permission | Permission[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export default function Permission({ perm, fallback = null, children }: Props) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const ok = Array.isArray(perm) ? perm.some((p) => hasPermission(p)) : hasPermission(perm);
  return <>{ok ? children : fallback}</>;
}
```

### W4.6 登录页（新建 `src/pages/login/index.tsx`）

- 居中 Card，标题"采购询价系统登录"
- 用户 Select（options 来自 `users`，label 显示"姓名（角色·组织）"）+ 密码 Input（任意密码，仅前端演示）
- 登录按钮：调 `useAuthStore.login(userId)`，成功后 navigate 到 `state.from?.pathname ?? '/dashboard'`
- 顶部 Logo + 副标题
- 已登录访问 `/login` 自动跳 dashboard

### W4.7 403 页（新建 `src/pages/forbidden/index.tsx`）

- antd Result status="403" + 返回首页按钮

### W4.8 路由改造（`src/router/index.tsx`）

```tsx
const LoginPage = lazy(() => import('@/pages/login'));
const ForbiddenPage = lazy(() => import('@/pages/forbidden'));
const ApprovalPage = lazy(() => import('@/pages/approval'));     // W5
const NotificationPage = lazy(() => import('@/pages/notification')); // W6

export const appRouter = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/403', element: <ForbiddenPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <MainLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'inquiry/list', element: <InquiryListPage /> },
      { path: 'inquiry/create', element: <InquiryCreatePage /> },
      { path: 'inquiry/edit/:id', element: <InquiryCreatePage /> },
      { path: 'inquiry/detail/:id', element: <InquiryDetailPage /> },
      { path: 'quotation/pending', element: <QuotationPendingPage /> },
      { path: 'quotation/compare', element: <QuotationComparePage /> },
      { path: 'quotation/compare/:inquiryId', element: <QuotationComparePage /> },
      { path: 'approval', element: <ApprovalPage /> },           // W5
      { path: 'notification', element: <NotificationPage /> },   // W6
      { path: 'supplier', element: <SupplierPage /> },
      { path: 'supplier/:id', element: <SupplierDetailPage /> },
      { path: 'material', element: <MaterialPage /> },
      { path: 'log', element: <LogPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/supplier-portal/:inquiryId/:supplierId',
    element: <SupplierLayout />,
    children: [{ index: true, element: <SupplierPortalPage /> }],
  },
]);
```

### W4.9 MainLayout 改造（`src/layouts/MainLayout.tsx`）

**a. 菜单按角色过滤**（L53-77 `menuItems` 改为函数）：
```ts
import { useAuthStore } from '@/store/useAuthStore';
import { ROLE_PERMISSIONS, type Permission } from '@/types';

function buildMenuItems(hasPermission: (p: Permission) => boolean): MenuItem[] {
  const items: MenuItem[] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' },
  ];
  // 询价管理组
  if (hasPermission('INQUIRY_CREATE') || hasPermission('INQUIRY_EDIT')) {
    items.push({
      key: 'inquiry-group', icon: <FileTextOutlined />, label: '询价管理',
      children: [
        { key: '/inquiry/list', label: '询价单列表' },
        hasPermission('INQUIRY_CREATE') && { key: '/inquiry/create', label: '新建询价单' },
      ].filter(Boolean) as MenuItem[],
    });
  }
  // 报价管理组（待回收 + 对比 + 审批）
  const quotationChildren: MenuItem[] = [
    { key: '/quotation/pending', label: '待回收报价' },
    { key: '/quotation/compare', label: '报价对比' },
  ];
  if (hasPermission('INQUIRY_APPROVE')) {
    quotationChildren.push({ key: '/approval', label: '审批管理' }); // W5
  }
  items.push({ key: 'quotation-group', icon: <SolutionOutlined />, label: '报价管理', children: quotationChildren });
  // 通知中心（所有人可见）
  items.push({ key: '/notification', icon: <BellOutlined />, label: '通知中心' }); // W6
  // 供应商/物料/日志/设置
  if (hasPermission('SUPPLIER_MANAGE') || hasPermission('SUPPLIER_DISABLE')) {
    items.push({ key: '/supplier', icon: <ShopOutlined />, label: '供应商管理' });
  }
  if (hasPermission('MATERIAL_MANAGE')) {
    items.push({ key: '/material', icon: <AppstoreOutlined />, label: '物料管理' });
  }
  if (hasPermission('VIEW_LOG')) {
    items.push({ key: '/log', icon: <ProfileOutlined />, label: '操作日志' });
  }
  if (hasPermission('SETTINGS_MANAGE')) {
    items.push({ key: '/settings', icon: <SettingOutlined />, label: '系统设置' });
  }
  return items;
}
```
组件内：`const hasPermission = useAuthStore((s) => s.hasPermission);` + `const menuItems = useMemo(() => buildMenuItems(hasPermission), [hasPermission]);`

**b. useMenuState 扩展**（L80-101）：新增 `/approval` → `/approval`、`/notification` → `/notification` 分支。

**c. 顶栏用户区改造**（L292-297）：
- 头像/姓名从 `useAuthStore.currentUser` 取（替换 `currentUser` import）
- 用户菜单 items 改为动态：
  - "个人信息"
  - "切换用户" → 子菜单列出现有 6 用户（演示用），点击调 `switchUser`
  - 显示当前角色 Tag
  - "退出登录" → 调 `logout` + navigate `/login`
- `userMenuItems` 增加 onClick 处理

**d. 组织 Select 管理员视角**（L262-267）：
- 管理员（`hasPermission('VIEW_ALL_ORG')`）在 options 前加"全部组织"选项
- 切换"全部组织"时 `currentOrganization` 设为特殊值 `__ALL__`

### W4.10 管理员视角数据过滤（`src/store/useInquiryStore.ts` L92-93）

```ts
getVisibleInquiries: (organization) =>
  get().inquiries.filter((i) =>
    organization === '__ALL__' ? true : i.organization === organization,
  ),
```

各列表页无需改动（已传 `currentOrganization`，管理员选"全部组织"时自动 `__ALL__`）。

### W4.11 按钮级权限包裹

| 页面 | 按钮 | 权限 |
|---|---|---|
| `inquiry/list` L390 | 新建询价单 | `INQUIRY_CREATE` |
| `inquiry/list` L342 | 编辑 | `INQUIRY_EDIT` |
| `inquiry/list` L360 | 取消 | `INQUIRY_CANCEL` |
| `inquiry/detail` | 编辑/发送/取消/定标按钮 | `INQUIRY_EDIT`/`INQUIRY_SEND`/`INQUIRY_CANCEL`/`INQUIRY_CONFIRM` |
| `quotation/compare` L333 | 确认定标 | `INQUIRY_CONFIRM`（W5 后改为 INQUIRY_APPROVE 走审批分支） |
| `supplier` | 新增/编辑/删除/启停 | `SUPPLIER_MANAGE`/`SUPPLIER_DISABLE` |
| `material` | 新增/编辑/删除/批量导入 | `MATERIAL_MANAGE` |
| `settings` | 整页 | 路由级 `SETTINGS_MANAGE`（无权限跳 403） |

用 `<Permission perm="XXX">` 包裹对应 Button。

### W4.12 useInquiryStore createLog 改造（L30-48）

`createLog` 当前硬编码 `currentUser` import，改为接收 operator 参数：
```ts
function createLog(
  inquiryId: string, type: LogType, content: string, result?: string,
  operator?: string, operatorRole?: string,
): InquiryLog {
  const user = useAuthStore.getState().currentUser;
  return {
    id: `log-${inquiryId}-${dayjs().valueOf()}`,
    inquiryId,
    time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    operator: operator ?? user.name,
    operatorRole: operatorRole ?? user.role,
    type, content, result,
  };
}
```
（新增 `import { useAuthStore } from './useAuthStore'`）

### W4.13 验证
- 未登录访问任意页 → 跳 `/login`
- 登录采购人员 → 菜单无"系统设置/操作日志/审批管理"；新建询价按钮可见；定标按钮不可见
- 登录采购主管 → 菜单有"审批管理/操作日志"；定标可见；系统设置不可见
- 登录管理员 → 菜单全显；组织 Select 有"全部组织"；选"全部组织"看全部询价单
- 切换用户 → 顶栏姓名/角色变化，菜单即时刷新
- 退出登录 → 跳 `/login`

---

## 四、W6 通知中心

### W6.1 通知中心页（新建 `src/pages/notification/index.tsx`）

- PageHeader "通知中心" + "全部已读"按钮
- 筛选区：Segmented（全部/未读）+ Select（类型：全部/询价发送/报价提交/即将截止/审批/系统）
- Table 列：标题（未读加粗+蓝底）/内容/类型 Tag/时间（相对时间）/操作（已读/查看详情）
- 点击行 → markRead + 跳 `inquiryId` 详情
- 分页 pageSize 20
- 空状态 Empty

### W6.2 deadlineWatcher 超时巡检（新建 `src/utils/deadlineWatcher.ts`）

```ts
import { useInquiryStore } from '@/store/useInquiryStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { InquiryStatus, NotificationType } from '@/types';
import { getRemainingTime } from '@/utils/format';

/** 检查即将超时（thresholdHours 内截止）的询价单，补发通知（去重） */
export function checkDeadlineApproaching(): void {
  const { timeoutThresholdHours } = useSettingsStore.getState();
  const inquiries = useInquiryStore.getState().inquiries;
  const { addNotification, notifications } = useNotificationStore.getState();
  const thresholdMs = timeoutThresholdHours * 3600 * 1000;
  const now = Date.now();

  inquiries
    .filter((i) => i.status === InquiryStatus.INQUIRING || i.status === InquiryStatus.PARTIAL_QUOTED)
    .forEach((i) => {
      const deadlineMs = new Date(i.deadline).getTime();
      const diff = deadlineMs - now;
      // 在 threshold 内且未过期
      if (diff > 0 && diff <= thresholdMs) {
        // 去重：同 inquiryId + DEADLINE_APPROACHING 类型 1 小时内不重复
        const recent = notifications.some(
          (n) =>
            n.inquiryId === i.id &&
            n.type === NotificationType.DEADLINE_APPROACHING &&
            now - new Date(n.time).getTime() < 3600 * 1000,
        );
        if (!recent) {
          addNotification({
            inquiryId: i.id,
            type: NotificationType.DEADLINE_APPROACHING,
            title: `询价单 ${i.code} 即将截止`,
            content: `截止时间 ${i.deadline}，请尽快跟进供应商报价`,
          });
        }
      }
    });
}
```

### W6.3 dashboard 接入巡检（`src/pages/dashboard/index.tsx`）

在 dashboard `useEffect` 中调用 `checkDeadlineApproaching()`，每次进入工作台检查一次：
```ts
import { checkDeadlineApproaching } from '@/utils/deadlineWatcher';
useEffect(() => {
  checkDeadlineApproaching();
}, []);
```

### W6.4 通知开关生效（`src/store/useNotificationStore.ts`）

`addNotification` 前判断开关。修改 `addNotification`（L36-59）：
```ts
addNotification: (payload) => {
  // W6: 通知开关生效（关闭的类型不生成）
  const { notifications: prefs } = useSettingsStore.getState();
  const typeToKey: Record<NotificationType, string> = {
    [NotificationType.INQUIRY_SENT]: 'inquirySent',
    [NotificationType.QUOTATION_SUBMITTED]: 'quotationSubmitted',
    [NotificationType.DEADLINE_APPROACHING]: 'timeoutAlert',
    [NotificationType.APPROVAL]: 'todoReminder', // 审批归到待办提醒
    [NotificationType.SYSTEM]: 'todoReminder',
  };
  const key = typeToKey[payload.type];
  if (key && prefs[key] === false) return; // 开关关闭，不生成
  // ... 原去重 + 添加逻辑
},
```
新增 `import { useSettingsStore } from './useSettingsStore'`。

### W6.5 铃铛"查看全部"链接（`src/layouts/MainLayout.tsx` L148-204）

在 notificationContent 顶部"全部已读"旁加"查看全部"链接：
```tsx
<Button type="link" size="small" onClick={() => navigate('/notification')}>
  查看全部
</Button>
```

### W6.6 验证
- 进入工作台 → 即将截止询价单自动产生"即将截止"通知
- 通知中心页可筛选未读/按类型、批量已读、分页
- settings 关闭"询价发送"开关 → 发送询价后不再产生通知
- 铃铛 Popover 点"查看全部" → 跳通知中心页

---

## 五、W5 审批流程

### W5.1 类型扩展（`src/types/index.ts`）

**a. 新增 InquiryStatus.PENDING_APPROVAL**（L10-29 枚举追加）：
```ts
/** 审批中 */
PENDING_APPROVAL = 'PENDING_APPROVAL',
```
同步 `INQUIRY_STATUS_LABEL`（L32）+ `INQUIRY_STATUS_COLOR`（L45）：
```ts
[InquiryStatus.PENDING_APPROVAL]: '审批中',
[InquiryStatus.PENDING_APPROVAL]: 'processing',
```

**b. 新增 LogType.APPROVE / REJECT**（L129-143 枚举追加）：
```ts
APPROVE = 'APPROVE',
REJECT = 'REJECT',
SUBMIT_APPROVAL = 'SUBMIT_APPROVAL',
```
同步 `LOG_TYPE_LABEL`（L145）：
```ts
[LogType.APPROVE]: '审批通过',
[LogType.REJECT]: '审批驳回',
[LogType.SUBMIT_APPROVAL]: '提交审批',
```

**c. 新增 ApprovalNode 类型**（在 Inquiry 接口前）：
```ts
/** 审批节点状态 */
export enum ApprovalNodeStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SKIPPED = 'SKIPPED',
}

export const APPROVAL_NODE_STATUS_LABEL: Record<ApprovalNodeStatus, string> = {
  [ApprovalNodeStatus.PENDING]: '待审批',
  [ApprovalNodeStatus.APPROVED]: '已通过',
  [ApprovalNodeStatus.REJECTED]: '已驳回',
  [ApprovalNodeStatus.SKIPPED]: '已跳过',
};

/** 审批节点 */
export interface ApprovalNode {
  id: string;
  inquiryId: string;
  /** 节点顺序（从 1 开始） */
  nodeOrder: number;
  approverId: string;
  approverName: string;
  approverRole: string;
  status: ApprovalNodeStatus;
  /** 审批意见 */
  comment?: string;
  /** 审批时间 */
  time?: string;
}

/** 审批配置 */
export interface ApprovalConfig {
  enabled: boolean;
  approverIds: string[];
}
```

**d. Inquiry 接口扩展**（L384-424 追加字段）：
```ts
/** 审批节点列表（W5） */
approvalNodes?: ApprovalNode[];
/** 审批配置（W5） */
approvalConfig?: ApprovalConfig;
```

### W5.2 useSettingsStore 审批配置（`src/store/useSettingsStore.ts`）

Settings 接口追加：
```ts
approvalConfig: ApprovalConfig;
```
DEFAULTS 追加：
```ts
approvalConfig: { enabled: false, approverIds: ['u-2'] }, // 默认主管审批
```
（新增 `import { type ApprovalConfig } from '@/types'`）

### W5.3 settings 审批配置 Card（`src/pages/settings/index.tsx`）

新增第 5 张 Card "审批流程设置"：
- Switch 开启/关闭审批
- 用户多选 Select（options 来自 `users`，仅显示采购主管+管理员）选择审批人
- 保存按钮 → `updateSettings({ approvalConfig: { enabled, approverIds } })`

### W5.4 useInquiryStore 审批 actions（`src/store/useInquiryStore.ts`）

InquiryState 接口追加（L60-82）：
```ts
submitForApproval: (inquiryId: string, approverIds: string[]) => void;
approveNode: (inquiryId: string, comment: string) => void;
rejectApproval: (inquiryId: string, comment: string) => void;
getPendingApprovalInquiries: (approverId: string) => Inquiry[];
```

实现：
```ts
submitForApproval: (inquiryId, approverIds) =>
  set((state) => {
    const user = useAuthStore.getState().currentUser;
    const inquiries = state.inquiries.map((i) => {
      if (i.id !== inquiryId) return i;
      const approvalNodes: ApprovalNode[] = approverIds.map((aid, idx) => {
        const approver = users.find((u) => u.id === aid);
        return {
          id: `node-${inquiryId}-${idx + 1}`,
          inquiryId,
          nodeOrder: idx + 1,
          approverId: aid,
          approverName: approver?.name ?? aid,
          approverRole: approver?.role ?? '',
          status: idx === 0 ? ApprovalNodeStatus.PENDING : ApprovalNodeStatus.SKIPPED,
        };
      });
      return {
        ...i,
        status: InquiryStatus.PENDING_APPROVAL,
        approvalNodes,
        approvalConfig: { enabled: true, approverIds },
        updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        logs: [...i.logs, createLog(inquiryId, LogType.SUBMIT_APPROVAL, `提交审批，审批人：${approverIds.length} 人`, '审批中', user.name, user.role)],
      };
    });
    saveJSON(STORAGE_KEY, inquiries);
    const inq = inquiries.find((i) => i.id === inquiryId);
    if (inq) {
      // 通知所有审批人
      approverIds.forEach((aid) => {
        useNotificationStore.getState().addNotification({
          inquiryId, type: NotificationType.APPROVAL,
          title: `询价单 ${inq.code} 待您审批`,
          content: inq.subject,
        });
      });
    }
    return { inquiries };
  }),

approveNode: (inquiryId, comment) =>
  set((state) => {
    const user = useAuthStore.getState().currentUser;
    const inquiries = state.inquiries.map((i) => {
      if (i.id !== inquiryId) return i;
      const nodes = (i.approvalNodes ?? []).map((n) =>
        n.approverId === user.id && n.status === ApprovalNodeStatus.PENDING
          ? { ...n, status: ApprovalNodeStatus.APPROVED, comment, time: dayjs().format('YYYY-MM-DD HH:mm:ss') }
          : n,
      );
      // 找下一个 PENDING 节点激活
      const nextPending = nodes.find((n) => n.status === ApprovalNodeStatus.SKIPPED);
      if (nextPending) nextPending.status = ApprovalNodeStatus.PENDING;
      const allApproved = nodes.every((n) => n.status === ApprovalNodeStatus.APPROVED);
      return {
        ...i,
        approvalNodes: nodes,
        status: allApproved ? InquiryStatus.PENDING_CONFIRM : InquiryStatus.PENDING_APPROVAL,
        updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        logs: [...i.logs, createLog(inquiryId, LogType.APPROVE, `审批通过：${comment}`, allApproved ? '待定标' : '审批中', user.name, user.role)],
      };
    });
    saveJSON(STORAGE_KEY, inquiries);
    useNotificationStore.getState().addNotification({
      inquiryId, type: NotificationType.APPROVAL,
      title: `询价单审批通过`,
      content: `${user.name} 审批通过：${comment}`,
    });
    return { inquiries };
  }),

rejectApproval: (inquiryId, comment) =>
  set((state) => {
    const user = useAuthStore.getState().currentUser;
    const inquiries = state.inquiries.map((i) => {
      if (i.id !== inquiryId) return i;
      const nodes = (i.approvalNodes ?? []).map((n) =>
        n.approverId === user.id && n.status === ApprovalNodeStatus.PENDING
          ? { ...n, status: ApprovalNodeStatus.REJECTED, comment, time: dayjs().format('YYYY-MM-DD HH:mm:ss') }
          : n,
      );
      return {
        ...i,
        approvalNodes: nodes,
        status: InquiryStatus.INQUIRING, // 驳回回到询价中
        updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        logs: [...i.logs, createLog(inquiryId, LogType.REJECT, `审批驳回：${comment}`, '已驳回', user.name, user.role)],
      };
    });
    saveJSON(STORAGE_KEY, inquiries);
    useNotificationStore.getState().addNotification({
      inquiryId, type: NotificationType.APPROVAL,
      title: `询价单审批驳回`,
      content: `${user.name} 驳回：${comment}`,
    });
    return { inquiries };
  }),

getPendingApprovalInquiries: (approverId) =>
  get().inquiries.filter(
    (i) => i.status === InquiryStatus.PENDING_APPROVAL &&
      (i.approvalNodes ?? []).some((n) => n.approverId === approverId && n.status === ApprovalNodeStatus.PENDING),
  ),
```

新增 import：`ApprovalNode, ApprovalNodeStatus` from `@/types`，`useAuthStore`，`users` from `@/mock/users`。

### W5.5 compare 定标按钮改造（`src/pages/quotation/compare/index.tsx` L135-147）

`handleConfirm` 改为判断审批开关：
```ts
const approvalConfig = useSettingsStore((s) => s.approvalConfig);
const submitForApproval = useInquiryStore((s) => s.submitForApproval);
const hasPermission = useAuthStore((s) => s.hasPermission);

const handleConfirm = () => {
  if (!inquiry) return;
  // 审批开启 → 提交审批
  if (approvalConfig.enabled && hasPermission('INQUIRY_APPROVE')) {
    confirmAction({
      title: '提交审批',
      content: `确认提交审批？审批人：${approvalConfig.approverIds.length} 人`,
      okText: '提交审批',
      onOk: () => {
        submitForApproval(inquiry.id, approvalConfig.approverIds);
        notifySuccess('已提交审批');
      },
    });
    return;
  }
  // 未开启审批 → 直接定标
  confirmAction({
    title: '确认定标',
    content: '确认后将该询价单标记为"已完成"。',
    okText: '确认定标',
    onOk: () => { confirmInquiry(inquiry.id); notifySuccess('已确认定标'); },
  });
};
```

按钮文案动态：审批开启显示"提交审批"，否则"确认定标"。

### W5.6 审批管理页（新建 `src/pages/approval/index.tsx`）

- PageHeader "审批管理"
- 当前用户 = `useAuthStore.currentUser`
- 列表 = `getPendingApprovalInquiries(currentUser.id)`
- Table 列：询价单编号/主题/提交人/提交时间/审批节点进度（如 1/2）/操作（通过/驳回）
- 通过按钮 → Modal 输入审批意见 → `approveNode`
- 驳回按钮 → Modal 输入驳回原因 → `rejectApproval`
- 空状态 Empty

### W5.7 detail 时间轴扩展（`src/pages/inquiry/detail/index.tsx` L82-93, L640-657）

`getTimelineColor` 扩展：
```ts
case LogType.SUBMIT_APPROVAL:
  return 'blue';
case LogType.APPROVE:
  return 'green';
case LogType.REJECT:
  return 'red';
```

时间轴新增审批节点区块（在 L640 流程时间轴 Card 后追加）：
```tsx
{inquiry.approvalNodes && inquiry.approvalNodes.length > 0 && (
  <Card title="审批流程" style={cardStyle}>
    <Timeline
      items={inquiry.approvalNodes.map((node) => ({
        color: node.status === 'APPROVED' ? 'green' : node.status === 'REJECTED' ? 'red' : node.status === 'PENDING' ? 'blue' : 'gray',
        children: (
          <div>
            <Text strong>{node.approverName}</Text>（{node.approverRole}）
            <Tag style={{ marginLeft: 8 }}>{APPROVAL_NODE_STATUS_LABEL[node.status]}</Tag>
            {node.comment && <div><Text type="secondary">意见：{node.comment}</Text></div>}
            {node.time && <div><Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(node.time)}</Text></div>}
          </div>
        ),
      }))}
    />
  </Card>
)}
```

### W5.8 InquiryStatusTag 兼容（`src/components/StatusTag.tsx`）

确认 `InquiryStatusTag` 能渲染 `PENDING_APPROVAL`（因为用 `INQUIRY_STATUS_LABEL`/`INQUIRY_STATUS_COLOR` 映射，自动兼容）。无需改动。

### W5.9 验证
- settings 开启审批 + 选审批人（主管 u-2）
- 采购员创建询价单 → 发送 → 报价对比页"确认定标"变为"提交审批"
- 提交审批 → 状态变"审批中" → 主管收到通知
- 主管登录 → 菜单"审批管理" → 看到待审批询价单 → 通过/驳回
- 通过 → 状态变"待确认" → 采购员可定标
- 驳回 → 状态回"询价中"
- detail 页时间轴显示审批节点

---

## 六、W9 AI 智能化

### W9.1 aiService（新建 `src/services/aiService.ts`）

```ts
import { formatCurrency } from '@/utils/format';
import type { Inquiry, InquiryItem, Quotation } from '@/types';
import type { CompareData, SupplierQuoteRow } from '@/components/quotation/scoreUtils';
import { getAvgUnitPrice, getQuotationItem, isHighPrice, isLowPrice } from '@/components/quotation/scoreUtils';

/**
 * AI 询价说明生成（基于规则的中文文本生成，模拟 LLM）
 * 后续可替换为真实 LLM 调用（见 aiService.real.ts）
 */
export async function generateInquiryDescription(
  items: InquiryItem[],
  subject: string,
): Promise<string> {
  await delay(600); // 模拟 LLM 延迟
  const lines: string[] = [];
  lines.push(`一、采购背景`);
  lines.push(`本次采购「${subject}」，共涉及 ${items.length} 项物料，旨在保障生产/运营所需。`);
  lines.push('');
  lines.push(`二、物料清单概要`);
  const categories = [...new Set(items.map((i) => i.category))];
  categories.forEach((cat) => {
    const catItems = items.filter((i) => i.category === cat);
    lines.push(`· ${cat}（${catItems.length} 项）：${catItems.map((i) => i.name).join('、')}`);
  });
  lines.push('');
  lines.push(`三、技术要求`);
  lines.push('1. 供应商需提供符合规格型号要求的正品，必要时提供原厂证明；');
  lines.push('2. 报价含税含运费，注明交货周期与质保期；');
  lines.push('3. 如有技术偏离需在报价中明确说明。');
  lines.push('');
  lines.push(`四、商务条款`);
  lines.push('1. 付款条件：款到发货 / 月结 30 天（任选其一）；');
  lines.push('2. 发票要求：增值税专用发票；');
  lines.push('3. 交货地点：以询价单约定为准。');
  return lines.join('\n');
}

/** AI 报价异常分析 */
export async function analyzeQuotationAnomalies(
  inquiry: Inquiry,
  quotations: Quotation[],
  data: CompareData,
): Promise<string> {
  await delay(800);
  const lines: string[] = [];
  lines.push(`【异常报价分析报告】`);
  lines.push(`询价单：${inquiry.subject}（${inquiry.code}）`);
  lines.push(`参与对比供应商：${data.submittedRows.length} 家`);
  lines.push('');
  // 价格异常
  const anomalies: string[] = [];
  for (const item of inquiry.items) {
    const avg = getAvgUnitPrice(data.submittedRows, item.id);
    if (avg === undefined) continue;
    for (const r of data.submittedRows) {
      const qi = getQuotationItem(r, item.id);
      if (!qi) continue;
      if (isHighPrice(qi.unitPrice, avg)) {
        anomalies.push(`· ${item.name} - ${r.supplier.name}：单价 ${formatCurrency(qi.unitPrice, inquiry.currency)}，高于均价 ${formatCurrency(avg, inquiry.currency)} 50%+，疑似高价，建议核实规格是否一致。`);
      } else if (isLowPrice(qi.unitPrice, avg)) {
        anomalies.push(`· ${item.name} - ${r.supplier.name}：单价 ${formatCurrency(qi.unitPrice, inquiry.currency)}，低于均价 ${formatCurrency(avg, inquiry.currency)} 50%+，疑似低价，建议核实品牌/质保/付款条件是否有差异。`);
      }
    }
  }
  lines.push(`【价格异常】${anomalies.length ? '\n' + anomalies.join('\n') : '未发现明显价格异常。'}`);
  lines.push('');
  // 交货异常
  const deliveryAnomalies: string[] = [];
  data.submittedRows.forEach((r) => {
    if (r.avgDeliveryDays > 30) {
      deliveryAnomalies.push(`· ${r.supplier.name}：平均交货 ${r.avgDeliveryDays.toFixed(1)} 天，超过 30 天，影响生产进度。`);
    }
  });
  lines.push(`【交货异常】${deliveryAnomalies.length ? '\n' + deliveryAnomalies.join('\n') : '所有供应商交货周期在合理范围内。'}`);
  lines.push('');
  // 综合建议
  lines.push(`【综合建议】`);
  if (data.topScoreSupplierId) {
    const top = data.submittedRows.find((r) => r.supplier.id === data.topScoreSupplierId);
    const s = data.scores[data.topScoreSupplierId];
    if (top && s) {
      lines.push(`综合评分最高：${top.supplier.name}（总分 ${s.total.toFixed(2)}），建议优先选择。`);
      lines.push(`理由：金额评分 ${s.price.toFixed(1)}、交货评分 ${s.delivery.toFixed(1)}、等级评分 ${s.level.toFixed(1)}、履约评分 ${s.fulfillment.toFixed(1)}，综合表现最优。`);
    }
  }
  if (anomalies.length) {
    lines.push(`注意：存在 ${anomalies.length} 项价格异常，定标前建议与相关供应商确认报价细节。`);
  }
  return lines.join('\n');
}

/** AI 比价结论生成 */
export async function generateCompareConclusion(
  inquiry: Inquiry,
  data: CompareData,
  rows: SupplierQuoteRow[],
): Promise<string> {
  await delay(700);
  const lines: string[] = [];
  lines.push(`【比价结论】`);
  lines.push(`经对 ${rows.length} 家供应商的报价进行综合对比分析，结论如下：`);
  lines.push('');
  if (data.lowestTotalSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.lowestTotalSupplierId);
    if (r) lines.push(`1. 报价最低：${r.supplier.name}，总额 ${formatCurrency(r.totalAmount, inquiry.currency)}。`);
  }
  if (data.fastestDeliverySupplierId) {
    const r = rows.find((x) => x.supplier.id === data.fastestDeliverySupplierId);
    if (r) lines.push(`2. 交货最快：${r.supplier.name}，平均 ${r.avgDeliveryDays.toFixed(1)} 天。`);
  }
  if (data.topScoreSupplierId) {
    const r = rows.find((x) => x.supplier.id === data.topScoreSupplierId);
    const s = data.scores[data.topScoreSupplierId];
    if (r && s) {
      lines.push(`3. 综合推荐：${r.supplier.name}，综合评分 ${s.total.toFixed(2)} 分。`);
      lines.push(`   推荐理由：在金额、交货、供应商资质、历史履约四维度综合表现最优。`);
      if (r.supplier.level === 'STRATEGIC' || r.supplier.level === 'PREMIUM') {
        lines.push(`   该供应商为${r.supplier.level === 'STRATEGIC' ? '战略' : '优质'}供应商，历史履约率 ${(r.supplier.historyFulfillmentRate * 100).toFixed(0)}%，合作风险低。`);
      }
    }
  }
  lines.push('');
  lines.push(`【风险提示】`);
  // 检查异常
  let hasRisk = false;
  for (const item of inquiry.items) {
    const avg = getAvgUnitPrice(data.submittedRows, item.id);
    if (avg === undefined) continue;
    for (const r of data.submittedRows) {
      const qi = getQuotationItem(r, item.id);
      if (qi && (isHighPrice(qi.unitPrice, avg) || isLowPrice(qi.unitPrice, avg))) {
        lines.push(`· ${item.name} 存在偏离均价 50%+ 的报价，建议核实。`);
        hasRisk = true;
        break;
      }
    }
    if (hasRisk) break;
  }
  if (!hasRisk) lines.push(`· 各供应商报价均在合理区间，无明显风险。`);
  return lines.join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### W9.2 aiService.real 占位（新建 `src/services/aiService.real.ts`）

仅注释说明如何接入真实 LLM（如 OpenAI/Claude），不启用：
```ts
/**
 * 真实 LLM 接入示例（未启用）
 * 替换 aiService.ts 中的规则引擎为真实 LLM 调用：
 *
 * import OpenAI from 'openai';
 * const client = new OpenAI({ apiKey: import.meta.env.VITE_LLM_API_KEY });
 *
 * export async function generateInquiryDescription(items, subject) {
 *   const prompt = `...`;
 *   const res = await client.chat.completions.create({ ... });
 *   return res.choices[0].message.content;
 * }
 */
export {};
```

### W9.3 BasicInfoStep AI 生成按钮（`src/pages/inquiry/create/BasicInfoStep.tsx` L180-183）

description Form.Item 改造：
```tsx
import { RobotOutlined } from '@ant-design/icons';
import { generateInquiryDescription } from '@/services/aiService';
import { notifyError, notifyWarning } from '@/utils/confirm';

// 组件内
const [aiLoading, setAiLoading] = useState(false);
const handleAiGenerate = async () => {
  const items = form.getFieldValue('items') ?? []; // 若 BasicInfoStep 无 items，则从 props 取
  const subject = form.getFieldValue('subject') ?? '';
  if (!subject) { notifyWarning('请先填写询价主题'); return; }
  setAiLoading(true);
  try {
    const text = await generateInquiryDescription(items, subject);
    form.setFieldValue('description', text);
    notifySuccess('AI 已生成询价说明');
  } catch {
    notifyError('AI 生成失败，请稍后重试');
  } finally {
    setAiLoading(false);
  }
};

// JSX
<Form.Item name="description" label="询价说明">
  <TextArea ... />
</Form.Item>
<Form.Item>
  <Space>
    <Button icon={<RobotOutlined />} loading={aiLoading} onClick={handleAiGenerate}>
      AI 生成说明
    </Button>
    <Tag color="purple">AI 辅助</Tag>
  </Space>
</Form.Item>
```

> 注：BasicInfoStep 无 items 数据（items 在 MaterialStep），AI 生成时 items 传空数组，仅基于 subject 生成模板。若需 items 数据，需提升 form state 到 CreateInquiryPage（改动较大，本次从简）。

### W9.4 compare AI 分析按钮（`src/pages/quotation/compare/index.tsx` L316-339 headerExtra）

```tsx
import { RobotOutlined } from '@ant-design/icons';
import { analyzeQuotationAnomalies } from '@/services/aiService';

// 组件内
const [aiAnalysisOpen, setAiAnalysisOpen] = useState(false);
const [aiAnalysisText, setAiAnalysisText] = useState('');
const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
const handleAiAnalyze = async () => {
  if (!inquiry || !data) return;
  setAiAnalysisOpen(true);
  setAiAnalysisLoading(true);
  try {
    const text = await analyzeQuotationAnomalies(inquiry, getQuotationsByInquiry(inquiry.id), data);
    setAiAnalysisText(text);
  } catch {
    setAiAnalysisText('AI 分析失败，请稍后重试');
  } finally {
    setAiAnalysisLoading(false);
  }
};

// headerExtra 新增按钮（在"生成对比摘要"前）
<Button icon={<RobotOutlined />} loading={aiAnalysisLoading} onClick={handleAiAnalyze}>
  AI 分析异常
</Button>

// Modal（在组件末尾 JSX 追加）
<Modal
  title={<span><RobotOutlined /> AI 异常分析报告 <Tag color="purple" style={{ marginLeft: 8 }}>AI 生成</Tag></span>}
  open={aiAnalysisOpen}
  onCancel={() => setAiAnalysisOpen(false)}
  footer={null}
  width={720}
>
  <Spin spinning={aiAnalysisLoading}>
    <Paragraph style={{ whiteSpace: 'pre-wrap', background: '#F7F8FA', padding: 16, borderRadius: 8, fontSize: 13, lineHeight: 1.8 }}>
      {aiAnalysisText}
    </Paragraph>
  </Spin>
</Modal>
```

### W9.5 SummaryModal AI 结论（`src/components/quotation/SummaryModal.tsx`）

改造：
- 新增"AI 生成结论"按钮（默认显示模板摘要，点按钮后调 AI 生成更自然结论）
- AI 结论用 Tag 标注
- 失败降级为模板文本 + notifyWarning

```tsx
import { Button, Spin, Tag } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { generateCompareConclusion } from '@/services/aiService';
import { notifyWarning } from '@/utils/confirm';

export default function SummaryModal({ open, inquiry, data, rows, onClose }) {
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const templateSummary = buildSummary(inquiry, data, rows);
  const displayText = aiText || templateSummary;

  const handleAiGenerate = async () => {
    setAiLoading(true);
    try {
      const text = await generateCompareConclusion(inquiry, data, rows);
      setAiText(text);
    } catch {
      notifyWarning('AI 生成失败，已显示模板摘要');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Modal ...>
      <Space style={{ marginBottom: 8 }}>
        <Button icon={<RobotOutlined />} loading={aiLoading} onClick={handleAiGenerate}>
          AI 生成结论
        </Button>
        {aiText && <Tag color="purple">AI 生成</Tag>}
      </Space>
      <Paragraph copyable={{ text: displayText }} ...>
        {displayText}
      </Paragraph>
    </Modal>
  );
}
```

### W9.6 验证
- 创建询价单 BasicInfoStep → 填主题 → 点"AI 生成说明" → loading → textarea 填入生成文本
- 报价对比页 → 点"AI 分析异常" → Modal 展示分析报告
- 报价对比页 → 点"生成对比摘要" → Modal 内点"AI 生成结论" → 摘要替换为 AI 结论 + Tag

---

## 七、最终验证

### 自动化三连
```bash
npm run lint        # 0 error 0 warning
npm run test        # 全绿（新增审批/权限/AI 相关单测）
npm run build       # 通过
```

### 新增单测建议
- `src/store/__tests__/useAuthStore.test.ts`：login/logout/hasPermission/isRole
- `src/utils/__tests__/permissions.test.ts`：ROLE_PERMISSIONS 矩阵完整性
- `src/services/__tests__/aiService.test.ts`：三个方法返回非空字符串、含关键标识词
- `src/store/__tests__/useInquiryStore.approval.test.ts`：submitForApproval/approveNode/rejectApproval 状态流转

### 手动回归（按角色）
- [ ] 未登录访问 `/dashboard` → 跳 `/login`
- [ ] 登录采购人员 → 菜单无设置/日志/审批；新建询价可见；定标按钮不可见
- [ ] 登录采购主管 → 审批管理可见；定标可见；设置不可见
- [ ] 登录管理员 → 菜单全显；组织选"全部组织"看全部询价
- [ ] 切换用户 → 顶栏姓名/角色变化，菜单刷新
- [ ] 退出登录 → 跳 `/login`
- [ ] 进入工作台 → 即将截止询价自动产生通知
- [ ] 通知中心页：筛选/批量已读/分页正常
- [ ] settings 关闭"询价发送"开关 → 发送询价无通知
- [ ] settings 开启审批 + 选审批人
- [ ] 采购员报价对比页点"提交审批" → 状态审批中 → 主管收通知
- [ ] 主管审批管理页通过/驳回 → 状态流转 + 通知
- [ ] detail 页时间轴显示审批节点
- [ ] 创建询价单 AI 生成说明
- [ ] 报价对比 AI 分析异常
- [ ] 对比摘要 AI 生成结论

---

## 八、风险与决策

| # | 风险 | 决策 |
|---|---|---|
| 1 | `UserRole` 从 2 角色扩到 3 角色，mock 数据兼容 | 现有 5 用户保持采购人员/主管，新增 1 管理员；类型 union 扩展不破坏旧值 |
| 2 | `currentUser` 全局 import 与 useAuthStore 并存 | useAuthStore.currentUser 优先；MainLayout/create/index/settings 改读 store；useInquiryStore.createLog 改读 store；保留 mock `currentUser` 作为未登录 fallback |
| 3 | `useSettingsStore.organization` vs `useUIStore.currentOrganization` 重叠 | W4 不合并；useUIStore 仍是数据过滤源；settings.organization 仅展示用 |
| 4 | 管理员"全部组织" `__ALL__` 特殊值 | getVisibleInquiries 内判断 `__ALL__` 不过滤；各列表页无需改 |
| 5 | W5 审批开启后定标流程变化 | compare 定标按钮动态判断 approvalConfig.enabled + 权限；未开启审批时保持原"确认定标"流程 |
| 6 | W5 审批节点多级审批 | approveNode 自动激活下一 SKIPPED 节点为 PENDING；全部 APPROVED 后状态变 PENDING_CONFIRM |
| 7 | W9 AI 无真实 LLM | 规则引擎模拟，接口 async 预留；aiService.real.ts 占位说明 |
| 8 | W9 BasicInfoStep 无 items 数据 | AI 生成说明时 items 传空数组，仅基于 subject 生成；如需 items 需提升 form state（本次从简） |
| 9 | W4 RequireAuth 未登录时 currentUser 为 mock | RequireAuth 仅判断 isAuthenticated；未登录直接跳 login，不依赖 currentUser |
| 10 | 通知开关 key 映射 APPROVAL→todoReminder | 审批通知归到"待办提醒"开关；SYSTEM 也归到 todoReminder |

---

## 九、新增/修改文件清单

**新增（15 个）**：
- `src/store/useAuthStore.ts`
- `src/components/RequireAuth.tsx`
- `src/components/Permission.tsx`
- `src/pages/login/index.tsx`
- `src/pages/forbidden/index.tsx`
- `src/pages/approval/index.tsx`
- `src/pages/notification/index.tsx`
- `src/utils/deadlineWatcher.ts`
- `src/services/aiService.ts`
- `src/services/aiService.real.ts`
- `src/store/__tests__/useAuthStore.test.ts`（可选）
- `src/utils/__tests__/permissions.test.ts`（可选）
- `src/services/__tests__/aiService.test.ts`（可选）
- `src/store/__tests__/useInquiryStore.approval.test.ts`（可选）

**修改（12 个）**：
- `src/types/index.ts`（UserRole 扩 3 角色 + Permission + ROLE_PERMISSIONS + ApprovalNode/Config/Status + InquiryStatus.PENDING_APPROVAL + LogType.APPROVE/REJECT/SUBMIT_APPROVAL + Inquiry 字段）
- `src/mock/users.ts`（新增 adminUser + users 数组）
- `src/store/useInquiryStore.ts`（createLog 用 useAuthStore + 3 审批 actions + getPendingApprovalInquiries + getVisibleInquiries 支持 __ALL__）
- `src/store/useNotificationStore.ts`（addNotification 前判断通知开关）
- `src/store/useSettingsStore.ts`（新增 approvalConfig）
- `src/router/index.tsx`（+login/403/approval/notification 路由 + RequireAuth 包裹）
- `src/layouts/MainLayout.tsx`（菜单按角色过滤 + 用户切换/退出 + 组织"全部" + 通知"查看全部"）
- `src/pages/settings/index.tsx`（审批配置 Card）
- `src/pages/quotation/compare/index.tsx`（定标按钮改造 + AI 分析按钮）
- `src/pages/inquiry/detail/index.tsx`（时间轴 APPROVE/REJECT 颜色 + 审批节点区块）
- `src/pages/inquiry/create/BasicInfoStep.tsx`（AI 生成说明按钮）
- `src/components/quotation/SummaryModal.tsx`（AI 生成结论按钮）
- `src/pages/dashboard/index.tsx`（接入 deadlineWatcher）
- 按钮级 Permission 包裹：`inquiry/list`、`supplier`、`material`、`quotation/compare`

---

## 十、后续批次预告（本批次完成后）

| 顺序 | 工作流 | 依赖 | 主要产出 |
|---|---|---|---|
| 1 | W10 其他增强 | 收尾 | PDF 导出 / 移动端 / 物料详情页 / 工具抽取 / 工作台快捷操作 |
| 2 | W7 接入真实后端 | 最后 | axios + React Query + MSW + 环境变量切换 |
