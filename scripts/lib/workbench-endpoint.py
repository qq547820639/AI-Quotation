#!/usr/bin/env python3
"""差分闸的被测侧：用真端点实现算一遍行动工作台计数（R107）

由 `scripts/check-workbench-parity.mjs` 调用。它不复制任何 SQL、也不重抄判据——
直接 import `app.routers.dashboard.workbench_summary` 本尊，喂一个临时 SQLite 库
（表结构来自 app.models，夹具由 Node 侧生成后以 JSON 传入），把返回的
Pydantic 模型打印成 JSON 回给 Node 侧与 TS 参考实现对比。

走函数本体而不走 TestClient：查询参数解析与鉴权由
`backend/tests/test_dashboard_workbench.py` 覆盖，这里只核语义。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True, help="Node 侧生成的夹具 JSON")
    ap.add_argument("--backend-dir", required=True, help="含 app/ 包的那一层目录")
    ap.add_argument("--user", default="u-1")
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="qi-parity-")
    os.environ["DB_PATH"] = os.path.join(tmp, "parity.db")
    os.environ["APP_DEMO_MODE"] = "true"
    sys.path.insert(0, args.backend_dir)

    try:
        from app.database import Base, SessionLocal, engine
        from app.models import Inquiry, InquiryLog, Quotation, User, inquiry_supplier
        from app.routers.dashboard import workbench_summary
    except Exception as exc:  # 依赖不可用 ⇒ 让上层判"未覆盖"，不要伪装成通过
        print(f"IMPORT-FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 3

    with open(args.fixture, encoding="utf-8") as fh:
        fixture = json.load(fh)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for row in fixture["users"]:
            db.add(User(**row))
        for row in fixture["inquiries"]:
            db.add(Inquiry(**row))
        for row in fixture["quotations"]:
            db.add(Quotation(**row))
        for row in fixture["logs"]:
            db.add(InquiryLog(**row))
        for row in fixture["invited"]:
            db.execute(inquiry_supplier.insert().values(**row))
        db.commit()

        # 插入条数自报：Node 侧拿它与夹具对账，防"insert 被静默吞掉"读成两边一致
        counted = {
            "users": db.query(User).count(),
            "inquiries": db.query(Inquiry).count(),
            "quotations": db.query(Quotation).count(),
            "logs": db.query(InquiryLog).count(),
            "invited": db.query(inquiry_supplier).count(),
        }

        user = db.query(User).filter(User.id == args.user).one()
        p = fixture["params"]
        result = workbench_summary(
            db=db,
            user=user,
            owner=p.get("owner"),
            dateFrom=p.get("dateFrom"),
            dateTo=p.get("dateTo"),
            organization=p.get("organization"),
        )
        print(json.dumps({"counts": result.model_dump(), "inserted": counted}, ensure_ascii=False))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
