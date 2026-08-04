# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。未发布的变更列入 `[Unreleased]`。

## [Unreleased]

### 新增（本迭代：供应商安全参与与生产部署闭环）

- **供应商安全邀请闭环（P0）**
  - 新增 `supplier_invitations` 表（`id/inquiry_id/supplier_id/token_hash/expires_at/status/created_at/sent_at/first_opened_at/last_opened_at/submitted_at/revoked_at/created_by`），`token_hash` 唯一。
  - 邀请 Token 采用密码学安全随机值，库中仅存哈希，绑定唯一询价+供应商，带有效期，支持撤销/重新生成/重新发送。
  - 供应商门户改为独立 API + 邀请 Token 专用鉴权（不再依赖内部采购 Bearer Token），字段级最小化输出，枚举 ID 无法越权。
  - 前端路由改为 `/supplier-portal/:invitationToken`，实现 7 种页面状态（有效/过期/撤销/已提交/允许修订/已截止/已取消）。
  - 真实 API 失败不再静默回退 mock。

- **组织级与资源级数据权限（P0）**
  - 新增统一资源授权层（`backend/app/policy.py`），普通采购默认仅可访问自己创建/负责/被协作/组织共享的询价。
  - 创建询价的 `organization/owner_id/owner_name/created_by_id/created_by_name` 由服务端强制生成，不信任前端。
  - 普通更新不得修改 `status/organization/created_by/code`；所有 list/get/update/delete/action 均执行资源级校验。

- **服务端强约束状态机（P0）**
  - 新增 `backend/app/state_machine.py`，询价/报价/审批状态机化，非法转换返回结构化 409，普通 PUT/PATCH 不得直接修改状态。
  - 动作接口幂等，`Idempotency-Key` 支持（发送邀请/提交报价/提交审批/确认定标）。

- **数据模型与金额正确性（P0）**
  - 金额/单价/税率/总额改用 Decimal + Numeric；时间用带时区 DateTime + ISO 8601。
  - 补齐外键（`quotation.supplier_id`、`quotation_item.inquiry_item_id`、`notification.user_id`、附件归属）。
  - 唯一约束（供应商在询价中有效报价唯一、审批节点顺序/当前待审批唯一、`token_hash` 唯一）。
  - CheckConstraint/服务端校验（`quantity>0`、`unit_price>=0`、`delivery_days>=0`、合法税率/币种/状态）。
  - 服务端重算未税/税额/含税/总额，不信任客户端 `total_amount/supplier_name/组织/操作者`。

- **鉴权会话安全（P1）**
  - 登出先携带凭据撤销服务端会话再清本地；库中只存 Token 哈希。
  - 短期 Access + 可轮换 Refresh + HttpOnly/Secure/SameSite Cookie；会话列表/单会话撤销/全部退出/Refresh 重用检测。
  - 限流与幂等数据迁移到 Redis（可多实例）；`X-Forwarded-For` 仅可信代理读取。
  - 安全响应头（CSP/HSTS/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）。
  - CI 增加依赖漏洞扫描、Secret 扫描（gitleaks）、SAST（bandit）、容器镜像扫描（Trivy）。

- **PostgreSQL 与部署（P1）**
  - 支持 `DATABASE_URL` 使用 PostgreSQL；SQLite 仅开发/演示；生产不再调用 `create_all`，仅由 Alembic 管理。
  - 新增全新库升级/上一版本升级/关键迁移 downgrade 测试；Docker 健康检查改用 `/api/ready`；Compose 健康条件控制依赖。
  - 开发/测试/生产环境配置示例；密钥全部通过 Secret/环境变量注入。

- **真实通知与附件上传（P1）**
  - 发送询价改造为异步可重试任务，支持邮件等可扩展渠道、模板/多语言/变量校验/预览。
  - 逐供应商交付状态（待发送/已发送/已送达/失败/退信/已打开/已提交），支持重发与截止提醒；发送失败不再显示"全部发送成功"。
  - 通知绑定用户级未读与偏好。
  - 真实文件上传服务（本地存储/S3/MinIO），预签名或流式上传，校验大小/MIME/扩展名/文件名/资源权限，支持进度/取消/重试/预览/删除、病毒扫描预留、下载鉴权、孤儿清理与审计日志。

- **服务端 AI（P1）**
  - 新增后端 `/api/ai/*`，API Key 仅存服务端，可插拔 Provider。
  - 超时/有限重试/并发限制/熔断/成本与 Token 统计/结构化输出校验/敏感字段脱敏/审计记录。
  - AI 不可用回退本地规则；输出仅标注为辅助建议。

- **mock 与真实数据隔离（P1）**
  - 演示模式显式环境变量开启；生产构建默认禁止 mock fallback。
  - 后端不可用显示离线状态与最后同步时间；缓存标明是否过期；不再无提示回退 localStorage。
  - 统一 React Query（服务端数据/缓存/失效）与 Zustand（客户端 UI 状态）职责。

- **供应商报价体验（P2）**
  - 报价流程步骤条（阅读/填写/上传/检查/提交成功）；防抖自动保存 + 保存中/已保存/保存失败/最后保存时间。
  - 未保存离开提示与草稿恢复；提交前错误摘要并可定位到具体物料/字段。
  - 批量税率/交期/付款；Excel 模板导出/导入；复制上一轮报价。
  - 移动端物料卡片 + 底部固定操作栏；上传进度/重试/错误原因；回执编号/时间/总额/下载回执；撤回/修订状态规则；无障碍（键盘/焦点/屏幕阅读器/WCAG）。

- **采购端体验（P2）**
  - 列表查询改服务端分页/筛选/搜索/排序；搜索筛选状态同步 URL；用户保存视图与列配置持久化到服务端。
  - SSE 实时更新（未读/详情/比价/通知）；用户级通知中心与偏好。
  - 比价页增强（币种统一/税费标准化/运费/付款折算/交期/质保/历史履约/技术商务偏离/总拥有成本）；推荐原因/异常值/缺失数据解释。
  - 定标创建不可变报价快照；服务端生成 PDF/Excel；未报价/部分报价/不同币种/异常报价的空态与风险提示。

- **国际化与前端工程治理（P2）**
  - 硬编码文案全入 i18n；CI 增加缺失/未用翻译键检查；拆分超大页面组件；抽取表单 Schema/领域 Hook/API Hook/状态组件/格式化/权限守卫；Error Boundary/路由懒加载/性能监控。

- **测试与质量门禁（P2）**
  - 新增测试：邀请 Token 安全、组织/资源越权、状态机参数化、金额精度、并发/乐观锁、幂等、数据库迁移、PostgreSQL 集成、文件上传安全、AI 超时/回退/结构校验、中英文 E2E、多浏览器/移动端 E2E、axe 无障碍。
  - 覆盖率门禁：后端 `--cov-fail-under=80`（实测 81.18%）、前端 vitest thresholds 30%。
  - CI 任意关键任务失败即禁止视为完成（quality/build/backend-test/security-scan/docker-e2e）。

### 修复

- 修复 E2E 仍使用旧 `/supplier-portal/:inquiryId/:supplierId` 路由的问题，改为通过有效邀请 Token 访问。
- 修复 E2E 登录辅助函数默认密码与后端演示密码不一致（`test123` → `123456`）导致登录 401 的问题。
- 修复 `regenerate_invitation` 通过重建记录违反 `(inquiry_id, supplier_id)` 唯一约束的问题，改为在原记录上原地更新 Token。
- CI `docker-e2e` 增加超时失败、服务日志转储、Playwright trace/截图/视频产物，便于后续定位。

### BREAKING

- 供应商门户访问从 `/supplier-portal/:inquiryId/:supplierId` 改为 `/supplier-portal/:invitationToken`。
- 供应商门户鉴权从内部 Bearer Token 改为邀请 Token 专用鉴权。
- 金额字段从 Float 改为 Decimal（API 序列化为字符串或保留精度数字）。
- 生产启动不再调用 `Base.metadata.create_all`，仅 Alembic 管理 schema。
- 创建询价的 `organization/owner_id/owner_name/created_by_id/created_by_name` 由服务端强制生成，前端提交将被忽略。
- 普通更新接口不再允许修改 `status/organization/created_by/code`。

### 文档

- 更新 `README.md`（测试数量与实际一致）、`CHANGELOG.md`、`docs/deployment.md`、`docs/architecture.md` 与 `.env.example`。

---

## 历史版本

- `feat: production readiness (migration, observability, AI abstraction, tests, a11y, mobile)` — 生产就绪迭代（迁移/Alembic、可观测性、AI 抽象、测试、无障碍、移动端）。
- `feat: state model & compare UX` — 状态模型与比价体验（评审意见保存保护、导出反馈、比价守卫）。
- `feat: data consistency & error recovery` — 数据一致性与错误恢复（写结果、并发 409、服务端编号、axios）。
- `feat: production security & auth` — 生产安全与鉴权（bcrypt、Token 过期/撤销、限流、401 流程）。
- `feat: reliability hardening & enterprise UX` — 可靠性加固与企业级体验（可靠性、权限、比价、E2E、CI）。
- `refactor: deep iteration & UX optimization` — 深度迭代与 UX 优化。
