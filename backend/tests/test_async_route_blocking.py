"""
路由里的"async 定义 + 体内同步阻塞"判据（常驻门禁）

存在理由：2026-09-27 查 E2E 抖动时，后端自记的 `http_request.duration_ms` 最长到 **84.5 s**
（`GET /api/inquiries`），连 `POST /api/metrics` 都到 76 s；同一时刻单发同一条读只要 0.28–1.2 s，
库里也只有 60 张询价单 ⇒ 不是数据量、不是缺索引。顺着"为什么一个请求能把别人拖住"查，
发现 `backend/app/routers/ai.py` 里有三个路由是 `async def` 却整段没有 `await`
（`ai_feedback` / `ai_stats` / `ai_feedback_summary`），里面直接跑 SQLAlchemy。

FastAPI 官方文档（https://fastapi.tiangolo.com/async/#path-operation-functions）：
  "When you declare a path operation function with normal `def` instead of `async def`,
   it is run in an external threadpool that is then awaited, instead of being called
   directly (as it would block the server)."
  以及 "If you are using a third party library that ... doesn't have support for using
   `await` ... then declare your path operation functions as normally, with just `def`."
⇒ `async def` + 同步 DB 驱动 = 这个请求独占事件循环，期间**所有**其它请求都在排队。
并发越高，被拖住的那一条就越像"产品偶发不渲染"——这正是 E2E 抖动最难归因的形状。

这条判据不测时延（时延测出来的东西随宿主负载漂，不可复现），只钉**形状**：
凡是挂着路由装饰器、体内又没有任何 `await` 的函数，必须是 `def`。
形状可静态判、可复现、且改一个字就能合规——比"加超时"诚实。

自证：`test_criterion_can_fire` 把一段合成源码喂给判据本身，要求它必须报出 1 处违规
（否则"0 违规"可能只是因为判据根本没在看）。
"""

import ast
import pathlib

ROUTERS_DIR = pathlib.Path(__file__).resolve().parent.parent / "app" / "routers"
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


def _is_route(fn: ast.AST) -> bool:
    for d in getattr(fn, "decorator_list", []):
        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr in HTTP_METHODS:
            return True
    return False


def violations(source: str, filename: str = "<str>") -> list:
    """返回 [(lineno, name)]：async 定义的路由，但体内没有任何 await。"""
    out = []
    tree = ast.parse(source, filename=filename)
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and _is_route(node):
            has_await = any(isinstance(x, ast.Await) for x in ast.walk(node))
            if not has_await:
                out.append((node.lineno, node.name))
    return out


def test_criterion_can_fire():
    """必开火夹具：同样的路由，async 版必须被抓住、def 版必须放过。"""
    bad = '''
from fastapi import APIRouter, Depends
router = APIRouter()

@router.get("/stats")
async def ai_stats(db=Depends(get_db)):
    return get_ai_stats(db)
'''
    good = bad.replace("async def ai_stats", "def ai_stats")
    pure_async = bad.replace("return get_ai_stats(db)", "return await get_ai_stats(db)")

    # 只钉"恰好一处、且是哪一个函数"，不钉行号：行号跟着夹具里几行 import 走，
    # 写死它只会让这条控制在没人改判据的情况下自己红（第一版就红在数错行号上）。
    bad_hits = violations(bad)
    assert len(bad_hits) == 1 and bad_hits[0][1] == "ai_stats", f"判据没开火＝这条门禁是假的：{bad_hits}"
    assert violations(good) == [], "改成 def 就该放过（否则逼人加假 await）"
    assert violations(pure_async) == [], "真的 await 了就不算违规"


def test_no_blocking_async_routes_in_production():
    """主线断言：生产路由里不许再有 `async def` 而无 `await`。"""
    files = sorted(ROUTERS_DIR.glob("*.py"))
    assert files, f"读不到路由目录 {ROUTERS_DIR}：空分母不判为通过"
    found = []
    for f in files:
        found += [(f.name, *v) for v in violations(f.read_text(encoding="utf-8"), f.name)]
    assert not found, (
        "这些路由是 async 定义却整段没有 await，会独占事件循环、把并发请求全拖住："
        f"{found}。要么改成 `def`（FastAPI 会丢给线程池），要么让它真的 await。"
    )


def test_router_corpus_is_actually_scanned():
    """分母控制：确认扫描真的覆盖了路由文件，而不是 glob 写短了一层。"""
    names = {f.name for f in ROUTERS_DIR.glob("*.py")}
    for expected in ("ai.py", "auth.py", "inquiries.py", "metrics.py", "notifications.py", "portal.py"):
        assert expected in names, f"{expected} 不在判据的入域里——这条门禁的分母不全覆盖"
