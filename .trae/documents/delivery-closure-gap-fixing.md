# 交付闭环与缺口修复计划

> 目标：一次性修复探索发现的 5 项交付缺口，形成可追溯的交付闭环。
> 范围：Git 初始化 → 后端 /api/metrics 端点 → 健康检查真实探测 → E2E 重写 → 计划文档勾选框更新 → 最终验证。
> 原则：只修复真实缺口，不新增未请求功能；所有改动基于 Phase 1 实际探索结果。

---

## 一、当前状态分析（基于 Phase 1 探索）

### 已完成（代码层已落地，但计划文档勾选框未更新）
- 前端：React 18 + TS + Vite + Ant Design + Zustand + React Query + i18n + 主题切换 + MSW
- 后端：FastAPI + SQLAlchemy + SQLite，38 个 API 端点，RBAC 鉴权，种子数据
- 工程：ESLint/Prettier/Husky/Vitest、Dockerfile×2、docker-compose、nginx.conf、CI workflow
- 可观测性：Sentry 接入、Web Vitals 前端采集、后端请求日志中间件
- 文档：README、docs/deployment.md、docs/architecture.md

### 真实缺口（5 项，按依赖排序）

| # | 缺口 | 影响 | 阻塞性 |
|---|---|---|---|
| G1 | Git 未初始化（根目录无 .git） | CI/Husky/pre-commit 全失效，代码无版本追踪，无法形成交付闭环 | 🔴 阻塞 |
| G2 | 后端 /api/metrics 端点缺失 | 前端 webVitals.ts 的 sendBeacon 数据落入 nginx 静态回退/404，Web Vitals 数据丢失 | 🟡 可观测性断点 |
| G3 | /api/health 硬编码 db:"connected" | SQLite 不可用时仍返回 connected，Docker healthcheck 误判健康 | 🟡 监控失真 |
| G4 | E2E 5 个 spec 浅断言/恒真式 | inquiry-flow 完全未测真实创建→发送→报价→审批→定标流程；auth/permission/i18n 含恒真式或空跑 | 🟡 质量保障空心 |
| G5 | .trae/plan/ 与 .trae/documents/ 勾选框全部过期 | 计划文档与代码脱节，无法判断真实进度，误导后续规划 | 🟢 文档卫生 |

### 源码 TODO/FIXME 检索结论
- `backend/app/`：无任何 TODO/FIXME/XXX/HACK 残留
- `src/`：无真正待办注释（匹配项均为 placeholder 属性、设计决策说明、算法步骤描述）

---

## 二、执行计划（6 阶段，按依赖链顺序）

### 阶段 1：Git 初始化与首次提交（G1）🔴 阻塞优先

**目标**：将项目纳入版本控制，激活 CI/Husky，确保代码可追溯。

**步骤**：
1. 确认 `.gitignore` 已存在且内容合理（探索确认存在，包含 node_modules/dist/.venv 等）
2. 执行 `git init`（在项目根目录）
3. 执行 `git add .`（依赖 .gitignore 排除大文件）
4. 执行 `git commit -m "Initial commit: complete procurement inquiry system (P1-P7 + A/B finalization)"`
5. 验证 `git log --oneline` 显示首次提交
6. 验证 `git status` 显示 working tree clean

**关键文件**：
- `.gitignore`（已存在，需确认排除 backend/.venv、backend/procurement.db、node_modules、dist）
- `.gitattributes`（已存在）

**验证**：
- `git log --oneline -1` 输出首次提交
- `git status` → "nothing to commit, working tree clean"
- `.husky/pre-commit` 可执行（后续提交触发）

**注意**：不配置 remote、不 push（用户未要求远程仓库）。若用户后续要求推送，再单独处理。

---

### 阶段 2：后端 /api/metrics 端点实现（G2）

**目标**：接收前端 Web Vitals sendBeacon 上报，闭合可观测性链路。

**前端现状（已实现，无需改动）**：
- `src/utils/webVitals.ts` 采集 CLS/LCP/FCP/TTFB/INP 5 项指标
- 通过 `navigator.sendBeacon('/api/metrics', JSON.stringify({name,value,id,delta,rating}))` 上报
- Content-Type: `text/plain;charset=UTF-8`（sendBeacon 默认）

**后端实现**：
1. 新建文件 `backend/app/routers/metrics.py`
2. 实现 `POST /api/metrics` 端点：
   - 无需鉴权（Web Vitals 上报不应被 auth 拦截）
   - 接收 request body（JSON），解析 name/value/id/delta/rating
   - 记录到日志（logger.info，结构化：name/value/rating/user_agent）
   - 返回 `{"status": "ok"}`（sendBeacon 不关心响应，但需 200 状态码）
3. 在 `backend/app/main.py` 注册路由：`app.include_router(metrics.router, prefix="/api")`
4. 处理 sendBeacon 的 Content-Type（text/plain），用 `Request.body()` 读取原始 body 后 json.loads

**关键代码结构**（`backend/app/routers/metrics.py`）：
```python
import json
import logging
from fastapi import APIRouter, Request

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/metrics")
async def receive_metrics(request: Request):
    """接收前端 Web Vitals 上报（sendBeacon，无鉴权）"""
    try:
        body = await request.body()
        data = json.loads(body) if body else {}
        logger.info(
            "WebVital name=%s value=%.2f rating=%s",
            data.get("name"), float(data.get("value", 0)), data.get("rating"),
        )
    except Exception:
        logger.warning("Failed to parse metrics body")
    return {"status": "ok"}
```

**验证**：
- 启动后端，`curl -X POST http://localhost:8080/api/metrics -d '{"name":"LCP","value":1200,"rating":"good"}'` 返回 `{"status":"ok"}`
- 后端日志出现 `WebVital name=LCP value=1200.00 rating=good`

---

### 阶段 3：健康检查真实 DB 探测（G3）

**目标**：让 /api/health 真实验证数据库连通性，避免误判。

**当前代码**（`backend/app/main.py` 第 89-92 行）：
```python
@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "1.0.0", "db": "connected"}
```

**改进**：
```python
from sqlalchemy import text
from .database import SessionLocal

@app.get("/api/health")
def health_check():
    """健康检查端点：真实探测数据库连通性"""
    db_ok = False
    db_error = None
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        finally:
            db.close()
    except Exception as e:
        db_error = str(e)
    return {
        "status": "ok" if db_ok else "degraded",
        "version": "1.0.0",
        "db": "connected" if db_ok else "disconnected",
        "db_error": db_error,
    }
```

**关键文件**：
- `backend/app/main.py`（修改 health_check 函数）
- `backend/app/database.py`（已存在 SessionLocal，无需改动）

**验证**：
- 正常启动：`curl http://localhost:8080/api/health` 返回 `{"status":"ok","db":"connected","db_error":null}`
- 模拟 DB 不可用（临时改 DB_PATH 为无效路径）：返回 `{"status":"degraded","db":"disconnected","db_error":"..."}`
- Docker healthcheck 仍能工作（status=ok 时 200，degraded 时仍 200 但可扩展为 503——本期保持 200 不破坏现有 healthcheck）

---

### 阶段 4：E2E 测试重写（G4）

**目标**：消除恒真式与空跑，覆盖核心业务流程。

**当前问题汇总**：
| 文件 | 问题 |
|---|---|
| `e2e/auth.spec.ts` | 恒真式 `toHaveCount(count)`；登出软处理 |
| `e2e/inquiry-flow.spec.ts` | 完全未测创建→发送→报价→审批→定标；仅断言 body/descriptions 可见 |
| `e2e/supplier-portal.spec.ts` | 未填写报价表单、未提交 |
| `e2e/permission.spec.ts` | 恒真式 `a||b||!c`；无 401/按钮级验证 |
| `e2e/i18n-theme.spec.ts` | `if(isVisible)` 包裹致空跑；恒真式 `x||true` |

**重写策略**（务实优先，不追求完美覆盖，先消除假断言）：

#### 4.1 `e2e/auth.spec.ts`
- 删除恒真式 `toHaveCount(count)`
- 用例1：登录后断言工作台统计数字存在且 > 0（`page.locator('.ant-statistic-content')` 至少 1 个可见）
- 用例2：登录后刷新页面，验证仍保持登录态（URL 仍为 /dashboard，非跳 /login）
- 删除登出软处理（若登出按钮不可见则 test.fail，而非静默通过）

#### 4.2 `e2e/inquiry-flow.spec.ts`（重点重写）
保留现有 3 个基础用例（列表/详情/对比页可见），新增深度用例：
- **用例4「创建询价单草稿」**：访问 /inquiry/create → 填写标题/物料 → 保存草稿 → 断言跳转列表且新记录可见
- **用例5「发送询价单」**：在列表找到 DRAFT 状态询价单 → 点击发送 → 断言状态变为 PENDING_QUOTING
- **用例6「报价对比查看」**：访问种子数据 inq-3（ALL_QUOTED）的对比页 → 断言供应商列数 ≥ 2、有金额数据
- **用例7「审批提交」**：在对比页点击"提交审批" → 断言出现审批确认或状态变更
（不强行测到定标，因依赖审批配置，保持务实）

#### 4.3 `e2e/supplier-portal.spec.ts`
- 访问 /supplier-portal/inq-3/sup-1
- 断言报价表单可见（`.ant-form`）
- 填写单价/交货期字段
- 点击提交 → 断言出现成功提示或状态变更（toast/message）
- 若种子数据该询价已报价导致不可再报，则改为断言"已报价"状态显示

#### 4.4 `e2e/permission.spec.ts`
- 删除恒真式 `a||b||!c`
- 用例1：采购人员访问 /settings → 断言 URL 不变（仍在 /settings 但显示 403 提示）或跳转 forbidden 页（二选一，据实际实现）
- 用例2：管理员访问 /settings → 断言表单可见
- 新增用例3：未登录访问 /dashboard → 断言跳转 /login

#### 4.5 `e2e/i18n-theme.spec.ts`
- 删除 `if(isVisible)` 空跑包装，改为直接断言语言切换按钮存在
- 用例1：点击语言切换 → 选 English → 断言菜单出现 "Dashboard" 或 "Inquiry" 文案（具体文案断言）
- 用例2：点击主题切换 → 断言 `documentElement.getAttribute('data-theme')` 或 `body.className` 发生变化 → 刷新 → 断言持久化值与切换后一致
- 删除恒真式 `x||true`

**关键文件**：
- `e2e/auth.spec.ts`、`e2e/inquiry-flow.spec.ts`、`e2e/supplier-portal.spec.ts`、`e2e/permission.spec.ts`、`e2e/i18n-theme.spec.ts`
- `playwright.config.ts`（已存在，webServer 用 docker compose）

**验证**：
- `npm run e2e` 全部用例通过（或明确跳过且标注原因）
- 无恒真式、无空跑 `if` 包裹

---

### 阶段 5：计划文档勾选框更新（G5）

**目标**：让 .trae/plan/ 与 .trae/documents/ 的勾选框反映代码真实状态。

**需更新文件**：
1. `.trae/plan/final-delivery-execution.md`（P1-P7）
2. `.trae/plan/a-b-finalization.md`（A-Verify/B4-B7/B-V）
3. `.trae/plan/next-batch-execution.md`（W1/W3）
4. `.trae/plan/remaining-execution.md`（B2-B7）
5. `.trae/documents/next-step-final-delivery.md`（验证清单）

**更新规则**：
- 代码已落地的项 → `[x]`
- 本计划修复后落地的项 → 本阶段先标 `[~]`（进行中），最终验证后改 `[x]`
- 真正未完成的项 → 保持 `[ ]` 并注明原因
- 在每份文档顶部添加 `> 更新时间：2026-08-04 | 状态已核对实际代码` 注记

**验证**：通读 5 份文档，确认无"代码已存在但勾选框未勾"的项。

---

### 阶段 6：最终验证

**目标**：确认全链路可用，形成交付闭环。

**验证清单**（全部需通过）：
1. `npm run lint` → 0 error / 0 warning
2. `npx tsc --noEmit` → 0 error
3. `npx vitest run` → 全部通过
4. `npm run build` → 构建成功
5. 后端启动：`bash backend/run.sh` → 无报错
6. `curl http://localhost:8080/api/health` → `{"status":"ok","db":"connected"}`
7. `curl -X POST http://localhost:8080/api/metrics -d '{"name":"LCP","value":1000,"rating":"good"}'` → `{"status":"ok"}`
8. `git log --oneline` → 显示首次提交 + 本计划修复提交
9. `git status` → working tree clean
10. （可选，需 Docker）`docker compose up -d --build` + `npm run e2e` → E2E 通过

**最终提交**：
```bash
git add .
git commit -m "fix: close delivery gaps (metrics endpoint, health DB probe, E2E depth, doc sync)"
```

---

## 三、假设与决策

### 假设
1. `.gitignore` 内容已合理排除 node_modules/dist/.venv/procurement.db（探索确认存在，执行时再核读一次）
2. 后端 `SessionLocal` 在 `database.py` 中已导出（探索确认）
3. sendBeacon 的 Content-Type 为 text/plain，后端用 `request.body()` + `json.loads` 处理（非标准 JSON body）
4. E2E 测试依赖 Docker Compose 启动（playwright.config.ts 的 webServer 配置），若用户环境无 Docker 则 E2E 跳过，不阻塞其他验证
5. 种子数据 inq-3 为 ALL_QUOTED 状态，可用于对比页测试（基于既有 E2E 注释）

### 决策
1. **不配置 git remote**：用户未要求推送远程，仅本地初始化。若需推送，用户后续指示。
2. **/api/health 保持 200 状态码**：即使 DB degraded 也返回 200，避免破坏 Docker healthcheck（status 字段区分 ok/degraded）。如需 503，后续扩展。
3. **/api/metrics 仅日志记录，不持久化**：Web Vitals 数据量小，日志足够；不引入新数据表，保持后端简洁。
4. **E2E 重写务实优先**：不追求 100% 覆盖，先消除假断言，覆盖核心流程到"审批提交"为止，不强行测到定标。
5. **计划文档更新放在阶段 5（验证前）**：确保勾选框反映修复后状态，但最终验证项在阶段 6 完成后才标 [x]。

---

## 四、文件变更清单

### 新建
- `backend/app/routers/metrics.py`（/api/metrics 端点）

### 修改
- `backend/app/main.py`（health_check 真实 DB 探测 + 注册 metrics 路由）
- `e2e/auth.spec.ts`（删除恒真式，强化断言）
- `e2e/inquiry-flow.spec.ts`（新增 4 个深度用例）
- `e2e/supplier-portal.spec.ts`（填写并提交报价）
- `e2e/permission.spec.ts`（删除恒真式，新增未登录用例）
- `e2e/i18n-theme.spec.ts`（删除空跑与恒真式，具体文案断言）
- `.trae/plan/final-delivery-execution.md`（勾选框更新）
- `.trae/plan/a-b-finalization.md`（勾选框更新）
- `.trae/plan/next-batch-execution.md`（勾选框更新）
- `.trae/plan/remaining-execution.md`（勾选框更新）
- `.trae/documents/next-step-final-delivery.md`（勾选框更新）

### 不改动
- `src/utils/webVitals.ts`（已正确实现，上报 /api/metrics）
- `src/main.tsx`（已正确接入 Sentry + Web Vitals）
- 前端业务代码（无缺口需修复）
- 后端业务路由（auth/inquiries/materials/notifications/quotations/settings/suppliers 均无 TODO）

---

## 五、执行顺序与依赖

```
阶段1 (Git init) ──┐
                    ├─→ 阶段2 (metrics) ─→ 阶段3 (health) ─┐
                    │                                        ├─→ 阶段6 (最终验证) ─→ 提交
                    └─→ 阶段4 (E2E 重写) ────────────────────┤
                                                             │
                             阶段5 (文档勾选) ────────────────┘
```

- 阶段 1 最先（解锁版本控制）
- 阶段 2、3 顺序（均改后端，合并理解）
- 阶段 4 可与 2、3 并行（改前端测试，无冲突）
- 阶段 5 在 2、3、4 完成后更新勾选框
- 阶段 6 全部完成后统一验证 + 最终提交
