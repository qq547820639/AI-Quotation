# Checklist

> 状态以本地可执行验证（lint/tsc/i18n/vitest/build/pytest/alembic/bandit/pip-audit/npm audit/trivy）及 GitHub Actions 运行结果为准；需 Docker/Playwright 的项目以真实运行证据为准。

## P0
- [ ] GitHub Actions 所有 Job 真实运行且全绿（无 skipped、无 continue-on-error/`|| true` 绕过）
- [ ] Frontend unit tests with coverage gate 退出码 0（覆盖率门禁 ≥30% 且逐步提升，未降低）
- [ ] PostgreSQL integration tests（真实 PG）退出码 0，未被静默跳过
- [ ] Python SAST（Bandit）退出码 0；真实问题已修复，误报抑制带安全理由
- [ ] Production Build 真实执行且通过
- [ ] Docker Compose + Playwright E2E 真实执行且通过
- [ ] SHA 锁定 Actions 已升级至支持 Node.js 24 Runtime 的稳定版本（commit SHA 固定，无浮动 tag）
- [ ] 可重试基础设施瞬时故障有有限重试；安全扫描失败仍阻断 CI
- [ ] 报价草稿返回每条明细 `quotationItemId` + `inquiryItemId`
- [ ] 前端同时保存两个 ID；`owner_type=quotation_item` 上传/删除/下载传真实 `quotationItemId`
- [ ] 不允许询价明细 ID 冒充报价明细 ID；未放宽后端归属校验
- [ ] 新建报价首次上传先可靠保存草稿取得服务端 ID，或使用"临时附件"模型
- [ ] 临时附件绑定 invitation/supplier/inquiry item/一次性 upload session；过期清理/权限校验/幂等重试/孤儿清理
- [ ] 附件 ID 契约集成测试 + Playwright E2E 覆盖列出场景
- [ ] 前端接入 `scanStatus`/`scanResult`（pending/scanning/clean/infected/error）
- [ ] 上传后显示"正在进行安全检查"；clean/通过；infected 禁下载预览提交仅允许安全删除；error 显示原因与重新扫描入口
- [ ] pending/scanning 轮询/SSE/后台刷新；刷新恢复真实状态；提交前检查并阻断说明具体附件
- [ ] 所有状态中英文/图标/非纯颜色/ARIA/键盘；不暴露内部细节
- [ ] 附件扫描 UX API contract test/组件测试/真实 E2E（含 EICAR infected）
- [ ] Compose 启动完整生产依赖；等待 `/api/ready` 校验外部依赖
- [ ] 五浏览器项目真实 E2E；核心链路连续两次运行通过
- [ ] 禁用 MSW/前端 mock；上传经过真实 ClamAV；失败上传 trace/截图/视频/容器日志/request ID；环境可靠清理

## P1 业务审计
- [ ] 报价修订版本表（revisions/items/attachments）Alembic upgrade/downgrade 通过
- [ ] 每次提交形成不可变版本快照（字段齐全）；修订以最后版本建新草稿；历史不可改
- [ ] 并发修订返回结构化 409；重复提交幂等键；定标审批引用具体报价版本
- [ ] 前端版本时间轴/差异提示/逐字段 diff/变化高亮/导出含版本号；移动端/i18n/无障碍
- [ ] 历史数据迁移与回滚方案测试通过
- [ ] 结构化定标记录字段齐全 + 不可变快照机制
- [ ] 权重/分数修改必填原因；未选第一名必填原因；AI 内容标记并不可代替人工
- [ ] 定标记录进入审批/审计/导出；资源级权限与组织隔离
- [ ] 定标权限/并发/幂等/越权/导出测试通过
- [ ] Celery Beat 周期任务代码注册（截止/过期邀请/失败重试/孤儿清理），明确时区
- [ ] 同询价/供应商/阶段去重；多实例不重复发送
- [ ] 任务幂等/退避/死信/人工重试/可观测；运维查询接口
- [ ] Compose 与生产默认启动 Beat；时区/重启/Redis 短暂不可用测试
- [ ] 邮件 Provider 抽象 + 至少一种真实 Provider 或签名 Webhook
- [ ] 投递状态齐全；Webhook 签名与时间戳校验；去重幂等；provider message ID；防跨组织伪造
- [ ] 供应商级状态与失败原因；退信/投诉/永久失败停止重试；打开不作为唯一依据
- [ ] 重放/乱序/重复事件测试通过

## P1 工程可信度
- [ ] 前端全局覆盖率 ≥60%（分阶段）；关键模块 ≥80%；后端关键模块 ≥90%
- [ ] 前后端 OpenAPI contract test；属性/参数化测试
- [ ] 关键数据库行为真实 PostgreSQL 验证
- [ ] 关键业务断言验证具体结果（非主要依赖快照）
- [ ] OpenTelemetry trace 链路关联；Grafana Dashboard/Alert Rules/SLO/错误预算
- [ ] 告警项齐全；敏感字段脱敏测试；运维 Runbook
- [ ] PG 自动备份/保留/恢复演练脚本；S3 生命周期与版本
- [ ] 迁移前置检查/零停机说明/回滚方案/Secret 轮换
- [ ] 镜像 digest/SBOM/签名；语义化版本；Tag 与 Release 工作流；RC 验收

## P2
- [ ] 供应商门户拆分为 hooks/组件；减少重渲染；区分 loading；虚拟化/分页；保留移动端/无障碍/i18n；独立测试
- [ ] 首屏 Skeleton；错误分类；可重试按钮；自动保存状态；离开提醒；网络恢复不覆盖服务端
- [ ] 上传/扫描取消/重试/后台状态；提交回执/版本号/下载；错误含 request ID
- [ ] 宣称 Excel 真实支持 `.xlsx`；CSV 明确标注；模板/映射/预览/错误行列/部分导入/报告；防公式注入；异步幂等
- [ ] README/architecture/deployment/CHANGELOG/OpenAPI/测试说明/环境变量模板与实际一致
- [ ] 不再把 ClamAV 描述为占位；更新实际测试数量/覆盖率/架构；区分模式；不暗示静默回退
- [ ] 自动从 CI 生成或校验关键数据

## 最终
- [ ] 同一 commit SHA 的 GitHub Actions 全绿
- [ ] 前端 lint/tsc/i18n/unit/coverage/build 全通过
- [ ] 后端 lint/unit/API 集成/权限/状态迁移/coverage 全通过
- [ ] 真实 PostgreSQL 迁移与集成测试通过且未被 skip
- [ ] 安全扫描（gitleaks/bandit/pip-audit/npm audit/trivy）无未豁免 HIGH/CRITICAL
- [ ] Docker Compose 空数据卷可启动；生产不写演示数据
- [ ] Docker+Playwright 连续两次运行通过
- [ ] 提交并推送 origin/main，给出最终 commit SHA 与 Production Ready Yes/No