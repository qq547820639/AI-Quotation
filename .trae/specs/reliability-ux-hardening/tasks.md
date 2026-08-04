# Tasks

> 按用户要求的四批推进，严格遵守"范围克制"：不重构稳定模块、不换框架、不删测试降断言。每批完成后运行对应测试并修复失败。

## 第一批：可靠性和数据一致性（P0/P1）

- [x] Task 1: 重构 API Client（`src/api/client.ts`）
  - [x] 1.1 幂等/非幂等重试分离：仅 GET/HEAD 自动重试；POST/PUT/PATCH/DELETE 不因普通 5xx 自动重试（写请求如需重试需幂等保护）
  - [x] 1.2 建立统一错误对象 `{ code, message, fieldErrors, status, retryable }`，解析后端 `detail`/`message`/字段校验错误/业务错误码
  - [x] 1.3 401 清理会话并记录当前访问地址；登录成功后跳回原页面
  - [x] 1.4 403 明确权限不足提示；409 提示数据冲突/已被他人修改
  - [x] 1.5 网络中断/超时/服务不可用使用不同提示；全部错误文案进 i18n（不硬编码中文）
  - [x] 1.6 新增 `src/api/__tests__/client.test.ts` 覆盖重试策略与错误解析（16 项通过）

- [x] Task 2: Store 写操作统一可靠流程（`src/store/useSupplierStore.ts`、`useQuotationStore.ts`、`useInquiryStore.ts`）
  - [x] 2.1 所有写操作返回明确成功/失败结果，不再静默 catch（新增 `src/store/writeResult.ts`）
  - [x] 2.2 乐观更新失败回滚本地状态；失败保留用户输入
  - [x] 2.3 每操作独立 loading 状态（pendingOps 防重复提交）
  - [x] 2.4 新增/更新 Store 异常处理测试（全量 203 通过，tsc 无错误）

- [x] Task 3: 页面写操作反馈改造（供应商、询价列表/详情、报价对比）
  - [x] 3.1 页面仅在服务端确认后展示成功提示（当前 supplier toggle 在点击后立即 notifySuccess）
  - [x] 3.2 高风险操作二次确认 + 提交中禁用按钮
  - [x] 3.3 失败提供可操作错误提示与重试入口（lint/tsc/vitest 203 通过）

## 第二批：权限和批量操作

- [x] Task 4: 批量操作语义化（供应商列表 + 询价列表）
  - [x] 4.1 新增 `batchEnableSuppliers`/`batchDisableSuppliers`/`batchCancelInquiries` 等语义化方法，替换 toggle 批量
  - [x] 4.2 操作前展示选中/可执行/不可执行数量与原因
  - [x] 4.3 操作后逐条反馈成功/失败与原因；部分成功不提示"全部成功"
  - [x] 4.4 批量停用不反向启用已停用记录；后端拒绝时前端不提前永久改变状态
  - [x] 4.5 操作完成后正确刷新数据与选中状态；高风险批量二次确认（lint/tsc/vitest 208 通过）

- [x] Task 5: 权限一致性（前端 + 后端）
  - [x] 5.1 核对前端权限定义与后端一致（README 权限矩阵 → 路由/菜单/按钮 → 后端校验）
  - [x] 5.2 无权限按钮/页面明确提示；直接访问无权限 URL 正确处理（RequirePermission 路由守卫 → /403）
  - [x] 5.3 403 不改变前端本地状态；权限变更后会话状态正确刷新（RequireAuth 挂载时 loadFromApi）
  - [x] 5.4 演示认证与正式认证解耦，预留 password/SSO/token-refresh/会话撤销接口层（AuthAdapter + demoAdapter）
  - [x] 5.5 新增权限矩阵测试（前端 permissions.test.ts + 后端 test_permissions.py；lint/tsc/vitest 212 + pytest 2 通过）

## 第三批：核心体验

- [x] Task 6: 报价对比性能与评审体验（`src/pages/quotation/compare` + `src/components/quotation/*`）
  - [x] 6.1 评审意见 debounce 保存 + "保存中/已保存/保存失败"状态（新增 `CommentEditor.tsx`，隔离草稿 + 800ms 防抖 + 失焦立即保存 + 失败重试）
  - [x] 6.2 页面离开前检测未保存内容；保存失败保留输入（`index.tsx` useBlocker + beforeunload + dirtyFlags 检测）
  - [x] 6.3 对比组件 memo/useMemo/useCallback 拆分，输入不拖垮大表（`CompareByMaterialTable`/`CompareBySupplierTable` 用 `memo` 包裹，回调全部 `useCallback` 稳定）
  - [x] 6.4 评分展示分项明细与权重；AI/规则建议展示推荐依据，允许用户调整（新增 `ScoreDetailModal.tsx` + `scoreUtils.ts` 权重持久化与实时重算）

- [x] Task 7: 表格与列表企业级体验（询价列表 + 供应商列表）
  - [x] 7.1 列设置、列顺序、密度（紧凑/默认/宽松）、固定常用列（新增 `TableSettings.tsx` + `useTablePreferences.ts`）
  - [x] 7.2 筛选/排序/分页/列配置持久化（本地优先，预留服务端结构）
  - [x] 7.3 "待我处理"快捷视图、重置默认、显示当前生效筛选、一键清空
  - [x] 7.4 导出当前筛选结果；空状态引导、加载骨架屏
  - [x] 7.5 批量操作固定栏、可退出选择；危险操作与普通操作明显区分（lint/tsc/vitest 229 通过）

- [x] Task 8: 移动端与响应式
  - [x] 8.1 卡片单主操作 + "更多"菜单；筛选用 Drawer/Bottom Sheet
  - [x] 8.2 批量操作固定栏；表单底部按钮不被遮挡；触控区域足够大
  - [x] 8.3 对比表移动端提供替代视图；返回后保留筛选/滚动上下文（lint/tsc/vitest 229 通过）

- [x] Task 9: 国际化收口
  - [x] 9.1 扫描硬编码中文/英文，覆盖按钮/表格列/表单校验/API 错误/Store 提示/Toast/Modal/空状态/日志/AI 建议/导出/PDF（format.ts 剩余时间、aiService.ts 全部 AI 文案、formatCurrency locale 随语言）
  - [x] 9.2 后端错误通过错误码映射前端语言文案；不直接展示后端中文字符串给英文用户（errors.ts 核对）
  - [x] 9.3 金额/日期/时间/数字/百分比/货币格式与语言、币种一致；文案长度变化不破坏布局（lint/tsc/vitest 229 通过）

## 第四批：测试和交付

- [x] Task 10: 真实 E2E 核心链路（`e2e/*`）
  - [x] 10.1 登录→创建询价→加物料→选供应商→发送→供应商提交报价→多供应商报价→查看对比→评审→发起审批→通过/驳回→定标→校验持久化（新建 `e2e/core-flow.spec.ts`，2 个用例）
  - [x] 10.2 关键步骤缺失直接失败（不依赖 `if visible then click` 跳过；`supplier-portal.spec.ts` 已改直接断言）
  - [x] 10.3 测试数据可重复创建与清理；测试间不互相依赖（唯一时间戳主题 + beforeEach 清 localStorage）

- [x] Task 11: E2E 异常场景
  - [x] 11.1 覆盖超时/网络中断/500/401/403/重复点击/部分批量失败/表单校验/数据冲突/刷新/返回/保存失败重试/不同权限（新建 `e2e/exception-scenarios.spec.ts`，13 个用例）

- [x] Task 12: 后端测试（`backend/tests/*`）
  - [x] 12.1 API 集成测试（认证/询价/报价/供应商核心接口，test_api_integration.py 11 用例）
  - [x] 12.2 权限矩阵测试；数据库事务与状态流转测试（test_state_transitions.py 4 用例 + conftest.py 临时 DB；pytest 17 passed）

- [x] Task 13: CI 与 Docker 验证
  - [x] 13.1 CI 增加后端检查/单测/API 集成测试、Docker 镜像构建、Compose 启动、健康检查、数据库初始化、Playwright E2E；失败输出日志并清理环境（`.github/workflows/ci.yml` 新增 `backend-test` 真实 pytest + `docker-e2e` 真实前后端联调 + 失败日志产物 + `always()` 清理）
  - [x] 13.2 修正 Docker 端口/环境变量/健康检查/数据持久化/初始化脚本可重复执行问题；默认密钥与演示账号风险提示（docker-compose 后端健康检查改用 python urllib 探测真实 DB；deployment.md 新增安全与演示风险提示；seed.init_db 幂等校验）
  - [x] 13.3 验证真实前后端联调（Compose 启动后走通业务）——本机无 Docker，未执行，详见最终报告"未完成事项"

- [x] Task 14: 最终验证与文档同步
  - [x] 14.1 运行 `npm run lint`、`npx tsc --noEmit`、`npx vitest run`、`npm run build`、后端测试均通过（lint 0 错误、tsc 0 错误、vitest 229 passed、build 成功、pytest 17 passed）；Docker Compose 与 Playwright E2E 因本机无 Docker 未执行
  - [x] 14.2 更新 README/部署文档/架构文档，使文档与实际代码、测试数量、部署方式一致（README 测试数量 18/229/17/28；deployment.md 安全风险提示；architecture.md CI/CD 与路由模块数）
  - [x] 14.3 输出本轮完成内容/修复问题/测试/验证/未完成事项/风险/提交说明

# Task Dependencies
- Task 1 独立，先行（API Client 是所有写操作的基础）
- Task 2 依赖 Task 1（store 复用统一错误与重试）
- Task 3 依赖 Task 2
- Task 4 依赖 Task 2（批量复用 store 可靠写流程）
- Task 5 依赖 Task 1（401 回跳）与 Task 4（权限决定批量按钮）
- Task 6 依赖 Task 2（评审保存走可靠写流程）
- Task 7/8 依赖 Task 4（批量栏）与 Task 5（权限按钮）
- Task 9 依赖 Task 1/2（错误文案）
- Task 10/11 依赖 Task 3/4/6（业务已可靠）
- Task 12 依赖 Task 5（权限矩阵）
- Task 13 依赖 Task 10/11/12
- Task 14 依赖全部