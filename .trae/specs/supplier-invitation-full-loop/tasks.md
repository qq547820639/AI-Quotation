# Tasks

> 本次变更核心：统一邀请 URL Builder + PUBLIC_APP_URL 启动校验 + 真实 E2E 完整闭环。后端 URL Builder 与校验、邀请安全性单元测试已基本就绪，重点补齐 E2E 与全量验证。

## Task 1: requests 现状核对（不写代码）
- [ ] 1.1 逐项核对 P0-4 相关文件当前实现：config.py URL Builder、config_validation.py PUBLIC_APP_URL 校验、delivery.py 投递、inquiries.py 重新生成链接返回 canonical URL
- [ ] 1.2 确认 `/portal?token=` 旧格式已不再生成

## Task 2: 统一邀请 URL Builder（canonical）
- [ ] 2.1 `config.build_invitation_url(raw_token)` 生成 `/supplier-portal/{urlencodedToken}`，token 用 `quote(safe="")` 编码
- [ ] 2.2 优先 `PUBLIC_APP_URL`，回退 `PORTAL_BASE_URL` origin，再回退相对路径
- [ ] 2.3 `normalize_public_app_url` 去除末尾冗余斜杠、正确处理反向代理子路径

## Task 3: PUBLIC_APP_URL 启动校验
- [ ] 3.1 `config_validation._public_url_ok`：生产必须 HTTPS、禁止 localhost/回环地址
- [ ] 3.2 `validate_production_config` 接入 PUBLIC_APP_URL 校验；`assert_production_config` 失败抛 RuntimeError

## Task 4: 邀请投递与重新生成链接使用统一 URL Builder
- [ ] 4.1 `delivery.py::_invitation_context` 用 `config.build_invitation_url(raw_token)` 生成 portalUrl
- [ ] 4.2 `inquiries.py` 重新生成邀请链接返回 `portalUrl` 为 canonical URL

## Task 5: 邀请相关单元/集成测试
- [ ] 5.1 `test_invitation_url.py`：canonical 链接、PUBLIC_APP_URL 使用、HTTPS/localhost 校验、末尾斜杠去除
- [ ] 5.2 `test_invitation_security.py`：重新生成返回 canonical URL、并发提交仅一条有效报价、过期/撤销/重发/重复提交/非法令牌

## Task 6: 供应商邀请真实 E2E（e2e/）
- [ ] 6.1 E2E 完整闭环：采购登录 → 创建询价 → 邀请/发送供应商 → 从测试邮箱服务（Mailpit）读邮件 → 提取邀请链接 → 浏览器打开门户 → 上传附件 → 保存草稿 → 提交报价 → 采购端看到报价与提交状态
- [ ] 6.2 覆盖令牌过期、撤销、重发、重复提交、并发提交、非法令牌，均有真实断言
- [ ] 6.3 本环境无 Docker 时在代码注释/文档中写明不能本地运行，但代码必须完整；由 CI `docker-e2e` 验证

## Task 7: 全量验证
- [ ] 7.1 后端：`cd backend && python3 -m pytest -q` 全量通过（含邀请相关测试）
- [ ] 7.2 后端定向：`python3 -m pytest tests/test_invitation_url.py tests/test_invitation_security.py -q` 通过
- [ ] 7.3 前端：`npm run lint && npx tsc --noEmit && npx vitest run` 通过
- [ ] 7.4 更新 e2e 相关配置/文档说明运行方式

# Task Dependencies
- Task 2/3/4 基于 Task 1 现状核对
- Task 5 依赖 Task 2/3/4
- Task 6 依赖 Task 4（投递生成 canonical 链接供邮件提取）
- Task 7 依赖 Task 5/6