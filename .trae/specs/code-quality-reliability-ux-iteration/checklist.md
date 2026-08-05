# Checklist

> 状态基于本地可执行验证（lint/tsc/i18n/vitest/build/pytest/alembic）。凡需 Docker/Playwright 真实环境或 CI 运行后方可确认的项，保留未勾选并注明。

## P0 阻塞
- [x] 审批驳回存在独立 `RETURNED` 状态，通过→待确认、驳回→RETURNED，驳回后可修改并重新提交审批
- [x] 非法状态转换由后端返回 409 且无副作用；并发审批使用乐观锁并正确处理冲突
- [x] 审批记录保存操作者、时间、意见与状态变化；Alembic upgrade/downgrade 通过
- [x] 附件扫描器重构为 `FileScanner`/`ScanResult`/`ClamAVScanner`/`NoopScanner` 统一接口
- [x] 上传附件先入 pending，扫描通过才可下载；infected 禁止下载；生产 fail closed
- [x] 校验文件头、真实 MIME、扩展名、大小、路径遍历、双扩展名、伪造 Content-Type、压缩炸弹；服务端重命名
- [x] NoopScanner 仅显式配置用于开发；生产未配置真实扫描器拒启
- [x] `redis`、`boto3` 已加入 requirements.txt；Redis/对象存储客户端含超时与重试
- [x] `APP_ENV=prod` 且要求 Redis/对象存储但不可用 → 拒绝启动，不静默降级内存
- [x] compose 增加 Redis 服务与健康检查；可选 MinIO 服务、bucket 初始化（minio-init）与健康检查
- [x] 对象键/下载权限/临时 URL 严格校验；跨组织附件不可越权读取
- [x] 邀请明文 token 仅在创建/重新生成时返回一次；DB 只存哈希
- [x] 重发保证有效新链接并失效旧链接；已撤销/过期/提交/使用不可重发；并发不产生多有效 token
- [x] 邀请生成、旧 token 失效、投递入队事务一致；恒定时间比较
- [x] 邀请 token/重发相关测试（进程重启、Redis 丢失、重复/并发重发、失败、撤销、已提交）全部通过

## P1 后端可靠性
- [x] 持久化任务队列（Celery+Redis）已引入；邮件/重试/提醒/批量/导出/慢 AI 迁出 `BackgroundTasks`
- [x] 独立 worker 与 beat；幂等键、指数退避、最大重试、任务状态与最后错误、dead-letter
- [x] 事务 outbox 保证 DB 提交成功但任务未入队不丢失；重启后任务不丢失；同事件不重复发
- [x] 任务状态查询 API 与管理员重试 API（权限校验）可用
- [x] 任务队列相关测试（worker 重启、Redis 断开、重复消费、超时）全部通过
- [x] 重复提交报价有唯一约束 + 幂等键 + 409；审批/定标/邀请等已有唯一约束/乐观锁/状态机 409
- [x] 前端对 409 冲突显示可恢复提示；并发与重复请求测试通过
- [x] 组织隔离外键与组合唯一约束、金额 Numeric、高频索引已落实（状态/枚举库级 CHECK 受 SQLite 限制仍由应用状态机保障）
- [x] 事务边界明确、删除/撤销 ondelete=CASCADE、索引、items N+1 消除、列表稳定排序已落实
- [x] 迁移与迁移回滚测试通过（0001→0011 upgrade + downgrade base 均验证）

## P1 安全
- [x] CI 移除 bandit/pip-audit/npm audit 的 `|| true`；Trivy HIGH/CRITICAL 非零退出
- [x] 前端/后端依赖与镜像纳入扫描；失败保存报告（if: always()）；gitleaks secret scanning；SBOM；Actions version 锁定到 commit SHA
- [x] 安全扫描失败阻断 CI（无 continue-on-error）
- [x] 生产启动校验 `SECRET_KEY` 非空非默认≥32；禁 demo/默认账号；强制 CORS 白名单
- [x] 依赖不可用 readiness 失败；未配置真实扫描器拒启；生产禁内存型后端；错误日志脱敏；配置校验单元测试通过
- [x] 组织级资源隔离（资源 ID+组织 ID）、RBAC、登录限流、刷新 token 撤销轮换、改密使会话失效、token 用途区分、Cookie 安全、CSRF 已落实
- [x] IDOR、越权、跨组织、角色边界测试通过（test_auth_hardening）
- [x] 安全响应头（CSP 无 unsafe-inline、frame-ancestors、object-src none、base-uri self、HSTS、nosniff、Referrer/Permissions-Policy）已落实并有自动化测试

## P1 AI
- [x] AI 输出经 Pydantic 严格校验，未验证字段不入库；非法结构可有限修复重试，失败明确降级
- [x] prompt 抽离并版本化；固定测试样本回归测试；注入测试；依赖注入；测试不调用真实付费 API
- [x] 可解释性字段（结论/依据/报价行/异常/风险/模型/降级/时间）返回
- [x] AI 用量 DB 聚合（分页/时间/组织过滤）；并发限制、超时/重试/熔断/预算；并发不绕过预算
- [x] AI 非法结构、超时、限流、熔断、预算耗尽测试通过

## P2 前端体验
- [x] 行动工作台卡片可跳转/筛选/骨架屏/空态/错误重试/移动端可用；组件测试通过（E2E 需 Docker 未本地执行）
- [x] 询价草稿自动保存（状态提示、刷新恢复、并发冲突、复制、模板）；测试通过
- [x] Excel 导入（字段映射、错误行/列/原因、错误报告、部分导入、预览、幂等、异步进度、公式注入防护）；测试通过
- [ ] 供应商门户：步骤导航/进度/倒计时/草稿/提交预览/回执/防重复/375px/axe 已具备；**附件扫描状态显示与修订版本历史依赖后端契约字段，前端未实现**
- [ ] 比价定标：权重/重算/得分组成/异常警告/AI 依据/偏好/权限/导出一致已具备；**结构化定标理由未采集保存**
- [x] 全局搜索（服务端分页、参数校验、视图保存/默认、批量预览/逐条结果/后台队列）；批量部分失败与权限测试通过
- [x] 通知（SSE 重连、补拉、已读、偏好、跳转、无权限状态、去重、统一事件 ID）；断线/重复/权限测试通过
- [x] 无障碍与移动端（label、aria、焦点管理、表头语义、非纯色状态、触控尺寸、axe）；无横向溢出

## P2 性能与一致性
- [x] 后端查询性能（分页、稳定排序、索引、N+1、聚合、流式导出、慢查询日志、性能测试）
- [x] 前端性能（代码拆分、防重请求、取消、防抖、按需加载、体积、性能基线）
- [x] API 一致性（错误码/可读消息/字段级错误/request ID/可重试/冲突详情；分页统一；ISO 8601；金额精度；OpenAPI 一致；contract 测试）

## 可观测性
- [x] request ID 贯穿前后端；任务/业务事件 ID；结构化 JSON 日志；日志脱敏（含邮箱/报价正文）
- [x] Prometheus 风格指标接口（延迟/错误率/队列积压/任务失败/AI/邮件/扫描）；`/health` 存活性与 `/ready` 依赖就绪分离；readiness/依赖故障测试通过

## 最终完成标准
- [x] 前端 lint、tsc、i18n、vitest（392）、build 全部成功
- [x] 后端 pytest（320）全部成功；alembic upgrade head 从空库成功
- [x] migration upgrade 与 downgrade 均经测试
- [ ] docker compose 起服务后 Playwright 真实 E2E 连续运行两次成功（本环境无 Docker，未执行）
- [ ] 最新 commit 提交并推送 origin/main，记录 commit SHA 与各 CI job 状态（CI 在 GitHub Actions 校验）
- [x] 无被静默忽略的测试、安全扫描或运行时异常