# Tasks

> 以代码、测试、CI 运行结果为完成唯一依据。所有 DB 结构变化必须提供 Alembic migration 且 upgrade/downgrade 经测试。P0 优先，P1 并行，P2 聚焦可测试项。基线 commit：`651a8c1278e74ba0ea7b6e1f66d098fea24b741d`。

## P0：修复当前验收阻断项
- [ ] Task 1: 修复 GitHub Actions 所有 Job 真实全绿
  - [ ] 1.1 复现并定位 Frontend unit tests with coverage gate 退出码 1 根因（本地 `npx vitest run --coverage`），修复代码/测试，禁止降低覆盖率或删除测试
  - [ ] 1.2 复现并定位 PostgreSQL integration tests 退出码 4 根因（本地 `python -m pytest tests/test_postgres_integration.py -v -p no:cov -o addopts=`），修复测试/代码
  - [ ] 1.3 复现并定位 Python SAST (Bandit) 退出码 1 根因，修复真实问题；确属误报仅在最小范围带安全理由抑制并补充测试/说明
  - [ ] 1.4 修复后 Production Build 与 Docker E2E 因前置失败未执行的问题，使所有 Job 真实运行
  - [ ] 1.5 将 SHA 锁定 Actions 升级至支持 Node.js 24 Runtime 的稳定版本（保持 commit SHA 固定，禁止浮动 tag）
  - [ ] 1.6 对可重试的基础设施瞬时故障实现有限重试；安全扫描最终失败仍阻断 CI
- [ ] Task 2: 修复供应商报价明细附件 ID 契约
  - [ ] 2.1 后端创建/返回报价草稿时为每条明细返回 `quotationItemId` + `inquiryItemId`（portal/quotation schemas+serializers）
  - [ ] 2.2 前端 `QuotationFormItem` 同时保存两个 ID；上传/删除/下载 `owner_type=quotation_item` 传真实 `quotationItemId`
  - [ ] 2.3 新建报价未生成明细时先可靠保存草稿取得服务端 ID 再上传
  - [ ] 2.4 设计并实现"临时附件"模型（绑定 invitation/supplier/inquiry item/一次性 upload session），首次保存草稿同一事务重绑定真实 QuotationItem；支持过期清理、权限校验、幂等重试、孤儿清理；禁止放宽后端归属校验
  - [ ] 2.5 集成测试 + Playwright E2E：首次上传/已有草稿/刷新后继续/删除重传/跨供应商邀请询价越权/无效 owner ID/保存失败/网络重试重复点击/移动端
- [ ] Task 3: 完成附件安全扫描 UX 闭环
  - [ ] 3.1 前端 API 类型、状态管理、界面接入 `scanStatus`/`scanResult`（pending/scanning/clean/infected/error）
  - [ ] 3.2 上传后显示"正在进行安全检查"；clean 显示通过；infected 明确风险并禁止下载/预览/提交仅允许安全删除；error 显示原因与重新扫描入口
  - [ ] 3.3 pending/scanning 轮询/SSE/后台刷新；页面刷新恢复真实扫描状态；提交前检查附件状态并阻断（说明具体附件）
  - [ ] 3.4 所有状态中英文/图标/非纯颜色/ARIA/键盘；不暴露扫描器地址/路径/堆栈/敏感签名
  - [ ] 3.5 API contract test、组件测试、真实 E2E（含 EICAR infected 分支）
- [ ] Task 4: 完成真实 Docker + Playwright 验收
  - [ ] 4.1 Compose 启动完整生产依赖（nginx 前端/FastAPI/PG/Redis/Celery Worker/Outbox Dispatcher/MinIO/ClamAV/邮件测试服务）
  - [ ] 4.2 等待 `/api/ready`（校验外部依赖），而非仅存活检查
  - [ ] 4.3 chromium/firefox/webkit/mobile-android/mobile-ios 真实 E2E；核心链路连续运行两次验证幂等/清理/隔离
  - [ ] 4.4 禁止 MSW/前端本地 mock；上传经过真实 ClamAV（EICAR 验证 infected 分支）
  - [ ] 4.5 CI 失败上传 Playwright trace/截图/视频/容器日志/request ID；结束后可靠清理环境

## P1：业务审计闭环
- [ ] Task 5: 实现不可变报价修订版本历史
  - [ ] 5.1 新增 quotation_revisions / quotation_revision_items / 附件版本关系表（Alembic upgrade/downgrade）
  - [ ] 5.2 每次提交形成不可变版本（revision number/quotation/supplier/inquiry ID/明细快照/总金额币种/附件快照引用/提交人时间/修订原因/来源版本/request ID/invitation ID/状态）
  - [ ] 5.3 修订以最后已提交版本创建新草稿；不修改/删除历史证据；并发修订 409；重复提交幂等键；定标审批引用报价版本
  - [ ] 5.4 前端：供应商版本时间轴、当前草稿与上次提交差异提示、采购端版本列表与逐字段 diff、金额/交期/品牌/偏差/附件变化高亮、导出含版本号与生成时间、移动端/i18n/无障碍
  - [ ] 5.5 历史数据迁移与回滚方案测试
- [ ] Task 6: 实现结构化定标理由
  - [ ] 6.1 新增定标决策记录字段/表（decisionSummary/reasonCategories/selectedQuotationRevisionId/acceptedDeviations/riskAssessment/mitigationPlan/scoreOverrideReason/nonTopRankReason/approverComment/evidenceReferences/createdBy/createdAt/requestId）+ 不可变更快照机制
  - [ ] 6.2 人工修改权重/分数必须填原因；未选第一名必须填原因；AI 内容标记模型/版本/时间/依据且不代替人工确认
  - [ ] 6.3 定标记录进入审批/审计日志/导出文件；资源级权限与组织隔离
  - [ ] 6.4 权限/并发/幂等/越权/导出一致性测试
- [ ] Task 7: 周期提醒开箱即用
  - [ ] 7.1 代码注册 Celery Beat 任务（截止提醒/过期邀请/失败通知重试/孤儿清理），明确时区
  - [ ] 7.2 同一询价/供应商/阶段去重；多实例不重复发送（租约/幂等）
  - [ ] 7.3 任务幂等/退避重试/死信/人工重试/可观测状态；运维查询接口（最近/下次执行/失败原因/积压）
  - [ ] 7.4 Compose 与生产部署默认启动 Beat；时钟漂移/夏令时/重复调度/Worker 重启/Redis 短暂不可用测试
- [ ] Task 8: 完善真实邮件投递状态
  - [ ] 8.1 可替换邮件 Provider 抽象 + 至少一种真实 Provider 或通用签名 Webhook 模式
  - [ ] 8.2 支持 accepted/sent/delivered/opened/bounced/complained/failed；Webhook 签名与时间戳校验
  - [ ] 8.3 事件去重幂等、provider message ID、防跨组织伪造、供应商级状态与失败原因、退信/投诉/永久失败停止重试、不把打开作为完成唯一依据
  - [ ] 8.4 重放攻击/乱序事件/重复事件测试

## P1：工程与运营可信度
- [ ] Task 9: 提高测试门禁质量
  - [ ] 9.1 恢复并稳定当前门禁；前端全局覆盖率分阶段提升至 ≥60%
  - [ ] 9.2 权限/状态机/供应商门户/附件/报价提交/定标/API 错误恢复等关键模块 ≥80%；后端关键模块 ≥90%
  - [ ] 9.3 前后端 OpenAPI contract test；ID 映射/金额精度/版本历史/附件状态/定标记录属性或参数化测试
  - [ ] 9.4 关键数据库行为用真实 PostgreSQL 验证；避免主要依赖快照测试
- [ ] Task 10: 完善可观测性与故障处理
  - [ ] 10.1 OpenTelemetry trace：前端请求/后端 API/数据库/Celery/邮件/扫描/AI 调用链路关联
  - [ ] 10.2 Grafana Dashboard 示例、Prometheus Alert Rules、SLO/错误预算
  - [ ] 10.3 队列积压/任务失败/扫描失败/邮件退信/AI 熔断/数据库连接池/慢查询告警；敏感字段脱敏测试
  - [ ] 10.4 运维 Runbook（每类告警如何定位与恢复）
- [ ] Task 11: 完成备份、恢复和发布工程
  - [ ] 11.1 PostgreSQL 自动备份/保留策略/恢复演练脚本；S3/MinIO 生命周期与版本策略
  - [ ] 11.2 数据库迁移前置检查、零停机或最小停机说明、失败回滚方案、Secret 轮换说明
  - [ ] 11.3 容器镜像 digest 固定、SBOM 与签名；语义化版本、Git Tag 与 GitHub Release 工作流
  - [ ] 11.4 Release Notes/迁移说明/已知问题/回滚步骤；正式发布前生成 RC 版本并通过完整验收

## P2：用户体验与可维护性
- [ ] Task 12: 拆分供应商门户超大组件
  - [ ] 12.1 拆分为 useInvitationValidation/useQuotationDraft/useAutosave/useAttachmentUpload/useScanStatus/useQuotationSubmission + InquirySummary/QuotationItemsTable/MobileQuotationCards/AttachmentManager/SaveStatusIndicator/PortalStatePage
  - [ ] 12.2 减少不必要重渲染；避免单一 loading 控制多种操作；大量报价行虚拟化/分页
  - [ ] 12.3 保留移动端/无障碍/i18n；每个关键 hook/组件独立测试
- [ ] Task 13: 优化长流程反馈
  - [ ] 13.1 首屏 Skeleton；区分加载失败/权限不足/邀请失效/网络断开/服务不可用；可重试错误提供重试按钮
  - [ ] 13.2 自动保存状态（正在保存/已保存/离线/失败/冲突）；离开提醒；网络恢复不覆盖服务端更新
  - [ ] 13.3 长时间上传/扫描支持取消/重试/后台状态；提交成功回执/版本号/下载入口；错误含 request ID
- [ ] Task 14: 统一导入文件格式与产品文案
  - [ ] 14.1 宣称 Excel 必须真实支持 `.xlsx`；仅 CSV 处明确标注 CSV；模板下载/字段映射/预览/错误行列/部分导入/错误报告
  - [ ] 14.2 防公式注入；大文件异步任务+进度查询；导入重试幂等
- [ ] Task 15: 修正文档漂移
  - [ ] 15.1 更新 README/architecture/deployment/CHANGELOG/OpenAPI/测试说明/环境变量模板
  - [ ] 15.2 不再把真实 ClamAV 描述为占位；更新实际测试数量与覆盖率；更新 PG/Redis/Celery/React Query/S3 真实架构；区分开发/演示/生产模式；不再暗示静默回退 localStorage/SQLite/本地文件/Noop Scanner
  - [ ] 15.3 自动从 CI 生成或校验关键测试数量、API 契约、配置文档

# Task Dependencies
- Task 1 是所有其他任务的前置（需 CI 全绿）；Task 2/3 相互耦合（附件 ID 与扫描状态）
- Task 4 依赖 Task 2/3 的 E2E 就绪；Task 5 依赖 Task 2 的报价明细模型
- Task 6 依赖 Task 5 的报价版本；Task 8 依赖 notifier Provider 抽象
- Task 9/10/11 在 P0 稳定后展开；Task 12-15 在前置稳定后并行
- 所有任务完成后统一全量验证并提交 origin/main