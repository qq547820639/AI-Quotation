# 后端：Python 3.11 + uvicorn
# 基础镜像改用 Alpine（固定 3.24，与前端 nginx:alpine 3.24 对齐）。
# 为什么不用 Debian（bookworm/trixie）：Debian 基础镜像携带大量 OS 包（perl、ncurses、
# util-linux、zlib1g、libsqlite3-0 等），其中含多个尚未被上游修复、或 Debian 明确
# will_not_fix 的 HIGH/CRITICAL CVE（apt upgrade 也无新版本可升），会被 Trivy 镜像扫描
# 以 --exit-code 1 强门禁阻断。Alpine 包裁剪最小、Trivy 扫描为 0 HIGH/CRITICAL，
# 且本项目全部二进制 Python 依赖均发布 musllinux wheel（psycopg2-binary、pydantic_core、
# greenlet、uvloop、bcrypt(abi3) 等），无需 gcc 编译即可直接安装。
FROM python:3.11-alpine3.24
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/procurement.db
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
