# Tasks

> 本任务的安全加固代码已实现并通过自测（基线 239 passed → 现状 247 passed, 1 skipped）。以下任务按实施顺序列出，并将验证结果与代码状态对齐。

- [x] Task 1: 报价单组织级资源隔离（IDOR）
  - [x] 1.1 在 `routers/quotations.py` 新增 `_get_quotation_with_access()`，加载报价后复用 `require_inquiry_access()` 校验父询价单
  - [x] 1.2 将 get / submit / create / draft 等报价端点改为经访问校验函数处理，跨组织返回 403
  - [x] 1.3 测试：`test_quotation_get_cross_org_403` / `test_quotation_submit_cross_org_403` / `test_create_quotation_cross_org_403` / `test_quotation_same_org_draft_allowed`

- [x] Task 2: 管理接口 RBAC（AI 用量统计）
  - [x] 2.1 在 `auth.py` 新增 `require_admin` 依赖（非管理员 → 403）
  - [x] 2.2 将 `/api/ai/stats` 依赖改为 `require_admin`
  - [x] 2.3 测试：`test_ai_stats_rbac`（采购/主管 403，管理员 200）；更新 `test_ai.py` 断言

- [x] Task 3: 改密使会话失效
  - [x] 3.1 在 `schemas.py` 新增 `ChangePasswordParams`
  - [x] 3.2 在 `routers/auth.py` 新增 `POST /api/auth/change-password`：校验当前密码 → 更新 bcrypt 哈希 → 撤销该用户所有会话（含当前）并删除其下 access token → 清除 refresh cookie
  - [x] 3.3 测试：`test_change_password_revokes_sessions`（错误当前密码 400、两次不一致 400、成功后旧 token 401、旧密码 401、新密码 200，随后恢复哈希）

- [x] Task 4: CSRF 防护（refresh 端点）
  - [x] 4.1 在 `routers/auth.py` 新增 `_assert_same_origin()`（Origin 优先，回退 Referer，命中 `CORS_ORIGINS` 白名单，否则 403）
  - [x] 4.2 在 `/api/auth/refresh` 调用 origin 校验
  - [x] 4.3 测试：`test_refresh_rejects_cross_origin`（evil Origin 403、可信 Origin 200 并轮换）

- [x] Task 5: 登录限流接线确认
  - [x] 5.1 确认 `redis_client.py` 的 `is_login_blocked` / `record_login_failure` / `reset_login_attempts` 在 login 接口接线生效
  - [x] 5.2 测试：`test_login_rate_limit_wired`（连续失败超阈值 → 429）

- [x] Task 6: 回归验证
  - [x] 6.1 `cd backend && python3 -m pytest -q` 全部通过（现状 247 passed, 1 skipped，覆盖率 84.23% ≥ 80%）

# Task Dependencies
- Task 3/4 依赖 Task 2（改密/CSRF 建立于既有会话体系）
- Task 5 独立（Redis 限流接线）
- Task 6 依赖全部。