#!/usr/bin/env bash
# 后端启动脚本：uvicorn 监听 :8080（对齐 vite.config.ts proxy 默认目标）
set -e
cd "$(dirname "$0")"

# 首次运行自动安装依赖
if [ ! -d ".venv" ]; then
  echo ">>> 创建虚拟环境 .venv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo ">>> 安装依赖"
pip install -q -r requirements.txt

echo ">>> 启动 FastAPI（http://localhost:8080，文档 http://localhost:8080/docs）"
exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
