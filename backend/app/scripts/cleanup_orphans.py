"""孤儿附件文件清理脚本

扫描 UPLOAD_DIR 中无对应 Attachment 数据库记录的文件并删除，记录审计日志。

用法：
    python -m app.scripts.cleanup_orphans [--dry-run]

--dry-run 仅列出孤儿文件不删除。
"""
from __future__ import annotations

import logging
import sys

from app.database import SessionLocal
from app.models import Attachment
from app.config import UPLOAD_DIR

logger = logging.getLogger("procurement.audit")


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    dry_run = "--dry-run" in argv

    db = SessionLocal()
    try:
        # 收集数据库中所有附件物理文件名前缀（attachment_id）
        try:
            known_ids = {row[0] for row in db.query(Attachment.id).all()}
        except Exception as e:  # noqa: BLE001
            # 表不存在（如未迁移）时，视为无任何已知附件，避免脚本崩溃
            print(f"警告：无法读取附件记录（{e}），将视为无已知附件")
            known_ids = set()

        # 收集存储目录中的物理文件
        candidates = list(UPLOAD_DIR.glob("*"))
        orphan_files = [
            f for f in candidates
            if f.is_file() and f.name.split(".")[0] not in known_ids
        ]

        removed = 0
        for f in orphan_files:
            if dry_run:
                logger.info(
                    "orphan_dry_run",
                    extra={"extra_fields": {"action": "orphan_cleanup", "file": f.name, "dry_run": True}},
                )
                print(f"[dry-run] 孤儿文件: {f.name}")
                continue
            try:
                f.unlink()
                removed += 1
                logger.info(
                    "orphan_removed",
                    extra={"extra_fields": {"action": "orphan_cleanup", "file": f.name}},
                )
                print(f"已删除孤儿文件: {f.name}")
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "orphan_remove_failed",
                    extra={"extra_fields": {"action": "orphan_cleanup", "file": f.name, "error": str(e)}},
                )
                print(f"删除失败: {f.name}: {e}", file=sys.stderr)

        print(f"完成：孤儿文件 {len(orphan_files)} 个，删除 {removed} 个（dry-run={dry_run}）")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())