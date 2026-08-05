# 后端：Python 3.11 + uvicorn
FROM python:3.11-slim
WORKDIR /app
# 打满基础镜像的 OS 安全补丁，降低 Trivy 镜像扫描的 HIGH/CRITICAL OS 包 CVE 数量。
# 基础镜像为浮动 tag，上游会不定期更新；显式 apt upgrade 确保构建时使用最新已修复包。
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/procurement.db
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
