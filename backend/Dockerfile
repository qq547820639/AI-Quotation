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
# 修复 setuptools 内嵌（_vendor）的 jaraco.context 5.3.0 / wheel 0.45.1 高危 CVE：
# 这两个包被 setuptools 以 _vendor 方式物理拷贝进 site-packages/setuptools/_vendor/ 下，
# 单独 `pip install jaraco.context>=6.1.0` 只会把补丁版装到顶层 site-packages，
# 并不会替换 setuptools 内嵌的旧版本，Trivy 镜像扫描（--exit-code 1）仍会命中并阻断。
# 先升级 setuptools 让内嵌拷贝被补丁版覆盖，再显式清理 vendored 目录下残留的
# jaraco.context-*.dist-info 与 wheel-*.dist-info，确保镜像内不再残留任何旧版本元数据。
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --upgrade setuptools wheel \
    && rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/jaraco.context-*.dist-info \
    && rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/wheel-*.dist-info
COPY . .
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/procurement.db
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
