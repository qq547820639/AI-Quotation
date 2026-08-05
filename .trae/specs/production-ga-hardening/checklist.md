# Checklist

> 状态以本地可执行验证（lint/tsc/i18n/vitest/build/pytest/alembic）为准；需 Docker/Playwright/CI 的项目保留未勾选并注明。

## P0
- [ ] CI 创建独立临时 PostgreSQL 库并跑通 `alembic upgrade head`，校验表/约束/索引
- [ ] PostgreSQL 集成测试覆盖 CRUD/事务回滚/唯一约束/并发写入且可靠清理；未被静默跳过
- [ ] pytest-cov 禁用与 `--cov` 注入无冲突
- [ ] SQLAlchemy 2 统一命名参数绑定
- [ ] 生产 Compose 提供合规 `.env` 后可一键启动
- [ ] SECRET_KEY/DB 密码/S3 密钥/管理员凭证使用 fail-fast，无明文默认值
- [ ] `CORS_ORIGINS` 支持 JSON 数组或逗号分隔并严格校验
- [ ] 生产 Secure Cookie/SameSite/HSTS/代理头/HTTPS 判断/PUBLIC_APP_URL 正确
- [ ] `.env.example`、`.env.production.example`、密钥生成命令、首部署步骤已提供
- [ ] production-like Compose E2E 证明服务健康
- [ ] 生产启动不无条件 Seed；`seed-demo` 仅 dev/test/demo
- [ ] `bootstrap-admin` 幂等创建首位管理员，无明文密码入日志
- [ ] 生产不自动用 DEMO_USER_PASSWORD 回填历史密码
- [ ] 空生产库迁移后无演示数据（有测试证明）
- [ ] 邀请 canonical URL 统一为 `/supplier-portal/{token}`，无 `/portal?token=...`
- [ ] PUBLIC_APP_URL 启动校验（HTTPS/禁 localhost/禁末尾重复/子路径）
- [ ] 真实邮件邀请-提交 E2E 通过
- [ ] token 过期/撤销/重发/重复/并发/非法测试通过
- [ ] compose 含 celery-worker + outbox-dispatcher（+beat/监控）并真正运行
- [ ] Readiness 识别"Redis 可用但 Worker 未消费"
- [ ] Outbox 与业务实体同 Session 同事务；多副本 `FOR UPDATE SKIP LOCKED`/租约
- [ ] 记录 attempt/next_retry_at/locked_by/locked_until/最终失败原因
- [ ] Outbox 故障注入测试（Redis 断/Worker 重启/API 崩溃/重复/多 Worker/确认前终止）通过
- [ ] 至少一次投递下靠业务幂等最终正确
- [ ] prod 下 NOTIFY_CHANNEL=log 拒启；email 但 SMTP 不全拒启；禁回退 LogNotifier
- [ ] 邮件投递记录字段齐全；提供 Provider 接口与退信/投递/打开 Webhook 设计
- [ ] 批量通知逐项结果；部分失败不返回无条件 ok
- [ ] 邮件任务失败抛可重试异常进入 retry/dead-letter
- [ ] compose 含 Mailpit/MailHog
- [ ] `/api/tasks`/重试/`/api/metrics`/`/api/health`/`/api/ready` 授权与脱敏正确
- [ ] `/api/metrics` 为内部/管理员端点或独立监控端口
- [ ] `/api/health` 不返回原始 DB 异常；详细异常入脱敏日志
- [ ] IDOR/横向越权/跨组织/信息泄露测试通过
- [ ] S3/MinIO 探活（head bucket/写读删临时对象，有限超时）
- [ ] 生产强制 S3/MinIO，禁静默回退本地磁盘
- [ ] Readiness 覆盖 PostgreSQL/Redis/Worker/S3/ClamAV；等待 bucket 初始化
- [ ] ClamAV EICAR 测试通过（正常/感染/不可用 fail-closed/扫描完前不可下载或提交）
- [ ] 扩展名/声明 MIME/magic bytes/内容校验防双扩展名与 MIME 欺骗

## P1
- [ ] 异步导出保存 S3/MinIO + ExportJob 全状态 + SSE 通知 + 短时下载 URL + 重新生成/取消/清理/重试
- [ ] 前端显示导出真实进度/失败原因/重新执行
- [ ] 导出大数据量/超时/重启/存储失败/权限测试通过
- [ ] AI 慢任务用当前 Provider，不硬编码；fallback 记录原因
- [ ] AI schema/prompt 版本/provider/model/token成本/timeout/熔断/缓存/反馈/审计齐全
- [ ] AI 展示依据/使用字段/缺失数据/不确定性；不绕过审批权限
- [ ] AI malformed/超时/限流/超预算/Provider 故障/注入测试通过
- [ ] 前端覆盖率分阶段 ≥60%，核心模块 ≥80%；后端 ≥80%、核心安全/状态机 ≥90%
- [ ] mutation 或等价测试有效性验证
- [ ] 所有已修复 P0 问题有回归测试；CI 不跳过失败测试
- [ ] pip-audit 明确审计 backend 依赖；Python 锁文件+哈希
- [ ] 安全扫描成败都出报告且保留退出码；Trivy 输出目录挂载
- [ ] 镜像明确版本/digest；Dependabot/Renovate；provenance/SBOM/签名
- [ ] Docker E2E 依赖安全扫描成功或全 Job 必需
- [ ] 状态迁移库级约束+服务层校验；统一乐观锁/409
- [ ] 并发场景测试（双人编辑/审批撤回/重复提交/邀请重发/重复通知/Outbox 抢占）通过
- [ ] N+1/无索引/无限列表消除；游标分页或稳定排序；PostgreSQL 查询计划与性能基线

## P2
- [ ] 供应商门户拆分为模块 + 状态机；刷新/断网恢复；保存状态区分；冲突差异比较
- [ ] 移动端固定底部主操作；附件扫描状态；提交预览；回执打印
- [ ] 比价权重模板/复制/按品类复用；What-if 场景；缺失/不可比/换算时间/新鲜度展示
- [ ] 计算依据展开；逐物料推荐与组合授标；TCO/MOQ/付款/风险/履约
- [ ] 表格键盘导航/冻结列/虚拟滚动/列偏好/读屏
- [ ] 采购工作台可执行卡片 + 一键下一步 + 批量提醒/延期/指派/归档
- [ ] 用户级保存视图服务端同步；全局搜索命令面板/最近/深链/权限过滤
- [ ] SSE last-event-id 游标；通知已读/归档/撤销/上下文操作；真实状态展示；点击定位；多标签页已读同步
- [ ] WCAG 2.2 AA；axe 无严重/高等级；纯键盘；焦点/Modal/错误摘要/表头/ARIA live
- [ ] reduced-motion/200% 缩放/高对比；bundle budget；虚拟化/分页；CWV 与 p95 基线
- [ ] Chromium/Firefox/WebKit/移动视口核心 E2E

## 最终
- [ ] 同一 commit SHA 的 GitHub Actions 全绿
- [ ] 前端 lint/tsc/i18n/unit/coverage/build 全通过
- [ ] 后端 lint/unit/API 集成/权限/状态迁移/coverage 全通过
- [ ] 真实 PostgreSQL 迁移与集成测试通过且未被 skip
- [ ] 安全扫描无未豁免 HIGH/CRITICAL；豁免注明原因/负责人/截止
- [ ] Production-like Compose 从空数据卷可启动
- [ ] 生产启动不写演示数据
- [ ] API/Worker/Redis/PostgreSQL/MinIO/ClamAV/测试邮件均有真实健康证据
- [ ] 完整供应商邮件邀请-报价提交 E2E 通过
- [ ] 异步任务在 Worker 重启/Redis 故障/重复投递下最终正确
- [ ] 导出文件可实际下载
- [ ] 任务/指标/健康/业务资源无跨用户或跨组织越权
- [ ] README/环境变量示例/部署文档/API 文档与实际行为一致
- [ ] 提交并推送 origin/main，给出最终 commit SHA 与 Production Ready Yes/No