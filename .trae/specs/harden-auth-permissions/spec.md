# 认证与权限加固（Auth & Permissions Hardening）Spec

## Why

后端（FastAPI + SQLAlchemy）此前虽已具备会话/Tok 体系，但对资源级隔离、管理接口 RBAC、改密会话失效、CSRF、登录限流等安全点覆盖不全，存在跨组织 IDOR、越权访问、令牌滥用等 P1 风险。本任务在既有体系上做增量加固，不破坏现有功能。

## What Changes

- **报价单组织级资源隔离（IDOR）**：报价单自身无 `organization` 字段，归属由父询价单决定。新增 `_get_quotation_with_access()`，加载报价后复用 `require_inquiry_access()` 校验父询价单，跨组织访问返回 403。
- **管理接口 RBAC**：`auth.py` 新增 `require_admin` 依赖（非管理员角色 → 403）；`/api/ai/stats` 由 `get_current_user` 改为 `require_admin`，不依赖前端隐藏入口。
- **改密使会话失效**：`auth.py` 新增 `POST /api/auth/change-password`，校验当前密码 → 更新 bcrypt 哈希 → 撤销该用户所有会话（含当前）并删除其下 access token → 清除 refresh cookie。新增 `ChangePasswordParams` schema。
- **CSRF 防护**：`routers/auth.py` 新增 `_assert_same_origin()`，对 cookie 认证的 `/api/auth/refresh` 校验 Origin/Referer 必须命中 `CORS_ORIGINS` 白名单，否则 403（配合 `SameSite=Lax` 双重防护）。
- **登录限流接线确认**：`redis_client.py` 的 `is_login_blocked` / `record_login_failure` / `reset_login_attempts` 已在 login 接口接线，超阈值返回 429。
- **密码哈希**：沿用 bcrypt（`hash_password` / `verify_password`），改密测试后恢复原哈希。

**BREAKING**：`/api/ai/stats` 改为仅管理员可访问；`POST /api/auth/change-password` 为新增端点。

## Impact

- Affected specs: 认证、报价、AI、权限。
- Affected code:
  - `backend/app/auth.py`（新增 `require_admin`）
  - `backend/app/routers/auth.py`（CSRF、change-password、会话撤销）
  - `backend/app/routers/quotations.py`（`_get_quotation_with_access`）
  - `backend/app/routers/ai.py`（`/ai/stats` RBAC）
  - `backend/app/schemas.py`（`ChangePasswordParams`）
  - `backend/tests/test_security_hardening.py`（新增安全测试）
  - `backend/tests/test_ai.py`（更新 stats RBAC 断言）

## ADDED Requirements

### Requirement: 报价单组织级资源隔离
系统 SHALL 对报价单读写操作按父询价单做组织级访问校验，用户无权访问其父询价单时返回 403，防止跨组织 IDOR。

#### Scenario: 跨组织访问报价单
- **WHEN** 华东分部用户访问总部询价单下的报价单
- **THEN** 返回 403；总部用户访问同一报价单返回 200

### Requirement: 管理接口 RBAC
系统 SHALL 对管理类接口（如 AI 用量统计）施加管理员角色校验，非管理员返回 403，不依赖前端隐藏入口。

### Requirement: 改密使会话失效
系统 SHALL 提供修改密码端点，校验当前密码后更新哈希并撤销该用户所有会话（含当前），使旧 access/refresh token 立即失效。

### Requirement: CSRF 防护
系统 SHALL 对使用 cookie 认证的状态修改端点校验 Origin/Referer 必须命中 CORS 白名单，否则返回 403。

#### Scenario: 跨站 refresh
- **WHEN** 携带合法 refresh cookie 但从非白名单 Origin 发起 refresh
- **THEN** 返回 403；可信 Origin（CORS 白名单）返回 200 并轮换 token

## MODIFIED Requirements

### Requirement: 登录速率限制
登录接口 SHALL 在超过连续失败阈值后返回 429，并在成功登录或测试复位时重置计数。

## REMOVED Requirements

无。