# Production GA Hardening Spec

## Why
项目已从高完成度 RC 进入验收阶段，但仍有若干阻断生产上线的问题：真实 PostgreSQL 集成测试未跑通、生产 Compose 无法一键启动、生产启动会写入演示数据、供应商邀请闭环的 canonical URL 不一致、Celery/Outbox 未形成生产闭环、生产通知存在"假成功"、任务/运维接口授权边界不清晰、对象存储与病毒扫描未按生产强制，以及大量 P1/P2 业务与体验缺口。

## What Changes
- 建立真实 PostgreSQL CI，跑通 Alembic `upgrade head`、CRUD、事务、唯一约束、并发写入，且不因环境静默跳过。
- 生产 Compose 一键启动：fail-fast 必需变量、无明文默认密码、可配 CORS、Secure Cookie/HSTS/正确代理头/PUBLIC_APP_URL。
- 拆分生产初始化与演示数据：Alembic 只管结构，`seed-demo` 仅 dev/test，`bootstrap-admin` 幂等创建首位管理员，生产启动不写演示数据。
- 统一供应商邀请 canonical URL（`/supplier-portal/{token}` + PUBLIC_APP_URL 校验），并补齐真实邮件 E2E。
- 完成 Celery/Worker/Outbox 生产闭环：事务原子性、`FOR UPDATE SKIP LOCKED` 抢占、健康检查、故障注入测试。
- 生产禁止 LogNotifier 假成功；邮件投递记录与 Provider 接口、批处理逐项结果、可重试失败。
- 收紧任务/指标/健康接口授权边界，防 IDOR 与信息泄露。
- 对象存储与病毒扫描生产强制（head bucket/读写删探活、EICAR 测试、fail-closed）。
- P1：异步导出完整闭环、AI 慢任务用当前 Provider 且可解释、前端覆盖率门槛、安全扫描流水线修正、数据库并发正确性。
- P2：供应商门户拆分、比价决策深化、采购工作台、通知中心、无障碍/性能/移动端验收。

## Impact
- Affected specs: 生产可靠性、安全、可观测性、异步任务、认证权限、前端体验
- Affected code: `backend/app/*`、`backend/alembic/*`、`backend/tests/*`、`.github/workflows/ci.yml`、`docker-compose.yml`、`src/**`、`.env*.example`、部署/API 文档、CHANGELOG

## ADDED Requirements

### Requirement: Production Database CI
系统 SHALL 在 CI 中创建独立临时 PostgreSQL 数据库，执行完整 `alembic upgrade head`，校验关键表/约束/索引，执行核心 CRUD、事务回滚、唯一约束与并发写入，并可靠清理；不得因环境判断静默跳过。

### Requirement: Fail-Fast Production Config
生产启动 SHALL 对必需变量（SECRET_KEY、数据库密码、S3/MinIO 密钥、管理员初始凭证）使用 fail-fast，不允许不安全默认值进入生产；`CORS_ORIGINS` 支持 JSON 数组或逗号分隔并严格解析校验。

### Requirement: Seed/Admin Separation
生产 API 启动 SHALL 不无条件执行演示数据 Seed；`seed-demo` 仅限 dev/test/demo；`bootstrap-admin` 幂等创建首位管理员，支持一次性令牌或标准输入密码，不把明文密码写入日志。

### Requirement: Canonical Supplier Invitation URL
后端 SHALL 仅通过统一 URL Builder 生成 `/supplier-portal/{urlencodedInvitationToken}`，用 PUBLIC_APP_URL 拼接完整地址，不再生成 `/portal?token=...`；生产 PUBLIC_APP_URL 必须为 HTTPS、禁止 localhost、禁止末尾路径重复。

### Requirement: Celery/Outbox Production Loop
Outbox SHALL 与业务实体同一 DB Session/事务提交；多副本 dispatcher 使用 `FOR UPDATE SKIP LOCKED` 或租约抢占；记录 attempt/next_retry_at/locked_by/locked_until/最终失败原因；Readiness 需识别 Redis 可用但 Worker 未消费的情况。

### Requirement: No Fake Notification Success in Prod
`APP_ENV=prod` 时 NOTIFY_CHANNEL=log 直接启动失败；NOTIFY_CHANNEL=email 但 SMTP 不完整直接启动失败；禁止自动回退 LogNotifier；批量通知返回逐项结果，部分失败不得返回 `ok:true`；邮件任务失败抛可重试异常。

### Requirement: Ops/Task Endpoint Authorization
`/api/tasks`、任务重试、`/api/metrics`、`/api/health`、`/api/ready` SHALL 做授权边界控制，不向普通客户端暴露 idempotency key、内部 task name、原始异常堆栈、数据库/broker 地址、文件系统路径；`/api/metrics` 改为内部/管理员端点或独立监控端口。

### Requirement: Object Storage & Av Scan Production Enforcement
S3/MinIO 可用性 SHALL 通过 head bucket/写读删临时对象探活（有限超时）；生产默认强制 S3/MinIO，禁止静默回退本地磁盘；Readiness 覆盖 PostgreSQL/Redis/Celery Worker/S3/ClamAV；ClamAV 增加 EICAR 测试且生产 fail-closed。

### Requirement: Async Export Product Loop
大型导出 SHALL 保存到 S3/MinIO，持久化 ExportJob（pending/running/succeeded/failed/expired、progress、file key、size、checksum、expires_at、error code），成功后经通知/SSE 告知，提供短时有效下载 URL，支持重新生成/取消/过期清理/失败重试。

### Requirement: AI Async Uses Configured Provider
AI 慢任务 SHALL 使用当前配置的 Provider，不得硬编码 LocalRuleProvider；保留本地规则 Provider 作为显式并记录原因的 fallback；实现 schema 校验、prompt 版本、provider/model/version、token/成本、timeout、circuit breaker、结果缓存、用户反馈、审计记录。

### Requirement: Frontend Coverage Gate
前端整体覆盖率分阶段提高至 ≥60%，核心状态机/权限/供应商门户/提交/邀请/比价/审批模块 ≥80%；后端覆盖率保持 ≥80%，核心安全与状态机模块 ≥90%；所有已修复 P0 问题拥有回归测试；CI 不允许跳过失败的浏览器/数据库/安全测试。

## MODIFIED Requirements
### Requirement: Security Scan Pipeline
安全扫描（Bandit、pip-audit、npm audit、Trivy）SHALL 无论成败都生成报告并保留正确退出码；pip-audit 明确审计 backend 依赖/锁文件；引入 Python 可重复构建锁文件与哈希校验；镜像使用明确版本或 digest；增加 Dependabot/Renovate；构建产物生成 provenance/SBOM/签名；Docker E2E 依赖安全扫描成功或全部 Job 设为必需检查。

### Requirement: Database & Concurrency Correctness
对关键业务状态迁移建立数据库约束与服务层校验；统一乐观锁/版本号/409；覆盖双人编辑、审批与撤回并发、供应商重复提交、邀请重发与旧令牌、多任务重复通知、Outbox 多实例抢占；消除 N+1/无索引/无限列表；大表提供游标分页或稳定排序分页；建立 PostgreSQL 查询计划与性能基线。

## REMOVED Requirements
### Requirement: 生产启动自动 Seed 演示数据
**Reason**: 违反生产隔离，污染真实数据。
**Migration**: 由 `seed-demo`（仅 dev/test/demo）与 `bootstrap-admin`（幂等）替代。