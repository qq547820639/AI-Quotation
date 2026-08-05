# 代码质量验收、可靠性补齐与用户体验深化 Spec

## Why
仓库 `qq547820639/AI-Quotation` 已具备较高完成度的 MVP，但存在若干会阻塞真实生产/验收的代码级问题：审批驳回没有独立状态导致后续流程缺失、附件扫描器是占位实现、Redis/对象存储依赖与容器环境未补齐、生产配置缺少启动校验、后台任务依赖 FastAPI 进程内 `BackgroundTasks`（重启即丢）、CI 安全扫描以 `|| true` 静默放行。本次迭代只处理代码层面事项，以代码、测试和 CI 运行结果为完成唯一依据。

## What Changes
- **审批状态机**：新增 `RETURNED`（驳回可编辑）状态；通过→待确认，驳回→RETURNED；驳回后允许修改并重新提交；非法转换由后端 409 拒绝；并发审批用乐观锁；前端标签/按钮/筛选/统计同步更新。
- **附件扫描器**：重构为 `FileScanner` / `ScanResult` / `ClamAVScanner` / `NoopScanner` 统一接口；生产默认真实扫描器、fail closed；上传先入 `pending`，扫描通过才允许下载；校验文件头/真实 MIME/扩展名/大小；文件头/压缩炸弹防护；服务端重命名。
- **Redis 与对象存储**：将 `redis`、`boto3` 加入正式依赖；compose 增加 Redis 与可选 MinIO 服务及健康检查；客户端连接超时与重试；`APP_ENV=prod` 时若要求 Redis/对象存储但不可用则拒绝启动；禁止生产静默降级到内存实现。
- **邀请重发**：DB 只存 token 哈希；明文 token 仅在创建/重新生成时返回一次；重发语义清晰；明文丢失时自动生成新 token 并使旧失效；已撤销/过期/提交/使用不可重发；并发防多有效 token；恒定时间比较；事务一致性。
- **持久化任务队列**：引入 Celery + Redis 作为队列后端，独立 worker 与 beat scheduler；幂等键、指数退避、最大重试、任务状态与最后错误、dead-letter、任务状态查询与管理员重试 API、事务 outbox 防重。
- **并发与幂等**：对重复提交报价/审批/定标/邀请/AI/导出/提醒增加唯一约束、幂等键、乐观锁、409。
- **数据库约束与事务**：组织隔离外键与组合唯一约束、状态/枚举库级约束、金额 Decimal/Numeric、时间统一 UTC、明确事务边界、索引、N+1 消除、稳定排序；迁移与回滚测试。
- **CI 安全强门禁**：移除 bandit/pip-audit/npm audit 的 `|| true`，Trivy HIGH/CRITICAL 非零退出，加入 SBOM 与 secret scanning，锁定 Actions 版本。
- **生产配置校验**：启动时校验 `SECRET_KEY` 非空非默认且长度足够；禁 demo/默认账号；强制 CORS 白名单；依赖不可用则 readiness 失败；未配置真实扫描器拒启；错误日志脱敏。
- **认证与权限加固**：组织级资源隔离、刷新令牌撤销轮换、密码修改使会话失效、token 用途声明、Cookie 安全、CSRF、IDOR/越权测试。
- **安全响应头**：CSP nonce、移除 `script-src 'unsafe-inline'`、`frame-ancestors`、`object-src 'none'`、`base-uri 'self'`、HSTS、nosniff、Referrer/Permissions-Policy + 自动化测试。
- **AI 深化**：强结构化输出（Pydantic 校验 + 有限结构修复重试 + 明确降级）、提示词版本、回归样本、依赖注入、可解释性字段、用量 DB 聚合、并发/超时/熔断/预算。
- **前端 UX**：行动工作台、询价草稿自动保存、Excel 导入映射、供应商门户体验、比价定标权重、全局搜索/批量、通知重连、无障碍与移动端。
- **可观测性**：request ID 贯穿、结构化 JSON 日志、Prometheus 指标或等效接口、`/health` 存活性与 `/ready` 依赖就绪分离。

## Impact
- Affected specs: 复用并扩展现有可靠性/生产就绪能力，新增任务队列与审批驳回状态。
- Affected code:
  - 后端：`app/state_machine.py`、`app/scanner.py`、`app/redis_client.py`、`app/storage.py`、`app/invitations.py`、`app/delivery.py`、`app/config.py`、`app/main.py`、`app/models.py`、`app/schemas.py`、`app/serializers.py`、`app/routers/*`、`app/tasks/`（新增）、`app/outbox.py`（新增）、`app/middleware/csp.py`（新增）
  - 迁移：`backend/alembic/versions/0008_*.py` 起新增
  - 前端：`src/api/*`、`src/pages/*`、`src/store/*`、`src/components/*`、`src/hooks/*`、`src/locales/*`
  - 配置：`docker-compose.yml`、`backend/requirements.txt`、`backend/Dockerfile`、`backend/.env.example`、`.github/workflows/ci.yml`、`nginx.conf`、`playwright.config.ts`

## 实现范围与优先级
本 Spec 按 P0（阻塞）→ P1（可靠性/安全）→ P2（体验）分层。P0 为必须完成项；P1 按可验证性优先；P2 聚焦具备自动化测试支撑的高价值项。所有数据库结构变化必须提供 Alembic migration 与回滚测试。

## ADDED Requirements

### Requirement: 审批驳回状态机
系统 SHALL 为询价审批提供明确的分支状态：审批通过进入下一节点或待确认；审批驳回进入 `RETURNED`（可重新编辑）状态，且驳回后允许修改并重新提交。

#### Scenario: 驳回并重新编辑
- **WHEN** 审批人驳回某询价单
- **THEN** 状态变为 RETURNED，前端显示驳回标签与可编辑入口，供应商可修改后重新提交审批

#### Scenario: 非法状态转换
- **WHEN** 对终端状态或不存在该转换的业务发起状态变更
- **THEN** 后端返回 409 Conflict 且不产生任何修改

### Requirement: 附件扫描统一接口
系统 SHALL 提供 `FileScanner` / `ScanResult` / `ClamAVScanner` / `NoopScanner` 统一接口；生产环境默认使用真实扫描器并 fail closed；上传后附件先进入 `pending`，扫描通过才允许下载。

#### Scenario: 感染文件
- **WHEN** 扫描服务报告文件受感染
- **THEN** 附件标记 `infected` 且禁止下载

#### Scenario: 扫描服务不可用
- **WHEN** 生产环境扫描服务不可用或超时
- **THEN** 默认 fail closed，附件保持不可用并记录错误

### Requirement: Redis 与对象存储生产强制
系统 SHALL 在 `APP_ENV=prod` 且配置要求 Redis/对象存储时，若客户端不可用则拒绝启动；禁止静默降级到进程内实现。

#### Scenario: 生产依赖缺失
- **WHEN** 生产环境配置了 `REDIS_URL` 但客户端无法连接
- **THEN** 应用启动失败并给出明确错误

### Requirement: 邀请重发一致性
系统 SHALL 保证重发邀请要么产生有效新链接并失效旧链接，要么明确失败，不允许产生空链接或失效链接；并发重发不产生多个同时有效 token。

### Requirement: 持久化任务队列
系统 SHALL 将邮件发送、重试、截止提醒、批量通知、大型导出、慢 AI 请求迁出 FastAPI 进程内 `BackgroundTasks`，使用 Redis 作队列后端，独立 worker 与 scheduler；进程重启后未完成任务不丢失；相同业务事件不重复发送。

#### Scenario: worker 重启
- **WHEN** worker 进程在任务执行中重启
- **THEN** 未完成任务在 worker 恢复后继续执行，不产生重复业务效果

### Requirement: 生产配置启动校验
系统 SHALL 在应用启动时校验生产配置：`SECRET_KEY` 非空非默认且长度足够、禁止 demo 模式与默认账号、必须配置 CORS 白名单、依赖不可用则 readiness 失败、未配置真实扫描器拒绝生产启动。

### Requirement: CI 安全强门禁
系统 SHALL 将安全扫描设为 CI 强制门禁：移除安全扫描的 `|| true`，Trivy 对 HIGH/CRITICAL 非零退出，纳入前端/后端依赖与镜像扫描，失败阻断 CI 并保存报告 artifact。

## MODIFIED Requirements
### Requirement: 现有状态机扩展
在现有 `state_machine.py` 的 `INQUIRY_TRANSITIONS` 基础上，为审批相关状态补充 `RETURNED` 节点与合法转换，保持既有快乐路径可用。

### Requirement: 现有 Redis/存储抽象增强
在现有内存回退实现基础上，增加生产强制校验、连接超时与重试，补齐依赖声明与容器服务。

## REMOVED Requirements
（无移除；本迭代为增量增强。）

## 完成验收（对应「十、代码完成标准」）
1. 最新 commit 全部 CI job 成功。
2. Playwright 真实 E2E 连续运行两次成功。
3. 后端单元与集成测试全部成功。
4. 前端 lint/类型/i18n/单测/构建全部成功。
5-6. migration 从空库可执行，upgrade 与 downgrade 均经测试。
7. 生产环境不可用占位扫描器。
8. 生产不安全配置导致启动失败。
9. 邀请重发不产生空/失效链接。
10. 审批驳回具有正确可测试的后续流程。
11. 后台任务在重启后不丢失。
12. 高危安全扫描阻断 CI。
13. 远程 AI 非法输出不入库。
14. 核心流程在中英/明暗/移动/键盘可用。
15. 无被静默忽略的测试、扫描或运行时异常。