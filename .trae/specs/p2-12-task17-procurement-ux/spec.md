# P2-12 Task 17 采购端体验深化 Spec

## Why
采购端（procurement）在询价全流程中缺少服务端分页/筛选/排序、URL 状态同步、用户偏好持久化、实时更新、报价快照、服务端导出以及未报价/异常报价风险提示等能力，导致大批量询价时列表卡顿、跨设备配置丢失、报价确认无回溯依据、实时性差。通过本任务深化采购端体验，使其达到可稳定试运行的产品级水准。

## What Changes
- 询价列表服务端分页/筛选/搜索/排序（GET /api/inquiries 支持 page/pageSize/keyword/status/dateFrom/dateTo/sort），并向后兼容无分页参数时返回全量列表。
- 询价列表页 URL 同步筛选/排序/分页状态（keyword/status/dateFrom/dateTo/sort/page），支持会话内复制 URL 恢复视图。
- 用户级表格偏好持久化到服务端（GET/PUT /api/users/table-preferences/{pageKey}），useTablePreferences 支持 serverSync 跨设备恢复与自动上传。
- 实时更新：引入 SSE 事件总线（/api/events/stream），报价提交/定标确认/通知等事件推送，前端 useEventStream 订阅并刷新未读数与相关查询缓存。
- 报价对比页增强：报价回收风险提示（未报价/部分报价供应商、异常报价高亮）。
- 报价不可变快照：定标确认时冻结报价与询价摘要（QuotationSnapshot 模型），GET /api/inquiries/{id}/snapshots 可回溯。
- 服务端 PDF/Excel 导出：POST /api/inquiries/{id}/export（reportlab/openpyxl 生成，流式下载）。
- 清晰的空状态与风险提示、相关 i18n 文案（zh-CN / en-US）。

## Impact
- Affected specs: build-procurement-inquiry-system（询价列表、报价对比、通知）
- Affected code:
  - 后端：backend/app/models.py（UserTablePreference、QuotationSnapshot）、backend/app/routers/inquiries.py、backend/app/routers/users.py、backend/app/routers/events.py、backend/app/events.py、backend/alembic 迁移、backend/tests/test_task17.py
  - 前端：src/types/index.ts、src/api/inquiryApi.ts、src/api/usersApi.ts、src/hooks/useTablePreferences.ts、src/hooks/useEventStream.ts、src/App.tsx、src/pages/inquiry/list/index.tsx、src/pages/quotation/compare/index.tsx、src/locales/{zh-CN,en-US}.json、src/mocks/handlers.ts

## ADDED Requirements
### Requirement: 服务端分页询价列表
询价列表列表接口 SHALL 支持服务端分页/筛选/搜索/排序，并向后兼容全量返回。

#### Scenario: 分页查询
- **WHEN** 采购端调用 GET /api/inquiries?page=2&pageSize=10&keyword=xxx&status=INQUIRING&sort=createdAt:desc
- **THEN** 返回 { items, total, page, pageSize }，items 按条件过滤排序后切片

### Requirement: 用户表格偏好持久化
用户表格偏好 SHALL 按 pageKey 持久化到服务端并支持跨设备恢复。

#### Scenario: 保存与恢复
- **WHEN** 用户调整列显隐/排序/密度
- **THEN** 本地变更自动上传服务端；新设备首次进入从服务端恢复

### Requirement: SSR 实时更新
系统 SHALL 通过 SSE 推送报价提交/定标确认/通知事件，前端实时刷新。

#### Scenario: 报价提交
- **WHEN** 供应商提交报价
- **THEN** 服务端推送 quotation_submitted 事件，采购端未读数与列表实时刷新

### Requirement: 报价不可变快照
定标确认时 SHALL 冻结报价与询价摘要为不可变快照，供回溯查询。

#### Scenario: 定标确认
- **WHEN** 采购端确认定标结果
- **THEN** 生成 QuotationSnapshot，GET /api/inquiries/{id}/snapshots 可读取历史快照

### Requirement: 服务端导出
系统 SHALL 支持服务端生成 PDF/Excel 导出文件并流式下载。

#### Scenario: 导出 PDF
- **WHEN** 采购端触发导出 PDF
- **THEN** 服务端用 reportlab 生成文件，返回带 Content-Disposition 的流供下载

### Requirement: 报价回收风险提示
报价对比页 SHALL 对未报价/部分报价供应商与异常报价给出明确风险提示。

#### Scenario: 存在未报价供应商
- **WHEN** 邀请供应商数大于已报价数
- **THEN** 展示 {{count}}/{{total}} 未提交报价的警告，并提示核查/延长截止时间

## REMOVED Requirements
_无。_