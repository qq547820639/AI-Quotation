# 剩余批次执行计划：B2 ~ B7 + 最终验证

> 更新时间：2026-08-04 | 状态已核对实际代码：B2-B7 全部 ✅ 完成（GlobalSearch/通知联动/useSettingsStore/批量导入/PDF/图表/移动端）

> 承接 `next-batch-execution.md`：批次 A（W1 工程化）✅ 完成；批次 B 中 **B1 通知 store** ✅ 完成（含 types/useNotificationStore/useInquiryStore 联动/useQuotationStore 联动）。
> 本计划覆盖剩余 **B2 ~ B7** 与最终三连验证，目标：消灭全部已识别占位/假交互，达到「工程化达标 + 无假交互」交付态。

---

## 一、当前精确状态盘点（截至本计划起点）

| 子任务 | 状态 | 已完成 / 待办 |
|---|---|---|
| A1~A5 工程化 | ✅ | ESLint/Prettier/Husky/lint-staged/Vitest/4 份测试/README |
| B1 通知 store | ✅ | `Notification`/`NotificationType` 类型、`useNotificationStore`、`useInquiryStore.getVisibleInquiries`、`sendInquiry`/`cancelInquiry`/`selectSupplier`/`confirmInquiry` 联动、`useQuotationStore.submitQuotation` 联动 |
| B2 全局搜索 | ❌ | `MainLayout.tsx` L210-214 `Input.Search` 无 onSearch，无 GlobalSearch 组件 |
| B3 组织隔离 | ⚠️ 半成 | `getVisibleInquiries` 已有；4 个列表页仍直接读 `inquiries` 未接入 |
| B4 设置持久化 | ❌ | `settings/index.tsx` 全部 useState，保存仅 notifySuccess；无 useSettingsStore；BasicInfoStep 未读 validDays |
| B5 loading 真实化 | ❌ | `material/index.tsx` L71、`supplier/index.tsx` L63、`log/index.tsx` L80 `useState(false)` 恒 false；dashboard/inquiry-list/quotation-pending 无首屏 skeleton |
| B6 物料批量导入 | ❌ | `materialImport.ts` 未抽取；MaterialStep 内 XLSX 解析在 L150-197；material/index.tsx 无批量导入按钮 |
| B7 通知真实化 | ❌ | `MainLayout.tsx` L217 Badge count=5 硬编码、L221 Badge count=3 硬编码、L130-143 List 硬编码 3 条；无「全部已读」按钮 |
| 最终验证 | ❌ | lint/test/build 三连未跑 |

---

## 二、执行总顺序（严格依赖链）

```
B3 组织隔离（store 已就绪，纯页面接入）
   └─> B4 设置持久化（新建 store + 改 settings + 联动 BasicInfoStep）
         └─> B7 通知真实化（消费 B1 的 store，改 MainLayout）
               └─> B2 全局搜索（新建组件 + 改 MainLayout）
                     └─> B5 loading 真实化（3 页 useState 改造）
                           └─> B6 物料批量导入（抽取工具 + material 页 Modal）
                                 └─> 最终验证（lint/test/build 三连 + 手动回归）
```

> 说明：B3 / B4 / B7 都改 MainLayout 或 store，先做避免 merge 冲突；B5 / B6 改独立页面放最后；每完成一项立即跑 `npm run lint && npm run test`，全部完成后再跑 build。

---

## 三、任务详细方案

### B3 采购组织数据隔离（页面接入）

**目标**：4 个列表页按 `currentOrganization` 过滤询价单，切换组织即时生效。

**改动文件与精确改动点：**

1. **`src/pages/dashboard/index.tsx`**
   - 新增 import：`import { useUIStore } from '@/store/useUIStore';`
   - 在 `useInquiryStore` 取值处（grep 命中 `const inquiries = useInquiryStore((s) => s.inquiries);`）替换为：
     ```ts
     const currentOrganization = useUIStore((s) => s.currentOrganization);
     const getVisibleInquiries = useInquiryStore((s) => s.getVisibleInquiries);
     const inquiries = useMemo(
       () => getVisibleInquiries(currentOrganization),
       [getVisibleInquiries, currentOrganization],
     );
     ```
   - 注意：dashboard 中 `inquiries` 被多处 useMemo 依赖，替换后保持依赖数组一致。

2. **`src/pages/inquiry/list/index.tsx`** L76
   - 同样替换 `const inquiries = useInquiryStore((s) => s.inquiries);` 为上述三行（含 useUIStore import + useMemo）。
   - `filteredInquiries` useMemo 依赖 `inquiries`，自动联动。

3. **`src/pages/quotation/pending/index.tsx`** L97
   - 同样替换 `const inquiries = useInquiryStore((s) => s.inquiries);`。
   - `filteredInquiries` useMemo 依赖 `inquiries`，自动联动。

4. **`src/pages/quotation/compare/index.tsx`** L65
   - 替换 `const inquiries = useInquiryStore((s) => s.inquiries);` 为三行版。
   - `comparableInquiries` useMemo 依赖 `inquiries`，自动联动。

5. **`src/pages/log/index.tsx`** L78（连带）
   - 日志页聚合全部询价单 logs，**也应按组织过滤**：替换 `const inquiries = useInquiryStore((s) => s.inquiries);` 为三行版，`aggregateLogs(inquiries)` 自动联动。

**验证：**
- 手动：打开工作台，切组织 Select，统计卡片与列表数据随之变化。
- 单测：可选新增 `useInquiryStore.getVisibleInquiries` 单测（B1 已留接口）。

**风险：** 无；getVisibleInquiries 已在 B1 实现。

---

### B4 系统设置持久化

**目标**：settings 页 4 张卡片表单值持久化到 localStorage；BasicInfoStep 读取 `validDays` 作为默认报价有效期。

**新增 `src/store/useSettingsStore.ts`：**
```ts
import { create } from 'zustand';
import { loadJSON, saveJSON } from '@/utils/storage';
import { Currency } from '@/types';

const STORAGE_KEY = 'settings';
const SCHEMA_VERSION = 1;

export interface Settings {
  organization: string;
  systemName: string;
  currency: Currency;
  validDays: number;            // 默认报价有效期（天）
  deadlineLeadDays: number;     // 默认报价截止提前天数
  timeoutThresholdHours: number; // 即将超时阈值（小时）
  notifications: Record<string, boolean>;
}

const DEFAULTS: Settings = {
  organization: '总部采购中心',
  systemName: '采购询价系统',
  currency: Currency.CNY,
  validDays: 7,
  deadlineLeadDays: 3,
  timeoutThresholdHours: 24,
  notifications: {
    inquirySent: true,
    quotationSubmitted: true,
    timeoutAlert: true,
    todoReminder: false,
  },
};

interface SettingsState extends Settings {
  updateSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
}

function loadSettings(): Settings {
  const saved = loadJSON<Settings & { __v?: number }>(STORAGE_KEY, DEFAULTS);
  // 浅合并，保证新增字段有默认值
  return { ...DEFAULTS, ...saved, notifications: { ...DEFAULTS.notifications, ...(saved.notifications ?? {}) } };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadSettings(),
  updateSettings: (patch) =>
    set((state) => {
      const next = { ...state, ...patch };
      saveJSON(STORAGE_KEY, { ...next, __v: SCHEMA_VERSION });
      // 仅持久化业务字段，剥离 updateSettings/resetSettings
      const { updateSettings: _u, resetSettings: _r, ...persist } = next;
      void _u; void _r;
      saveJSON(STORAGE_KEY, { ...persist, __v: SCHEMA_VERSION });
      return patch;
    }),
  resetSettings: () =>
    set(() => {
      saveJSON(STORAGE_KEY, { ...DEFAULTS, __v: SCHEMA_VERSION });
      return DEFAULTS;
    }),
}));
```

> 注：`loadJSON` 已有 SCHEMA_VERSION 机制（W8 已完成），上述 `__v` 字段可省略，直接依赖 storage.ts 的版本判断；保留仅为可读性。最终实现时去掉重复 saveJSON 调用。

**改动 `src/pages/settings/index.tsx`：**
- 删除全部 useState（L51-66）。
- 改为：
  ```ts
  const { organization, systemName, currency, validDays, deadlineLeadDays,
          timeoutThresholdHours, notifications, updateSettings } = useSettingsStore();
  ```
- 3 个 `handleSave*` 改为：
  ```ts
  const handleSaveBasic = () => { updateSettings({ organization, systemName, currency }); notifySuccess('设置已保存'); };
  const handleSaveRules = () => { updateSettings({ validDays, deadlineLeadDays, timeoutThresholdHours }); notifySuccess('设置已保存'); };
  const handleSaveNotifications = () => { updateSettings({ notifications }); notifySuccess('设置已保存'); };
  ```
- 表单 onChange 直接调 `updateSettings({ field: value })`，去掉局部 state 中转（实现"onChange 即时持久化 + 显式保存按钮提交"的混合模式：保存按钮再确认一次）。
  - 决策：保留显式保存按钮（用户习惯），但 onChange 也写入 store，刷新后值不丢；保存按钮仅做提示反馈。
- `handleToggleNotification` 改为：
  ```ts
  const handleToggleNotification = (key: string, checked: boolean) =>
    updateSettings({ notifications: { ...notifications, [key]: checked } });
  ```
- 数据管理卡片不变（已用 removeKey/clearAll）。

**联动 `src/pages/inquiry/create/BasicInfoStep.tsx`：**
- grep 命中 `paymentTerms`（L166），未命中 `validDays`。
- 改动：新增 import `useSettingsStore`，在表单初始化时读取 `validDays` 作为「报价有效期」字段默认值。
- 需要先 Read 该文件确认「报价有效期」字段名（可能叫 `validDays` 或 `validUntil`），再精准改默认值。

**验证：**
- 修改设置 → 刷新页面 → 值保留。
- 新建询价单 → BasicInfoStep 报价有效期默认值 = settings.validDays。

**风险：** settings store 与 useUIStore.currentOrganization 概念重叠（settings.organization vs UI.currentOrganization）。
- 决策：本次不合并；settings.organization 仅作"系统名称展示用默认值"，UI.currentOrganization 仍是过滤数据源。后续 W4 权限时再统一。

---

### B7 通知系统真实化（MainLayout 接入）

**目标**：铃铛 Badge 显示真实未读数；Popover 列表展示真实通知；点击跳转询价详情；全部已读按钮。

**改动 `src/layouts/MainLayout.tsx`：**

1. 新增 import：
   ```ts
   import { useNotificationStore } from '@/store/useNotificationStore';
   import { useInquiryStore } from '@/store/useInquiryStore';
   import { InquiryStatus, NotificationType } from '@/types';
   import { useNavigate } from 'react-router-dom'; // 已有
   import dayjs from 'dayjs';
   import { formatDateTime } from '@/utils/format';
   ```

2. 组件内新增：
   ```ts
   const navigate = useNavigate(); // 已有
   const notifications = useNotificationStore((s) => s.notifications);
   const markRead = useNotificationStore((s) => s.markRead);
   const markAllRead = useNotificationStore((s) => s.markAllRead);
   const unreadCount = notifications.filter((n) => !n.read).length;
   // 待处理询价数（询价中/部分已报价）作为消息图标 Badge
   const pendingInquiryCount = useInquiryStore(
     (s) => s.inquiries.filter(
       (i) => i.status === InquiryStatus.INQUIRING || i.status === InquiryStatus.PARTIAL_QUOTED
     ).length,
   );
   const messageCount = pendingInquiryCount + unreadCount;
   ```

3. 替换 L128-144 `notificationContent`：
   ```tsx
   const notificationContent = (
     <div style={{ width: 340 }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 8px' }}>
         <Text strong>通知</Text>
         {unreadCount > 0 && (
           <Button type="link" size="small" onClick={markAllRead}>全部已读</Button>
         )}
       </div>
       <List
         size="small"
         dataSource={notifications.slice(0, 10)}
         locale={{ emptyText: <Empty description="暂无通知" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
         renderItem={(n) => (
           <List.Item
             style={{ background: n.read ? 'transparent' : '#F2F7FF', cursor: 'pointer', padding: '8px 12px', borderRadius: 4 }}
             onClick={() => {
               markRead(n.id);
               if (n.inquiryId) navigate(`/inquiry/detail/${n.inquiryId}`);
             }}
           >
             <List.Item.Meta
               title={<Text strong={!n.read}>{n.title}</Text>}
               description={<><Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(n.time)}</Text></>}
             />
           </List.Item>
         )}
       />
     </div>
   );
   ```

4. 替换 L217-224：
   ```tsx
   <Badge count={messageCount} size="small" overflowCount={99}>
     <MessageOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
   </Badge>
   <Popover content={notificationContent} trigger="click" placement="bottomRight">
     <Badge count={unreadCount} size="small" overflowCount={99}>
       <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
     </Badge>
   </Popover>
   ```

5. 去除 L18 `List` 已有；新增 `import { Empty } from 'antd'`。

**验证：**
- 发送询价（询价单列表 → 选草稿 → 发送）→ 铃铛出现未读小红点 + 列表新增条目 → 点击跳转详情 → 全部已读清零。
- 切换询价状态到「询价中」→ 消息图标 Badge 数变化。

**风险：** MainLayout 内 useInquiryStore 订阅 inquiries 全量，可能触发频繁重渲染。
- 决策：用 selector 仅返回 count（如上代码），Zustand 浅比较即可，无需 useMemo 优化。

---

### B2 全局搜索

**目标**：MainLayout 顶部 Input.Search 点击/回车打开 Modal，实时搜索询价单/供应商/物料，分组展示，点击跳转。

**新增 `src/components/GlobalSearch.tsx`：**
```tsx
import { useMemo, useState } from 'react';
import { Modal, Input, List, Empty, Typography, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useInquiryStore } from '@/store/useInquiryStore';
import { useSupplierStore } from '@/store/useSupplierStore';
import { useMaterialStore } from '@/store/useMaterialStore';
import { InquiryStatusTag } from '@/components/StatusTag';

const { Text } = Typography;

interface Props { open: boolean; onClose: () => void; }

export default function GlobalSearch({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const inquiries = useInquiryStore((s) => s.inquiries);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const materials = useMaterialStore((s) => s.materials);

  const kw = keyword.trim().toLowerCase();
  const results = useMemo(() => {
    if (!kw) return { inquiries: [], suppliers: [], materials: [] };
    return {
      inquiries: inquiries.filter(
        (i) => i.code.toLowerCase().includes(kw) || i.subject.toLowerCase().includes(kw),
      ).slice(0, 8),
      suppliers: suppliers.filter(
        (s) => s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw),
      ).slice(0, 8),
      materials: materials.filter(
        (m) => m.name.toLowerCase().includes(kw) || m.code.toLowerCase().includes(kw),
      ).slice(0, 8),
    };
  }, [kw, inquiries, suppliers, materials]);

  const total = results.inquiries.length + results.suppliers.length + results.materials.length;
  const handleClose = () => { setKeyword(''); onClose(); };
  const go = (path: string) => { navigate(path); handleClose(); };

  return (
    <Modal
      title="全局搜索"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Input.Search
        autoFocus
        placeholder="搜索询价单编号/主题、供应商名称/编号、物料名称/编码"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 16 }}
        size="large"
      />
      {total === 0 ? (
        <Empty description={kw ? '未找到匹配结果' : '请输入关键词'} />
      ) : (
        <>
          {results.inquiries.length > 0 && (
            <List
              size="small"
              header={<Text strong>询价单（{results.inquiries.length}）</Text>}
              dataSource={results.inquiries}
              renderItem={(i) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => go(`/inquiry/detail/${i.id}`)}>
                  <List.Item.Meta
                    title={<><Text strong>{i.code}</Text> · {i.subject}</>}
                    description={<InquiryStatusTag status={i.status} />}
                  />
                </List.Item>
              )}
            />
          )}
          {results.suppliers.length > 0 && (
            <List
              size="small"
              header={<Text strong>供应商（{results.suppliers.length}）</Text>}
              dataSource={results.suppliers}
              renderItem={(s) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => go(`/supplier/${s.id}`)}>
                  <List.Item.Meta title={<><Text strong>{s.code}</Text> · {s.name}</>} description={<Tag>{s.level}</Tag>} />
                </List.Item>
              )}
            />
          )}
          {results.materials.length > 0 && (
            <List
              size="small"
              header={<Text strong>物料（{results.materials.length}）</Text>}
              dataSource={results.materials}
              renderItem={(m) => (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => go('/material')}>
                  <List.Item.Meta title={<><Text strong>{m.code}</Text> · {m.name}</>} description={<Tag color="blue">{m.category}</Tag>} />
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </Modal>
  );
}
```

> 注：物料无独立详情页，点击跳转到 `/material` 并在 Modal 关闭后通过 URL query 携带 code 高亮（本次先跳 /material，W10 再做物料详情）。

**改动 `src/layouts/MainLayout.tsx`：**
- 新增 import `GlobalSearch`。
- 组件内 `const [searchOpen, setSearchOpen] = useState(false);`
- L210-214 `Input.Search` 改为只读触发器：
  ```tsx
  <Input.Search
    placeholder="全局搜索询价单 / 供应商 / 物料"
    style={{ maxWidth: 360, width: '32vw', minWidth: 200 }}
    enterButton
    readOnly
    onClick={() => setSearchOpen(true)}
    onSearch={() => setSearchOpen(true)}
  />
  ```
- 在 `</Layout>` 前渲染 `<GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />`。

**验证：**
- 点搜索框或回车 → Modal 打开 → 输入"INQ"出现询价单分组 → 点条目跳转详情并关 Modal。

**风险：** 无。

---

### B5 loading 状态真实化

**目标**：material/supplier/log 三页首屏 300ms 内有 loading；dashboard/inquiry-list/quotation-pending 补初始 skeleton。

**改动 `src/pages/material/index.tsx`** L71：
```ts
const [loading, setLoading] = useState(true);
useEffect(() => {
  const t = setTimeout(() => setLoading(false), 300);
  return () => clearTimeout(t);
}, []);
```
（新增 import `useEffect`）

**改动 `src/pages/supplier/index.tsx`** L63：同上。

**改动 `src/pages/log/index.tsx`** L80：同上。

**改动 dashboard / inquiry-list / quotation-pending：**
- 已有数据驱动渲染，无需强制 loading；但首屏 Suspense fallback 已在 MainLayout 处理（RouteSuspense）。
- 决策：本次仅在 material/supplier/log 三页加 300ms 模拟 loading；其余页面保持现状，避免过度改造。W7 接入真实后端时统一用 useQuery.isLoading。

**验证：**
- 打开物料/供应商/日志页 → 首屏短暂 Spin → 300ms 后表格出现。

**风险：** 无；300ms 仅过渡，W7 替换为真实 isLoading。

---

### B6 物料批量导入

**目标**：抽取 `materialImport.ts` 公共解析工具；material 页新增「批量导入」按钮 + Modal（上传 → 预览 → 确认批量 addMaterial）。

**新增 `src/utils/materialImport.ts`：**
```ts
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import type { Material, InquiryItem } from '@/types';

/** 列名别名表（与 MaterialStep 保持一致） */
const CATEGORY_ALIASES = ['物料品类', '品类', 'category'];

/** 规范化品类（与 MaterialStep 同源，可后续抽到 constants） */
function normalizeCategory(raw: string): string {
  const valid = ['工业电子', '五金件', '自动化', '办公设备', '包材', '劳保'];
  return valid.includes(raw) ? raw : raw || '工业电子';
}

/** 解析 Excel/CSV 文件 → Material[]（不含 id，由调用方生成） */
export async function parseMaterialFile(file: File): Promise<Partial<Material>[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (!rows.length) throw new Error('未解析到任何数据行');

  const get = (row: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== '') return String(row[k]);
    }
    return '';
  };

  const items = rows
    .map((row): Partial<Material> => ({
      code: get(row, ['物料编码', '编码', 'code']),
      name: get(row, ['物料名称', '名称', 'name']),
      category: normalizeCategory(get(row, CATEGORY_ALIASES)),
      brand: get(row, ['品牌', 'brand']),
      spec: get(row, ['规格型号', '规格', 'spec']),
      techParams: get(row, ['技术参数', 'techParams']),
      unit: get(row, ['单位', 'unit']) || '个',
      stockQty: Number(get(row, ['库存', 'stockQty'])) || undefined,
    }))
    .filter((m) => m.name);
  if (!items.length) throw new Error('未解析到有效物料行（需包含"物料名称"列）');
  return items;
}

/** 生成完整 Material（带 id），供 material 页批量导入使用 */
export function buildMaterials(parsed: Partial<Material>[]): Material[] {
  const now = dayjs().valueOf();
  return parsed.map((m, i) => ({
    id: `mat-${now}-${i}`,
    code: m.code || `MAT${String(now).slice(-6)}${i}`,
    name: m.name!,
    category: m.category!,
    brand: m.brand ?? '',
    spec: m.spec ?? '',
    techParams: m.techParams ?? '',
    unit: m.unit!,
    stockQty: m.stockQty,
  }));
}

/** 解析为 InquiryItem[]（供 MaterialStep 复用，保持原逻辑） */
export async function parseInquiryItems(
  file: File,
  inquiryId: string,
): Promise<InquiryItem[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (!rows.length) throw new Error('未解析到任何数据行');

  const get = (row: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== '') return String(row[k]);
    }
    return '';
  };

  const now = Date.now();
  const items = rows
    .map((row, idx): InquiryItem => {
      const qtyRaw = get(row, ['采购数量', '数量', 'quantity']);
      const priceRaw = get(row, ['目标价格', '目标价', 'targetPrice']);
      return {
        id: `item-imp-${now}-${idx}`,
        inquiryId,
        name: get(row, ['物料名称', '名称', 'name']),
        code: get(row, ['物料编码', '编码', 'code']),
        category: normalizeCategory(get(row, CATEGORY_ALIASES)),
        brand: get(row, ['品牌', 'brand']),
        spec: get(row, ['规格型号', '规格', 'spec']),
        techParams: get(row, ['技术参数', 'techParams']),
        unit: get(row, ['单位', 'unit']),
        quantity: qtyRaw ? Number(qtyRaw) || 0 : 0,
        targetPrice: priceRaw ? Number(priceRaw) || undefined : undefined,
        expectedDeliveryDate: get(row, ['期望交货日期', '交货日期', 'expectedDeliveryDate']) || undefined,
        remark: get(row, ['备注', 'remark']),
        attachments: [],
      };
    })
    .filter((it) => it.name);
  if (!items.length) throw new Error('未解析到有效物料行（需包含"物料名称"列）');
  return items;
}
```

**改动 `src/pages/inquiry/create/MaterialStep.tsx`** L150-197：
- 删除内联 `handleImport`，改为：
  ```ts
  const handleImport = async (file: File) => {
    try {
      const newItems = await parseInquiryItems(file, editingId ?? '');
      onChange([...items, ...newItems]);
      notifySuccess(`已导入 ${newItems.length} 条物料`);
    } catch (e) {
      notifyError((e as Error).message || '文件解析失败');
    }
  };
  ```
- 新增 import `{ parseInquiryItems } from '@/utils/materialImport'`，移除 `import * as XLSX`（如无其他用处）。

**改动 `src/pages/material/index.tsx`：**
- PageHeader extra 新增「批量导入」按钮：
  ```tsx
  extra={
    <Space>
      <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>批量导入</Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增物料</Button>
    </Space>
  }
  ```
- 新增 import：`UploadOutlined`、`parseMaterialFile, buildMaterials`、`UploadProps`、`Upload`、`notifyWarning, notifyError`。
- 新增状态与 Modal：
  ```ts
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<Material[]>([]);
  const [importing, setImporting] = useState(false);

  const importProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
    multiple: false,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const parsed = await parseMaterialFile(file);
        setImportPreview(buildMaterials(parsed));
      } catch (e) {
        notifyError((e as Error).message);
      }
      return false;
    },
  };

  const handleConfirmImport = () => {
    if (!importPreview.length) { notifyWarning('请先上传文件'); return; }
    setImporting(true);
    importPreview.forEach((m) => addMaterial(m));
    notifySuccess(`已导入 ${importPreview.length} 条物料`);
    setImportPreview([]);
    setImportOpen(false);
    setImporting(false);
  };
  ```
- Modal JSX（含 Upload + 预览 Table 前 10 行 + 确认按钮）。

**验证：**
- 物料页 → 批量导入 → 上传 xlsx → 预览前 10 行 → 确认 → 列表新增。
- 创建询价单 MaterialStep 批量导入仍正常（回归）。

**风险：**
- 抽取后 MaterialStep 行为可能因 normalizeCategory 实现差异变化 → 抽取时复制原逻辑逐行对应，保证 1:1。
- 重复 code 物料导入未去重 → 本次不处理，W10 再加去重提示。

---

## 四、最终验证清单

### 自动化三连
```bash
npm run lint        # 0 error
npm run test        # 全绿
npm run build       # 通过
```

### 手动回归（按页面）
- [ ] 工作台：统计卡片随组织切换变化
- [ ] 询价单列表：切换组织数据过滤；筛选/复制/取消/导出正常
- [ ] 待回收报价：切换组织数据过滤；模拟供应商报价入口可用
- [ ] 报价对比：列表页切换组织过滤；进入对比页评分/导出/定标正常
- [ ] 操作日志：切换组织日志过滤；筛选正常
- [ ] 系统设置：修改 4 张卡片 → 刷新 → 值保留；新建询价单 BasicInfoStep validDays 默认值生效
- [ ] MainLayout：发送询价后铃铛未读 +1；点击跳转详情；全部已读清零；消息 Badge 显示待处理数
- [ ] 全局搜索：点搜索框 → Modal → 输入关键词分组结果 → 点击跳转
- [ ] 物料管理：首屏 300ms loading；批量导入 → 预览 → 确认新增；新增/编辑/删除正常
- [ ] 供应商管理：首屏 300ms loading
- [ ] 创建询价单 MaterialStep：批量导入仍正常（回归）

---

## 五、风险与决策汇总

| # | 风险 | 决策 |
|---|---|---|
| 1 | settings.organization 与 UI.currentOrganization 概念重叠 | 本次不合并；W4 权限时统一 |
| 2 | MainLayout 订阅 inquiries 全量可能频繁重渲染 | 用 selector 返回 count，Zustand 浅比较 |
| 3 | 抽取 materialImport 后 MaterialStep 行为变化 | 1:1 复制原逻辑，回归测试覆盖 |
| 4 | 物料批量导入重复 code | 本次不去重，W10 加提示 |
| 5 | 300ms 模拟 loading 是过渡方案 | W7 接入真实后端时统一替换为 useQuery.isLoading |
| 6 | 物料无独立详情页 | 全局搜索点击物料仅跳 /material，W10 做详情页 |
| 7 | BasicInfoStep validDays 联动需先确认字段名 | 实施时先 Read 文件再精准改 |
| 8 | dashboard inquiries 替换为 useMemo 后依赖链 | 保持依赖数组与原 inquiries 一致 |

---

## 六、后续批次预告（本批次完成后）

| 顺序 | 工作流 | 依赖 | 主要产出 |
|---|---|---|---|
| 1 | W4 权限与角色 | B3 组织隔离 | 登录页 / 路由守卫 / 按钮级权限 / RBAC |
| 2 | W6 消息通知系统 | B1+B7 通知 | 通知中心页 / 触发点全覆盖 / 通知偏好 / 超时巡检 |
| 3 | W5 审批流程 | W4+W6 | 审批数据模型 / 审批操作 / 时间轴 / 审批管理页 |
| 4 | W9 AI 智能化 | 无强依赖 | aiService / 询价说明生成 / 异常分析 / 比价结论 |
| 5 | W10 其他增强 | 收尾 | PDF 导出 / 移动端 / 物料详情页 / 工具抽取 |
| 6 | W7 接入真实后端 | 最后 | axios + React Query + MSW + 环境变量切换 |
