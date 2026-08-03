# 部署指南

## Docker Compose 部署（推荐）

### 一键启动

```bash
docker compose up -d --build
```

- 前端：http://localhost（nginx 静态文件 + API 反代）
- 后端：http://localhost:8080（内部通信，不直接暴露）
- 健康检查：http://localhost/api/health

### 服务架构

```
浏览器 → nginx:80 → 静态文件（前端 SPA）
                  → /api/* → backend:8080（FastAPI + uvicorn）
                                      → SQLite (/app/data/procurement.db)
```

### 数据持久化

SQLite 数据库挂载到 `./data/` 目录：

```yaml
volumes:
  - ./data:/app/data
```

备份数据：
```bash
cp data/procurement.db data/procurement.db.bak
```

### 环境变量

在 `docker-compose.yml` 中配置：

| 变量 | 说明 | 默认 |
|---|---|---|
| `DB_PATH` | SQLite 数据库路径 | `/app/data/procurement.db` |

前端构建时注入（Dockerfile.frontend）：
- `VITE_ENABLE_MSW=false`（关闭 mock）
- `VITE_API_BASE_URL=/api`（通过 nginx 反代）

### 自定义 Sentry DSN

修改 `Dockerfile.frontend` 构建参数：

```dockerfile
RUN VITE_ENABLE_MSW=false VITE_API_BASE_URL=/api VITE_SENTRY_DSN=your_dsn_here npm run build
```

### 升级流程

```bash
git pull
docker compose up -d --build
```

### 查看日志

```bash
docker compose logs -f          # 所有服务
docker compose logs -f backend  # 仅后端
docker compose logs -f frontend # 仅前端
```

### 停止服务

```bash
docker compose down              # 停止容器
docker compose down -v           # 停止并删除卷（慎用，会丢数据）
```

## 本地原生部署

### 后端

```bash
cd backend
bash run.sh
# 首次自动创建 .venv + 安装依赖
# 启动在 http://localhost:8080
```

### 前端

```bash
npm install
npm run build       # 生产构建到 dist/
npm run preview     # 本地预览（http://localhost:4173）
```

或用 nginx 部署 `dist/`：

```bash
cp -r dist/* /usr/share/nginx/html/
cp nginx.conf /etc/nginx/conf.d/default.conf
nginx -s reload
```

## 生产环境注意事项

1. **HTTPS**：在 nginx 配置中添加 SSL 证书，或在前置负载均衡器终止 SSL
2. **CORS**：修改 `backend/app/config.py` 的 `CORS_ORIGINS` 为生产域名
3. **数据库**：SQLite 适合中小规模；如需高并发，迁移到 PostgreSQL
4. **反向代理**：生产环境建议在 nginx 前再加一层负载均衡器（如 ALB/HAProxy）
5. **监控**：配置 Sentry DSN 启用错误监控
6. **备份**：定期备份 `./data/procurement.db`
