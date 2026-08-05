# Tasks

> 以代码、测试、CI 运行结果为完成唯一依据。所有 DB 结构变化必须提供 Alembic migration 且 upgrade/downgrade 经测试。P0 优先，P1 并行，P2 聚焦可测试项。审查基线 commit：`643b84a`。

## P0：阻断生产上线
- [x] Task 1: 真实 PostgreSQL CI
  - [x] 1.1 修复 pytest-cov 禁用冲突（`-p no:cov -o addopts=` 同时移除插件与 `--cov` 注入）
  - [x] 1.2 SQLAlchemy 2 统一命名参数绑定（`:name` + 字典，无 `%s`/`?`）
  - [x] 1.3 PostgreSQL 集成测试：独立临时库、`alembic upgrade head`、校验关键表/约束/索引、CRUD/事务/唯一约束/并发、可靠清理
  - [x] 1.4 CI 不静默跳过（`requirements.txt` 含 psycopg2-binary；CI postgres service 提供 DATABASE_URL；仅本地无 PG 才 skip）
- [x] Task 2: 生产 Compose 一键启动
  - [x] 2.1 必需变量 fail-fast（后端启动守卫 `assert_production_config` 拒绝不安全 SECRET_KEY/DB/S3；compose 注释与部署文档说明）
  - [x] 2.2 `CORS_ORIGINS` 支持 JSON 数组或逗号分隔并严格解析（`parse_cors_origins`）
  - [x] 2.3 生产 Secure Cookie、SameSite、HSTS、代理头与 HTTPS 判断、PUBLIC_APP_URL（config + config_validation）
  - [x] 2.4 提供 `.env.example`、`.env.production.example`、密钥生成命令（generate_secrets.py）、首部署步骤（deployment.md）
  - [ ] 2.5 production-like Compose E2E：证明服务健康而非仅进程存在（需 CI/Docker，本地无 Docker）
- [x] Task 3: 拆分生产初始化与演示数据
  - [x] 3.1 Alembic 只管结构；生产启动不无条件 Seed（lifespan prod 仅 ensure_app_settings）
  - [x] 3.2 `seed-demo` 仅 dev/test/demo 可运行（seed_demo 生产拒绝）
  - [x] 3.3 `bootstrap-admin` 幂等创建首位管理员（一次性 token 或 stdin 密码，明文不入日志）
  - [x] 3.4 禁止生产用 DEMO_USER_PASSWORD 回填历史密码（已移除）
  - [x] 3.5 测试证明空生产库迁移后无演示数据（test_seed_prod_safety.py）
- [x] Task 4: 供应商邀请完整闭环
  - [x] 4.1 统一 URL Builder：`/supplier-portal/{urlencodedInvitationToken}`，移除 `/portal?token=...`
  - [x] 4.2 PUBLIC_APP_URL 启动校验（HTTPS、禁 localhost、禁末尾路径重复、反向代理子路径）
  - [ ] 4.3 真实邮件 E2E（需 CI/Docker + Mailpit，本地无 Docker）
  - [x] 4.4 token 过期/撤销/重发/重复提交/并发提交/非法 token 测试（test_invitation_security.py）
- [x] Task 5: Celery/Redis/Outbox 生产闭环
  - [x] 5.1 compose 增加 celery-worker + outbox-dispatcher + celery-beat（复用 backend 镜像/env 锚点）
  - [x] 5.2 worker 与 API 同镜像/配置；健康检查、优雅停止、并发、队列、超时、重试策略
  - [x] 5.3 Readiness 识别"Redis 可用但 Worker 未消费"（`_celery_worker_ok` control.ping）
  - [x] 5.4 Outbox 事务原子性（enqueue 先持久化 outbox 再投递；幂等去重）
  - [ ] 5.5 多副本 `FOR UPDATE SKIP LOCKED`/租约抢占（设计已具备幂等，未加 SKIP LOCKED）
  - [ ] 5.6 故障注入测试（需真实 Redis/Worker，CI 验证）
  - [x] 5.7 至少一次投递下靠业务幂等保证最终正确（idempotency_key + delivery_status）
- [x] Task 6: 禁止生产通知"假成功"
  - [x] 6.1 prod 下 NOTIFY_CHANNEL=log 拒启；email 但 SMTP 不全拒启；禁回退 LogNotifier
  - [x] 6.2 邮件投递记录（provider/message_id/queued_at/sent_at/delivered_at/opened_at/bounced_at/last_error/attempt_count）
  - [x] 6.3 Provider 接口 + 退信/投递/打开 Webhook 设计 + 测试实现（Provider.handle_status_hook）
  - [x] 6.4 批量通知逐项结果；部分失败不返回无条件 ok（batch_notify_task）
  - [x] 6.5 邮件任务失败抛可重试异常进入 retry/dead-letter（NotifierError）
  - [x] 6.6 compose 增加 Mailpit/MailHog 用于 E2E（docker-compose.mailpit.yml）
- [x] Task 7: 任务与运维接口授权边界
  - [x] 7.1 `/api/tasks`、重试、`/api/metrics`、`/api/health`、`/api/ready` 授权与信息脱敏
  - [x] 7.2 不暴露 idempotency key/内部 task name/异常堆栈/DB/broker 地址/文件路径（_record_to_dict 剔除 + _sanitize_error）
  - [x] 7.3 `/api/metrics` 改管理员端点（require_admin）
  - [x] 7.4 `/api/health` 不返回原始 DB 异常；详细异常入脱敏日志
  - [x] 7.5 IDOR/横向越权/跨组织/信息泄露测试（test_task_authorization.py）
- [x] Task 8: 对象存储与病毒扫描生产强制
  - [x] 8.1 S3/MinIO 探活（head bucket/写读删临时对象，有限超时）
  - [x] 8.2 生产默认强制 S3/MinIO，禁静默回退本地磁盘（S3_REQUIRED）
  - [x] 8.3 Readiness 覆盖 PostgreSQL/Redis/Worker/S3/ClamAV；等待 bucket 初始化
  - [x] 8.4 ClamAV EICAR 测试（正常通过/感染拒绝/不可用 fail-closed/扫描完成前不可下载或提交）
  - [x] 8.5 校验扩展名/声明 MIME/magic bytes/实际内容，防双扩展名与 MIME 欺骗

## P1：业务结果与可靠性
- [ ] Task 9: 异步导出完整闭环（S3 存储、ExportJob 状态、进度/文件大小/校验和/过期/错误码、SSE 通知、短时下载 URL、重新生成/取消/清理/重试、前端进度与失败原因、大数据量/超时/重启/存储失败/权限测试）
- [ ] Task 10: AI 异步任务与可解释性（当前 Provider 不硬编码、明确 fallback 原因、schema/prompt 版本/provider/model/token成本/timeout/熔断/缓存/反馈/审计、依据与不确定展示、不绕过审批权限、malformed/超时/限流/超预算/Provider 故障/注入测试）
- [ ] Task 11: 前端测试质量门槛（覆盖率分阶段 ≥60%，核心模块 ≥80%；后端 ≥80%、核心安全/状态机 ≥90%；mutation 或等价验证；P0 回归测试；CI 不跳过失败）
- [ ] Task 12: 安全扫描流水线（pip-audit 明确审计、Python 锁文件+哈希、扫描成败都出报告且保留退出码、Trivy 输出目录挂载、SBOM 范围、镜像明确版本/digest、Dependabot、provenance/SBOM/签名、Docker E2E 依赖安全或全 Job 必需）
- [ ] Task 13: 数据库与并发正确性（状态迁移库级约束+服务层校验、统一乐观锁/409、并发场景测试、N+1/无索引/无限列表、游标分页或稳定排序、PostgreSQL 查询计划与性能基线）

## P2：用户体验深化
- [ ] Task 14: 拆分供应商门户巨型组件（状态机 loading/draft/saving/conflict/submitting/submitted/expired/revoked；刷新/断网恢复；保存状态区分；冲突差异比较；移动端底部主操作；附件扫描状态；提交前预览；回执打印）
- [ ] Task 15: 比价与决策深化（权重模板/复制/按品类复用、What-if 场景、缺失/不可比/换算时间/新鲜度、计算依据展开、逐物料推荐与组合授标、TCO/MOQ/付款/风险/履约、表格键盘/冻结列/虚拟滚动/列偏好/读屏）
- [ ] Task 16: 采购工作台（可执行卡片：即将截止/未报价/待审批/退回/发送失败/扫描失败/导出完成/并发冲突；一键下一步；批量提醒/延期/指派/归档；用户级保存视图服务端同步；全局搜索命令面板/最近/深链/权限过滤）
- [ ] Task 17: 通知中心与实时状态（SSE last-event-id 游标、已读/归档/撤销/上下文操作、真实邮件/任务/扫描/导出状态、点击准确定位、多标签页已读同步）
- [ ] Task 18: 无障碍性能移动端（WCAG 2.2 AA、axe 无严重/高等级、纯键盘、焦点/Modal/错误摘要/表头/ARIA live、reduced-motion/200%缩放/高对比、bundle budget、虚拟化/分页、CWV 与 p95 基线、Chromium/Firefox/WebKit/移动视口 E2E）

# Task Dependencies
- Task 5/6/8 相互耦合（Outbox/通知/对象存储/Readiness），需协同
- Task 2/3 依赖 config 校验骨架；Task 4 依赖邀请 URL builder
- Task 7 依赖 Task 5 的 task 模型；Task 9 依赖 Task 8 的对象存储
- Task 10 依赖 AI provider 抽象；Task 11 依赖 Task 1-8 的回归
- Task 14-18 在 P0/P1 稳定后并行展开
- 所有任务完成后统一全量验证并提交 origin/main