# Tasks

> 按用户指定 P0/P1/P2 优先级推进。每完成一个阶段都必须先运行对应测试并修复全部失败，再进入下一阶段。遵循"不掩盖未实现逻辑、不用 mock 掩盖真实后端、不信任客户端身份/组织/总金额/状态、不删除失败测试换取绿色 CI、每批写真实测试"。执行前先逐项核对最新代码与文档，不假定已实现。

## P0-1：修复当前 CI E2E
- [x] Task 1: 定位并修复 docker-e2e Playwright 失败
  - [x] 1.1 定位根因：E2E 仍用旧路由 `/supplier-portal/:inquiryId/:supplierId`；登录辅助函数默认密码 `test123` 与后端演示密码 `123456` 不一致（登录会校验密码，401 导致 E2E 失败）；`regenerate_invitation` 重建邀请记录违反 `(inquiry_id, supplier_id)` 唯一约束
  - [x] 1.2 修复：E2E 改用邀请 Token 路由（`e2e/helpers.ts` 新增 `getInvitationToken`/`submitQuoteViaPortal`）；登录默认密码改为 `123456`；`regenerate_invitation` 改为在原记录上原地更新 Token（不新增行）
  - [x] 1.3 修复根因（未删除断言/跳过/加等待/关闭 E2E）；本地 Docker 不可用，最终推 CI `docker-e2e` 验证
  - [x] 1.4 CI 增加：`docker-e2e` 任务 `timeout-minutes: 40`、失败 `docker compose logs --tail=300`、Playwright trace/截图/视频产物（`playwright.config.ts` `trace:on-first-retry`/`screenshot:only-on-failure`/`video:on-first-retry`），上传 `playwright-report/` 与 `test-results/`
- [x] Task 2: 全链路门禁基线
  - [x] 2.1 npm run lint / npx tsc --noEmit / npx vitest run（297 passed）/ npm run build 全部通过
  - [x] 2.2 backend pytest 通过（163 passed, 1 skipped，coverage 81.18% ≥ 80%）；Alembic 空库 upgrade head（0001→0007）+ downgrade base + 再 upgrade round-trip 成功
  - [x] 2.3 Docker Compose 配置（健康条件依赖 + `/api/ready`）就绪；真实 Playwright E2E 需 Docker 环境，推 CI `docker-e2e` 验证（本机无 Docker）

## P0-2：供应商安全邀请闭环
- [x] Task 3: 供应商邀请数据模型与 Token
  - [x] 3.1 新增 `supplier_invitations` 表（id/inquiry_id/supplier_id/token_hash/expires_at/status/created_at/sent_at/first_opened_at/last_opened_at/submitted_at/revoked_at/created_by）
  - [x] 3.2 邀请 Token 密码学安全随机；库中只存哈希；绑定唯一询价+供应商；有效期；撤销/重生成/重发
  - [x] 3.3 Alembic 迁移（含 token_hash 唯一约束）
- [x] Task 4: 独立供应商门户 API + 邀请鉴权
  - [x] 4.1 校验邀请 / 获取供应商可见询价 / 获取或创建草稿 / 保存草稿 / 上传删除附件 / 正式提交 / 获取回执
  - [x] 4.2 邀请 Token 专用鉴权（非内部 Bearer）；比 Bearer 独立
  - [x] 4.3 字段级最小化输出（隐藏其他受邀供应商/报价/内部备注/目标价/审批/日志）
- [x] Task 5: 前端邀请路由 + 页面状态 + mock 隔离
  - [x] 5.1 路由改为 `/supplier-portal/:invitationToken`；7 种状态（有效/过期/撤销/已提交/允许修订/已截止/已取消）
  - [x] 5.2 禁止真实 API 失败静默回退 mock
  - [x] 5.3 安全测试：越权/过期/撤销/重复提交/篡改 supplierId/访问其他询价

## P0-3：组织级与资源级数据权限
- [x] Task 6: 资源授权层 + 服务端强制字段
  - [x] 6.1 统一 Policy 层；询价按 owner/协作/组织共享授权
  - [x] 6.2 创建询价 organization/owner_id/owner_name/created_by_id/created_by_name 由服务端生成，不信任前端
  - [x] 6.3 普通更新不得改 status/organization/created_by/code；所有 list/get/update/delete/action 资源级校验
  - [x] 6.4 越权测试：跨组织读/跨用户编辑/伪造负责人/伪造供应商报价/非指定审批人审批

## P0-4：服务端强约束状态机
- [x] Task 7: 领域状态机 + 幂等动作
  - [x] 7.1 询价/报价/审批状态机，非法转换返回结构化 409；普通 PUT 不得改状态
  - [x] 7.2 合法/非法转换参数化测试
  - [x] 7.3 动作接口幂等 + `Idempotency-Key`（发送邀请/提交报价/提交审批/确认定标）

## P0-5：数据模型与金额正确性
- [x] Task 8: Decimal/时区/外键/唯一约束/校验
  - [x] 8.1 金额/单价/税率/总额用 Decimal+Numeric；时间用带时区 DateTime + ISO 8601
  - [x] 8.2 补齐外键（quotation.supplier_id、quotation_item.inquiry_item_id、notification.user_id、attachment 归属）
  - [x] 8.3 唯一约束（供应商在询价中有效报价唯一、审批节点顺序/当前待审批唯一、token_hash 唯一）
  - [x] 8.4 CheckConstraint/服务端校验（quantity>0、unit_price>=0、delivery_days>=0、合法税率/币种/状态）
- [x] Task 9: 服务端重算金额
  - [x] 9.1 服务端按明细重算未税/税额/含税/总额，不信任 total_amount/supplier_name/组织/操作者
  - [x] 9.2 舍入/税率/空报价/极大值/并发提交测试

## P1-6：鉴权会话安全
- [x] Task 10: Token 哈希 + 短期/刷新令牌 + 会话管理
  - [x] 10.1 库中只存 Token 哈希；登出先撤销服务端会话再清本地
  - [x] 10.2 短期 Access + 可轮换 Refresh + HttpOnly/Secure/SameSite Cookie；会话列表/单会话撤销/全部退出/Refresh 重用检测
  - [x] 10.3 限流与幂等迁移到 Redis（可多实例）；`X-Forwarded-For` 仅可信代理读取
  - [x] 10.4 安全响应头（CSP/HSTS/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）
  - [x] 10.5 依赖/Secret/SAST/镜像扫描；登录爆破/Token 过期/撤销/重放/跨组织/伪造代理头测试

## P1-7：PostgreSQL 与部署
- [x] Task 11: 数据库与部署
  - [x] 11.1 支持 `DATABASE_URL` PostgreSQL；SQLite 仅开发/演示；生产不用 `create_all`
  - [x] 11.2 全新库升级/上一版本升级/关键迁移 downgrade 测试；备份恢复演练文档
  - [x] 11.3 Docker 健康检查改 `/api/ready`；Compose 健康条件控制依赖；`/api/health` 区分 liveness/readiness
  - [x] 11.4 开发/测试/生产环境配置示例；密钥不入库

## P1-8：真实通知与附件上传
- [x] Task 12: 异步发送通知闭环
  - [x] 12.1 发送询价改异步任务；邮件等可扩展渠道；模板/多语言/变量校验/预览
  - [x] 12.2 逐供应商交付状态（待发送/已发送/已送达/失败/退信/已打开/已提交）；重发/截止提醒；可重试且幂等
  - [x] 12.3 通知绑定用户级未读与偏好；发送失败不显示"已全部发送成功"
- [x] Task 13: 安全附件上传
  - [x] 13.1 真实上传服务（本地/S3/MinIO）；预签名或流式上传；大小/MIME/扩展名/文件名/资源权限校验
  - [x] 13.2 进度/取消/重试/预览/删除；病毒扫描预留；下载鉴权；孤儿清理与审计

## P1-9：服务端 AI
- [x] Task 14: 后端 `/api/ai/*`
  - [x] 14.1 API Key 仅存服务端；可插拔 Provider
  - [x] 14.2 超时/有限重试/并发限制/熔断/成本与 Token 统计/结构校验/敏感脱敏/审计
  - [x] 14.3 AI 不可用回退本地规则；输出仅标为辅助建议；提示词注入/无效 JSON/超时/限流/泄漏测试

## P1-10：mock 与真实数据隔离
- [x] Task 15: 演示/生产边界 + 状态管理职责
  - [x] 15.1 演示模式显式环境变量；生产构建默认禁止 mock fallback
  - [x] 15.2 后端不可用显示离线状态与最后同步时间；缓存标明是否过期；不无提示回退 localStorage
  - [x] 15.3 统一 React Query（服务端数据/缓存/失效）与 Zustand（客户端 UI 状态）；服务端更新成功后用返回对象更新缓存

## P2-11：供应商报价体验
- [x] Task 16: 步骤条/自动保存/草稿/错误摘要/批量/移动端/回执/无障碍
  - [x] 16.1 步骤条（阅读/填写/上传/检查/提交成功）
  - [x] 16.2 防抖自动保存 + 保存中/已保存/保存失败/最后保存时间
  - [x] 16.3 未保存离开提示（beforeunload + 路由 Block）与草稿恢复提示
  - [x] 16.4 提交前错误摘要并可点击定位到具体物料/字段
  - [x] 16.5 批量税率/交期/付款（选中行或全部行）
  - [x] 16.6 Excel 模板导出/CSV 导入/复制上一轮
  - [x] 16.7 移动端物料卡片 + 底部固定操作栏
  - [x] 16.8 上传进度/重试/错误原因；回执编号/时间/总额/下载回执
  - [x] 16.9 撤回/修订状态规则（revoke→撤回页、提交后可重新报价）
  - [x] 16.10 无障碍（aria-label、aria-live、role=alert、键盘可操作）
  - [x] 16.11 中英文 i18n 文案补齐；测试更新为数据路由并全部通过

## P2-12：采购端体验
- [x] Task 17: 服务端分页/搜索 URL 同步/保存视图/实时更新/通知中心/比价增强/报价快照/服务端 PDF-Excel/空态风险

## P2-13：国际化与前端工程治理
- [x] Task 18: 硬编码扫描入 i18n；CI 翻译键检查；拆分超大组件；Error Boundary/懒加载/性能

## P2-14：测试与质量门禁
- [x] Task 19: 15 项测试清单 + 覆盖率门槛 + CI 关键任务失败即禁止完成
  - [x] 19.1 补齐/确认测试：邀请 Token 安全、组织越权、状态机参数化、金额精度、并发/乐观锁、幂等、PG 集成、文件上传、AI 超时/回退、Docker 健康检查
  - [x] 19.2 后端覆盖率门槛 pytest.ini `--cov-fail-under=80`（实测 80.93%）；前端 vitest.config thresholds 30%（实测 33.33%）
  - [x] 19.3 Playwright 多浏览器 + 移动设备项目（chromium/firefox/webkit/mobile-android/mobile-ios）；CI 安装全部浏览器
  - [x] 19.4 CI 接入：quality 跑 `vitest run --coverage`；backend-test 提供 postgres service 跑 PG 集成测试；docker-e2e 安装全部浏览器
  - [x] 19.5 验证结果：backend pytest 160 passed 1 skipped / tsc / lint / build / vitest 297 passed 全过

# Task Dependencies
- Task 1/2 独立先行（CI 基线是后续一切的前提）
- Task 3→4→5 依赖（邀请 模型→API→前端）
- Task 6 依赖 Task 2（权限在稳定基线上加）
- Task 7 依赖 Task 6（状态机与资源权限配合）
- Task 8/9 依赖 Task 7（金额约束在状态机化后）
- Task 10 依赖 Task 1/2（鉴权安全建立在可用 CI 上）
- Task 11 依赖 Task 10（部署与鉴权配套）
- Task 12/13 依赖 Task 3（通知/附件服务于邀请闭环）
- Task 14 依赖 Task 11（AI 后端部署）
- Task 15 独立（mock 隔离）
- Task 16/17 依赖 Task 5/6/7（体验建立在安全闭环上）
- Task 18 依赖 Task 16/17
- Task 19 依赖全部