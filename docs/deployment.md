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

### 后端环境变量

后端在 `backend/app/config.py` 统一读取，可通过环境变量（或 docker-compose `environment`）覆盖：

| 变量 | 说明 | 默认 |
|---|---|---|
| `APP_DEMO_MODE` | 演示模式：`true`/`1`/`yes` 时允许快捷登录（选中用户即可，无需密码）。生产必须留空或设为 `false` | `false` |
| `TOKEN_TTL` | token 有效期（秒） | `86400`（24 小时） |
| `LOGIN_MAX_ATTEMPTS` | 连续失败登录次数阈值，超过后触发限流 | `5` |
| `LOGIN_RATE_LIMIT_WINDOW` | 失败登录限流窗口（秒） | `900`（15 分钟） |
| `DEMO_USER_PASSWORD` | 演示账号默认密码（仅 `APP_DEMO_MODE=true` 时种子用户使用） | `123456` |
| `DB_PATH` | SQLite 数据库文件路径 | `backend/procurement.db` |

> 说明：`.env.example` 是前端 Vite 环境文件（`VITE_*` 变量）。后端变量位于 FastAPI 进程，通过 `os.environ` 读取，部署时在 docker-compose `environment` 或 shell 环境变量中配置，无需写入 `.env.example`。

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

## 数据库迁移（Alembic）

后端使用 Alembic 管理数据库结构变更（`backend/alembic/`）：

```bash
cd backend
alembic upgrade head        # 应用全部迁移到最新
alembic revision --autogenerate -m "描述"   # 生成新迁移脚本
alembic downgrade -1        # 回退一步
```

- **配置文件**：`backend/alembic.ini`（脚本目录 `alembic`），`backend/alembic/env.py` 从 `app.config` 读取 `DB_URL`（基于 `DB_PATH` 环境变量）。
- **首个迁移**：`backend/alembic/versions/0001_initial.py`，包含全部 13 个 ORM 模型的初始表结构。
- **兼容路径**：`Base.metadata.create_all` 仍保留在应用启动（`app/main.py` lifespan）与测试夹具（`backend/tests/conftest.py`）中，作为「无迁移场景」的快速起表/测试路径；生产首次部署建议执行 `alembic upgrade head` 以迁移方式建表。
- **CI**：`.github/workflows/ci.yml` 的 `backend-test` job 在 pytest 前执行 `alembic upgrade head` 验证迁移可成功应用。

## 可观测性

后端提供以下可观测性能力（详见 `backend/app/main.py`、`backend/app/logging.py`）：

- **request_id**：每个请求分配唯一 ID，通过响应头 `X-Request-Id` 返回，并写入请求日志与结构化错误响应，便于链路追踪。
- **健康检查**：`GET /api/health` —— 真实探测数据库连通性（`SELECT 1`），返回 `{"status":"ok","version":"1.0.0","db":"connected"}`；Docker healthcheck 与监控使用。
- **就绪检查**：`GET /api/ready` —— 校验 DB 连通 + 关键表（users/inquiries）可查询，返回 `{"status":"ready","db":"connected"}`；异常时返回 503。
- **结构化日志**：请求日志中间件以 `http_request` 结构化字段（method/path/status/duration_ms/request_id）输出 INFO 日志。
- **日志脱敏**：`app/logging.py` 的 `redact()` 对密码、token、授权头等敏感字段掩码为 `***`，避免敏感信息落盘。
- **统一错误响应**：所有异常（HTTPException / 请求校验 422 / 未捕获 500）均返回结构化 JSON，含 `detail`、`request_id`、`error_type`，并携带 `X-Request-Id` 响应头。

## 生产环境注意事项

1. **HTTPS**：在 nginx 配置中添加 SSL 证书，或在前置负载均衡器终止 SSL
2. **CORS**：修改 `backend/app/config.py` 的 `CORS_ORIGINS` 为生产域名
3. **数据库**：SQLite 适合中小规模；如需高并发，迁移到 PostgreSQL
4. **反向代理**：生产环境建议在 nginx 前再加一层负载均衡器（如 ALB/HAProxy）
5. **监控**：配置 Sentry DSN 启用错误监控
6. **备份**：定期备份 `./data/procurement.db`

## ⚠️ 安全与演示风险提示

**当前为演示/试运行版本，接入正式环境前必须完成以下事项：**

1. **演示账号**：`backend/app/seed.py` 内置固定演示账号（如 `u-1` 采购人员、`u-2` 采购主管、`u-6` 管理员），密码为简单的演示口令。**不要**在公网环境使用这些账号，正式上线前应替换为真实账号体系并清理种子数据。
2. **认证强度**：当前认证为「演示 Bearer Token」（后端 `app/auth.py` 将 token 直接存于数据库，无 JWT 签名密钥、无过期刷新机制）。这适合本地/内网试用，**不满足生产安全要求**。正式接入请启用密码哈希 + JWT 签发/刷新 + 会话撤销（前端已预留 `AuthAdapter` 接口层，见 `src/services/auth/types.ts`）。
3. **CORS 白名单**：`config.py` 的 `CORS_ORIGINS` 仅含 localhost 开发地址，生产必须改为实际域名。
4. **默认密钥**：未使用外部加密密钥；若后续接入 JWT，请务必通过环境变量注入随机密钥，不要写入代码。
5. **数据范围**：管理员角色含 `VIEW_ALL_ORG` 权限，请按需收紧角色权限矩阵（前端 `src/types/index.ts` 与后端 `app/auth.py` 需保持一致）。
6. **健康检查**：`docker compose` 中后端健康检查通过 Python 探测 `/api/health`（真实执行数据库 `SELECT 1`），可据此判断服务与数据库连通性。
