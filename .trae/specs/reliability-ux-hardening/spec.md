# 代码可靠性深化 + 用户体验优化 Spec

## Why
项目已从"高完成度 MVP"进入可试运行阶段。当前存在一批直接影响验收可靠性的真实问题：写操作失败仍显示成功、后端失败被静默吞掉、非幂等请求会被自动重试、批量操作使用模糊 toggle 导致反向切换、错误文案硬编码不国际化、权限仅靠前端隐藏、报价对比大表无性能保护、E2E 只验证"元素存在"。本轮不做大规模新功能，只做可靠性、一致性、反馈与测试闭环的深化，使项目可稳定验收、可试运行。

## What Changes
- **数据可靠性**：所有 Store 写操作返回成功/失败结果；失败回滚；页面仅在服务端确认后展示成功；写操作独立 loading + 防重复提交；失败保留输入。
- **API Client 重构**：幂等/非幂等重试策略分离；统一错误对象（code/message/fieldErrors/status/retryable）；401 记录回跳地址；403/409/网络/超时/服务不可用差异化提示；全部错误文案进 i18n。
- **批量操作语义化**：用 `batchEnableSuppliers`/`batchDisableSuppliers`/`batchCancelInquiries` 等明确方法替换 toggle；操作前展示选中/可执行/不可执行数量与原因；操作后逐条成败反馈；部分成功不笼统提示"全部成功"。
- **表格与体验**：询价/供应商列表补齐列设置、密度、固定列、筛选持久化、快捷视图、一键清空、导出当前结果、批量操作固定栏；危险操作与普通操作区分。
- **报价对比**：大表性能（memo/useMemo/useCallback）、评审意见 debounce + 显示保存状态、离开前未保存检测、评分明细与 AI 推荐依据展示。
- **权限与认证**：前端/后端权限定义一致；无权限按钮/页面明确提示；演示认证与正式认证解耦，预留 password/SSO/token-refresh 接口。
- **AI 可解释性**：标注推荐来源（规则/模型）、展示评分维度与权重、支持权重调整与实时重算、记录采纳与修改原因。
- **测试闭环**：真实业务 E2E（核心链路 + 异常场景）、后端 API 集成测试、权限矩阵测试、Store 异常处理测试、API Client 重试测试。
- **CI/Docker**：CI 增加后端测试、API 集成测试、Docker 镜像构建、Compose 启动、健康检查、Playwright E2E；修正端口/环境变量/健康检查/数据持久化/初始化脚本可重复性问题。

## Impact
- 受影响规格：build-procurement-inquiry-system（原构建规格，已完成，本轮为其深化延展）
- 受影响代码：
  - 前端：`src/api/client.ts`、`src/store/*`、`src/pages/inquiry/list|detail`、`src/pages/supplier`、`src/pages/quotation/compare`、`src/components/quotation/*`、`src/utils/aiService.ts`、`src/locales/*`
  - 后端：`backend/app/routers/*`、`backend/app/auth.py`
  - 工程：`.github/workflows/ci.yml`、`docker-compose.yml`、`e2e/*`、`playwright.config.ts`

## ADDED Requirements

### Requirement: 写操作统一可靠流程
所有 Store 写操作 SHALL 返回明确成功/失败结果；失败 SHALL 回滚本地状态并保留用户输入；页面 SHALL 仅在服务端确认后再展示成功提示；每次写操作 SHALL 有独立 loading 与防重复点击。

#### Scenario: 服务端失败时不显示成功
- **WHEN** 用户启用/停用供应商、取消询价、提交报价、保存评审意见，且后端返回失败
- **THEN** 页面不显示"保存成功"，本地状态回滚到操作前，展示可操作错误提示并保留输入

#### Scenario: 连续点击不重复提交
- **WHEN** 用户快速多次点击提交/审批/定标按钮
- **THEN** 操作进行中按钮禁用，仅执行一次提交

### Requirement: API Client 幂等/非幂等重试分离
非幂等请求（POST/PUT/PATCH/DELETE）SHALL 不因普通 5xx 自动重试；幂等请求（GET/HEAD）SHALL 可自动重试；如写请求需重试，SHALL 具备幂等保护。

#### Scenario: POST 5xx 不自动重试
- **WHEN** 提交报价的 POST 请求返回 500
- **THEN** 客户端不自动重发该请求，仅向用户反馈失败与重试入口

### Requirement: 统一错误对象与提示
SHALL 存在统一前端错误对象 `{ code, message, fieldErrors, status, retryable }`；SHALL 解析后端 `detail`/`message`/字段校验错误/业务错误码；401/403/409/网络/超时/服务不可用 SHALL 使用不同提示；所有错误文案 SHALL 进入 i18n。

#### Scenario: 401 后回跳原页面
- **WHEN** 会话过期返回 401
- **THEN** 清理会话、记录当前访问地址，登录成功后跳回原页面

### Requirement: 批量操作语义化
批量操作 SHALL 使用语义化方法（batchEnable/batchDisable/batchCancel 等），不得用 toggle；操作前 SHALL 展示选中/可执行/不可执行数量与原因；操作后 SHALL 展示逐条成功/失败结果；批量停用 SHALL 不反向启用已停用记录；部分成功 SHALL 不提示"全部成功"。

#### Scenario: 批量停用不反向启用
- **WHEN** 选中一个已停用和一个合作中供应商执行批量停用
- **THEN** 已停用的保持停用，仅合作中的被停用，结果逐条反馈

### Requirement: 报价对比性能与评审体验
对比表格 SHALL 通过 memo/useMemo/useCallback 避免无意义重渲染；评审意见 SHALL debounce 保存并显示"保存中/已保存/保存失败"状态；页面离开 SHALL 检测未保存内容；评分 SHALL 展示分项明细与权重；AI 建议 SHALL 展示推荐依据并允许用户调整。

#### Scenario: 评审意见输入不拖垮大表
- **WHEN** 用户在评审意见输入框快速输入
- **THEN** 输入不触发整张对比表重渲染，保存状态明确显示

### Requirement: 权限一致性
前端权限定义 SHALL 与后端一致；前端隐藏 SHALL 非唯一权限保护（后端 SHALL 再校验）；无权限按钮/页面 SHALL 明确提示；403 SHALL 不改变前端本地状态；演示认证 SHALL 与正式认证解耦，预留 password/SSO/token-refresh/会话撤销接口层。

### Requirement: AI/规则推荐可解释性
AI 或规则推荐 SHALL 标注来源（规则引擎/模型）；SHALL 展示评分维度、权重、分项得分与推荐依据；SHALL 允许用户调整权重并实时重算；SHALL 记录用户是否采纳及修改原因；AI 失败 SHALL 不影响核心业务流程；AI 文案 SHALL 国际化。

### Requirement: 测试闭环
SHALL 包含真实核心业务链路 E2E（登录→创建询价→加物料→选供应商→发送→供应商提交报价→查看对比→评审→审批→定标→校验持久化）；SHALL 覆盖异常场景（超时/网络中断/500/401/403/重复点击/部分批量失败/表单校验/数据冲突/刷新/返回/保存失败重试/不同权限）；E2E 关键步骤缺失 SHALL 直接失败而非跳过；SHALL 增加后端 API 集成测试、权限矩阵测试、事务与状态流转测试、Store 异常测试、API Client 重试测试。

### Requirement: CI 与 Docker 验证
CI SHALL 执行前端 lint/typecheck/单测/构建、后端检查/单测/API 集成测试、Docker 镜像构建、Compose 启动、健康检查、数据库初始化、Playwright E2E；失败 SHALL 输出必要日志并清理环境；SHALL 验证真实前后端联调。Docker 端口/环境变量/健康检查/数据持久化/初始化脚本可重复性 SHALL 与部署文档一致。

## MODIFIED Requirements
### Requirement: 现有 API Client 错误处理
原有 `src/api/client.ts` 的 axios-retry 对所有方法重试、错误文案硬编码中文、401 直接跳转不记录回跳，修改为幂等/非幂等分离、统一错误对象、i18n 文案、401 记录回跳。

### Requirement: 现有供应商/询价 store 写操作
原有 `toggleSupplierStatus`/`updateSupplier`/`submitQuotation`/`saveQuotationDraft` 等静默 catch、乐观更新无回滚、不返回结果，修改为返回结果、失败回滚、每操作 loading、防重复提交。

## REMOVED Requirements
### Requirement: 模糊 toggle 批量操作
**Reason**: `toggleSupplierStatus` 用于批量操作会导致反向切换（停用已停用记录被重新启用），不符合明确业务动作。
**Migration**: 以 `batchEnableSuppliers`/`batchDisableSuppliers` 等语义化方法替换，仅对目标状态可执行记录操作。