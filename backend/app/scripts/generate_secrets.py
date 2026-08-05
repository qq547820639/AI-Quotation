"""生成生产环境安全随机密钥（P0-2）

用法：
    python -m app.scripts.generate_secrets [--hex]

默认输出 BASE64 URL 安全随机串（48 字节，适合 SECRET_KEY）；
--hex 输出 64 位十六进制串（等价 openssl rand -hex 32）。

示例：
    cd backend && python -m app.scripts.generate_secrets
    SECRET_KEY=$(python -m app.scripts.generate_secrets)
"""
from __future__ import annotations

import argparse
import secrets
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成生产环境安全随机密钥")
    parser.add_argument(
        "--hex",
        action="store_true",
        help="输出 64 位十六进制串（等价 openssl rand -hex 32）",
    )
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])
    if args.hex:
        print(secrets.token_hex(32))
    else:
        print(secrets.token_urlsafe(48))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())