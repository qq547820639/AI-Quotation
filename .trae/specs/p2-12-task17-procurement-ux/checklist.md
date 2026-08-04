# Checklist

## 服务端分页询价列表
- [x] GET /api/inquiries 支持 page/pageSize/keyword/status/dateFrom/dateTo/sort，返回 { items, total, page, pageSize }
- [x] 无分页参数时向后兼容返回全量列表
- [x] 询价列表页在非演示模式启用服务端分页，并正确回退演示模式客户端筛选

## URL 状态同步
- [x] 询价列表页 URL 同步 keyword/status/dateFrom/dateTo/sort/page
- [x] 挂载时从 URL 恢复筛选条件，与 sessionStorage 取并集

## 用户表格偏好持久化
- [x] GET/PUT /api/users/table-preferences/{pageKey} 已实现并持久化
- [x] useTablePreferences 支持 serverSync：初始从服务端拉取、变更后防抖上传（失败静默）

## 实时更新
- [x] SSE 事件总线已实现，/api/events/stream 可推送 quotation_submitted / inquiry_confirmed / notification
- [x] useEventStream 订阅并分发事件，App.tsx 据此刷新未读数与相关查询缓存
- [x] 演示模式（MSW）不建立 SSE 连接，避免误报

## 报价不可变快照
- [x] QuotationSnapshot 模型与迁移已存在，定标确认时冻结报价与询价摘要
- [x] GET /api/inquiries/{id}/snapshots 返回不可变快照列表

## 服务端导出
- [x] POST /api/inquiries/{id}/export 用 reportlab/openpyxl 生成 PDF/Excel 并流式下载
- [x] 前端 inquiryApi.export 触发下载，列表页与详情页提供导出入口

## 报价回收风险提示
- [x] 报价对比页对未报价/部分报价供应商展示 riskTitle / riskUnquoted / riskUnquotedHint
- [x] 对异常报价展示 riskAnomalyHint
- [x] zh-CN.json 与 en-US.json 均含对应 i18n 文案

## Mock Handlers
- [x] mocks/handlers.ts 补齐 table-preferences、inquiries 分页查询、export、snapshots 处理器

## 验证
- [x] npm run lint 通过
- [x] npx tsc --noEmit 通过
- [x] npm run build 通过
- [x] npx vitest run 通过（前端，297 用例）
- [x] 后端 Task 17 测试通过（13 用例，全量后端 108 通过）