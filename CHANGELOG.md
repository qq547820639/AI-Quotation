# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。未发布的变更列入 `[Unreleased]`。

## [Unreleased]

### R60 / R49 后半 / R58 / R59：设置真入库、MSW 桩契约漂移、八把尺子的未知旗标退 2

- **R60（`69785c8`）**：摸清设置上行通路时量出两处既有漂移——MSW 的 `settingsState` 根本没有 `ai` 组
  （演示模式 `loadFromApi` 每次都把 undefined 覆盖进 store，tsc 不响因为桩是无类型字面量），
  且 `/settings` 只挂了 POST 而客户端用 PUT ⇒ 演示模式每次"保存设置"穿透 dev server 拿 404。
  修法是把桩显式标成 `AppSettings`（真 schema 加一组而桩不加 = 编译失败）并补与后端同形的 PUT。
- **R49 后半（`69785c8`）**：Alembic 0017 加 `system_name/default_currency/inquiry_deadline_lead_days`，
  写边界拒坏值（币种过枚举、0..365、少分组 422），`toAppSettings` 与 `loadFromApi` 两头接通；
  **零读者的 organization / validDays / notifications.todoReminder 一项都没入库**——R57 那把尺子在这里直接起作用。
  四臂变异各有牙（M1 2 failed / M2 1 failed / M3 1 failed / M4 1 failed，逐臂 cmp -s 还原）。
  读数：后端 `446 passed, 1 skipped / 85.56% / rc=0`（前值 436），alembic 打出 `0016 -> 0017`；
  前端 `474 passed (45 files)`、lint 与 tsc rc=0。
- **R58（`f4ff04d`）**：七把尺子未知旗标一律退 2 并各配"闸门必须开火"的臂；
  主会话复核 plain 输出与 HEAD 逐字节相同，唯一差异 `tsc-coverage 165→169` 恰等于本轮新增的四个测试文件。
- **R59（`6b2d64b`）**：`local-only`（有读者却不上行）从免检改成必须签字，未签字判红、谎报判"清单已过期"。
  我自己一度写多了一条"只有宽面读到就判红"，立刻把真树的 `notifications.inquirySent` 打红——
  那会让宽面从**只减不增**变成会造指控，正是 R55 与本尺文件头禁止的形状，已删。
  MA/MB/MC 三臂各由变异证明会红。
- **未做（外部阻塞）**：本轮 Playwright 一次没跑——子代理通道额度用尽，两次派发都以 ERROR 返回，
  我没有拿主会话硬跑长流程凑进度，也没有在旧栈（服务 `bded3ac`）上凑出一个会误导人的读数。
  欠的三格凭据与下一轮的安全做法（独立 compose project + 非冲突端口 + /tmp 配置覆盖 baseURL）写在登记册十一度那节。

### R57：R49 的"字段从不上行"被拆成两根轴——既不上行也没读者的开关，补持久化只会把假承诺做实

- 新常驻判据 `scripts/check-settings-inert.mjs`：分母 = `Settings` 9 个顶层字段 + `DEFAULTS.notifications` 5 个键 = **14 单位**，
  每单位记两根轴——**有没有上行**（解析 `toAppSettings` 读了哪些本地单位，按本地单位记而非服务端列名）与
  **有没有读者**（`ts.createProgram` + checker 的类型解析，成员声明必须挂在 `interface Settings` 上才算；
  编辑面 store 与 `pages/settings/index.tsx` 不算读者）。四档：live / local-only / uploaded-only / inert。
- 选型实测后判"不引依赖"：`knip@6.38.0`（ISC，4 天前发版）在本仓 `--include members` 直接
  `ERROR: Invalid issue type: members`，其 issue type 里有 `enumMembers` 而**没有接口属性成员**这一档，
  结构上答不了"这个字段被不被读"；`ts-prune@0.10.3` 最后发版 2021-12-12，出局。
  借的是 knip 的分档 + 双向对账形状，和 R55 的"宽面只许减少指控"。类型解析开销实测 2836 文件 / 2.95 s。
- **R49 的前提改判**：所谓"7 个字段未上行"里只有 2 个真在改变行为（`deadlineLeadDays`→新建单据默认截止、
  `notifications.inquirySent`→`useNotificationStore.ts:139` 的计算下标在拦通知写入），
  另 5 个（`organization`/`systemName`/`currency`/`validDays`/`notifications.todoReminder`）**全仓零读者**——
  它们的毛病不是"换设备丢"而是"不改变任何行为"，照 R49 的修法 A 去扩列只会把 5 个装饰开关做成 5 个入库的装饰开关。
  本轮不动后端、不动 `toAppSettings`。`ai` 是 `uploaded-only` 但读者在 `backend/app/routers/ai.py:50-54`，
  由一条**带出处且被尺子重开验证**的跨侧引用接住（文件打不开或标记没了都判红）。
- 接线两条 local-only→live 的前半：`App.tsx:20`+`:44-50` 让 `document.title` 跟随 `systemName`
  （清空时回落 index.html 的静态标题，不再抄一份第二处默认名）；`create/shared.ts:272-295` 的
  `defaultBasicInfo()` 用 `useSettingsStore.getState()` 的 `currency` 取代写死的 `Currency.CNY`。
  牙：改前树 `documentTitle.test.tsx` 3 failed（`expected '' to be '华东采购询价台'`）；
  行为牙齿另建变异树（只把两行退回写死）→ 3 failed | 2 passed，对照组不开火；
  兜底一格就地变异删 `|| STATIC_TITLE` → `expected '' to be '静态兜底标题'`，`cmp -s` 证还原。
- **这台仪器先抓的是自己人**：(1) 我按"零读者"写下的两条惰性台账，2 分钟后被并发落地的接线判"清单已过期"；
  (2) `resolveJsonModule` 把 `src/locales/*.json` 也放进 Program，locale 里的 `"todoReminder"` 是文案不是读者，
  第一跑凭空出 4 条假红 ⇒ 语料面收死在 `.tsx?`；(3) `toAppSettings` 里 `s.notifications.timeoutAlert` 的
  内层 `s.notifications` 被记成"整个容器已上行"，一个每键都惰性的容器就能读成 live ⇒ 上行轴不记容器。
- **它的第一版自测是死码**：`bad` 数组 13 处 push 没有一处 `if (bad.length)` 消费。
  发现方式是把"谎报惰性"的判红规则换成 `if (false)` —— 预期红，实际 **rc=0 自检通过**。
  六臂变异电池（M1 宽面／M2 编辑面／M3 谎报惰性／M4 inert 档／M5 上行轴／M6 分母哨兵）修后全部 rc=1，
  每臂跑完 `cmp -s` 证逐字节还原。家规再确认：**新写的自测必须先被证明会红，才被允许当门禁。**
- 退码分三档（0 通过／1 真违规／**2 量具故障**），崩溃不得冒充判红。真树读数
  `单位 14（inert=3 local-only=5 live=5 uploaded-only=1）｜惰性已声明 3 条`。

### R56：`check-i18n.mjs` 补上 `--self-test`（12 臂），顺带记一条"未知旗标静默忽略"的通用形状

- HEAD `9d5787e` 上 `node scripts/check-i18n.mjs --self-test` **rc=0，但输出与不带旗标逐字节相同**：
  该脚本零 `process.argv` 引用 ⇒ 旗标被忽略、自测臂根本不存在。
  它是被一个 `for` 循环的 rc 汇总列"洗绿"的：**"臂不存在"与"臂跑过了"在一列 0 里同形**（R44 同族）。
- 按九度末条指定的改法落地：语料入口参数化（`extractUsedKeys(readFile, listFiles)`、
  `collectCarriedKeys(readFile, listFiles, definedKeys)`）+ 纯判据核 `check(...)`，
  把 R55 那四臂搬成内存夹具，另补两条判红条款各自的臂与前提闸门（locale 零键、源码零 `t()` 引用 ⇒ 开火）。
  `176 → 473` 行，12 臂每臂一行 `PASS/FAIL + 臂名`。
- 读数：`--self-test` rc=0 / `判据自测 12/12 通过`；默认路径 rc=0 且输出与改前**逐字节相同**（`未使用翻译键（354` 不变）；
  接线落地后复跑仍是 12/12、354。变异 A（删 `carried`）→ rc=1 且真树 354→386（正是 R55 之前的面）——
  **这两把变异是子代理跑的，我重跑的是两个 rc 与 12/12 那行，故变异侧标未亲验**。
- 登记为 **R58（开放）**：8 把尺子里 1 把的 `--self-test` 曾是空话，而没有任何门禁保证"旗标必须被识别"。
  候选修法（统一 argv 解析、未知旗标 rc=2；或加一条"旗标必须被自己回显"的门禁）本轮未做，理由是动 8 把尺子入口
  需在同一轮重跑全部取证，收益/扰动比不划算——这是裁决不是遗忘。

### R54 量率：0/20 首跑失败（`--retries=0`，宿主 load 5.9→12.3/10 核），保持"开放·抖动"不升级

- 九度那一格写着"率见下一节的收尾表"，而那张表当时不存在——本轮回填九度收尾读数时一并实测。
- 装置：`npx playwright test e2e/core-flow.spec.ts --project=chromium --repeat-each=5 --retries=0` 连跑 4 批 = 20 次首跑
  → **0 failed / 20 passed**；控制跑（整文件单跑）`2 passed (26.9s)` 复现登记时那次"单独复跑 2 passed"。
  起跑前 `check-e2e-install.mjs` rc=0（696 条）与 `check-e2e-demo-password.mjs` rc=0；
  在跑的另一路 Playwright（同栈同库，206 passed）跑完才起第一臂，避免红了无法归因。
- 首屏 URL 从服务端拿：nginx 窗口内 42 次 `GET /quotation/compare/<id>` **全 200**，referrer 链无一次弹回 `/login`；
  后端 5967 条 status 200、**零 4xx/5xx**（nginx 的 525 条 499 是 `page.goto()` 掐在飞轮询的客户端中断码）
  ⇒ 排除"鉴权被弹回"与"接口报错"两条假设，候选收窄为 >10 s 的慢 200 或 `submittedRows.length === 0` 空态。
- **最有信息量的是余量不是"没红"**：`/api/inquiries` 最慢一条 `200 / 9440.0 ms`，吃掉 10 s 断言预算的 **94%** 而套件仍绿；
  同一条用例挂钟随 load 从 7.6 s 涨到 23.8 s（×3.1）。
- 一条取证面的结构事实：`playwright.config.ts:24-26` 是 `trace/video: 'on-first-retry'` 而量率用 `--retries=0`
  ⇒ **这些年跑里红了也拿不到 trace**。下次要表征它，先解决取证面，不要先改断言。
- 判定：0/20（95% 置信上界 ≈15%，与原始 1/180 完全相容），**只测了单文件隔离跑，不是全量套件末尾那个总体**
  ⇒ R54 记为"已量率、本轮未复现"，不闭。

### R55：i18n 门禁的"未使用键"清单不再把住在数据里的键报成孤儿（386 → 354，32 条误报归零）

- 起因是一行"不阻断"的提示：`未使用翻译键（386）`。两把独立检索实测——
  动态拼接前缀能解释 **0** 条，但其中 **32 条**以字符串字面量出现在
  `src/pages/dashboard/ActionWorkbench.tsx` 的卡片配置里（`labelKey: 'dashboard.workbench.pendingSend'`，
  运行时才 `t(k)`）⇒ 是在用的，静态面看不见这一类；照清单删键会让工作台渲染出裸键。
- `check-i18n.mjs` 加第三张面 `collectCarriedKeys()`：**只认恰好等于已定义键**的字面量，
  因此只会让清单变短；并在文件头锁死面分工——会判红的第 2 条不吃这张宽面，
  否则 `'btn.lg'` 这类杂串会被当成"引用了不存在的键"而假红。
- 四臂控制（真树注入-还原，逐文件比 sha 确认还原干净）：① 那 32 条之一必须从清单消失且总数 386→354；
  ② 新造一条真没人用的键必须出现在清单里（**没有这条，"少 32"与"尺子失明"同形**）；
  ③ 把它写成数据里的字面量后必须消失；④ 写一条 locale 里没有的杂串必须仍 `rc=0` 且不提名它。四臂全过。
- 尺子自己报拆解：`静态 t() 1227 / 动态前缀 15 / 仅以字面量写在数据里 32`。
  余量与缺口登记在册：剩下 354 条不判该不该删（还有两层看不见的面），且这把尺子仍无 `--self-test`。

### R51-A / R52 / R53：写回执铺到跨帧宣告、导出重入守卫改同步 ref、8 处过去式通知移到服务端接受之后

- **R51-A（`101cc0b`）**：R50 那把判据是函数粒度的，看不见"写在 store action / `useEffect` 帧、
  toast 由调用方弹"的跨帧宣告（实测 35 对）。其中真正要修的只有 4 对——本机存储是唯一权威、没有服务端副本可退：
  `useSavedViews` 的持久化改为 `commit()` 内同步写并返回 `WriteReceipt`（`useEffect` 保留为兜底镜像，
  `transition` 必须确定性否则镜像与状态分叉），三个方法签名 `void → WriteReceipt`，
  `inquiry/list/index.tsx:427/:442/:456` 三条宣告改为失败走 `storage.writeFailed`（保存失败不关弹窗、不清输入）；
  `useInquiryDraft.overwrite` 从"调 `saveNow` 丢布尔"改为 `return saveNow(...)`，`create/index.tsx:271` 随之有据。
  牙：HEAD `45b36f2` 上只换两个测试文件 ⇒ `4 failed / 17 passed`。
- **R52（`eb4cf20`）**：R50 取证跑抓出 `[chromium] export-download` 逐行导出重入格 `1 failed`（复跑 3 次红 1 次）。
  根因是守卫读渲染闭包里的 state、而 state 要等下一次渲染才可见 ⇒ 同 tick 连发两下都放行。
  改为 `useRef<Set<string>>` 同步占坑（逐行 `:598/:627`、批量 `:744/:775`），state 只画 loading。
  **同时推翻我自己登记的一条结论**：R44 四臂表里"留守卫 + 删 loading 仍 gen=1 ⇒ 守卫单独成立"
  是在两次跨往返的弱注入下取的，属非判别性巧合。注入改成 element 内一次连发 5 个 click 后重测三臂：
  修好的树 `gens=1` × 3 全绿；变异回 state 守卫的树 **3 次全红、`Expected: 1 / Received: 5`**（并附产物 sha1 变更证）。
  教训：注入的时钟帧必须与被测守卫的失效窗口同帧，"删掉某层仍绿"的臂要先证明注入落在它的时间尺度里。
- **R53（`bded3ac`）**：R51 的"判不出"桶读到定案且更糟——8 处写入口（`useInquiryStore` 的
  cancel/send/select/confirm/submitApproval/approve/reject + `useQuotationStore.submitQuotation`）
  把「询价单 X 已取消」这类过去式通知铸在 `set(状态配方)` 体内，即乐观那一帧；`catch` 只回滚实体、
  从不撤通知，而仓里没有任何删通知的能力（`grep "removeNotification\|deleteNotification\|dismiss" src/store src/api` = 0）
  ⇒ 被后端拒绝的操作会在通知中心与本机存储留下永久假记录。修法是把铸造移到对应 `await` 之后
  （实体改从 `get().getInquiryById` 取，顺带用上服务端真编号而非占位值）。
  **连带改判 6 条常驻用例**：它们用 `void store.getState().xxx()` 同步观察，钉的正是这个缺陷本身
  （改成 `await` 后观察，断言内容一字未动，`6 failed → 103 passed`）。
  新常驻判据 `scripts/check-notification-optimistic-mint.mjs`：`addNotification` 落在 `set(配方)` 子树里即判红；
  真树 `26 站点 inside_set=0`，同一把尺子打在改前的 `eb4cf20` 上点名 7 处；
  自测三臂（夹具开火 / 合规侧不掉档 / "4 次铸造全在配方外"的逆语料必须 0 处）。
  **覆盖面说清**：8 处里它只吃 7 处——quotation 那一处是"配方外、`await` 前"的时间形状，由不变量用例守着。
  已接 `package.json:19` 的 `notify-mint:check` 与 CI quality 档。
- 本轮门禁读数：`vitest 41 files / 459 tests`、`tsc`、`lint --max-warnings=0`、`i18n`、
  `toast 自测 18/18`、`tsc 覆盖面 165`、`装树 696`、`storage 判据 86 站点`、`通知铸造判据 26 站点` 全绿。

；新门禁 `storage:check` 带 quiet 棘轮；R48 那 11 行"未亲验"逐条读到定案

### R50：本地存储的三个写函数改为返回**写回执**；新门禁 `storage:check` 带 quiet 棘轮；R48 那 11 行"未亲验"逐条读到定案

- 根因：`src/utils/storage.ts` 的 `saveJSON`/`removeKey`/`clearAll` 把 `QuotaExceededError`、
  隐私模式的 `SecurityError` 就地吞掉并返回 `void` ⇒ 调用方没有任何凭据却能弹"已保存/已清空/已重置"。
  现改为返回 `WriteReceipt { success, key, error? }`（`:37-42`），`clearAll` 另带 `removed` 条数。
- 接线：`src/pages/settings/index.tsx:117/:133` 接住回执，失败走新 key `storage.writeFailed`，
  重置那一支失败时不再 reload（reload 会连失败提示与重试机会一起抹掉）；
  `src/hooks/useInquiryDraft.ts:88-99/:130-138` 由 `try/catch` 改为读回执。
  **连带后果**：改前 `saveJSON` 从不抛 ⇒ catch 分支结构上到不了 ⇒ `saveNow`/`saveAsTemplate` 恒真 ⇒
  `inquiry/create/index.tsx:307` 的 `if` 恒真、`:310`「模板保存失败」与 `:609` 的 `status === 'failed'` UI
  都是不可达代码。这三处现在才第一次可达。
- 新门禁 `scripts/check-storage-receipt.mjs`：函数粒度 AST、四档 `checked/evidenced/quiet/lying`，
  只有"丢弃回执 + 同函数后跟 `notifySuccess` + 无其他凭据"判红；`quiet` 档带 `QUIET_BASELINE=74` 只减不增
  （借 `eslint-plugin-unicorn` 那条规则"有意丢弃要写 `void`"的**思路**，不借实现——现成规则都覆盖不到 app 函数）。
  已接 `npm run storage:check`（`package.json:18`）与 CI quality 档（`.github/workflows/ci.yml:44-45`）。
  读数：站点 85（checked=9 evidenced=2 quiet=74），与文本面 grep 独立对齐、差集为空。
- 牙：HEAD 干净 worktree 上只换两个测试文件 ⇒ `6 failed | 11 passed`（红的正是新增的 6 条），工作树 `17 passed`；
  棘轮在**真树**上四读数（默认 74 绿 / 73 红并点名 / 200 绿 / 夹具两臂），`--self-test` 另含"删掉成功提示必须降到 quiet"的反-过严臂。
- R48 遗留的 11 行"未亲验"**全部读到定案**：准确 10 / 指针需更正 1（`inquiry/detail` 那条偏 7 行）/ 定位不到 0；
  其中 3 行由 R50 吃掉，余 8 行按成因归入新登记的 R51-A/B/C/D 四桶。
- **R51（本轮只量不改）**：判据是函数粒度的 ⇒ 写在 store action / `useEffect`、toast 由调用方弹的"跨帧宣告"
  共 **35 对**看不见，其中把 storage 写失败真传给调用方的 **0 对**；
  只有 R51-A 那 4 对（savedViews 3 + 草稿 `overwrite` 1）是"localStorage 唯一权威"，排在下一片。

### R48：全仓"成功宣告 vs 可知范围"普查落地 7 处（含一条死 catch）；R49 登记设置页 7 个从不上行的字段

- 分母普查（子代理只读跑）：`notifySuccess` 共 **61 处宣告站点**，分档 相称 40 / 说过 20 / 说不清 1。
  属于要进门禁的读数，所以逐条亲手开文件复核后才用：**10 行亲验（7 行修掉、3 行确认为真缺陷登记 R49），
  11 行仍标"未亲验"并在登记册逐条列名**。
- 修掉的 7 处：
  `quotation/compare` 与三处文本下载（门户模板、回执、错误报告）文案降到"已开始下载"
  （blob + `a.click()` 无落盘回执，依据是 R47 那次拒收实验）；
  `utils/pdf.ts` 的 `exportPDFWithFallback` 三条分支全不 reject ⇒ 调用方 `.catch` 是死代码、
  且"只弹打印框"被报成"PDF 导出成功" ⇒ 改为返回 `'pdf' | 'print'` 并按通道选文案，
  新增 `src/utils/__tests__/pdf.test.ts` 三分支各一条（回退那条同时钉"不 reject"与"不是 pdf"）；
  重发询价改为"已重新排队发送"（后端只置 pending + 入队，`invitations.py:193`、`inquiries.py:754-764`）；
  读取送达明细失败的分支不再拿本地条数报"已发送 N 家"，改 `notifyWarning` + 新 key `sendUnverified`。
- 对照：把回退分支谎报成 `'pdf'` ⇒ `1 failed | 2 passed`，还原 `3 passed`；`tsc 覆盖面 164→165`；
  收尾 `--retries=0` 全量 **206 passed / 4 skipped (9.8m)、0 flaky**，服务产物 36/36 一致且新串可 grep、旧串 0。
- **R49（已验证，故意不做）**：设置页 `organization/systemName/currency`、`validDays/deadlineLeadDays`、
  `inquirySent/todoReminder` 共 7 个字段可编辑却从不上行（`useSettingsStore.ts:27-38` 与
  `backend/app/routers/settings.py:42-56` 两侧对过），三张卡却共用「设置已保存」。
  两条修法（扩表 + Alembic 0017 / 拆文案标"仅本机"）都记账待单独一轮——后者会动
  `settings.saveSuccess`，而 R34 的冒充实证用例正是靠这对文案后缀构造的，必须连它一起复跑。
- 顺带闭掉导出用例的适用域猜测（`bccdf9c`）：把跳过全关掉跑 5 个 project → 8 passed / 2 failed，
  两个失败恰好都是逐行格且都在移动 project（窄屏是卡片 + 「更多」下拉，行内没有导出按钮）
  ⇒ 批量与顺序断言不挑引擎（webkit 一并验过），逐行重入格只对桌面 project 跑。

### R47：导出提示改成"已开始下载"——blob 交付这条路没有落盘回执可拿

- 上一节留下的"未证面"本轮量出来了：一次性探针对批量导出用 `test.use({ acceptDownloads: false })`
  造浏览器拒收，读数
  `failure="Pass { acceptDownloads: true } …" path() 不可用（已取消） name=询价单管理_20260927084401.xlsx toastInDom=1`
  且 1.2s 后仍在 ⇒ 文件没落盘、成功提示照样在屏上。页面侧对 `a.click()` 交付没有任何回执可读，
  所以能修的是"说"：`table.exportCurrentSuccess` → 当前筛选结果已开始下载、
  `inquiry.export.success` → 文件已开始下载（en 同）；`src/utils/excel.ts` 注释同步改口径。
- 两条新文案互不为子串——toast 判据的 `ambiguous` 档会把"命中 ≥2 条成功文案"的过滤串判红，
  都叫"已开始下载"就会自踩。改后读数：`i18n rc=0`、`toast 站点 21（named=7）·豁免 6·目录 17`。
- 失败路径不动（`writeBuffer` 抛错仍 `notifyError`），宣称变窄不等于坏消息变少。

### 门户共享步骤那格抖动：三次复现都不红 ⇒ 修法定为"红了能归因"，而不是加大超时

- `helpers.ts:264`（等门户单价输入框）是全量套件里唯一读到过 `element(s) not found` 的共享步骤。
  本轮 `--grep "定标接口 500" --project=mobile-android --repeat-each=5 --retries=0` → **5 passed**；
  `--project=mobile-android --retries=0`（整 project）→ **39 passed / 3 skipped**；
  并排除一个猜测：容器内 `procurement.db` 现读 `inquiries=13 / quotations=18`，数据量小，
  "累积行数拖慢门户渲染"在当前体积下不成立。
- 因此不改 10s 超时（加大超时是掩盖），改为失败时把 `page.url()` 与 `body` 前 240 字并进错误信息，
  让下一次红能自己说清现场。登记仍留"历史仅 1 次红"的口径。
- 同批把全量套件在 **`--retries=0`** 下跑了一次：**`200 passed (10.9m)`、`PW_RC=0`**（本轮第一次关重试全绿）。
  服务产物双证：36 个哈希文件名与容器求差为空；新文案能在 `index-BLKdbTwh.js` grep 到、旧文案计数 0。

### 导出链路补上浏览器级覆盖；四臂量出"组件 loading 先吞、handler 守卫在后"；webkit 抖动连根收掉

- 起点读数 `grep -rniE "导出|xlsx|download" e2e/` = **0**：R41（提示早于生成）与 R44（连点叠发）
  此前没有任何浏览器级证据。新增 `e2e/export-download.spec.ts` 两格，只在 chromium 项目跑
  （`test.skip` 谓词第二参数不是 testInfo，写成 describe 级会让每个 project 抛
  `Cannot read properties of undefined (reading 'project')`——实测）。
- **顺序断言换了测法**：第一版用"点完立刻读提示在场否"，两格都红 `Received: 1`——不是产品病，
  是 `await click()` 返回时已经过去几百毫秒。改成页内 MutationObserver 单时钟累加器，
  读数为 `431ms|dl|询价单管理_….xlsx` → `451ms|toast|已导出当前筛选结果`，先后由记录顺序给出。
- **重入断言按 2×2 逐层删**：删掉 handler 守卫用例照绿，探针显示两次 DOM click 都到按钮、
  `disabled=false`、却只有一次 `URL.createObjectURL` ⇒ 桌面路径上先挡住的是 antd Button 的 loading。
  判别量也换成页内 spy（Chromium 对短时间内第二次自动下载另有策略，download 条数无分辨力）。
  四臂生成次数：原样 1／删守卫 1（该臂无判别力）／删守卫+删 loading 2（红 ✓）／留守卫+删 loading 1（绿 ✓）。
  由此更正 `6cd4564` 提交信息：桌面点击路径上第一层防护是组件 loading，本用例证的是用户可见不变量。
- 移动端下拉路径实测 `gen=2`、两份文件、相隔 1s ⇒ 判为**正确行为**（菜单必须重开，两次点击落在同一代
  生成窗口之外），不是守卫失效。
- **`[webkit] auth-session-refresh.spec.ts:49` 抖动闭合**：三轮全量里红过 2 次、同一读法
  （goto 被客户端 401→/login 的跳转打断）。改成只吞这一次导航错误、后面三条主张全保留，
  `--project=webkit --repeat-each=5 --retries=0` 读数 10 passed。
- 收尾全量（`127d8ec` 干净 worktree、最后一次改动之后）：`PW_RC=0`｜`200 passed / 10 skipped (8.3m)`，
  **本轮第一次 0 flaky**；`tsc/lint/i18n/toast(站点21·豁免6·自测18/18)/tsc:cov(164)/装树(696)/vitest(444)` 全绿，
  服务产物同一次性与 HEAD 求差 = 空。

### R45：e2e 侧接进 eslint-plugin-playwright（限定规则面），当天咬出一条空用例（R46）

- `eslint.config.js` 新增 `files:['e2e/**/*.ts']` 块 `extends:[playwright.configs['flat/recommended']]`，
  并关 3 条与本仓已验证不变量冲突的规则（撑窗的 `no-wait-for-timeout`、一次性读数的
  `prefer-to-have-count`、带理由跳过的 `no-skipped-test`，理由写在配置注释里）。
  命中面是现算的：整包 recommended 在 `e2e/` 上 14 条 → 关 3 条后 9 条 → 9 条处理完 `npm run lint` rc=0。
  规则块"真接上了"由临时探针双向验：探针报 3 条 warning，而被关掉的 2 条在探针上不开火。
- **R46（真缺陷）**：`dashboard-workbench.spec.ts` 的
  `if (count>0) {点卡片验跳转} else {只验页面标题}` 改成断言后当场红 `Received: 0`
  ⇒ 这条名为"点击可点击的行动卡片跳转到对应筛选结果"的用例每次都走 else，从来没点过卡片。
  再往下读还分出第二层：红的直接原因是同步 `await count()` 抢在卡片数据落地前读到"全部禁用"。
  一次性探针按 6 个演示身份实测（李明辉/王志强/周大海/陈晓燕 各 `enabled=4`；张文静/刘建国 无卡片）
  ⇒ 前提成立，保留无分支的强形状、把读数换成 `expect(clickable).toBeVisible({timeout:15000})`。
- 另外两处"分支不成立时断言整条不执行"也一并改成无条件：
  `auth-session-refresh.spec.ts`（先钉住"必须观测到一次 /api/auth/refresh"再判 401）、
  `permission.spec.ts`（保存按钮断言从 `if (stillOnSettings)` 里挪出来）。
  4 处确属刻意形状的就地 `eslint-disable` 并写明理由；
  顺带一条量具自净性质：`--max-warnings=0` 会把挂错行/失效的 disable 注释本身报成
  `Unused eslint-disable directive`，豁免注释不会静默腐烂。
- 装树门 694 → **696 条**；这轮改 lock 之前它先把 worktree 的 E2E 拦下过一次（正是它该拦的形状）。
- 收尾全量（干净 worktree 的 `f995640`，最后一次改动之后取数）：
  `PW_RC=0`｜`197 passed / 1 flaky / 2 skipped (12.2m)`；
  `tsc/lint/i18n/toast(站点19·豁免6·自测18)/tsc:cov(164)/装树(696)/vitest(40 files·444 tests)` 全绿。
  本轮第二例单发抖动登记在案：`[mobile-android] exception-scenarios.spec.ts:303`
  首试红在 `helpers.ts:264` 等 `input[id$="-unitPrice"]`、retry 绿（与上轮 `[webkit]` 那例不同格）。

### R44：逐行导出补上按行的 loading 与重入保护（并撤回上一轮"不做"的理由）

- 调用点普查（子代理跑，5 个 `file:line` 我逐个亲手复核）推翻了上一轮登记的理由：
  R41 之后 **5 个导出调用点形状完全一致**（都 `await exportAOA` 才 `notifySuccess`），
  唯一没守卫的那个是 `src/pages/inquiry/list/index.tsx:580` 的**逐行**导出，
  也是唯一挂在表格行与移动端下拉两个入口上的那个。
- 修法按行记状态（`exportingRows: Record<string, boolean>`：`:581` 挡重入、`:965` 给该行 loading），
  没复用单个布尔——单槽位在两行同时生成时，先完成那次的 `finally` 会把后发起那次的标记清掉。
- 残留事实：`grep -rniE "导出|xlsx|download" e2e/` 读数 **0** ⇒ 导出链路零浏览器级覆盖，
  本轮两个守卫都只有代码形状与全量套件不回退作证据。

### 冒充实证用例在真实栈跑绿：先证明的是我自己的装置有三处"绿而无效"

- `e2e/toast-impersonation.spec.ts` 首跑（`4b35007`）把整套件拖成
  `5 failed / 193 passed / 2 skipped (11.1m)`，三处装置病逐个被真实栈逼出：
  ① `page.route` 装太早，把动作 A 自己的 PUT 也挂住；
  ② 注入不承重——删掉 `await gate` 让 B 正常落库，用例照样绿，于是改成撑窗 1s，
  并用"保持 handler 原样、只提前 `release()`"的干净对照实测翻红在第 93 行；
  ③ 缺席断言用 `toHaveCount(0)` 是重试型 matcher，会被"出现过又淡掉"的提示在淡出后凑成 0，
  改一次性 `count()` 读数；再补一条"删掉动作 A"的对照，实测红在第 72 行的未指名断言。
- 修完（`8b1bd89`）同一套件读数：`PLAYWRIGHT_RC=0`｜`197 passed / 1 flaky / 2 skipped (8.8m)`，
  该用例在 5 个 project 全绿（2.3/4.6/2.5/2.2/2.7s）。
  跑之前先证"跑的就是这份代码"：worktree 里 `npx vite build` 的 36 个内容哈希文件名
  与容器 `/usr/share/nginx/html/assets/*.js` 求差 = 空。
- toast 判据档位随之从 `named=4 negative=2` 变 `named=5 negative=1`（总 19、豁免 6 不变）；
  登记册里"豁免清单只是读码判定"那一格就此闭合。
- 身份前提也修过一次：`李明辉` 是 u-1 采购人员、无 `SETTINGS_MANAGE`，
  在 `/settings` 拿到的是 403 Result 页（`error-context.md` 的 a11y 树只有"返回首页"），
  改用 u-6 管理员 `周大海`（`b5deef4`）。

### 两条"要不要接新门禁"的选型，都落成实测数

- `eslint-plugin-playwright@2.12.0`：在 `/tmp/pwlint` 隔离安装（跑套件期间绝不碰主仓 node_modules，
  worktree 是指向它的软链），复制 `e2e/` 后只开 `flat/recommended` ⇒ **14 条 warning、7 个文件、0 error**
  （`no-conditional-in-test 5 / no-conditional-expect 3 / no-wait-for-timeout 3 / no-force-option 1 /
no-skipped-test 1 / prefer-to-have-count 1`）。规则数由 `Object.keys(plugin.rules).length` 读出 = 67；
  npm 侧 MIT、2026-09-14 发布、周下载 6,352,928；仓库在个人名下而非 `playwright-community`
  （GitHub API 对该 org 路径返回 301）。裁决：**限定规则面接**（R45），
  因为有 3 条 recommended 规则直接打在本轮刚验证过的形状上（撑窗、一次性读数、带理由的 skip）。
- `format:check`：三个口径实测 **39 / 50 / 48**，CI 里 `grep -c prettier` = 0，
  `format:check` 定义存在但**调用者 0 个**；最近 6 个提交碰过的文件 ∩ 红名单 = 0
  ⇒ 提交钩子（写模式）已经在挡新代码不合格式，接成常驻红门只会先逼一次 50 文件的清扫。
  判本轮不接，重开条件是那一轮独立清扫。本轮只做卫生项：2 个生成物进 `.prettierignore`（`2a0d154`，全量 50→48）。

### R43：通知偏好写入失败不再静默（并修掉一处会随清理时机漂移的断言）

- `src/pages/notification/index.tsx` 两处 `void updatePreferences(...)` 丢掉 `WriteResult`
  ⇒ 服务端拒了，用户只看到"开关拨了没反应"。新增 `savePreferences`：失败走 `notifyError`，
  有原因报名词、原因空白退回既有 key `common.operateFailed`（zh/en 都有，未新造文案）。
  `??` → `.trim() ||` 这一步由变异复验钉住：抛 `Error('   ')` 时 `??` 会弹一个空气泡。
- **提示类断言的口径改了三次**：DOM 绝对数会被上一条用例在 `document.body` 全局 portal 上的残留满足；
  改成"相对本条之前"又被 `beforeEach` 的 `message.destroy()` 异步移除打断
  （本机读到 `1→1`、干净 worktree 读到 `1→0`）⇒ 终版 spy `message.error/success` 的实参，
  连跑三次 6/6 稳定，两条变异臂各按预期开火。
- **一条流程账**：`1aa69fd` 把带 4 处 `TS4104` 的测试文件提交进了 HEAD，而那一轮的收尾读数写着
  "tsc rc=0" —— 读数不假，时点假（那次 tsc 跑在文件创建之前，而 vitest 不做类型检查、
  提交钩子只跑 eslint+prettier）。已修（`74e07ef`），并把收尾改成
  **在干净 worktree 的 HEAD 上重取全部读数**：`tsc/lint/i18n/toast(18/18)/cov(164)/install(694)` 全绿，
  `vitest 40 files / 444 tests passed`。

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
