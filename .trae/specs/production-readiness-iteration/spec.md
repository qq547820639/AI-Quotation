# 生产就绪迭代（Production-Readiness Iteration）Spec

## Why

项目当前是从高完成度全栈 MVP。虽然已具备完整业务链路、i18n、E2E 与 CI，但多项生产级能力缺失：认证无密码校验、token 无过期、无速率限制、询价编号由客户端生成、多人并发编辑无冲突控制、无数据库迁移、AI 服务纯本地模拟、无障碍几乎空白。本迭代目标是把项目从"可演示 MVP"深化为"可真实用户试用与生产验收的候选版本"。

## What Changes

- **认证与鉴权**：引入密码哈希（bcrypt）、token 过期、登出撤销、登录失败不泄露用户存在性、连续失败登录速率限制、演示账号仅限开发/演示环境变量启用。
- **数据一致性**：移除空 `catch`/静默失败；写操作统一 pending/success/error 状态、服务端确认后再提示成功、乐观更新回滚、防重复提交；修复供应商定标覆盖其他物料问题；为询价/报价增加并发控制（版本号 + 409）；询价编号改为服务端生成并事务内重试。
- **状态模型**：统一 idle/loading/refreshing/success/empty/saving/error/offline 状态；修复 Dashboard 空数据永久 Skeleton；评论保存 trim + 保存状态 + 避免旧请求覆盖；导出增加进行中/防重复/失败提示。
- **报价对比**：清理不合理的 `useEffect` 依赖与 lint 禁用；防止刷新/路由切换覆盖未提交选择与评论；区分供应商选择/单项推荐/整体推荐/人工决定；对异常/缺失/超预算/交期/付款风险给出可解释提示；按需性能优化。
- **列表与移动端**：自定义列设置组件（不依赖不存在的 `columnSetting` 属性）、密度、固定列、排序、批量选择、恢复默认；筛选/排序/分页/搜索持久化；清除所有筛选；375/768/桌面宽度适配。
- **无障碍**：语义化按钮/链接/标题/表单标签/表格；可点击 `div` 改造为按钮；键盘可操作；焦点管理；对比度；引入 axe 无障碍检查覆盖核心页面。
- **AI 服务真实化**：抽象 `AIBackend`/`LocalRuleBackend`/`RemoteAIBackend`，环境变量选择后端，界面显示当前模式（本地规则/远程 AI/降级/AI 不可用），远程调用带超时/取消/错误/限流/敏感信息过滤/用户确认，输出结构校验，最终定标保留人工确认。
- **后端工程化**：引入 Alembic 迁移并生成首个迁移；结构化日志 + request ID；健康检查/就绪检查；日志不记录密码/完整 token/敏感采购数据；事务边界保证不产生半完成数据。
- **测试与 CI**：前端补 API client/401/Store 异常回滚/并发/Dashboard 空态/评论保存/多物料定标/报价异常/中英切换/移动端测试；后端补登录成败/token 过期撤销/RBAC/资源级权限/状态流转/唯一编号/并发冲突/事务回滚/非法输入/多物料定标完整性测试；Playwright 增加真实后端模式；CI 实际执行 npm ci + ESLint + tsc + Vitest + build + pytest + Playwright 真实后端流程，失败输出日志与截图/trace。

**BREAKING**：认证改为密码校验后，`POST /api/auth/login` 请求体从 `{userId}` 变为 `{userId, password}`；演示账号登录仅在 `APP_DEMO_MODE=true`（开发/演示）时可用。询价编号改为服务端生成后，前端不再本地生成 `code`。

## Impact

- Affected specs: 认证、询价、报价、供应商、定标、查询列表、报价对比、审批、Dashboard、AI 服务、导出。
- Affected code:
  - 后端：`backend/app/auth.py`、`routers/auth.py`、`routers/inquiries.py`、`models.py`、`schemas.py`、`serializers.py`、`seed.py`、`config.py`、`database.py`、新增 `alembic/`、`routers/*`、`tests/*`。
  - 前端：`src/api/client.ts`、`src/api/errors.ts`、`src/store/*`、`src/services/auth/*`、`src/utils/aiService.ts`、`src/pages/quotation/compare/*`、`src/pages/dashboard/*`、`src/pages/inquiry/*`、`src/pages/supplier/*`、`src/components/quotation/*`、`src/components/table/*`、`src/hooks/*`、`src/locales/*`、`src/router/*`、`e2e/*`。
  - 工程：`.github/workflows/ci.yml`、`docker-compose.yml`、`README.md`、`docs/*`、`.env.example`。

## ADDED Requirements

### Requirement: 安全密码认证
系统 SHALL 用可靠哈希（bcrypt）存储与校验用户密码，token 带明确过期时间，登出可撤销 token，登录失败不泄露用户是否存在，对连续失败登录施加速率限制；演示账号快捷登录仅在 `APP_DEMO_MODE=true` 时启用。

#### Scenario: 正确密码登录
- **WHEN** 用户以正确密码提交登录
- **THEN** 返回带过期时间的 token 与用户信息

#### Scenario: 错误密码登录
- **WHEN** 用户提交错误密码或不存在用户
- **THEN** 返回 401 且提示文案一致（不泄露用户是否存在），连续失败后触发速率限制

### Requirement: 询价编号服务端生成
后端 SHALL 生成询价编号，数据库列唯一约束，并发碰撞时在事务内安全重试，不再依赖客户端时间戳或末几位。

### Requirement: 并发冲突控制
后端对询价/报价等多人可编辑数据 SHALL 支持版本号（`version`）或 `updatedAt` 乐观锁，冲突时返回 409；前端 SHALL 展示冲突并提供重新加载或重新应用选择。

### Requirement: 供应商定标数据完整性
供应商定标 SHALL 使用完整映射或增量 PATCH 协议，不得因只提交当前物料而覆盖其他物料的选择；SHALL 提供多物料选择与重复修改的回归测试。

### Requirement: AI 服务抽象与降级
AI 服务 SHALL 抽象为 `AIBackend` 接口，含 `LocalRuleBackend`（离线/演示/降级）与 `RemoteAIBackend`（远程可配置后端），通过环境变量选择；界面 SHALL 明确显示当前模式；远程调用 SHALL 带超时/取消/错误/限流/敏感信息过滤/用户确认；输出 SHALL 做结构校验；最终定标 SHALL 保留人工确认。

### Requirement: 数据库迁移
系统 SHALL 使用 Alembic 管理 schema 变更并生成可验证的首个迁移，不再仅依赖自动 `create_all`（保留自动建表作为兼容/测试路径）。

### Requirement: 无障碍（a11y）
页面 SHALL 使用语义化元素、键盘可操作、清晰焦点、ARIA 辅助文本、充分对比度；SHALL 引入 axe 无障碍检查并覆盖核心页面，无严重级问题。

## MODIFIED Requirements

### Requirement: 统一状态模型与错误恢复
所有创建/更新/删除/发送/提交/审批/评论/定标写操作 SHALL 暴露 pending/success/error 状态，等待服务端确认后再显示最终成功，失败显示可理解可重试错误，乐观更新提供回滚，防重复提交；页面 SHALL 建立 idle/loading/refreshing/success/empty/saving/error/offline 统一状态模型，Skeleton 仅用于首次加载，空数据用 Empty 而非永久 Skeleton，Dashboard 无数据时不得永久显示 Skeleton。

### Requirement: 评论与导出反馈
评论保存 SHALL 保存前 trim、显示"正在保存/已保存/保存失败"、服务端确认后提示成功、避免旧请求覆盖新内容；PDF/Excel 导出 SHALL 提供导出中状态、防重复点击、成功结果、失败提示与大数据量保护。

### Requirement: 报价对比体验
报价对比页 SHALL 清理不合理的 `useEffect` 依赖与 lint 禁用，防止询价/报价刷新或路由切换覆盖用户未提交的选择与评论，区分供应商选择/单项推荐/整体推荐/人工决定，对异常/缺失/超预算/交期/付款风险给出可解释提示，在真实性能分析证明有收益时才使用 memo/useMemo/useCallback。

### Requirement: 列表与移动端体验
主要业务表格 SHALL 提供自定义列设置（显示/隐藏、列宽、固定列、密度、排序、批量选择、批量操作、恢复默认），筛选/排序/分页/搜索 SHALL 持久化并可恢复，提供"清除所有筛选"与当前生效条件展示；375/768/桌面宽度下关键按钮不越界、筛选可收起、表格可读。

### Requirement: 后端可观测性
后端 SHALL 引入结构化日志与 request ID，区分用户输入/权限/数据冲突/服务不可用/未知系统错误，提供健康检查与就绪检查，日志不记录密码/完整 token/敏感采购数据，事务边界保证不产生半完成数据。

### Requirement: 测试与 CI 门禁
CI SHALL 实际执行 `npm ci`、ESLint、TS 类型检查、Vitest、前端生产构建、pytest、Playwright 真实后端核心流程；失败输出足够日志与截图/trace；后端 import smoke test 不得替代 pytest。前端/后端/E2E 测试按上述清单补齐。

## REMOVED Requirements

### Requirement: 无密码演示登录
**Reason**: 为生产验收引入真实密码认证，演示快捷登录仅限开发/演示环境。
**Migration**: 登录请求体增加 `password` 字段；`APP_DEMO_MODE=true` 时保留演示账号快捷登录；测试用例改用带密码的登录夹具。

### Requirement: 客户端生成询价编号
**Reason**: 客户端生成编号无法保证并发唯一性，且存在碰撞风险。
**Migration**: 后端 `create_inquiry` 生成唯一编号；前端不再生成本地 `code`，创建成功后使用服务端返回的 `code`。