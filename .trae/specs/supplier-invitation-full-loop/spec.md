# 供应商邀请完整闭环（canonical URL + 启动校验 + 真实 E2E）Spec

## Why
采购端生成并发送给供应商的邀请链接，此前存在与前端路由不一致的问题：后端生成 `/portal?token=...`，
而前端实际路由为 `/supplier-portal/{invitationToken}`，导致供应商打开链接后无法进入门户。
同时生产环境缺少对公开应用地址（`PUBLIC_APP_URL`）的启动校验，存在发出 `http://localhost` 或格式非法
邀请链接的风险。此外缺少覆盖"创建询价 → 邀请供应商 → 读邮件提取链接 → 门户填报 → 提交 → 采购端看到报价"
全链路的真实 E2E 测试。

## What Changes
- 后端统一通过 URL Builder（`config.build_invitation_url`）生成 canonical 邀请链接
  `/supplier-portal/{urlencodedInvitationToken}`，不再生成 `/portal?token=...`。
- `PUBLIC_APP_URL` 解析与启动校验：生产必须 HTTPS、禁止 localhost/回环地址、去除末尾重复路径斜杠、
  正确处理反向代理子路径。
- 邀请链接 token 一律 URL 安全编码（`quote(raw_token, safe="")`）。
- 新增/完善真实 E2E 测试（`e2e/`）：创建询价 → 邀请供应商 → 从测试邮箱服务（Mailpit）读邮件 → 提取
  邀请链接 → 浏览器打开门户 → 上传附件 → 保存草稿 → 提交报价 → 采购端看到报价与提交状态。
- 测试令牌过期、撤销、重发、重复提交、并发提交、非法令牌。

## Impact
- Affected specs: 供应商安全邀请闭环（supplier-secure-production-loop）、通知投递（P1-8）
- Affected code: `backend/app/config.py`、`backend/app/config_validation.py`、`backend/app/delivery.py`、
  `backend/app/routers/inquiries.py`、`backend/tests/test_invitation_url.py`、
  `backend/tests/test_invitation_security.py`、`e2e/`

## ADDED Requirements
### Requirement: 统一邀请链接 URL Builder
系统 SHALL 只通过 `config.build_invitation_url(raw_token)` 生成供应商邀请链接，格式为
`{PUBLIC_APP_URL}/supplier-portal/{urlencode(token)}`。

#### Scenario: canonical 链接生成
- **WHEN** 后端投递邀请或采购端重新生成链接
- **THEN** 返回的 portalUrl 为 `/supplier-portal/{urlencodedToken}` 形式，且不再包含 `/portal?token=`

#### Scenario: token 特殊字符编码
- **WHEN** 邀请 token 含 URL 特殊/不安全字符
- **THEN** token 被 `quote(raw_token, safe="")` 编码，链接仍可正确路由到门户

### Requirement: PUBLIC_APP_URL 启动校验
系统 SHALL 在生产环境（APP_ENV=prod）启动时校验 `PUBLIC_APP_URL`。

#### Scenario: 生产 HTTPS 与禁止 localhost
- **WHEN** 生产环境配置的 PUBLIC_APP_URL 非 HTTPS 或指向 localhost/127.0.0.1/0.0.0.0/::1
- **THEN** `validate_production_config()` 返回对应错误，`assert_production_config()` 抛 RuntimeError 拒绝启动

#### Scenario: 末尾路径重复去除与子路径
- **WHEN** PUBLIC_APP_URL 以 `/` 结尾（含多个）或含反向代理子路径（如 `https://example.com/procurement`）
- **THEN** `normalize_public_app_url` 去除末尾冗余斜杠，URL Builder 拼接时不产生 `//token` 重复路径分隔符，
  且正确保留反向代理子路径

### Requirement: 供应商邀请真实 E2E
系统 SHALL 提供覆盖供应商邀请完整闭环的真实 E2E 测试（`e2e/`），不得用 mock 代替真实闭环。

#### Scenario: 完整闭环
- **WHEN** 采购登录 → 创建询价 → 邀请/发送给供应商 → 从测试邮箱服务（Mailpit）读取邮件 → 提取邀请链接
- **THEN** 浏览器打开该链接进入供应商门户 → 上传附件 → 保存草稿 → 正式提交报价 → 返回采购端可见该供应商报价与提交状态

#### Scenario: 令牌生命周期与边界
- **WHEN** 测试令牌过期、撤销、重发、重复提交、并发提交、非法令牌
- **THEN** 各场景均有真实断言（过期/撤销/非法令牌被拒绝；重复/并发提交仅产生一条有效报价；重发获得新有效链接）

## MODIFIED Requirements
### Requirement: 邀请投递使用统一 URL Builder（delivery.py）
`_invitation_context` 改用 `config.build_invitation_url(raw_token)` 生成 portalUrl，不再拼接旧 `/portal?token=`。

### Requirement: 重新生成链接返回 canonical URL（inquiries.py）
`/api/inquiries/{id}/invitations/{supplierId}/regenerate` 返回值 `portalUrl` 使用
`config.build_invitation_url(raw_token)`。

## REMOVED Requirements
### Requirement: 旧 `/portal?token=` 邀请链接生成
**Reason**: 与前端 `/supplier-portal/{token}` 路由不一致，导致链接无法进入门户。
**Migration**: 统一由 URL Builder 生成 canonical `/supplier-portal/{urlencodedToken}` 链接。