# 生产正式发布（Production GA Release）Spec

## Why
当前仓库停留在"生产候选版"（RC），存在多个 P0 验收阻断项：GitHub Actions 多个 Job 未全绿（前端覆盖率门禁、PostgreSQL 集成测试、Bandit SAST）、供应商报价明细附件存在 `inquiryItemId` 冒充 `quotationItemId` 的 ID 契约错位、附件安全扫描状态未接入前端闭环、真实 Docker+Playwright 验收未执行。此外业务审计（报价修订历史、结构化定标理由）、周期任务开箱即用、真实邮件投递状态、测试门禁质量、可观测性、备份/发布工程、门户组件拆分与长流程反馈均未完成。

目标：以**实际代码、真实接口契约、数据库迁移、GitHub Actions 运行结果**为唯一依据，将当前版本从"生产候选版"提升为"可正式发布并持续运营的生产版本"。

## What Changes
- **P0-1** 修复 GitHub Actions 全部 Blocking 失败（前端覆盖率门禁退出码 1、PostgreSQL 集成测试退出码 4、Bandit 退出码 1、Production Build 与 Docker E2E 前置失败），使所有 Job 真实全绿；将 SHA 锁定的 Actions 升级至支持 Node.js 24 Runtime 的稳定版本（保持 commit SHA 固定，禁止浮动 tag）。
- **P0-2** 修复供应商报价明细附件的 ID 契约：后端返回 `quotationItemId` + `inquiryItemId`，前端同时保存，上传/删除/下载 `owner_type=quotation_item` 必须传真实 `quotationItemId`；新建报价未生成明细时先可靠保存草稿取得服务端 ID 再上传；设计"临时附件"模型支持首次上传，禁止放宽后端归属校验。
- **P0-3** 完成附件安全扫描 UX 闭环：前端接入 `scanStatus`/`scanResult`（pending/scanning/clean/infected/error），含轮询/SSE 刷新、刷新恢复、提交阻断、中英文/图标/ARIA/键盘、不泄露内部细节。
- **P0-4** 完成真实 Docker+Playwright 验收：Compose 启动完整生产依赖，等待 `/api/ready`，五浏览器真实 E2E 连续两次，上传经过真实 ClamAV（含 EICAR），失败上传 trace/截图/视频/容器日志/request ID，可靠清理环境。
- **P1-5** 实现不可变报价修订版本历史（quotation_revisions / _items / _attachments），并发 409、幂等键、版本时间轴、diff 高亮、导出含版本号、Alembic upgrade/downgrade 与回滚。
- **P1-6** 实现结构化定标理由（decisionSummary/reasonCategories/selectedQuotationRevisionId/acceptedDeviations/riskAssessment/mitigationPlan 等），权限/并发/幂等/越权/导出一致性。
- **P1-7** 周期提醒开箱即用：代码注册 Celery Beat 任务（截止提醒/过期邀请/失败通知重试/孤儿清理），明确时区、去重、多实例防重复、幂等/退避/死信/人工重试/可观测、运维查询接口、Compose 默认启动 Beat。
- **P1-8** 完善真实邮件投递状态：可替换 Provider 抽象 + 至少一种真实 Provider 或签名 Webhook 模式，支持 accepted/sent/delivered/opened/bounced/complained/failed，Webhook 签名与时间戳校验、去重幂等、provider message ID、防跨组织伪造、退信/投诉停止重试。
- **P1-9** 提高测试门禁质量：前端全局覆盖率分阶段提升至 ≥60%、关键模块 ≥80%；后端关键模块 ≥90%；OpenAPI contract test；属性/参数化测试；真实 PostgreSQL 覆盖关键 DB 行为。
- **P1-10** 完善可观测性与故障处理：OpenTelemetry trace、Grafana Dashboard 示例、Prometheus Alert Rules、SLO/错误预算、敏感字段脱敏测试、运维 Runbook。
- **P1-11** 完成备份/恢复/发布工程：PG 自动备份与恢复演练、S3 生命周期、迁移前置检查、零停机说明、回滚方案、Secret 轮换、镜像 digest/SBOM/签名、语义化版本、Tag/Release 工作流、RC 验收。
- **P2-12** 拆分供应商门户超大组件为 hooks/组件（useInvitationValidation/useQuotationDraft/useAutosave/useAttachmentUpload/useScanStatus/useQuotationSubmission 等），减少重渲染、区分 loading、虚拟化/分页、保留移动端/无障碍/i18n、独立测试。
- **P2-13** 优化长流程反馈：Skeleton、错误分类与重试、自动保存状态（正在保存/已保存/离线/失败/冲突）、离开提醒、网络恢复不覆盖服务端、取消/重试、提交回执、request ID。
- **P2-14** 统一导入文件格式与产品文案：宣称 Excel 必须真实支持 `.xlsx`，CSV 明确标注，模板/映射/预览/错误行列/部分导入/错误报告，防公式注入，异步导入幂等。
- **P2-15** 修正文档漂移：README/architecture/deployment/CHANGELOG/OpenAPI/测试说明/环境变量模板与实际一致，自动从 CI 生成或校验关键数据。

## Impact
- 受影响能力：GitHub Actions CI/CD、供应商门户、附件上传与病毒扫描、报价提交/修订/定标、通知与邮件、周期任务、对象存储、可观测性、备份/发布、导入。
- 受影响代码：
  - CI：`.github/workflows/ci.yml`（新增/调整 Job、Actions SHA 升级）
  - 后端：`app/models.py`、`app/schemas.py`、`app/routers/portal.py`、`app/routers/quotations.py`、`app/notifier.py`、`app/tasks.py`、`app/scanner.py`、`app/storage.py`、`app/main.py`、`app/config.py`、`app/config_validation.py`、`app/state_machine.py`、`alembic/versions/*`
  - 前端：`src/pages/supplier-portal/*`、`src/api/portal.ts`、`src/api/client.ts`、`src/types/index.ts`、`src/components/*`、`src/hooks/*`、`src/locales/*`
  - 测试：`backend/tests/*`、`frontend/src/**/*.test.*`、`e2e/*`
  - 工程：`docker-compose.yml`、`Dockerfile*`、`scripts/*`、`docs/*`、`README.md`、`CHANGELOG.md`、`.env*.example`

## ADDED Requirements

### Requirement: 附件 ID 契约（报价明细）
系统 SHALL 确保上传 `owner_type=quotation_item` 的附件使用真实 `quotationItemId`；后端 SHALL 同时在报价草稿返回中提供 `quotationItemId` 与 `inquiryItemId`。新建报价未生成明细时 SHALL 先可靠保存草稿取得服务端 ID，或使用一次性"临时附件"模型在同一事务中绑定真实明细。系统 SHALL NOT 允许以 `inquiryItemId` 冒充 `quotationItemId`，也 SHALL NOT 通过放宽后端归属校验解决。

#### Scenario: 新建报价首次上传附件
- **WHEN** 供应商新建报价并上传附件
- **THEN** 系统先保存草稿取得 `quotationItemId`（或使用临时附件模型），以真实 `quotationItemId` 完成上传，附件归属正确且可随草稿恢复。

#### Scenario: 越权上传被拒绝
- **WHEN** 供应商尝试用其他邀请/询价/供应商 ID 上传或访问附件
- **THEN** 后端返回 403/404，且不发生产权泄露。

### Requirement: 附件安全扫描 UX 闭环
系统 SHALL 将 `scanStatus`/`scanResult` 接入前端类型、状态管理与界面，支持 pending/scanning/clean/infected/error。上传后 SHALL 显示"正在进行安全检查"而非完全成功；infected SHALL 明确风险并禁止下载/预览/提交但允许安全删除；error SHALL 显示原因与重新扫描入口；提交前 SHALL 检查附件状态，存在 infected/error/长期 pending 时阻止提交并说明具体附件。所有状态 SHALL 提供中英文、图标、非纯颜色表达、ARIA 标签与键盘操作，且 SHALL NOT 向供应商暴露内部扫描器地址、服务器路径、异常堆栈或敏感签名细节。

#### Scenario: EICAR 感染样本上传
- **WHEN** 供应商上传 EICAR 测试样本
- **THEN** 附件状态变为 `infected`，前端明确提示风险并禁止下载/预览/提交，仅允许安全删除。

### Requirement: 不可变报价修订版本历史
系统 SHALL 在每次提交时形成不可变报价版本快照（revision number、quotation/supplier/inquiry ID、明细快照、总金额与币种、附件快照或引用、提交人/时间、修订原因、来源版本、request ID、invitation ID、状态）。允许以最后一次已提交版本创建新草稿；不得修改或删除历史已提交证据；并发修订返回结构化 409；重复提交使用幂等键；定标与审批必须明确引用某个报价版本。

#### Scenario: 修订报价产生新版本
- **WHEN** 供应商修订已提交报价并再次提交
- **THEN** 系统基于最后一次已提交版本创建新草稿，提交后生成新版本号，旧版本保持不变可供审计与 diff。

### Requirement: 结构化定标理由
系统 SHALL 建立结构化、可审计、可导出的决策记录，至少包含 decisionSummary、reasonCategories、selectedQuotationRevisionId、acceptedDeviations、riskAssessment、mitigationPlan、scoreOverrideReason、nonTopRankReason、approverComment、evidenceReferences、createdBy/createdAt/requestId。人工修改权重或分数未填写原因、或未选择综合得分第一名未填写原因时 SHALL 阻止定标；AI 生成内容 SHALL 标记模型/版本/时间/依据且不能代替人工确认；最终定标后 SHALL 有不可变更的快照机制。

#### Scenario: 未选择第一名供应商
- **WHEN** 定标选择非综合得分第一的供应商但未填写原因
- **THEN** 系统阻止定标并要求填写 `nonTopRankReason` 后方可继续。

### Requirement: 周期提醒开箱即用
系统 SHALL 在代码中注册截止提醒、过期邀请、失败通知重试、孤儿文件清理等 Celery Beat 周期任务，配置明确时区，同一询价/供应商/提醒阶段去重，多实例不重复发送，任务支持幂等/退避重试/死信/人工重试/可观测状态，提供运维查询接口展示最近执行/下次执行/失败原因/积压，Compose 与生产部署默认启动 Beat 服务。

#### Scenario: 多实例部署不重复提醒
- **WHEN** 部署多个 worker+beat 实例且同一询价到达截止提醒时点
- **THEN** 仅发送一次提醒，其余实例因去重/租约机制跳过。

### Requirement: 真实邮件投递状态
系统 SHALL 提供可替换的邮件 Provider 抽象，并至少实现一种真实 Provider 或通用签名 Webhook 模式，支持 accepted/sent/delivered/opened/bounced/complained/failed。SHALL 校验 Webhook 签名与时间戳、事件去重幂等、保存 provider message ID、防止跨组织伪造状态、供应商级展示状态与失败原因、对退信/投诉/永久失败停止无意义重试、不把打开邮件作为业务完成唯一依据。

#### Scenario: 接收退信 Webhook
- **WHEN** 邮件 Provider 回调 `bounced` 事件（签名有效）
- **THEN** 系统记录投递状态为 bounced，停止该地址后续重试，并在供应商端展示失败原因。

## MODIFIED Requirements
### Requirement: GitHub Actions 门禁
由"部分 Job 依赖前置失败而 skipped / 部分失败"改为"所有 Job 真实运行且全绿"。前端覆盖率门禁由 ≥30% 逐步提升至 ≥60%（关键模块 ≥80%）；PostgreSQL 集成测试必须真实运行不得 skip；Bandit/安全扫描失败必须阻断 CI；Actions 需升级至支持 Node.js 24 Runtime 的 SHA 锁定稳定版本。

## REMOVED Requirements
无（不删除、不弱化现有安全/覆盖率/集成/E2E 门禁）。