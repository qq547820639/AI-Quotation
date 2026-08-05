"""生产引导 CLI（P0-3）：seed-demo 与 bootstrap-admin

用法：
    # 幂等创建首个管理员（生产引导；密码来自 --password / BOOTSTRAP_ADMIN_PASSWORD 环境变量 / stdin，不回显）
    python -m app.scripts.bootstrap_admin bootstrap-admin \
        [--name 姓名] [--department 部门] [--organization 组织] [--role 管理员] [--id 用户ID]

    # 注入演示数据（仅允许 dev/test 或显式 APP_DEMO_MODE=true；生产拒绝）
    python -m app.scripts.bootstrap_admin seed-demo

安全说明：
- bootstrap-admin 支持一次性 token（BOOTSTRAP_ADMIN_PASSWORD 环境变量或 --password）或读取 stdin
  （getpass，终端不回显）。明文密码绝不写入日志。
- seed-demo 在生产（APP_ENV=prod 且未显式 demo 模式）时拒绝执行并返回非零退出码。
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from app.config import APP_ENV, APP_DEMO_MODE
from app.database import SessionLocal
from app import seed


def _read_password(args: argparse.Namespace) -> str:
    """按优先级取密码：--password > BOOTSTRAP_ADMIN_PASSWORD 环境变量 > stdin（getpass 不回显）。"""
    if args.password:
        return args.password
    env = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
    if env:
        return env
    return getpass.getpass("请输入管理员密码（输入不回显）: ")


def _cmd_bootstrap_admin(args: argparse.Namespace) -> int:
    if not args.password and not os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") and not sys.stdin.isatty():
        # 非交互环境无密码来源时，避免 getpass 静默卡住/读取失败
        print("错误：非交互环境必须通过 --password 或 BOOTSTRAP_ADMIN_PASSWORD 提供密码", file=sys.stderr)
        return 2
    password = _read_password(args)
    db = SessionLocal()
    try:
        user = seed.bootstrap_admin(
            db,
            name=args.name,
            password=password,
            department=args.department,
            organization=args.organization,
            role=args.role,
            admin_id=args.id,
        )
        # 在会话关闭前取值，避免关闭后访问 ORM 触发懒加载
        summary = f"管理员就绪：id={user.id} name={user.name} role={user.role}"
    finally:
        db.close()
    print(summary)
    return 0


def _cmd_seed_demo(args: argparse.Namespace) -> int:
    if not seed.demo_seeding_allowed():
        print(
            f"错误：当前环境 APP_ENV={APP_ENV}、APP_DEMO_MODE={APP_DEMO_MODE}。"
            "seed-demo 仅允许在 APP_ENV in (dev, test) 或显式 APP_DEMO_MODE=true 时运行，"
            "生产环境禁止注入演示数据。",
            file=sys.stderr,
        )
        return 1
    db = SessionLocal()
    try:
        seed.seed_demo(db)
    finally:
        db.close()
    print("演示数据种子完成（幂等）。")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = argparse.ArgumentParser(prog="bootstrap_admin", description="生产引导 CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_admin = sub.add_parser("bootstrap-admin", help="幂等创建首个管理员")
    p_admin.add_argument("--name", default="系统管理员", help="管理员姓名")
    p_admin.add_argument("--department", default="信息中心", help="部门")
    p_admin.add_argument("--organization", default="总部", help="组织")
    p_admin.add_argument("--role", default="管理员", help="角色（默认管理员）")
    p_admin.add_argument("--id", default=None, help="管理员 id（默认自动生成）")
    p_admin.add_argument("--password", default=None, help="一次性引导密码（也可用 BOOTSTRAP_ADMIN_PASSWORD 环境变量或 stdin）")

    sub.add_parser("seed-demo", help="注入演示数据（仅 dev/test 或显式 demo 模式）")

    args = parser.parse_args(argv)
    if args.command == "bootstrap-admin":
        return _cmd_bootstrap_admin(args)
    if args.command == "seed-demo":
        return _cmd_seed_demo(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())