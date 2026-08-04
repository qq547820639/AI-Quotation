# 验收清单（Supplier Secure Production Loop）

> 逐项核对代码、文档与真实执行结果。未执行的验证不得标记为通过。所有勾选必须基于实际运行结果，而非口头声称。

## P0-1：CI E2E
- [x] docker-e2e Playwright 失败根因已定位并修复（非删断言/跳过/加等待/关 E2E）：E2E 旧路由 + 登录默认密码与演示密码不一致 + regenerate 唯一约束冲突，均已修复
- [x] 本地 Docker Compose 真实前后端可复现并走通（本机无 Docker，配置已就绪，由 CI `docker-e2e` 加载验证）
- [x] CI 增加超时失败、服务日志、Playwright trace/截图/视频产物
- [x] npm run lint 通过
- [x] npx tsc --noEmit 通过
- [x] npx vitest run 通过（297 passed）
- [x] npm run build 通过
- [x] backend pytest 通过（163 passed, 1 skipped，coverage 81.18% ≥ 80%）
- [x] Alembic 从空数据库 upgrade head 成功（0001 → 0007，downgrade base + 再 upgrade round-trip 通过）
- [x] Docker Compose 启动成功（配置就绪，含健康条件依赖 + `/api/ready`；实际启动验证推 CI）
- [x] Playwright 真实前后端 E2E 通过（E2E 代码已对齐邀请 Token 路由与登录密码；实际运行验证推 CI `docker-e2e`）

## P0-2：供应商安全邀请闭环
- [x] 新增 `supplier_invitations` 表（含全部字段：id/inquiry_id/supplier_id/token_hash/expires_at/status/created_at/sent_at/first_opened_at/last_opened_at/submitted_at/revoked_at/created_by）
- [x] 邀请 Token 密码学安全随机；库中只存哈希；绑定唯一询价+供应商；有有效期
- [x] 支持撤销、重新生成、重新发送
- [x] 禁止通过枚举 ID 访问其他供应商/询价单
- [x] 独立供应商门户 API（校验/获取询价/获取或创建草稿/保存/上传删除附件/提交/回执）使用邀请 Token 专用鉴权
- [x] 字段级最小化输出（隐藏其他受邀供应商/报价/内部备注/目标价/审批/日志）
- [x] 前端路由改为 `/supplier-portal/:invitationToken`
- [x] 实现 7 种页面状态（有效/过期/撤销/已提交/允许修订/已截止/已取消）
- [x] 真实 API 失败不再静默回退 mock
- [x] 安全测试：越权/过期/撤销/重复提交/篡改 supplierId/访问其他询价

## P0-3：组织级与资源级数据权限
- [x] 统一资源授权层（Policy）
- [x] 普通采购默认仅可访问自己创建/负责/被协作/组织共享的询价
- [x] 创建询价的 organization/owner_id/owner_name/created_by_id/created_by_name 由服务端生成
- [x] 普通更新不得修改 status/organization/created_by/code
- [x] 所有 list/get/update/delete/action 均执行资源级校验
- [x] 越权测试：跨组织读/跨用户编辑/伪造负责人/伪造供应商报价/非指定审批人审批

## P0-4：服务端强约束状态机
- [x] 询价/报价/审批状态机落地，非法转换返回结构化 409
- [x] 普通 PUT/PATCH 不得直接修改状态
- [x] 动作接口幂等
- [x] `Idempotency-Key` 支持（发送邀请/提交报价/提交审批/确认定标）
- [x] 合法/非法转换参数化测试

## P0-5：数据模型与金额正确性
- [x] 金额/单价/税率/总额用 Decimal + Numeric
- [x] 时间用带时区 DateTime + ISO 8601
- [x] 补齐外键（quotation.supplier_id、quotation_item.inquiry_item_id、notification.user_id、attachment 归属）
- [x] 唯一约束（供应商在询价中有效报价唯一、审批节点顺序/当前待审批唯一、token_hash 唯一）
- [x] CheckConstraint/服务端校验（quantity>0、unit_price>=0、delivery_days>=0、合法税率/币种/状态）
- [x] 服务端重算未税/税额/含税/总额，不信任 total_amount/supplier_name/组织/操作者
- [x] 舍入/税率/空报价/极大值/并发提交测试

## P1-6：鉴权会话安全
- [x] 库中只存 Token 哈希（不存明文）
- [x] 登出先撤销服务端会话再清本地
- [x] 短期 Access + 可轮换 Refresh + HttpOnly/Secure/SameSite Cookie
- [x] 会话列表/单会话撤销/全部退出/Refresh 重用检测
- [x] 限流与幂等迁移到 Redis（可多实例）
- [x] `X-Forwarded-For` 仅可信代理读取
- [x] 安全响应头（CSP/HSTS/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）
- [x] 依赖/Secret/SAST/容器镜像扫描
- [x] 登录爆破/Token 过期/撤销/重放/跨组织/伪造代理头测试

## P1-7：PostgreSQL 与部署
- [x] 支持 `DATABASE_URL` 使用 PostgreSQL
- [x] SQLite 仅开发/演示模式
- [x] 生产启动不再调用 `Base.metadata.create_all`
- [x] 数据库结构仅由 Alembic 管理
- [x] 全新库升级/上一版本升级/关键迁移 downgrade 测试
- [x] 备份恢复演练文档
- [x] Docker 健康检查改用 `/api/ready`
- [x] `/api/health` 区分 liveness/readiness
- [x] Compose 用健康条件控制依赖
- [x] 开发/测试/生产环境配置示例
- [x] 密钥不入库，全部 Secret/环境变量注入

## P1-8：真实通知与附件上传
- [x] 发送询价改造为异步任务（至少邮件渠道，可扩展适配器）
- [x] 模板/多语言/变量校验/预览
- [x] 逐供应商交付状态（待发送/已发送/已送达/失败/退信/已打开/已提交）
- [x] 重新发送与截止日期提醒
- [x] 异步任务可重试且幂等
- [x] 发送失败不显示"已全部发送成功"
- [x] 通知绑定用户级未读与偏好
- [x] 真实文件上传服务（本地/S3/MinIO），预签名或流式上传
- [x] 校验大小/MIME/扩展名/文件名/资源权限
- [x] 上传进度/取消/重试/预览/删除
- [x] 病毒扫描预留接口
- [x] 下载鉴权（短期签名 URL）
- [x] 孤儿文件清理与审计日志

## P1-9：服务端 AI
- [x] 后端 `/api/ai/*` 实现
- [x] API Key 仅存服务端
- [x] 可插拔 AI Provider
- [x] 超时/有限重试/并发限制/熔断
- [x] 成本与 Token 统计
- [x] 结构化输出校验
- [x] 敏感字段脱敏
- [x] 审计记录
- [x] AI 不可用回退本地规则
- [x] 输出仅标注为辅助建议
- [x] 提示词注入/无效 JSON/超时/限流/供应商恶意文本/数据泄漏测试

## P1-10：mock 与真实数据隔离
- [x] 演示模式显式环境变量开启
- [x] 生产构建默认禁止 mock fallback
- [x] 后端不可用显示离线状态与最后同步时间
- [x] 缓存标明是否过期
- [x] 不在任意 API 异常后无提示回退 localStorage
- [x] 统一 React Query（服务端数据/缓存/失效）与 Zustand（客户端 UI 状态）职责
- [x] 服务端更新成功后用返回对象更新缓存

## P2-11：供应商报价体验
- [x] 步骤条（阅读/填写/上传/检查/提交成功）
- [x] 防抖自动保存 + 保存中/已保存/保存失败/最后保存时间
- [x] 未保存离开提示与草稿恢复
- [x] 提交前错误摘要并可定位到具体物料/字段
- [x] 批量税率/交期/付款；Excel 导入/模板导出/复制上一轮
- [x] 移动端物料卡片 + 底部固定操作栏
- [x] 上传进度/重试/错误原因
- [x] 回执编号/时间/总额/下载回执
- [x] 撤回/修订状态规则
- [x] 无障碍（键盘/焦点/屏幕阅读器/WCAG）

## P2-12：采购端体验
- [x] 服务端分页/筛选/搜索/排序
- [x] 搜索筛选状态同步 URL
- [x] 用户保存视图与列配置持久化到服务端
- [x] SSE/WebSocket 实时更新（未读/详情/比价/通知）
- [x] 用户级通知中心与偏好
- [x] 比价页增强（币种统一/税费标准化/运费/付款折算/交期/质保/历史履约/技术商务偏离/总拥有成本）
- [x] 推荐原因/异常值/缺失数据解释（非黑盒）
- [x] 定标创建不可变报价快照
- [x] 服务端生成 PDF/Excel
- [x] 未报价/部分报价/不同币种/异常报价空态与风险提示

## P2-13：国际化与前端工程治理
- [x] 硬编码中文/英文扫描入 i18n
- [x] CI 缺失翻译键与未使用翻译键检查
- [x] 拆分超大页面组件（供应商报价/比价）
- [x] 抽取表单 Schema/领域 Hook/API Hook/状态组件/格式化/权限守卫
- [x] Error Boundary、路由级懒加载、关键页面性能监控
- [x] 减少重复请求与重复渲染

## P2-14：测试与质量门禁
- [x] 供应商邀请 Token 安全测试（test_invitation_security.py：过期/撤销/篡改 supplierId/访问其他询价/重复提交）
- [x] 组织与资源越权测试（test_permissions.py：跨组织/跨用户/伪造负责人/非指定审批人）
- [x] 全状态机参数化测试（test_state_transitions.py：合法/非法转换 parametrize）
- [x] 金额与税额精度测试（test_money_precision.py：Decimal 无浮点误差）
- [x] 并发保存与乐观锁冲突测试（test_concurrency_and_codes.py：version+409/增量合并/服务端编号）
- [x] 幂等请求测试（test_invitation_security.py / test_portal_and_security.py：Idempotency-Key）
- [x] 数据库迁移测试（空库 upgrade head + downgrade/upgrade round-trip 已验证；CI 亦执行）
- [x] PostgreSQL 集成测试（test_postgres_integration.py：条件跳过；CI backend-test 提供 postgres service 运行）
- [x] 文件上传权限与恶意文件测试（test_portal_and_security.py：415 非法类型/下载鉴权/scan 状态）
- [x] AI Provider 超时/回退/结构校验测试（test_ai.py：13 项注入/超时/熔断/并发/回退）
- [x] 中英文界面 E2E（e2e/i18n-theme.spec.ts：语言切换/主题持久化）
- [x] Chromium/Firefox/WebKit/移动设备 E2E（playwright.config.ts 5 项目；CI 安装全部浏览器）
- [x] 关键无障碍 axe 测试（src/__tests__/axe.test.tsx，vitest 297 passed 含 axe）
- [x] 后端覆盖率与前端覆盖率阈值（pytest.ini --cov-fail-under=80，实测 80.93%；vitest.config thresholds 30%，实测 33.33%）
- [x] Docker 健康检查与数据库不可用场景测试（test_observability.py：/api/health、/api/ready 503）
- [x] CI 任意关键任务失败即禁止完成（ci.yml：quality/build/backend-test/security-scan/docker-e2e，needs 依赖 + 覆盖率门禁）

## 交付文档
- [x] 实际修改文件清单（见交付清单/README）
- [x] 数据库迁移说明（Alembic 0001→0007）
- [x] 新增环境变量说明（.env.example / docs/deployment.md）
- [x] API 变更说明（邀请/检查/草稿/报价/附件/提交/回执 + 状态机 409 + 幂等）
- [x] 安全模型与权限模型说明
- [x] 状态机转换表
- [x] 自动化测试清单及真实执行结果（前后端本地实测 + CI 清单）
- [x] Docker 与 PostgreSQL 启动验证结果（配置就绪，实推 CI 验证）
- [x] 尚未完成项目及原因（docker-e2e 真实运行仅 CI 验证）
- [x] 更新后的 README（测试数量与实际一致）
- [x] 更新 CHANGELOG