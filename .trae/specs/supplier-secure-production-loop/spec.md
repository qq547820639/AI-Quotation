# 供应商安全参与与生产部署闭环（Supplier Secure Production Loop）Spec

## Why

项目当前是"完成度较高的全栈演示/内部试用系统"：供应商门户仍依赖内部采购账号的 Bearer Token 与可预测的 `inquiryId/supplierId` 访问，无资源级数据权限，询价/报价/审批状态无服务端强约束状态机，金额用 Float，无真实通知/附件/AI 后端，生产仍用 SQLite + `create_all`。本轮目标是把项目提升为"真实供应商可以安全参与、关键业务流程可信、能够生产部署的询报价系统"。

## What Changes

- **修复 CI E2E**：定位并修复 `docker-e2e` Playwright 真实前后端失败根因；CI 增加超时失败、服务日志、Playwright trace/截图/视频产物。
- **供应商安全邀请闭环（P0）**：新增 `supplier_invitations` 表；邀请用密码学安全随机 Token、库中只存哈希、绑定唯一询价+供应商、有有效期、支持撤销/重生成/重发；新增独立供应商门户 API（校验邀请/获取询价/草稿/保存/上传删除附件/提交/回执），用邀请 Token 专用鉴权而非内部 Bearer；字段级最小化输出；前端路由改用不可预测邀请 Token；实现 7 种页面状态；禁止真实 API 失败静默回退 mock。
- **组织级与资源级数据权限（P0）**：引入统一资源授权层（Policy）；普通采购默认仅可访问自己创建/负责/被协作/组织共享的询价；创建询价的服务端强制字段（organization/owner/created_by）不信任前端；普通更新不得改 status/organization/created_by/code；所有 list/get/update/delete/action 做资源级校验。
- **服务端强约束状态机（P0）**：将询价/报价/审批状态抽离为领域状态机；非法转换返回结构化 409；普通 PUT 不得改状态；动作接口幂等；支持 `Idempotency-Key`；为合法/非法转换写参数化测试。
- **数据模型与金额正确性（P0）**：金额/单价/税率/总额用 Decimal + Numeric；Date/DateTime 用带时区并 ISO 8601；补齐外键与唯一约束；CheckConstraint/服务端校验（quantity>0、unit_price>=0、delivery_days>=0、合法税率/币种/状态）；服务端重算未税/税额/含税/总额，不信任客户端 total_amount/supplier_name/组织/操作者。
- **鉴权会话安全（P1）**：登出先撤销服务端会话再清本地；库中只存 Token 哈希；短期 Access + 可轮换 Refresh + HttpOnly/Secure/SameSite Cookie；会话列表/单会话撤销/全部退出/Refresh 重用检测；限流与幂等迁移到 Redis；`X-Forwarded-For` 仅可信代理读取；安全响应头（CSP/HSTS/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）；依赖/Secret/SAST/镜像扫描。
- **PostgreSQL 与部署（P1）**：支持 `DATABASE_URL` 用 PostgreSQL；SQLite 仅开发/演示；生产不用 `create_all`，仅 Alembic；新增全新库升级/上一版本升级/关键迁移 downgrade 测试与备份恢复演练文档；Docker 健康检查改 `/api/ready`；Compose 用健康条件控制依赖；开发/测试/生产环境配置示例；密钥不入库。
- **真实通知与附件上传（P1）**：将发送询价改造成异步任务，支持邮件等可扩展渠道、模板/多语言/变量校验/预览、逐供应商交付状态（待发送/已发送/已送达/失败/退信/已打开/已提交）、重发与截止提醒、可重试且幂等；通知绑定用户级未读与偏好；实现真实文件上传（本地或 S3/MinIO），预签名或流式上传、大小/MIME/扩展名/文件名/资源权限校验、进度/取消/重试/预览/删除、病毒扫描预留、下载鉴权、孤儿清理与审计。
- **服务端 AI（P1）**：实现后端 `/api/ai/*`；API Key 只在服务端；可插拔 Provider；超时/有限重试/并发限制/熔断/成本与 Token 统计/结构校验/敏感脱敏/审计；AI 不可用回退本地规则；输出仅标为辅助建议。
- **mock/真实数据隔离（P1）**：演示模式显式环境变量开启；生产构建默认禁止 mock fallback；后端不可用显示离线状态与最后同步时间；统一 React Query（服务端数据/缓存/失效）与 Zustand（客户端 UI 状态）职责。
- **供应商报价体验（P2）**：步骤条（阅读/填写/上传/检查/提交成功）；防抖自动保存与保存状态；未保存离开提示与草稿恢复；提交前错误摘要并可定位；批量税率/交期/付款、Excel 导入/模板导出/复制上一轮；移动端物料卡片+底部操作栏；上传进度/重试/错误；回执编号/时间/总额/下载；撤回/修订状态规则；无障碍。
- **采购端体验（P2）**：服务端分页/筛选/搜索/排序；搜索筛选状态同步 URL；用户保存视图与列配置持久化到服务端；SSE/WebSocket 实时未读/详情/比价/通知；用户级通知中心与偏好；比价页币种统一/税费标准化/运费/付款折算/交期/质保/历史履约/技术商务偏离/总拥有成本；定标创建不可变报价快照；服务端 PDF/Excel；缺失/部分/币种/异常报价空态与风险提示。
- **国际化与前端工程治理（P2）**：扫描硬编码文案全入 i18n；CI 增缺失/未用翻译键检查；拆分超大页面组件（供应商报价/比价）；抽取表单 Schema/领域 Hook/API Hook/状态组件/格式化/权限守卫；Error Boundary、路由懒加载、性能监控；减少重复请求与渲染。
- **测试与质量门禁（P2）**：按 15 项清单补齐测试；CI 任意关键任务失败即禁止完成。

**BREAKING**：
- 供应商门户访问从 `/supplier-portal/:inquiryId/:supplierId` 改为 `/supplier-portal/:invitationToken`（不可预测邀请 Token）。
- 供应商门户鉴权从内部 Bearer Token 改为邀请 Token 专用鉴权。
- 金额字段从 Float 改为 Decimal（API 序列化为字符串或保留精度数字）。
- 生产启动不再调用 `Base.metadata.create_all`，仅 Alembic 管理 schema。
- 创建询价的 `organization/owner_id/owner_name/created_by_id/created_by_name` 由服务端强制生成，前端提交这些字段将被忽略。
- 普通更新接口不再允许修改 `status/organization/created_by/code`。

## Impact

- Affected specs: 认证鉴权、供应商门户、询价、报价、审批、定标、通知、附件、AI、列表、比价、国际化、部署。
- Affected code:
  - 后端：`backend/app/models.py`、`schemas.py`、`serializers.py`、`auth.py`、`config.py`、`database.py`、`seed.py`、`main.py`、`routers/*`、新增 `invitations.py`/`portal.py`/`notify.py`/`upload.py`/`ai.py`/`state_machine.py`/`policy.py`/`refresh.py`、`alembic/versions/*`、`tests/*`。
  - 前端：`src/router/*`、`src/pages/supplier-portal/*`、`src/api/*`、`src/store/*`、`src/services/*`、`src/pages/quotation/compare/*`、`src/pages/inquiry/*`、`src/hooks/*`、`src/components/*`、`src/locales/*`、`e2e/*`。
  - 工程：`.github/workflows/ci.yml`、`docker-compose.yml`、`Dockerfile*`、`nginx.conf`、`README.md`、`CHANGELOG.md`、`docs/*`、`.env.example`。

## ADDED Requirements

### Requirement: 供应商安全邀请
系统 SHALL 用 `supplier_invitations` 表建模邀请，邀请 Token 使用密码学安全随机值、库中只存哈希、绑定唯一询价+供应商、带有效期、可撤销/重生成/重发；通过枚举 ID 无法访问其他供应商或询价单。

#### Scenario: 供应商用邀请 Token 访问
- **WHEN** 供应商通过不可预测邀请 Token 访问门户
- **THEN** 进入对应询价报价流程，且仅见绑定询价与自身字段，看不到其他受邀供应商/报价/内部备注/目标价/审批/日志

### Requirement: 资源级数据权限
系统 SHALL 为询价等核心业务提供资源授权层，普通采购仅可访问自己创建/负责/被协作/组织共享的询价；创建询价的 `organization/owner/created_by` 由服务端生成；跨组织/跨用户访问被拒绝。

### Requirement: 服务端状态机
系统 SHALL 将询价/报价/审批状态定义为领域状态机，非法转换返回结构化 409，动作接口幂等并支持 `Idempotency-Key`。

### Requirement: 金额精度
系统 SHALL 用 Decimal/Numeric 存储金额，服务端迫真重算未税/税额/含税/总额，不信任客户端金额/供应商名/组织/操作者。

### Requirement: 短期令牌 + 刷新令牌会话
系统 SHALL 提供短期 Access Token + 可轮换 Refresh Token（HttpOnly/Secure/SameSite Cookie），支持会话列表、单会话撤销、全部退出与 Refresh 重用检测。

### Requirement: 真实通知与附件
系统 SHALL 通过异步可重试任务发送询价（支持邮件等渠道），逐供应商记录交付状态；附件 SHALL 走真实上传服务（本地/S3/MinIO），校验大小/MIME/扩展名/文件名/资源权限，支持进度/取消/重试/预览/删除与下载鉴权。

### Requirement: 服务端 AI
系统 SHALL 提供后端 `/api/ai/*`，API Key 仅存服务端，可插拔 Provider，带超时/重试/并发/熔断/成本统计/结构校验/脱敏/审计，不可用时回退本地规则，输出仅标注为辅助建议。

## MODIFIED Requirements

### Requirement: 数据范围与状态机替代宽松校验
原先"仅校验功能权限"改为"功能权限 + 资源级授权"双重校验；原先"直接改状态"改为"状态机驱动"。

### Requirement: 供应商门户从内部鉴权改为邀请鉴权
供应商门户不再使用内部采购 Bearer Token，改用邀请 Token 专用鉴权，真实 API 失败不再静默回退 mock。

### Requirement: 部署与迁移
生产运行由 SQLite + `create_all` 改为 PostgreSQL（`DATABASE_URL`）+ 仅 Alembic 管理 schema；`/api/health` 区分 liveness/readiness，`/api/ready` 用于容器健康检查。

## REMOVED Requirements

### Requirement: 供应商门户直接以可预测 ID 访问
**Reason**: 无法保证安全边界，易被枚举访问他供应商数据。
**Migration**: 前端路由改为 `/supplier-portal/:invitationToken`，后端按邀请 Token 鉴权。

### Requirement: 生产使用 `create_all`
**Reason**: 生产 schema 必须由迁移管理，避免隐式变更。
**Migration**: 生产启动仅 Alembic；`create_all` 仅保留开发/测试路径。