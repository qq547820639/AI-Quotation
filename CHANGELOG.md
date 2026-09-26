# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。未发布的变更列入 `[Unreleased]`。

## [Unreleased]

### 修复（R34：E2E 的泛化「成功提示」断言让测试在写请求飞行中就导航）

- **断言替产品说谎**：`core-flow.spec.ts` 里「提交审批成功」写成
  `expect(.ant-message-success.first()).toBeVisible()`。antd 的 message 停留约 3s，
  上一条「已选择推荐供应商」的提示还在屏上时这条断言立刻通过 —— 插桩实测 8/8 次，
  断言通过时刻只有 67~85ms（小于审批 POST 自身 147ms 的服务端耗时），
  屏上文案是上一步的，而审批 POST 的响应时刻读数为 `-1`：响应还没回来，
  下一次 `page.goto('/approval')` 把它掐断了。于是「审批后的单能不能出现在审批页」
  退化成服务端提交与新文档取数之间的掷硬币（全量跑 1/195 的红即此）。
- **修法**：`e2e/helpers.ts` 新增 `expectSuccessToast(page, 文案正则)` 按指名文案等提示
  （成功提示都在 `await` 写请求之后才弹，指名等就等于等落地），
  `core-flow.spec.ts` 7 处泛化断言改为指名。改前全仓泛化断言共 11 处，
  其余 4 处（exception-scenarios 2、门户回执 2）经上下文判未暴露，不改。
- **成对对照**：把 `/submit-approval` 桩成 500 后，泛化断言照样绿（`genericPassed=true`，
  这正是成因本身）、指名断言开火（`specificPassed=false`）、且此刻成功提示集合为空。
  修复前后同一探针：POST 响应时刻由 `-1`(8/8) 变为 93~110ms(5/5)。
- **棘轮门禁**：新增 `scripts/check-e2e-toast-assertions.mjs`（`npm run e2e:toast:check` + CI 的
  docker-e2e job，紧随既有的 `e2e:config:check`）。判据：证明写落地的成功提示必须写成
  `locator('…ant-message-success…').filter(`；未指名位点按文件登记豁免条数与理由，
  **超出豁免**与**豁免没用完**（清单随代码演进过期）两个方向都判红。
  第一版判据的字符类允许跨行，从上一行无关的单引号字符串一路匹到下一个选择器，
  在 `e2e/helpers.ts` 凭空多报一处 —— 是 `--self-test` 的「真实仓库必须先过」前置抓出来的，
  不是我读码读出来的；修法是把判据锚到 `locator(` 调用上并禁止跨行，
  并补一条必须**不开火**的正对照（在已指名断言前故意放一行无关单引号字符串）。
  读数：`✔ 未指名断言 4 处，全部在册且有豁免理由`，`--self-test` 四条控制全过。
- 归因中排除并留档：后端读己之写探针 20/20 无违例；nginx 只缓存静态资源；
  生产构建不注册 MSW；store 不从 localStorage 水合；`submitForApproval` 实现本身正确。

### 修复（R33：列表加载失败时页面说「暂无已提交报价」）

- **把同步失败说成业务事实**：报价清单拉取失败时 `loaded` 被置真而数组为空，
  对比页于是走进空态分支，向用户宣布「该询价单暂无已提交报价」。
  R30 补的 `loaded` 只分开了「还没加载」与「加载了且为空」，
  没把「加载结束**且失败**」分出来 —— 失败分支恰好复刻了 R30 要杀的那句谎话。
- **修法**：两个 store 各立第三根轴 `loadError`（成功清、两条 catch 分支置），
  对比页在 `!inquiryId`/`!inquiry`/空态分支**之前**统一拦一道，
  失败时渲染 `<Result status="warning">` + 「重试」，文案改成「还没拿到数据，不能判断有没有报价」。
- **常驻用例**：两个 store 各补一组 `loadError` 断言（`it` 计 4 条，按 `describe` 标题
  「…loadError（R33）」现数），`e2e/exception-scenarios.spec.ts` 补 1 条真实 500 链路。
  判别面踩到三个坑并逐条修掉：401 会清会话跳登录（改用 500）、`not.toContainText`
  作用在不存在的 locator 上是报错不是通过（缺席断言落到 `body`）、
  「重试」按钮全局离线横幅也有（改用只有修复才产出的文案「还不能判断」）。
  控制档（页面退回 `ec6735b` 的 blob 并重建镜像）确实断红 rc=1，修复档 5 项目全绿。
- **效果读数**：全量跑由 `184 passed / 2 flaky / 2 failed / 2 skipped` 变为
  `192 passed / 1 flaky / 2 skipped`，两条 firefox 硬红消失。

### 修复（R21 残留：门户 409 的可执行文案被前端丢掉）

- **FastAPI 的 `detail` 信封没人读**：后端把重复报价的提示写在
  `{"detail":{"error_type":"duplicate_quotation","message":"...请勿重复创建"}}` 里，
  而 `parseApiError` 的 409 分支只看顶层 `data.message`，`extractBackendMessage` 又不看
  `detail.message` → 实测四种 409 载荷全部塌成通用「数据已被他人修改或存在冲突，请刷新后重试」，
  后端专门写的下一步指引在门户消失。
  现在 409 按 `i18n(error_type) ?? 顶层 message ?? detail 文案 ?? 通用提示` 取文案，
  并补 `errors.duplicateQuotation` 中英两份（走文案表而非透出后端中文，英文界面才不会夹中文）。
  401/403 有意不变：那两类固定用前端文案，已有常驻用例钉着。
- **常驻用例**：`client.test.ts` 补 5 条（含"映射生效"与"无可读文案仍回落通用"两条极性、
  以及防两侧都缺键的夹具自检）；`e2e/supplier-portal.spec.ts` 补 1 条真实门户 409 链路
  （效力断言 + 必须出现"请勿重复创建" + 判别性对照不得出现通用冲突文案 + 不进入已提交回执态）。
  控制档把 `src/api/errors.ts` 退回改前，该 E2E 确实断在缺提示上。

### 修复（R32：写操作不 await 就弹成功 + R30 残留的"加载 vs 空"收口）

- **定标/取消在接口失败时给用户伪造结果（高）**：`quotation/compare` 的「确认定标」与
  `inquiry/detail` 的「取消询价」都是 `onOk: () => { 写操作(id); notifySuccess(成功文案); }` ——
  不 await、不看 `WriteResult`，所以重复提交被拦、记录被并发刷新挤掉（R28 那台机器）、
  版本冲突 409、500 这四类落空全部显示成成功。调用面普查（含 `useInquiryStore((s) => s.X)` 的 22 处订阅
  与 `approval` 页的 `action` 别名）显示 16 个询价/报价写操作调用点里 2 个丢弃返回值；
  但那条普查按名字取，真正的分母是类型规则跑出的 55 处非测试命中 —— 逐条读后其中
  **第三处同形缺陷在 `supplier/detail/index.tsx:104`（停用/启用开关）**，
  与列表页同一个开关的 await+分支写法不一致，一并修掉并纳入棘轮档。
  三处统一改为 await + 三分支，与同文件既有的 `handleSubmitApproval` 写法对齐。
- **防回归判据（零新增依赖）**：启用仓库里已在依赖中的 `@typescript-eslint/no-floating-promises`，
  按文件纳入 `eslint.config.js`（棘轮档，只列本轮清零的两个页面）。
  没自写 AST 脚本，因为标准规则判的是"返回值被丢弃"这个类型事实，而按方法名列名单会随 store 加方法静默漏判。
  全仓开启的代价已实测：该规则在 HEAD `10ac8f8` 命中 78 处（非测试 55 处），
  且 `src/pages/**/__tests__` 不在 `tsconfig.json` 内会导致类型解析报错 —— 故登记为后续项而非本轮接。
  牙齿：把定标改回不 await，`eslint . --max-warnings=0` 退出码 1（`232:9`），复位后 0。
- **`useInquiryStore.loaded` 是个零读者的假承诺，现已接上（R30 残留）**：该字段初值就是 `true`
  且生产侧从未被读，所以"改它会影响列表页等多处判断"这句登记理由是假的（波及面恒等于零）。
  现在初值改 `false`、生产模式失败分支也置 `loaded`，报价对比页把三种"没有"
  （可对比卡片为空 / 未找到该询价单 / 暂无已提交报价）统一挡在
  `!inquiriesLoaded || !quotationsLoaded || quotationsLoading → Spin` 之后，
  直达或刷新比价页不再闪一句「未找到该询价单」。补 3 条 store 用例，变异对照（去掉成功分支的 `loaded`）翻红。
- **E2E 常驻用例**：`exception-scenarios.spec.ts` 新增「定标接口 500：只报失败，不得伪造已确认定标」，
  含效力断言（响应状态确为 500，排除"根本没发请求"）与反向断言（成功提示里不得出现「已确认定标」）。
  反向断言按 MutationObserver 连续记录 toast 判定，不用 `toHaveCount(0)`：
  message 3 秒自动消失，重试型负向断言会在提示淡出后判绿 —— 变异档实测就是这样假绿过一次。
- **R28 残留取证完成**：8 处同形 `notFound()` 短路逐个查调用面 ——
  `deleteInquiry` 无 UI 调用点（不可达），其余均有 `await` 且落进 `notifyError(... ?? 操作失败)`。
  因此"同形即同样危险"更正为"同形但调用面已兜住提示"；把提示文案改成精确的
  「记录已被并发挤掉，请刷新」需要先裁决"本地短路该不该伪装成 ApiError"（现有用例把
  `toEqual({success:false, reason:'not_found'})` 钉成了基线），属口径决策，未做。

### 修复（R31：前端容器健康检查永远判不绿）

- **`frontend` 容器永久 `unhealthy`，而服务其实正常（中）**：nginx 只 `listen 80;`（IPv4），
  容器内 `localhost` 同时映射 `127.0.0.1` 与 `::1`，busybox `wget` 先试 `::1` 且不回退，
  于是 `wget --spider http://localhost` rc=1、`http://127.0.0.1` rc=0（容器内实测成对）。
  后端那条健康检查用 Python `urllib` 所以一直绿（`socket.create_connection` 会逐族回退）。
  两个 compose 文件的 frontend healthcheck 改指 `127.0.0.1`；未动 nginx 监听族。
  影响面是所有"看 compose 健康状态判就绪"的脚本（`up --wait`、`depends_on: service_healthy`）。
  mailpit 的同形写法本轮无镜像、未实测，按未取证登记在 R31 残留，不改。

### 修复（R21 闭合：门户并发提交让 DB 唯一约束直接穿出 ASGI）

- **并发提交报价时，输掉 check-then-insert 的那一路拿到的是未捕获异常而不是 409（高）**：
  `portal_save_draft` 与 `portal_submit_quotation` 都是
  `_find_quotation(...) is None → db.add(...) → db.flush()`，两个并发请求在各自的快照里都看不见对方的行，
  输家的 INSERT 撞 `uq_quotations_inquiry_id_supplier_id` 后**没有任何 handler 转换它**，
  异常穿出 ASGI 应用：TestClient 抛回调用线程（只进 warnings，套件照绿），
  生产 uvicorn 形态等价于 500 + 服务端栈。同表的内部写入口 `POST /api/quotations`
  早已 `except IntegrityError → 409 duplicate_quotation`，门户这两个口漏了同一步。
  现在抽出 `_duplicate_quotation_conflict(db, invitation)`（rollback + 与内部口同形的 409）并在两处 flush 各套一层。
- **登记更正**：R21 原先记作"会话对象被 GC 时的 unraisable flush、归属 `tests/test_task_queue.py`"，
  两条都是误读 —— 警告类型实为 `PytestUnhandledThreadExceptionWarning`（全量跑 5 条，
  `grep unraisable` 0 命中），归属 `test_invitation_security.py::test_concurrent_submit_...`；
  当时读的是 pytest warnings 归因表里 `datetime.utcnow()` DeprecationWarning 的那一组。
  教训已写进 R21：按警告类型分组读归因表，不要按"谁 warnings 多"。
- **新增常驻用例两条（先红后绿）**：`test_r21_portal_submit_conflict_returns_409_not_raw_integrity_error`
  与 `..._save_draft_...`，用 monkeypatch 把 `_find_quotation` 打成"永远看不见"来**确定性**复现输家可见性状态，
  不靠线程撞概率；修复前两条都断在 `UNIQUE constraint failed: quotations.inquiry_id, quotations.supplier_id`。
- **收紧既有并发用例**：它此前只断"至少一个 200"，500 或未捕获异常都逃不掉（未捕获异常甚至只进 warnings）。
  现补 `set(statuses) <= {200, 409}`，并实测该断言非恒真 —— 连跑 4 次分布都是 `[200, 409×5]`。
- 收尾读数：全量 `pytest` 426 passed / 1 skipped、coverage 85.44%，
  `IntegrityError` 与 `UnhandledThread` 命中数从 10 / 5 降到 **0 / 0**；`bandit -r app` 退出码 0、Issue 0 条。

### 修复（收尾审计第三轮：报价对比页把"还在加载"当成"确实没有"）

- **直达/刷新报价对比页会谎报"该询价单暂无已提交报价"（中）**：空态判据是
  `data.submittedRows.length === 0`，而报价列表只在 `App` 启动时拉一次；请求还在飞时
  `quotations` 仍是 `[]`，空态就成立了。并且该组件只订阅了 `getQuotationsByInquiry`
  （zustand 稳定 action 引用）而没订阅 `quotations` 本身，列表到货后不会重渲染，
  空态会一直挂着 —— E2E 里表现为 `[webkit] core-flow` 的「确认定标」按钮 10s 找不到、重试即过。
  现在 `useQuotationStore` 带 `loading/loaded` 标记（失败也置 `loaded`，避免永久骨架屏），
  比价页订阅它们并在空态之前先挡一层加载态；订阅本身同时修掉了"到货不重渲染"。
  常驻用例两条（在飞中/落地后/失败三条状态）+ 变异对照（去掉成功分支的 `loaded` 会翻红）。

### 修复（收尾审计第二轮：一次"点了发送却没反应"的真实竞态）

- **向导创建后立刻发送会静默不发请求（高）**：`useInquiryStore.sendInquiry` 以
  "本地缓存里有这条"为前置条件，而 `loadFromApi` 是整体替换缓存。向导 `onOk` 走
  `await addInquiry` → `await sendInquiry` 两次 await，中间只要落一次刷新（SSE 重连补拉、
  列表页 refetch 都会触发），刚创建的询价单就被不含它的服务端快照挤掉 → 本地 `notFound()` 短路；
  `onOk` 的 `if (!sent.success) return;` 又不弹提示（注释假设"拦截器已弹"，但本地短路没走网络）
  → 用户点"发送"后界面毫无反应，服务端留下一条孤儿 DRAFT。
  E2E 里表现为 `core-flow` 一条用例等满 60s，后端日志有 `POST /api/inquiries` 却没有 `/send`。
  修法：`sendInquiry` 不再以本地缓存为发请求的前提（存在性交回服务端判定）、
  `applyServerInquiry` 在缓存缺实体时插入而非只合并、`onOk` 对未走网络的失败补一条错误提示。
  常驻用例：`src/store/__tests__/useInquiryStore.test.ts` 新增竞态用例（先红后绿，
  并分别用"只回退守卫删除""只回退插入分支"两次变异确认都会翻红）。
- **E2E 侧把"没发请求"和"发了没跳转"分开**：`createAndSendInquiry` 先挂
  `waitForResponse(/\/api\/inquiries\/[^/]+\/send$/)` 再点发送并断言 2xx，
  失败信息不再是一句 60s 之后的 `waitForURL` 超时。
- **登记（未改）**：`useInquiryStore.ts` 另有 8 处同形的 `notFound()` 前置短路
  （`updateInquiry/deleteInquiry/cancelInquiry/selectSupplier/confirmInquiry/submitForApproval/approveInquiry/rejectInquiry`），
  触发窗口需要"用户正看着这条又被并发刷新挤掉"，本轮未取证，见风险文档 R28 残留段。
- **登记（读数可信度）**：前端覆盖率百分比跨树不可复现——同一份已提交树在主工作树读 39.97%、
  在 `git worktree` 检出读 42.39%，而两边**已覆盖语句数完全相同（7576）**，
  差异全在仪表化分母（18953 vs 17871，集中在 21 个页面 `.tsx`）。已逐一排除换行符、
  未跟踪 `.env.*`、`node_modules/.vite` 缓存与源码差异。门禁阈值 30% 不受影响，
  但文档中的百分比今后必须注明测量树，并对账用语句数。见风险文档 R29。

### 修复（收尾审计：干净签出复现不出 E2E 的绿）

- **E2E 的"绿"依赖一个没写进仓库的宿主环境变量（高）**：`docker-compose.dev.yml` 硬注入
  `DEMO_USER_PASSWORD=dev-demo-pass-12345678`（种子用户按它做哈希），而 `e2e/helpers.ts` 的兜底密码是
  `123456`。CI 恰好在 compose 步骤与 playwright 步骤各写了一次同一个强密码把它盖住，
  因此本地/干净签出一旦忘记导出该变量，前 5 次登录吃 401，随后被 `LOGIN_MAX_ATTEMPTS=5` 的锁定
  换成全线 429 —— 读数像限流故障，实为配置漂移（`CHANGELOG` 里 `test123`→`123456` 是同一类第二次）。
  现在 dev compose 改为 `${DEMO_USER_PASSWORD:-dev-demo-pass-12345678}`（宿主 env 真能覆盖，
  README 的说法随之成立），helpers 兜底值对齐，`login()` 断言按 401 / 429 分别给出根因与复算命令。
- **新增常驻门禁 `npm run e2e:config:check`**：`scripts/check-e2e-demo-password.mjs` 机械核对
  "dev compose 注入默认值 / `e2e/helpers.ts` 兜底值 / README 对外承诺值"三处副本必须相等，
  锚点未命中（位点被改写或删除）即失败；`--self-test` 带两条反证（注入漂移必须翻红、
  删除位点必须报锚点未命中）。CI 的 `docker-e2e` job 在启动 compose 之前先跑它，配置漂移在 30 秒内判红，
  不再由 180 个用例实例代为报错。
- **README E2E 段两处失真更正**：用例规模写的是"7 个文件 / 28 条用例"（现算为 10 个 spec 文件 /
  36 条 `test()` 声明 × 5 浏览器项目 = 180 用例实例）；运行前置写的 `docker compose up -d --build`
  是生产形态（`APP_ENV=prod` fail-closed，缺 `.env` 强密钥拒绝启动；且 `clamav/clamav:stable`
  无 linux/arm64 镜像，Apple Silicon 实测 `no matching manifest for linux/arm64/v8`），
  本地 E2E 的正确形态是 `docker-compose.dev.yml`，现已写明完整三步复现入口。

### 修复（本轮：实时推送链路与报价状态机的服务端断头）

- **SSE 事件流在浏览器里从不鉴权（高）**：`src/hooks/useEventStream.ts` 用原生 `EventSource`
  连 `/api/events/stream`，而该端点依赖 `get_current_user`（Bearer），`EventSource` 无法携带
  `Authorization` 头 → 浏览器侧恒为 `401`，"报价提交后采购端免刷新"整条实时链路实际不工作。
  改为 `fetch` + [`eventsource-parser`](https://github.com/EventSource/eventsource-parser)
  （MIT，4.1.1，2026-09-15 发布）读取响应流：认证仍走请求头、令牌不进 URL，
  保留原有指数退避（2s→30s）与重连后补拉；每次连接现取 token，续期换出的新 token 立即可用。
  未登录时不再发起注定 401 的建流请求（`App` 以认证态为开关，登录后立即重连而非等退避计时）。
- **供应商门户提交报价不广播事件（高）**：`publish("quotation_submitted")` 只挂在内部提交路径
  （`POST /api/quotations/{id}/submit`），而供应商实际走的是 `POST /api/portal/quotations/submit`
  → 即使上一条修好，采购端仍收不到推送。门户提交现在与内部提交同形广播（幂等重放不重复广播）。
- **报价全部回收后询价状态停在 `INQUIRING`（高）**：状态机声明了
  `INQUIRING → PARTIAL_QUOTED → ALL_QUOTED`，但服务端没有任何写入口推进它，
  比价页的"定标 / 提交审批"入口（要求 `ALL_QUOTED`/`PENDING_CONFIRM`）永远不出现。
  新增 `_sync_quote_progress()`，按受邀集合与已提交集合在门户提交事务内推进（含 `db.flush()`，
  否则本次提交仍挂在会话里、统计落后一次提交），并只在 `validate_inquiry_transition` 允许时改写。
- **发送询价的顺序与提示说谎（中）**：`handleSend` 原先在创建请求未落定时就调用发送并弹成功提示，
  失败时页面已跳转。现改为 `await` 创建/更新成功 → `await` 发送成功 → 才提示与跳转。
- **写请求携带过期的 `version` 导致 409（中）**：`useInquiryStore` 各写入口原先本地猜测
  `version + 1`，与后端自增的权威值脱钩，下一次写必然乐观锁冲突。改为每个写入口
  `applyServerInquiry(...)` 采纳服务端返回实体（`update/cancel/send/confirm/submitApproval/approve/reject/selectSupplier`）。
- **派生列表不随组织切换刷新（中）**：7 处调用点以 `getVisibleInquiries`（zustand 的稳定 action 引用，
  永不变化）作为 `useMemo` 依赖，等于只订阅了 `currentOrganization`；新增 `useVisibleInquiries()`
  订阅 `inquiries` + `currentOrganization` 并替换全部调用点。
- **登录前引导业务数据把 store 打成"离线"（中）**：`App` 无条件 `bootstrapStores()`，
  登录页也会挂载它 → 未鉴权时全部 401、store 标记离线且登录后不再重取（工作台全为 0）。
  改为仅在已认证时引导，并在"未认证 → 已认证"那一刻补一次。
- **CI 安全扫描门禁为红（中）**：`bandit -r app` 因 `app/config.py` 两处 `except Exception: pass`
  报 B110（CWE-703）并以退出码 1 结束，`security-scan` 步骤（无 `continue-on-error`）必然失败。
  改为记录 debug 日志（可选依赖缺失 / 演示密钥解密失败的现场信息），门禁转绿。

### 新增（本轮测试）

- `src/hooks/__tests__/useEventStream.test.ts`：由 `EventSource` 桩改为 `fetch` + `ReadableStream`
  桩，13 条用例覆盖 Bearer 建流、无令牌不发头、跨分片 data 解析、`connected` 首帧不分发、
  重连补拉、退避阶梯（2s→4s）与成功后复位、401 重连带新令牌、卸载中断且停止重连。
- `src/hooks/__tests__/useVisibleInquiries.test.tsx`、`src/store/__tests__/useInquiryStore.test.ts`
  新增用例：前者钉住"新增询价/切换组织后列表跟随"，后者用带状态的假 API 证明下一次写携带
  服务端返回的 `version`。
- `backend/tests/test_quote_progress.py`：门户提交推进状态机（0/2→1/2→ALL_QUOTED）、
  重复提交不回退、以及"门户提交必须广播 `quotation_submitted`"（含幂等重放不重复广播）。
- `e2e/sse-live-events.spec.ts`：真实浏览器断言登录后事件流返回 200 且 URL 不含令牌；
  另一上下文以邀请令牌提交报价后，采购端在**同一次文档生命周期内**（页内标记未被刷掉）
  从 `0/2` 变为 `1/2`。
- E2E 规格与产品实现对齐：8 个 spec 的确认按钮（antd v5 danger 为 `.ant-btn-dangerous`）、
  门户提交前预览弹窗、行内按钮替代行点击、错误响应体形状等按当前实现更新，
  并把 `playwright.config.ts` 的 `workers` 收敛为 2、`expect.timeout` 放宽到 10s
  （后端单 worker，冷启动首屏断言在默认 5s 预算内偶发超时）。

### 修复（本轮：SSE 连接占用、跨视口可用性）

- **SSE 长连接不再占用连接池连接（高）**：`/api/events/stream` 依赖 `get_db`，
  而 `StreamingResponse` 的响应体永不结束，FastAPI 的请求级退出栈也就不回收 session ——
  每个在线订阅者长期占走一条连接。实测（dev 栈 `QueuePool 5+10`）：打开 18 条订阅后
  `GET /api/inquiries` 从 **0.0s/200** 变成 **30.0s/500**；端点交回响应前显式 `db.close()`
  后重跑同一脚本回到 **0.0s/200**。
- **窄屏顶栏压盖（中）**：412px 级视口下「组织选择 + 最后同步」一组覆盖到语言/主题按钮，
  用户点不到。`MainLayout` 的 `Header` 改为可换行（`flexWrap` + `rowGap`、`minHeight:64`），
  不隐藏任何入口。
- **挂起请求的提示文案按引擎分档（低）**：chromium 由 axios 15s 超时提示「请求超时」，
  WebKit 提前中止停滞连接 → 提示「网络错误，请检查连接」。E2E 改为断言
  「出现错误 toast + 失败的停用整体回滚」，并只在 chromium 项目钉具体超时文案。
- **跨视口 E2E 校准（中）**：新增 `DATA_ROW`（Table 行与窄屏 `List` 卡片并集）、
  `tap()/tick()`（键盘等价触发，绕开 sticky 元素在 CDP 里返回未吸附四边形的命中测试假阳性）、
  `chooseSupplierOnCompare()`（ArrowDown 打开下拉）、门户填表改按产品稳定 DOM id 定位、
  「更多 ▾」在触屏上下文按点击而非悬停展开。
  `playwright.config.ts` 增加 `timeout: 60_000`（整链路实测 webkit 30.3~34.8s，默认 30s 会误判），
  并把 `workers` 从 2 固定为 1（同机同码同预算实测：2 worker → 9 红 18.7 分钟，
  1 worker → 0 红（8 个首跑抖动由重试兜住）21.2 分钟）。
- **E2E 时序假阳性收敛（中）**：`helpers.login()` 先等待登录接口返回 2xx 再断言跳转并给 30s
  预算（实测一次全量跑里 3 次停在 `/login`，登录是全套件最重的请求）；下拉菜单选择器加
  `:not(.ant-dropdown-hidden)`（收起的弹层 DOM 仍挂在页面上，实测 firefox 命中隐藏节点）；
  core-flow 的 7 处 `.ant-message-success` 由写死的 5s 改为继承配置预算；对比页卡片改走
  键盘 Enter（避开侧栏子菜单浮层的遮挡）；删掉 `exception-scenarios.spec.ts` 里重复实现的 login。
  收敛后 5 项目 180 用例实测 178 passed / 2 skipped / 0 failed / 0 抖动（7.9 分钟）。

### 新增（本轮测试：连接占用与跨视口）

- `backend/tests/test_sse_stream_no_db_leak.py`：先证明连接确被占住，再断言
  `stream_events()` 交回响应前已归还（删掉 `db.close()` 即红）。
- `src/pages/quotation/compare/__tests__/CompareInquiryPicker.test.tsx`：可对比询价单
  选择器的空态 / 卡片 / 点击 / 键盘 Enter / 只统计 `SUBMITTED` 五条契约
  （E2E 曾把"有数据时渲染卡片"这一分支当成表格或空态来断言）。

### 修复（本轮：Access Token 自动续期链路闭环与常驻门禁转绿）

- **同源校验按 origin 归一化比较（后端）**：`_assert_same_origin` 之前把浏览器 Origin 与
  `CORS_ORIGINS` 逐字符串比对，而浏览器会省略 http/https 默认端口（`http://localhost`
  而非 `http://localhost:80`），导致 nginx 反代（同源）部署下 `POST /api/auth/refresh`
  返回 403，前端自动续期在真实部署形态下失效并把用户踢回登录页。
  现按 `_canonical_origin` 归一化（小写、省略默认端口）后比较，并放行"与本次请求自身同源"
  的来源（OWASP CSRF 建议的 target-origin 校验），跨站 Origin 仍返回 403。
- **常驻门禁由红转绿**：`src/pages/supplier-portal/__tests__/index.test.tsx` 的 3 个提交类用例
  因夹具写死 `deadline: 2026-08-11`，在真实时间越过该日后确定性失败（自 2026-08-11 起
  `npx vitest run` 即为红）。改为相对当前时刻生成后恢复。
- **测试超时兜底**：`vitest.config.ts` 设 `testTimeout: 20000`，避免多 worker 并行时
  antd 重渲染页面的用例在默认 5s 内跑不完导致的偶发红。

### 新增（测试）

- `src/api/__tests__/client.refresh.test.ts`：401→`/auth/refresh`→重放 的续期成功、
  并发单飞、续期失败登出、`_retry` 防循环四条判据各配对照（夹具改用与 axios `settle()`
  同形的 `AxiosError`，原 401 用例的夹具缺 `error.config`，续期分支在旧用例中不可达）。
- `backend/tests/test_security_hardening.py::test_refresh_same_origin_behind_reverse_proxy`：
  同源/默认端口省略放行 + 跨站仍 403 的两侧对照。
- `e2e/auth-session-refresh.spec.ts`：真实浏览器 + 真实后端验证 token 过期后自动续期
  不被踢回登录页，并配"清掉 refresh cookie 必须登出"的反向对照。
- `src/test/temporalFixtures.ts`：`inDays/agoDays`，被产品代码消费的截止/有效期一律相对当前时刻；
  同步把 `src/__tests__/axe.test.tsx`（此前静默扫描"已截止"页面变体）与
  `src/pages/dashboard/__tests__/index.test.tsx`（2027-01-01 后会漂移）改为相对日期。

### 新增（本迭代：供应商安全参与与生产部署闭环）

- **供应商安全邀请闭环（P0）**
  - 新增 `supplier_invitations` 表（`id/inquiry_id/supplier_id/token_hash/expires_at/status/created_at/sent_at/first_opened_at/last_opened_at/submitted_at/revoked_at/created_by`），`token_hash` 唯一。
  - 邀请 Token 采用密码学安全随机值，库中仅存哈希，绑定唯一询价+供应商，带有效期，支持撤销/重新生成/重新发送。
  - 供应商门户改为独立 API + 邀请 Token 专用鉴权（不再依赖内部采购 Bearer Token），字段级最小化输出，枚举 ID 无法越权。
  - 前端路由改为 `/supplier-portal/:invitationToken`，实现 7 种页面状态（有效/过期/撤销/已提交/允许修订/已截止/已取消）。
  - 真实 API 失败不再静默回退 mock。

- **组织级与资源级数据权限（P0）**
  - 新增统一资源授权层（`backend/app/policy.py`），普通采购默认仅可访问自己创建/负责/被协作/组织共享的询价。
  - 创建询价的 `organization/owner_id/owner_name/created_by_id/created_by_name` 由服务端强制生成，不信任前端。
  - 普通更新不得修改 `status/organization/created_by/code`；所有 list/get/update/delete/action 均执行资源级校验。

- **服务端强约束状态机（P0）**
  - 新增 `backend/app/state_machine.py`，询价/报价/审批状态机化，非法转换返回结构化 409，普通 PUT/PATCH 不得直接修改状态。
  - 动作接口幂等，`Idempotency-Key` 支持（发送邀请/提交报价/提交审批/确认定标）。

- **数据模型与金额正确性（P0）**
  - 金额/单价/税率/总额改用 Decimal + Numeric；时间用带时区 DateTime + ISO 8601。
  - 补齐外键（`quotation.supplier_id`、`quotation_item.inquiry_item_id`、`notification.user_id`、附件归属）。
  - 唯一约束（供应商在询价中有效报价唯一、审批节点顺序/当前待审批唯一、`token_hash` 唯一）。
  - CheckConstraint/服务端校验（`quantity>0`、`unit_price>=0`、`delivery_days>=0`、合法税率/币种/状态）。
  - 服务端重算未税/税额/含税/总额，不信任客户端 `total_amount/supplier_name/组织/操作者`。

- **鉴权会话安全（P1）**
  - 登出先携带凭据撤销服务端会话再清本地；库中只存 Token 哈希。
  - 短期 Access + 可轮换 Refresh + HttpOnly/Secure/SameSite Cookie；会话列表/单会话撤销/全部退出/Refresh 重用检测。
  - 限流与幂等数据迁移到 Redis（可多实例）；`X-Forwarded-For` 仅可信代理读取。
  - 安全响应头（CSP/HSTS/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）。
  - CI 增加依赖漏洞扫描、Secret 扫描（gitleaks）、SAST（bandit）、容器镜像扫描（Trivy）。

- **PostgreSQL 与部署（P1）**
  - 支持 `DATABASE_URL` 使用 PostgreSQL；SQLite 仅开发/演示；生产不再调用 `create_all`，仅由 Alembic 管理。
  - 新增全新库升级/上一版本升级/关键迁移 downgrade 测试；Docker 健康检查改用 `/api/ready`；Compose 健康条件控制依赖。
  - 开发/测试/生产环境配置示例；密钥全部通过 Secret/环境变量注入。

- **真实通知与附件上传（P1）**
  - 发送询价改造为异步可重试任务，支持邮件等可扩展渠道、模板/多语言/变量校验/预览。
  - 逐供应商交付状态（待发送/已发送/已送达/失败/退信/已打开/已提交），支持重发与截止提醒；发送失败不再显示"全部发送成功"。
  - 通知绑定用户级未读与偏好。
  - 真实文件上传服务（本地存储/S3/MinIO），预签名或流式上传，校验大小/MIME/扩展名/文件名/资源权限，支持进度/取消/重试/预览/删除、病毒扫描预留、下载鉴权、孤儿清理与审计日志。

- **服务端 AI（P1）**
  - 新增后端 `/api/ai/*`，API Key 仅存服务端，可插拔 Provider。
  - 超时/有限重试/并发限制/熔断/成本与 Token 统计/结构化输出校验/敏感字段脱敏/审计记录。
  - AI 不可用回退本地规则；输出仅标注为辅助建议。

- **mock 与真实数据隔离（P1）**
  - 演示模式显式环境变量开启；生产构建默认禁止 mock fallback。
  - 后端不可用显示离线状态与最后同步时间；缓存标明是否过期；不再无提示回退 localStorage。
  - 统一 React Query（服务端数据/缓存/失效）与 Zustand（客户端 UI 状态）职责。

- **供应商报价体验（P2）**
  - 报价流程步骤条（阅读/填写/上传/检查/提交成功）；防抖自动保存 + 保存中/已保存/保存失败/最后保存时间。
  - 未保存离开提示与草稿恢复；提交前错误摘要并可定位到具体物料/字段。
  - 批量税率/交期/付款；Excel 模板导出/导入；复制上一轮报价。
  - 移动端物料卡片 + 底部固定操作栏；上传进度/重试/错误原因；回执编号/时间/总额/下载回执；撤回/修订状态规则；无障碍（键盘/焦点/屏幕阅读器/WCAG）。

- **采购端体验（P2）**
  - 列表查询改服务端分页/筛选/搜索/排序；搜索筛选状态同步 URL；用户保存视图与列配置持久化到服务端。
  - SSE 实时更新（未读/详情/比价/通知）；用户级通知中心与偏好。
  - 比价页增强（币种统一/税费标准化/运费/付款折算/交期/质保/历史履约/技术商务偏离/总拥有成本）；推荐原因/异常值/缺失数据解释。
  - 定标创建不可变报价快照；服务端生成 PDF/Excel；未报价/部分报价/不同币种/异常报价的空态与风险提示。

- **国际化与前端工程治理（P2）**
  - 硬编码文案全入 i18n；CI 增加缺失/未用翻译键检查；拆分超大页面组件；抽取表单 Schema/领域 Hook/API Hook/状态组件/格式化/权限守卫；Error Boundary/路由懒加载/性能监控。

- **测试与质量门禁（P2）**
  - 新增测试：邀请 Token 安全、组织/资源越权、状态机参数化、金额精度、并发/乐观锁、幂等、数据库迁移、PostgreSQL 集成、文件上传安全、AI 超时/回退/结构校验、中英文 E2E、多浏览器/移动端 E2E、axe 无障碍。
  - 覆盖率门禁：后端 `--cov-fail-under=80`（实测 81.18%）、前端 vitest thresholds 30%。
  - CI 任意关键任务失败即禁止视为完成（quality/build/backend-test/security-scan/docker-e2e）。

### 修复

- 修复 E2E 仍使用旧 `/supplier-portal/:inquiryId/:supplierId` 路由的问题，改为通过有效邀请 Token 访问。
- 修复 E2E 登录辅助函数默认密码与后端演示密码不一致（`test123` → `123456`）导致登录 401 的问题。
- 修复 `regenerate_invitation` 通过重建记录违反 `(inquiry_id, supplier_id)` 唯一约束的问题，改为在原记录上原地更新 Token。
- CI `docker-e2e` 增加超时失败、服务日志转储、Playwright trace/截图/视频产物，便于后续定位。

### BREAKING

- 供应商门户访问从 `/supplier-portal/:inquiryId/:supplierId` 改为 `/supplier-portal/:invitationToken`。
- 供应商门户鉴权从内部 Bearer Token 改为邀请 Token 专用鉴权。
- 金额字段从 Float 改为 Decimal（API 序列化为字符串或保留精度数字）。
- 生产启动不再调用 `Base.metadata.create_all`，仅 Alembic 管理 schema。
- 创建询价的 `organization/owner_id/owner_name/created_by_id/created_by_name` 由服务端强制生成，前端提交将被忽略。
- 普通更新接口不再允许修改 `status/organization/created_by/code`。

### 文档

- 更新 `README.md`（测试数量与实际一致）、`CHANGELOG.md`、`docs/deployment.md`、`docs/architecture.md` 与 `.env.example`。

---

## 历史版本

- `feat: production readiness (migration, observability, AI abstraction, tests, a11y, mobile)` — 生产就绪迭代（迁移/Alembic、可观测性、AI 抽象、测试、无障碍、移动端）。
- `feat: state model & compare UX` — 状态模型与比价体验（评审意见保存保护、导出反馈、比价守卫）。
- `feat: data consistency & error recovery` — 数据一致性与错误恢复（写结果、并发 409、服务端编号、axios）。
- `feat: production security & auth` — 生产安全与鉴权（bcrypt、Token 过期/撤销、限流、401 流程）。
- `feat: reliability hardening & enterprise UX` — 可靠性加固与企业级体验（可靠性、权限、比价、E2E、CI）。
- `refactor: deep iteration & UX optimization` — 深度迭代与 UX 优化。
