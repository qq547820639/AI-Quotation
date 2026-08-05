# Tasks

> 所有任务以代码、测试、CI 运行结果为完成唯一依据。所有数据库结构变化必须提供 Alembic migration 且 upgrade/downgrade 均经测试。P0 优先，P1 并行，P2 聚焦可测试项。

## P0：阻塞问题

- [x] Task 1: 审批驳回状态机（后端）
  - [x] 1.1 在 `state_machine.py` 增加 `RETURNED` 状态与合法转换（`PENDING_APPROVAL->RETURNED`、`RETURNED->PENDING_APPROVAL` 等），保持既有快乐路径
  - [x] 1.2 模型增加并发乐观锁 `version` 字段与审批记录（操作者/时间/意见/状态变化），新增 Alembic migration 0008
  - [x] 1.3 审批接口实现通过/驳回分支，非法转换返回 409，并发用乐观锁
  - [x] 1.4 增加状态机单元测试、API 测试（通过/驳回/重编辑/非法转换/并发/乐观锁冲突）

- [x] Task 2: 附件扫描统一接口
  - [x] 2.1 重构 `scanner.py` 为 `FileScanner`(ABC) / `ScanResult` / `ClamAVScanner` / `NoopScanner`，统一 `scan(path|bytes) -> ScanResult`
  - [x] 2.2 上传后附件先入 `pending`，扫描通过才允许下载；infected 禁止下载；扫描失败/不可用生产 fail closed
  - [x] 2.3 校验文件头、真实 MIME、扩展名、大小、路径遍历、双扩展名、伪造 Content-Type、压缩炸弹；服务端重命名
  - [x] 2.4 NoopScanner 仅显式配置用于开发；生产未配置真实扫描器拒启
  - [x] 2.5 compose 增加可选 ClamAV 服务与健康检查；附件扫描状态迁移字段
  - [x] 2.6 增加 clean/infected/timeout/scanner unavailable/恶意文件名/并发上传测试

- [x] Task 3: Redis 与对象存储补齐
  - [x] 3.1 将 `redis`、`boto3` 加入 requirements.txt；`redis_client` 增加连接超时与重试
  - [x] 3.2 `APP_ENV=prod` 且配置要求 Redis/对象存储但不可用 → 拒绝启动（不静默降级内存）
  - [x] 3.3 compose 增加 Redis 服务与健康检查；可选 MinIO 服务、bucket 初始化（minio-init）与健康检查
  - [x] 3.4 对象键/下载权限/临时 URL 严格校验；跨组织附件不可越权读取
  - [x] 3.5 增加 Redis 与对象存储集成测试

- [x] Task 4: 邀请 token 与重发逻辑
  - [x] 4.1 重发语义统一：明文 token 仅在创建/重新生成时返回一次；明文丢失自动生成新 token 并使旧失效
  - [x] 4.2 已撤销/过期/提交/使用不可重发；并发重发不产生多有效 token（事务锁/唯一约束）
  - [x] 4.3 邀请生成、旧 token 失效、投递入队事务一致（outbox）；恒定时间比较
  - [x] 4.4 增加进程重启、Redis 丢失、重复/并发重发、发送失败、撤销、已提交测试

## P1：后端可靠性

- [x] Task 5: 持久化任务队列
  - [x] 5.1 引入 Celery + Redis，将邮件发送/重试/截止提醒/批量通知/导出/慢 AI 迁出 `BackgroundTasks`
  - [x] 5.2 独立 worker 与 beat scheduler；幂等键、指数退避、最大重试、任务状态与最后错误、dead-letter
  - [x] 5.3 事务 outbox：DB 提交成功但任务未入队不丢失；进程重启未完成任务不丢；同业务事件不重复发
  - [x] 5.4 任务状态查询 API 与管理员重试 API（权限校验）
  - [x] 5.5 增加 worker 重启、Redis 短暂断开、重复消费、任务超时测试

- [x] Task 6: 并发与幂等
  - [x] 6.1 对重复提交报价/审批/定标/邀请/AI/导出/提醒增加唯一约束、幂等键、乐观锁、409
  - [x] 6.2 前端冲突时显示可恢复提示
  - [x] 6.3 并发与重复请求测试

- [x] Task 7: 数据库约束与事务
  - [x] 7.1 组织隔离外键与组合唯一约束；状态/枚举库级约束；金额 Decimal/Numeric；时间统一 UTC
  - [x] 7.2 明确事务边界、删除/撤销处理关联、高频查询索引、N+1 消除、列表稳定排序
  - [x] 7.3 迁移与迁移回滚测试

## P1：安全加固

- [x] Task 8: CI 安全强门禁
  - [x] 8.1 移除 bandit/pip-audit/npm audit 的 `|| true`；Trivy HIGH/CRITICAL 非零退出
  - [x] 8.2 前端/后端依赖与镜像纳入扫描；失败保存报告 artifact；secret scanning；SBOM；锁定 Actions 版本
  - [x] 8.3 所有安全扫描失败阻断 CI

- [x] Task 9: 生产配置校验
  - [x] 9.1 启动时校验 `SECRET_KEY` 非空非默认且长度足够；禁 demo/默认账号；强制 CORS 白名单
  - [x] 9.2 依赖不可用则 readiness 失败；未配置真实扫描器拒启；生产禁内存型后端；错误日志脱敏
  - [x] 9.3 配置校验单元测试

- [x] Task 10: 认证与权限加固
  - [x] 10.1 组织级资源隔离（资源 ID+组织 ID 同时查询）；RBAC 校验；禁止仅前端隐藏实现权限
  - [x] 10.2 登录限流；刷新 token 撤销轮换；改密使会话失效；token 用途区分；Cookie Secure/HttpOnly/SameSite；CSRF
  - [x] 10.3 IDOR、越权、跨组织、角色边界测试

- [x] Task 11: 安全响应头
  - [x] 11.1 CSP（无 unsafe-inline）、frame-ancestors、object-src none、base-uri self、HSTS、nosniff、Referrer/Permissions-Policy
  - [x] 11.2 安全头自动化测试

## P1：AI 深化

- [x] Task 12: AI 强结构化输出与版本
  - [x] 12.1 优先 structured output/tool calling，否则严格 JSON 校验；Pydantic 校验所有 AI 输出；禁止未验证字段入库
  - [x] 12.2 非法结构有限次结构修复重试，失败明确降级；保存模型/prompt 版本/耗时/降级状态
  - [x] 12.3 prompt 抽离并版本化；固定测试样本；报价异常/供应商推荐/询价生成回归测试；注入测试；依赖注入

- [x] Task 13: AI 可解释性与用量
  - [x] 13.1 后端返回结论/数据依据/报价行/异常/风险/模型/降级/时间；前端可展开定位、仅供参考标注、失败重试
  - [x] 13.2 用量 DB 聚合（分页/时间/组织过滤）；并发限制；超时/重试/熔断/预算；禁止并发绕过预算
  - [x] 13.3 超时/限流/熔断/预算耗尽测试

## P2：前端体验与性能

- [x] Task 14: 行动工作台（Dashboard 增卡片：待发送/即将截止/未报价/发送失败/异常报价/待审批/超时/待定标，可跳转、筛选、骨架屏、空态、错误重试、移动端；组件测试+E2E）
- [x] Task 15: 询价草稿与自动保存（服务端草稿、防抖自动保存、状态提示、刷新恢复、并发冲突检测、复制历史、存模板；自动保存失败/网络恢复/并发测试）
  - [x] 15.1 新建询价立即创建草稿；表单变更防抖自动保存；状态机 idle/saving/saved/failed/offline
  - [x] 15.2 页面刷新恢复草稿；登录过期后本地保留未提交内容；离开未保存页面 beforeunload + useBlocker 拦截
  - [x] 15.3 storage 事件检测并发编辑冲突，提供覆盖/重新加载；复制历史询价；保存/加载/清除模板
  - [x] 15.4 测试：draft.test.ts（自动保存失败/网络恢复/冲突）、useInquiryDraft.test.ts（保存/离线/模板/冲突）真实断言
- [x] Task 16: Excel 导入体验（字段映射、表头识别、错误行/列/原因、错误报告下载、部分导入、预览、幂等、异步大文件、进度、公式注入防护；测试）
- [ ] Task 17: 供应商门户体验（步骤导航、进度、倒计时、服务端草稿、附件扫描状态、提交预览、回执、状态区分、防重复提交、修订版本、375px、键盘/读屏；移动端+无障碍 E2E）
- [ ] Task 18: 比价与定标体验（权重配置、实时重算、后端同算校验、得分组成、异常警告、AI 依据定位、偏好保存、结构化定标理由、权限、导出一致；计算/API/E2E 测试）
- [x] Task 19: 搜索筛选批量（全局搜索、服务端分页、参数校验、索引、不整表扫描、保存视图、默认视图、批量预览/逐条结果/后台任务；批量部分失败与权限测试）
  - [x] 19.1 全局搜索跨询价/供应商/物料/报价，服务端分页 + 参数严格校验（searchApi + /search mock），防全表扫描
  - [x] 19.2 保存筛选视图/默认视图（useSavedViews + 列表页集成，localStorage 持久化）
  - [x] 19.3 批量发送/提醒/导出/负责人调整（useBatchInquiries + list 页集成），执行前预览、逐条结果、导出后台队列
  - [x] 19.4 测试：useSavedViews.test.ts、useBatchInquiries.test.ts（含批量部分失败与权限由调用方控制不伪造成功）
- [x] Task 20: 通知体验（SSE/WS 重连、补拉、全部/单条已读、类型偏好、跳转、无权限/已删除状态、去重、统一事件 ID；断线重连/重复/权限测试）
- [x] Task 21: 无障碍与移动端（label 关联、aria-describedby、弹窗焦点管理、表头语义、非纯色状态、键盘操作、触控尺寸、375/768/桌面无横向溢出、axe 检查）

## P2：性能与一致性

- [x] Task 22: 后端查询性能（服务端分页、稳定排序、索引、N+1 消除、selectinload/joinedload、DB 聚合、流式导出、慢查询日志、性能测试）
- [x] Task 23: 前端性能（路由级代码拆分、虚拟列表/分页、防重复请求、请求取消、搜索防抖、避免过度重渲染、上传进度/取消、按需加载、体积检查、性能基线）
- [x] Task 24: API 一致性（统一响应/错误格式：错误码、可读消息、字段级错误、request ID、可重试、冲突详情；分页统一结构；ISO 8601；金额精度；OpenAPI 一致；contract 测试）

## 可观测性

- [x] Task 25: 可观测性完善（request ID 贯穿、前后端关联、任务/业务事件 ID、结构化 JSON 日志、日志脱敏、Prometheus 指标或等效接口、`/health` 存活性与 `/ready` 依赖就绪分离；readiness/依赖故障测试）

## 最终验证与提交

- [x] Task 26: 全量验证与提交
  - [x] 前端：`npm run lint && npx tsc --noEmit && npm run i18n:check && npx vitest run && npm run build`
  - [x] 后端：`alembic upgrade head`（空库）+ downgrade base + pytest 全部通过
  - [x] 逐项核对 checklist.md，修正失败项
  - [x] 按用户要求提交并推送 origin/main，报告 commit SHA 与各 job 状态

# Task Dependencies
- Task 1/2 可并行；Task 3 依赖 config 校验骨架（可与 Task 9 协同）
- Task 4 依赖邀请相关的 models/outbox 基础（可与 Task 5 的 outbox 复用）
- Task 5 依赖 Task 3（Redis）；Task 6 依赖数据库约束（Task 7）
- Task 8/9/10/11 相互独立可并行
- Task 12/13 可并行
- Task 14-24 在 P0/P1 稳定后并行展开
- Task 26 依赖全部任务