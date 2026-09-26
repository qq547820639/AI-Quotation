# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。未发布的变更列入 `[Unreleased]`。

## [Unreleased]

### R36 前提更正（实测）：一次事件不等于一次全表读

- 起了本机栈（后端 `:8080` 走 SQLite 副本 + `vite :5173` 且 `VITE_DEMO_MODE=false`）实测：
  一条业务动作产生的 **3 个 `quotation_submitted` 事件（服务端发出时刻 19ms / 15ms 间隔）
  只换来 1 对 GET**。三条独立客户端账本互证：Playwright response、页内
  `XMLHttpRequest.open` 补丁、`performance.getEntriesByType('resource')`；
  服务端另开一条裸 SSE 读流证明 3 帧确实发出 ⇒ 合并在客户端。
- **合并机制**是 `src/api/client.ts` 的 `createDedupAdapter`（幂等 GET 并发相同则合流，
  key = `method:url:params`），它本就有常驻用例。R36 的放大模型此前没把它算进去。
- **因此 C（在 SSE handler 里做突发合并）撤销不做**：与既有保证重叠 ⇒ 第二份副本。
  **B（窄投影）仍是载荷侧唯一杠杆**，但收益口径从"每事件 19–23KB"改成
  "**每次落在飞行窗口之外的事件** 19–23KB"。
- 闭合一条上轮登记缺口：**"一次事件两条 GET"的报价那条，浏览器侧现在实测到了**（各账本均 1 条）。
- 顺带一条读数：同一份 5 行库三次跑分别是 `19,951 / 21,319 / 23,148 B`，
  只因探针反复提交同批报价在追加日志 ⇒ 单行字节随写增长，
  之前记过的"3,413 B/行"与"3,852 B/行"都不该当常数引用。
- **R36 终案：改判为"已知代价 + 写明重开判据"，三条修法逐条给出不做的理由。**
  A（服务端聚合）仍否——会造第二份业务规则；
  B（窄投影 + 工作台切片）不做——收益口径被实测砍到"只压窗口外事件"，
  而成本不变：真正的门槛是跨页失效面重划（16 个整行消费者文件的 store 水合路径），
  只加窄查询不动失效等于**净变差**（多一条请求）；
  E（按可见性过滤广播）否——`policy.py:63-84` 是行级规则，按事件过滤订阅者要么给 `publish()`
  加同步 DB 查询（把读放大搬到写路径），要么再抄一份内存版规则。
  重开判据三条，各带当前读数：单次暴露 > 1MB（现在 26KB）、
  事件间隔实测大于请求时长（现在 15–19ms vs 19–60ms）、并发在线订阅 > ~50。

### R41 收尾 + R34 判据 AST 化

- **R41 调用点全部改完**（`1aa69fd`）：`supplier`、`inquiry/list`（两处）、`inquiry/detail`、
  `quotation/compare`（含 `exportCompareWorkbook` 这条链）共 5 个导出位点改为
  `await` 之后才 `notifySuccess`，失败走各页**既有**错误通路（未新增任何 i18n key）。
  `inquiry/detail` 那个装饰性的 `catch` 从此真能接到异常。
- **一条反向对照被证明结构性做不到，并已改防线落点**：把 `exportAOA` 改回返回 `void` 之后，
  删掉调用点的 `await` 不再有任何门禁会红（`await voidExpr` 合法、80007 只是 suggestion、
  `await-thenable` 未开）。故新增 `src/utils/__tests__/excel.test.ts` 钉契约形状
  （返回 Promise / 生成未完成前不 resolve / 失败必须 reject）。
  变异复验：`excel.ts` 换回 fire-and-forget 那份 ⇒ `3 failed | 1 passed`；换回后 `4 passed`。
- **R34 的 toast 判据从文本面换成 AST 面**（`25e6e5b`，就地替换同一把尺子）：
  现在认得 ① 模板字符串选择器 ② locator 先赋变量再断言/再 filter ③ `getByText` 实参能吃几条成功文案。
  档位八种，Σ != 站点数即"读数作废"退 2，文案目录取不到也退 2。
  真语料读数：`站点 14（named=1 helper=7 negative=1 generic=5）`；与旧判据求差集只有三类
  （多出 `supplier-portal.spec.ts:50` 一处 generic、7 处 helper 开始计数、`toHaveCount(0)`
  的缺席断言由新 `negative` 档吸收不占豁免）。自测 **18 臂**全过。
- **主动不收的一种绕过**：`getByRole(_, {name})` 当 toast 位点在真语料上 FP 2 处 / TP 0 处
  （`permission.spec.ts:42`、`:60` 的按钮名 `/保\s*存|Save/` 恰好命中三条含"保存"的成功文案）
  ⇒ 按"FP 普查非 0 就不配当门禁"收回 `getByText`，并把该形状写成自测的一臂钉住。

### 门禁 + 修复（八度复评：`no-floating-promises` 推到整棵 src/，并修掉 R42）

- `eslint.config.js` 新增全量档 `files: ['src/**/*.{ts,tsx}']` ⇒ 类型感知的
  「Promise 必须被消费」不再只管 3 个页面。代价实测 **22 文件 72 处**（非测试 49 / 测试 23；
  严格"去 void 后逐字相同"口径读到 68，另 4 处是 `if (…) void navigate(…)` 与 prettier 拆行，
  逐条读过才计入）。
- 判据的两极性实测：往 `src/` 放裸 `Promise.resolve(1);` → eslint rc=1 点名本规则；
  加 `void` → rc=0。**19 处是 react-router 的类型假阳性**（`navigate` 声明返回
  `void | Promise<void>`，本机 `@typescript-eslint@8.65.0` 的 `checkThenables` 默认已 false 仍开火）。
- 旧棘轮档注释里「未列出的文件不受影响」在全量档下变成假话，就地更正；那份历史 `files`
  名单保留为决策记录，并注明它已不再决定适用域。
- **R42 修复**（`c382143`）：`addNotification` 被服务端拒绝后不再留下永久幽灵通知。
  过去它先乐观写本地数组 + `unreadCount + 1` 再 `await create()`，`catch` 只 `return fail(e)`；
  而 `loadFromApi` 的 `localOnly` 合并规则（`useNotificationStore.ts:84-85`）会把服务端从未接受的那条
  **原样保留**，`refreshUnreadCount:106` 又按服务端计数 ⇒ 角标与列表自相矛盾。
  现按 id 撤该条并按其 `read` 位扣未读（不整体回滚数组，避免连带丢掉等待期间的并发写入）。
  常驻用例两条（成功/失败两极性 + 并发控制），变异对照：删掉撤回的 `set()` → `2 failed | 8 passed`。
- **R41 根因侧**（`309a611`）：`exportAOA`/`exportMultiSheet` 改为返回生成完成的 `Promise<void>`。
  5 个调用点「生成还没完成就 `notifySuccess`」的搬迁在同一次改动里跟进，
  其中 `src/pages/inquiry/detail/index.tsx:411-413` 那个因拿不到 Promise 而装饰性的 `catch`
  会因此变成真的能抓到。

### 取证更正（R36 定案的收益数与成本档次）

- **作废两个字节数**：上轮 R36 选型记的「20,693B → 1,017B（省 95.1%）」与「513B（省 97.5%）」
  量的是一条**消费者跑不起来的投影**——它裁掉了 `logs` 与 `invitedSupplierIds`，
  而 `src/pages/dashboard/workbenchActions.ts:46`、`:49`、`:112` 正在读它们。
  且那两个数出自一次子 Agent 测量，其脚本不在我的复算目录里（`grep -rn "1017" /tmp/qqi-r36/` → 0 相关命中），
  数据集也不同（报价 6 条 / 我这边 8 条）⇒ 按"无法复开"处理。
- **换成本地一手读数**（起后端 `DB_PATH=/tmp/qqi-r36/procurement.db` + `python3 /tmp/qqi-r36/proj-restore.py`，
  校准控制：真实响应 19,267B == 重序列化 19,267B 逐字节对上）：
  按消费者真读的字段集重裁，**B 只服务 ActionWorkbench ⇒ 2,369B / 省 91.0%**；
  若投影要覆盖整个 dashboard 页（图表读 `i.items`：`src/pages/dashboard/index.tsx:464`、`:509`）⇒ **5,009B / 省 81.0%**。
  「三个重嵌套占询价载荷 78%」复核成立（实测 78.7%）。
- **一次事件是两条 GET 不是一条**：`src/App.tsx:51-52` 同时重取 inquiry 与 quotation store，
  `useQuotationStore.ts:75` 无缓存短路 ⇒ 两条响应体合计 26,323B / 事件 / 客户端。
  浏览器侧只实测过 inquiries 那条（计数器 `sse-amp-b2.mjs:74` 的 `^/api/inquiries/?$` 从形状上就排除了报价），
  quotations 那条按机制核实登记，测法写进登记册的未做清单。
- **`适配成本` 由"小"改判"中"**：共享整行有 **16 个非测试文件**在消费（判据与三条排除项见登记册），
  所以 B 不是"给现有取数加个参数"，而是新端点 + 新查询切片 + SSE 失效面按页重划 +
  一条"规则读的字段 ⊆ 投影字段"的常驻对账。**选型结论不变**（仍 B、仍否 A），
  C（只合并突发）由"可选叠加"升为可先落地的缓解项。
- 同一轮里我**第一次复算又造了新错**（把"348KB"当成可由我这 5 行库纠正的数），已按行内更正收回：
  `3,413 B/行` 与 `348 KB` 各自有自己的语料与一条真读数 `Content-Length: 340,361`，三份语料不能互相覆盖。

### 修复 + 门禁（R39：一个组件测试文件从未被类型检查过）

- `src/pages/dashboard/__tests__/ActionWorkbench.test.tsx` 与 `actionWorkbench.test.ts`
  **去掉扩展名后大小写不敏感相等**；本 APFS 卷 `useCaseSensitiveFileNames === false`，
  TS 的 `include` 展开会丢掉后收集的那个 ⇒ `tsc --noEmit` 一直 rc=0、`vitest` 也照常跑它，
  但这个文件从来没进类型检查面（实测 `--listFiles` 命中数 0）。
- **修法是改名不是兜底**：`git mv` 把纯逻辑那份改成 `actionWorkbench.pure.test.ts`，
  而不是给 `tsconfig.json` 补 `files`（改名让这类撞名不再可能复发）。
  复验：两个文件都进 `--listFiles`（1/1）、`tsc rc=0`、`vitest 3 files / 26 tests passed`。
- **顺带拆掉我登记的一条假阻塞理由**：原写「`src/pages/**/__tests__` 不在任何 tsconfig include」——
  实测 `tsconfig.json` 是 `include: ["src"]` 且无 `exclude`，`--listFilesOnly` 收 165 个 src 文件
  （含全部 `__tests__`）⇒ 那句不成立，真因就是上面的撞名。
- 新常驻门禁 `scripts/check-tsc-coverage.mjs`：按**两个集合的差**判（`git ls-files src` 的非 `.d.ts`
  `.ts/.tsx` vs `tsc --listFiles` 落在仓库根下的那批），不看命名规律；三条前提各判 `rc=2`
  而不折算成通过（`git ls-files` 为空、`tsc` 非 0、分子为空）。判据自测 **6/6**，
  两极性实测：改名前的 `git worktree` 检出 → `rc=1` 并点名那个 `.tsx`；当前树 → `rc=0`（163 全覆盖）。
- 已接 `package.json` 的 `tsc:cov:check` 与 `ci.yml` 中 `npx tsc --noEmit` 之后的一步。
- 这把尺子的第一个 bug 由**事故树复放**抓到：我把仓库目录名当路径标记写死，主树里对、
  到 worktree 就分子为空判 `rc=2` ⇒ 改成算出来的 `ROOT + '/'`，并给自测补一条
  「树外路径与别的检出目录不得混进来」的臂。

### 测试（R37 前置取证：撤回一条我自己登记的行为断言）

- **撤回**：R35 那轮登记里写着「偏好写入失败时 Switch 停在用户刚拨的位置，是界面与后端不一致」。
  本轮把它写成常驻用例 `src/pages/notification/__tests__/index.test.tsx`（3 条）并实测：
  失败后 `aria-checked` 仍是原值、store 无一位被改写 ⇒ **该症状描述不成立**。开关完全受控于
  `preferences`（`index.tsx:138`），store 只在成功分支 `set`（`useNotificationStore.ts:124-132`）。
  真实缺陷降级为「拨了没反应且无任何提示」，仍留作后续项。
- 这条否证之所以可信：同文件配了**正向对照**（mock 改为 resolve 后同一开关确实变 `false`），
  排除了"locator 根本不匹配所以永远'没变'"这一类空转。
- 写这条用例时踩到并修掉的两个自身问题（都记进了登记册）：
  ① 按"DOM 第 1 个 `.ant-switch` == 某个 key"绑，而真实渲染顺序与 key 名都和我猜的不同
  （实为 `inquirySent, quotationSubmitted, deadlineReminder, approvalResult`），
  用例红在**前提**而不是结论 ⇒ 改为四个布尔位全置 true、按"有没有任何位变 false"判，与顺序解耦；
  ② 用 `as never` 绕类型时 `vitest` 全绿而 `tsc --noEmit` 报 `TS2698`，两个门禁必须分别取码。
- 门禁读数：`vitest 434 passed (39 files)`、`lint rc=0`、`tsc rc=0`。

### 门禁（R36 前置：E2E 采信前的"装树 == 锁文件"预检）+ R35 的 E2E 全量复跑

- **补的门禁**：`scripts/check-e2e-install.mjs` 逐包比对 `package-lock.json` 与
  `node_modules/**/package.json`，三类判据（版本漂移／锁里有磁盘没有／磁盘多出未在册），
  退码 `0/1/2`（读不到锁文件判"前提不成立"，不静默通过）。平台专属可选包缺失**不判红**。
  判据自测 7/7，含两条"必须不开火"臂（平台可选包、在册作用域包）。
- **为什么要有它**：本轮一次 `npm install --no-save` 在**正在跑 Playwright 的同一棵树**上执行，
  79 个包被 `^` 区间就地升级（`@playwright/test` 1.62.1→1.63.0），runner 中途被换，
  最后起跑的 `mobile-ios` 39 条全灭于 `Executable doesn't exist`，先跑完的 4 个 project 照旧绿——
  读起来像产品回归，实际是被测环境被我换过。**`git status` 看不见这个面**（`node_modules` 未跟踪），
  所以必须有独立一把尺子。
- **接线两条路**：`playwright.config.ts` 的 `globalSetup`（事故那条路是 `npx playwright test`，
  它不走 npm 生命周期，`pree2e` 挡不住；而 globalSetup 覆盖一切会启动 Playwright 的路径，
  含 `npm run e2e` ⇒ 先加的 `pree2e` 因与它完全重叠、只会让尺子跑两遍，随后删除）、
  以及 `ci.yml` 的显式新 step（用的命令就是 `e2e:install:check`）。
  两极性均实测：指到事故树 → `rc=1` 且日志中真用例结果为 0 行；正常树 → 先绿再跑。
- **尺子自己的 bug 被自己的控制抓到**：作用域键少切一段导致 133 个在册作用域包全量误报，
  由"真仓库必须静默"这条臂当场判红发现；修好后把"未在册包必须开火"拆成普通名/作用域名两支，
  避免它在坏尺子下空开。用事故留档树复放：`✘ 89 处漂移`（79 版本 + 9 嵌套副本 + 1 未在册），
  并点名 `@playwright/test: 锁=1.62.1 磁盘=1.63.0`。
- **R35 的全量 E2E 复跑**（后端改了、前端与用例未动）：`193 passed / 0 failed / 2 skipped`、
  flaky 0、11.7 分钟，起跑前后装树漂移均为 `drift=0`；与五度复评逐项对得上，
  这次连抖动都没有（宿主 load 6 vs 上次 24，未调任何超时）。
- **收尾改从 `87d5f17` 的 `git worktree` 检出复算**（不用工作树）：E2E
  `192 passed / 1 flaky / 2 skipped / 0 failed`（RC=0，10.9m，前后 `drift=0`）；
  前端 `lint`/`tsc`/`vitest 431`/`i18n` 与三把判据自测（7/7、toast、demo-password）全绿；
  后端 `436 passed, 1 skipped`、coverage `85.51% ≥ 80%`。
  那条 flaky 落在 `helpers.ts:271` 的**豁免位点**上（门户提交回执的泛化 toast 前置断言，
  load 11 下 10s 没等到），不改超时也不改断言，只把它记成"豁免未实测"这项的新证据。
- 同轮另登记一条**未闭合的测量学事实**：同一 commit 下 vitest 覆盖率主树 `40.12%` /
  worktree `42.51%`，两边文件数（111）与**已覆盖语句数（7,630）完全相同**，差的是分母
  （19,014 vs 17,949）。两个候选解释（`vite.config.js` 遮蔽、宿主 `.env.development*` 内联）
  均已实测否证，故只记"归因未定"，并把"跨树比覆盖率一律锚已覆盖语句数、不锚百分比"落成规矩。
  同轮顺带更正一条**旧归因错误**：`GET /api/inquiries` 那条的问题不在"列表页没用 `listPage`"
  （列表页 `src/pages/inquiry/list/index.tsx:253` 确实用了），而在
  `useInquiryStore.loadFromApi` 的 4 个生产调用点，其中 `src/App.tsx:51` 会**每条 SSE 事件**
  重拉全表 —— 严重度上调，登记为 R36。

### 修复（R35：一条坏写让询价列表对所有人 500）

- **写边界不校验、读边界必炸**：`_build_inquiry_items` 把前端值原样写库
  （`quantity=it.get("quantity", 0)`），而 `InquiryCreate` 是 `extra="allow"` 且只校验 `subject`；
  SQLite 列不做类型校验，表上的 `CHECK (quantity > 0)` 也拦不住（SQLite 里 TEXT 排序类高于
  INTEGER，`'NOT-A-NUMBER' > 0` 为真）。读侧 `InquiryItemSchema.quantity: int` 于是抛
  ValidationError，而列表端点是 `[inquiry_to_schema(i) for i in rows]` ——
  **一行坏数据让 `GET /api/inquiries` 对所有用户持续 500**，且无法自愈。
  任何能调创建接口的客户端都握有打挂主页面的开关。
- **修法（构造性，不逐列枚举类型）**：写之前先过一遍**读侧** schema
  （`InquiryItemSchema.model_validate`），使"能写进去的"⊆"能读出来的"成为结构保证；
  可无损转换的（`"10"` → 10）照样接受并按转换后的值落库，不可表示的在**任何写入之前**
  以 422 拒绝（`error_type=invalid_inquiry_item` + `index` + `fields`）。
  创建与更新两条路径共用该函数，一次修好两处。
- **迁移 0016 治已经躺在库里的坏行**：可转换就地改值；不可转换删行并在父询价单
  `inquiry_logs` 留一条 `DATA_REPAIR` 痕迹（写明被删 item id 与原始值）。
  刻意不选"置 0"（`CHECK (quantity > 0)` 会拒）也不选"猜一个数"（那是伪造业务事实）；
  `target_price` 不可转换则置 NULL（该列本就可空）。`downgrade` 只收回留痕、不还原坏数据。
- **顺带修掉同族的错误归因**：创建重试循环 `except IntegrityError: rollback()` 吞掉一切
  完整性冲突后统一报 500「编号生成冲突重试耗尽」。实测把已存在的单改 `id` 回 POST
  （子行 `items[].id` 已存在）会连撞 5 次并拿到这句假原因。现在只有"刚生成的编号确实已被占用"
  才重试，其余冲突改判 409（`inquiry_conflict`）且文案不再声称编号碰撞；
  真·耗尽保留 500 但改成结构化 detail。
- **常驻用例 10 条**：`test_inquiry_item_validation.py` 6 条（核心那条断的是
  "被拒之后列表仍 200 且行数不变"，只断状态码抓不到"行已落库"）+
  `test_migration_0016_item_repair.py` 4 条（含"健康行一个都不动"这条不开火对照与幂等）。
  控制档：写侧退回改前 → 6 条全红；把 0016 移走 → 4 条里 2 条开火（另 2 条本就是
  "不该变更"的守卫，有无迁移都该绿）。
- **端到端复验（真实栈）**：`BEFORE GET /api/inquiries -> 500` → `alembic upgrade head`
  （`Running upgrade 0015 -> 0016`）→ `AFTER -> 200`，残留非整数行 0、留痕 2。
  后端全量（CI 的 env 形状）：`436 passed, 1 skipped, coverage 85.53%`，
  对照修前基线 `426 passed` —— 净增 10 条即本轮新用例，无回归。
- **同时撤回两条我上一轮登记的假缺陷**（"500 不打栈"与"500 响应没有 X-Request-Id"）：
  前者是 `tail -30` 在万行日志上截尾读的，按 request_id 精确 grep 后 ERROR 行与完整
  traceback 都在（`main.py:291` 的 handler 一直有 `logger.exception`）；
  后者是 `dict(headers)` 按 `'X-Request-Id'` 取值时大小写不匹配读成 None，
  `curl -D -` 实测该头存在。

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
- 归因中排除并留档（各条出处见登记册 R34）：后端读己之写探针 20/20 无违例；
  nginx 只缓存静态资源且 API 无校验器；产物内无 MSW 注册引用；`submitForApproval` 实现本身正确。
  「store 不从 localStorage 水合」一条只到推断级（依据是配置源码与全仓不设该变量），未升为已证实。

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
