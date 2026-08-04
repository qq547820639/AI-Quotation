# Tasks

- [x] Task 1: 定义 Task 17 新增类型（InquiryListParams、PaginatedInquiries、TablePreferencesPayload、QuotationSnapshot、ExportRequest）
- [x] Task 2: 后端模型与迁移（UserTablePreference、QuotationSnapshot，alembic 迁移 0007）
- [x] Task 3: 询价列表服务端分页/筛选/搜索/排序接口（GET /api/inquiries），向后兼容全量返回
- [x] Task 4: 用户表格偏好接口（GET/PUT /api/users/table-preferences/{pageKey}）
- [x] Task 5: SSE 事件总线与实时推送（backend/app/events.py、routers/events.py，报价提交/定标确认/通知触发）
- [x] Task 6: 服务端 PDF/Excel 导出（POST /api/inquiries/{id}/export，reportlab/openpyxl 流式下载）
- [x] Task 7: 报价不可变快照（定标确认冻结 + GET /api/inquiries/{id}/snapshots）
- [x] Task 8: 前端 API 封装（inquiryApi.listPage/export/snapshots、usersApi.get/saveTablePreference）
- [x] Task 9: useTablePreferences 服务端同步 + useEventStream SSE hook + App.tsx SSE 集成
- [x] Task 10: 询价列表页服务端分页接入 + URL 同步筛选/排序/分页 + 服务端导出入口
- [x] Task 11: 报价对比页增强：未报价/部分报价/异常报价风险提示 + i18n（zh-CN/en-US）
- [x] Task 12: 后端 Task 17 测试（backend/tests/test_task17.py）
- [x] Task 13: 前端 mock handlers 补齐新接口（table-preferences、inquiries 分页查询、export、snapshots），保证演示模式与测试可用
- [x] Task 14: 验证：npm run lint / npx tsc --noEmit / npm run build / npx vitest run / 后端测试

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 ~ Task 7 依赖 Task 2
- Task 8 依赖 Task 1
- Task 9 依赖 Task 8
- Task 10 依赖 Task 3、Task 8、Task 9
- Task 11 依赖 Task 8
- Task 12 依赖 Task 3 ~ Task 7
- Task 13 依赖 Task 8、Task 10
- Task 14 依赖全部