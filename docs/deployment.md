# 部署指南

## Docker Compose 部署（推荐）

### 一键启动

```bash
# 生产：先基于模板生成安全的 .env（含 SECRET_KEY / 数据库密码 / S3 密钥等）
cp .env.production.example .env
# 生成安全密钥（任选其一）：
#   openssl rand -hex 32
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
#   cd backend && python -m app.scripts.generate_secrets
# 将生成的强密钥填入 .env 的 SECRET_KEY 后启动：
docker compose up -d --build
```

- 前端：http://localhost（nginx 静态文件 + API 反代）
- 后端：http://localhost:8080（内部通信，不直接暴露）
- 就绪检查：http://localhost:8080/api/ready（Docker healthcheck 探测用）

> **生产 fail-fast**：`APP_ENV=prod` 时后端启动会调用 `config_validation.assert_production_config()`，
> 对 `SECRET_KEY`（默认/过短）、`CORS_ORIGINS`（仅 localhost）、`SCANNER_PROVIDER`（非 clamav）、
> `NOTIFY_CHANNEL`（非 email）、Redis/S3 探活等做强制校验，不满足则拒绝启动。因此生产必须通过
> `.env` 注入真实强密钥，不能依赖 compose 中的开发默认值。

### 持久化任务队列（Celery，P0-5）

`docker-compose.yml` 内置以下服务（与 `backend` 同镜像、同环境变量）：

| 服务                  | 职责                                                                             | 启动命令                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `celery-worker`       | 消费持久化任务队列（默认队列 `procurement`），并发/超时/重试策略可经环境变量覆盖 | `celery -A app.tasks worker --loglevel=... --concurrency=... -Q procurement --soft-time-limit=... --time-limit=...` |
| `outbox-dispatcher`   | 持续循环扫描 pending outbox 事件投递到 Celery（不丢事件），默认每 5s 轮询        | `while true; do python -c 'from app.queue_client import dispatch_outbox; ...'; sleep 5; done`                       |
| `celery-beat`（可选） | 周期任务调度器（如截止提醒 `send_inquiry_reminder_task`）占位                    | `celery -A app.tasks beat --loglevel=...`                                                                           |

可调环境变量：`CELERY_LOG_LEVEL`、`CELERY_WORKER_CONCURRENCY`、`CELERY_QUEUE_NAME`、
`CELERY_TASK_SOFT_TIME_LIMIT`、`CELERY_TASK_TIME_LIMIT`、`OUTBOX_POLL_INTERVAL_SECONDS`。
需要定时任务时，在 `backend/app/tasks.py` 的 `celery_app.conf.beat_schedule` 中登记即可。

### 服务架构

```
浏览器 → nginx:80 → 静态文件（前端 SPA）
                  → /api/* → backend:8080（FastAPI + uvicorn）
                                      → postgres:5432（PostgreSQL 16，生产默认）
```

### 数据持久化

生产默认使用 **PostgreSQL 16**，数据持久化到命名卷 `pgdata`：

```yaml
volumes:
  - pgdata:/var/lib/postgresql/data
```

> 本地开发仍可使用 SQLite（`DATABASE_URL` 不设置时回退到 `sqlite:///<DB_PATH>`）。

### 环境变量

在 `docker-compose.yml` 中配置（通过项目根 `.env` 或 `docker compose` 环境注入）：

| 变量                | 说明                                        | 默认                      |
| ------------------- | ------------------------------------------- | ------------------------- |
| `POSTGRES_USER`     | PostgreSQL 用户名                           | `procurement`             |
| `POSTGRES_PASSWORD` | PostgreSQL 密码（**生产必须注入强密码**）   | `procurement`             |
| `POSTGRES_DB`       | PostgreSQL 数据库名                         | `procurement`             |
| `SECRET_KEY`        | 签名/加密密钥（**生产必须注入随机强密钥**） | `change-me-in-production` |
| `APP_DEMO_MODE`     | 演示模式（生产必须 `false`）                | `false`                   |
| `DB_POOL_SIZE`      | PostgreSQL 连接池大小                       | `10`                      |
| `DB_MAX_OVERFLOW`   | 连接池溢出上限                              | `20`                      |

前端构建时注入（Dockerfile.frontend）：

- `VITE_ENABLE_MSW=false`（关闭 mock）
- `VITE_API_BASE_URL=/api`（通过 nginx 反代）

### 后端环境变量

后端在 `backend/app/config.py` 统一读取，可通过环境变量（或 docker-compose `environment`）覆盖。完整示例见 `backend/.env.example`：

| 变量                                                    | 说明                                                                                                               | 默认                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `DATABASE_URL`                                          | 完整数据库连接串。含 `postgresql://` 时使用 psycopg2 驱动并启用连接池；以 `sqlite://` 开头时走 SQLite（开发/演示） | 回退 `sqlite:///<DB_PATH>`          |
| `APP_ENV`                                               | 运行环境：`dev` / `test` / `prod`。`prod` 时默认 `DB_AUTO_CREATE=false`                                            | `dev`                               |
| `DB_AUTO_CREATE`                                        | 是否启动时 `create_all`（生产依赖 Alembic，应保持 `false`）                                                        | `true`（dev/test）、`false`（prod） |
| `APP_DEMO_MODE`                                         | 演示模式：`true`/`1`/`yes` 时允许快捷登录（选中用户即可，无需密码）。生产必须留空或设为 `false`                    | `false`                             |
| `SECRET_KEY`                                            | 签名/加密密钥，**生产必须通过环境变量注入**，勿写入代码                                                            | `dev-secret-key-change-me`          |
| `TOKEN_TTL`                                             | token 有效期（秒）                                                                                                 | `86400`（24 小时）                  |
| `LOGIN_MAX_ATTEMPTS`                                    | 连续失败登录次数阈值，超过后触发限流                                                                               | `5`                                 |
| `LOGIN_RATE_LIMIT_WINDOW`                               | 失败登录限流窗口（秒）                                                                                             | `900`（15 分钟）                    |
| `DEMO_USER_PASSWORD`                                    | 演示账号默认密码（仅 `APP_DEMO_MODE=true` 时种子用户使用）                                                         | `123456`                            |
| `DB_PATH`                                               | SQLite 数据库文件路径（仅 SQLite 场景）                                                                            | `backend/procurement.db`            |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_PRE_PING` | PostgreSQL 连接池配置                                                                                              | `10` / `20` / `true`                |

> 说明：项目根 `.env.example` 是前端 Vite 环境文件（`VITE_*` 变量）。后端配置见 `backend/.env.example`，通过 docker-compose `environment` 或 shell 环境变量注入，**所有密钥（`SECRET_KEY`、`POSTGRES_PASSWORD` 等）不入库**。

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

- **配置文件**：`backend/alembic.ini`（脚本目录 `alembic`），`backend/alembic/env.py` 从 `app.config` 读取 `DB_URL`（基于 `DATABASE_URL` / `DB_PATH` 环境变量）。
- **首个迁移**：`backend/alembic/versions/0001_initial.py`，包含全部 13 个 ORM 模型的初始表结构。
- **兼容路径**：`Base.metadata.create_all` 仍保留在应用启动（`app/main.py` lifespan）与测试夹具（`backend/tests/conftest.py`）中，作为「无迁移场景」的快速起表/测试路径；**生产禁用**（`APP_ENV=prod` 时 `DB_AUTO_CREATE=false`），首次部署由 `docker compose` 的 backend 启动命令执行 `alembic upgrade head` 以迁移方式建表。
- **迁移测试**：`backend/tests/test_migrations.py` 在独立临时 SQLite 上执行「全新库 upgrade head → 关键迁移 downgrade（0003→0002）→ re-upgrade → downgrade base」的 round-trip 验证，确保 0001/0002/0003 可升级、可回退。
- **CI**：`.github/workflows/ci.yml` 的 `backend-test` job 在 pytest 前执行 `alembic upgrade head` 验证迁移可成功应用。

## 数据库备份与恢复演练

### PostgreSQL（生产默认）

**备份**（逻辑备份，便于跨版本/跨机恢复）：

```bash
# 在 postgres 容器内执行 pg_dump，输出到宿主机
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > backup_$(date +%Y%m%d_%H%M%S).dump
```

**恢复**（演练：恢复到新库）：

```bash
# 1. 用 dump 重建一个独立数据库（避免覆盖生产库）
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"_restore
# 2. 恢复
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB"_restore < backup_xxx.dump
# 3. 校验：表与行数
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"_restore -c "\dt"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"_restore -c "SELECT COUNT(*) FROM users;"
```

> 恢复目标库必须是**空库**（`pg_restore` 不覆盖已存在的表）。建议演练时重建空库再恢复，验证 dump 可用性。

### SQLite（开发/演示）

```bash
# 备份：直接复制文件（SQLite 单文件）
cp data/procurement.db data/procurement.db.bak
# 或使用 SQLite 在线备份 API（原子、更安全）
sqlite3 data/procurement.db ".backup backup_$(date +%Y%m%d_%H%M%S).db"
# 恢复：停服后替换文件
cp backup_xxx.db data/procurement.db
```

> SQLite 建议定期备份文件并保留多个版本；恢复前确保后端已停止写库。

## 零停机迁移（生产）

- **扩缩容策略**：默认 `docker compose` 单实例。需要零停机时，可对 `backend` 多副本并用负载均衡（如 K8s / Docker Swarm + 反向代理 + 蓝绿）。
- **迁移与业务解耦**：Alembic 迁移在 `backend` 容器启动命令中先于 uvicorn 执行（`alembic upgrade head && uvicorn ...`）。新副本启动时先跑迁移，旧副本仍在服务，迁移不锁表（PostgreSQL DDL 使用事务 + 轻量锁），可平滑滚动。
- **原则**：迁移脚本应**向后兼容**（只加列/加表，不删旧列、不改旧语义），以便新旧版本同时运行；真正的破坏性变更（删列、改类型）放到独立维护窗口，避免滚动期间新旧代码冲突。
- **回滚**：若新版本异常，`docker compose` 回滚到上一镜像即可；数据库结构已变更时，用 `alembic downgrade -1` 回退（除非迁移包含不可逆操作，务必先做备份）。

## 日志轮转

- **Docker 日志**：容器 stdout/stderr 默认由 Docker 收集。建议在 `daemon.json` 或 compose 中配置日志轮转，避免无限增长：

```yaml
services:
  backend:
    logging:
      driver: json-file
      options:
        max-size: '20m'
        max-file: '5'
```

- **应用日志落盘**：若需将日志写入文件，配合 `logrotate`（路径如 `/var/log/procurement/*.log`，`daily` + `rotate 30` + `compress`）。

## TLS 与反向代理

- **SSL 终止**：在 nginx（或前置负载均衡器）终止 TLS。`nginx.conf` 增加 `listen 443 ssl;` 并配置 `ssl_certificate` / `ssl_certificate_key`，HTTP 80 强制 301 跳转 HTTPS。
- **反向代理**：`/api/*` 反代到 `backend:8080`；`X-Forwarded-Proto` 由 nginx 设置，后端 `TRUSTED_PROXY` 环境变量需信任代理地址。
- **安全头**：后端已由中间件下发 CSP / HSTS（`HSTS_ENABLED=true` 时）等安全响应头；HSTS 仅在 HTTPS 就绪后开启。
- **CORS**：`CORS_ORIGINS` 需改为生产域名，勿保留 localhost 白名单。

## 可观测性

后端提供以下可观测性能力（详见 `backend/app/main.py`、`backend/app/logging.py`）：

- **request_id**：每个请求分配唯一 ID，通过响应头 `X-Request-Id` 返回，并写入请求日志与结构化错误响应，便于链路追踪。
- **健康检查（liveness）**：`GET /api/health` —— 真实探测数据库连通性（`SELECT 1`），返回 `{"status":"ok","version":"1.0.0","db":"connected"}`；**DB 不可用时仍返回 HTTP 200**（`status=degraded`），用于判断进程是否存活，避免依赖故障误触发重启。
- **就绪检查（readiness）**：`GET /api/ready` —— 校验 DB 连通 + 关键表（users/inquiries）可查询，返回 `{"status":"ready","db":"connected"}`；异常时返回 503。**Docker healthcheck 使用 `/api/ready`**，确保 DB 与关键表就绪后才标记容器健康。
- **结构化日志**：请求日志中间件以 `http_request` 结构化字段（method/path/status/duration_ms/request_id）输出 INFO 日志。
- **日志脱敏**：`app/logging.py` 的 `redact()` 对密码、token、授权头等敏感字段掩码为 `***`，避免敏感信息落盘。
- **统一错误响应**：所有异常（HTTPException / 请求校验 422 / 未捕获 500）均返回结构化 JSON，含 `detail`、`request_id`、`error_type`，并携带 `X-Request-Id` 响应头。

## 生产环境注意事项

1. **HTTPS**：在 nginx 配置中添加 SSL 证书，或在前置负载均衡器终止 SSL（详见「TLS 与反向代理」）
2. **CORS**：修改 `backend/app/config.py` 的 `CORS_ORIGINS` 为生产域名
3. **数据库**：生产默认使用 PostgreSQL 16（`docker compose` 已内置）；本地开发仍可用 SQLite
4. **反向代理**：生产环境建议在 nginx 前再加一层负载均衡器（如 ALB/HAProxy）
5. **监控**：配置 Sentry DSN 启用错误监控
6. **备份**：定期执行 PostgreSQL 备份演练（见「数据库备份与恢复演练」）
7. **密钥**：`SECRET_KEY`、`POSTGRES_PASSWORD` 等必须通过环境变量注入，**不入库**（见 `backend/.env.example`）

## ⚠️ 安全与演示风险提示

**当前为演示/试运行版本，接入正式环境前必须完成以下事项：**

1. **演示账号**：`backend/app/seed.py` 内置固定演示账号（如 `u-1` 采购人员、`u-2` 采购主管、`u-6` 管理员），密码为简单的演示口令。**不要**在公网环境使用这些账号，正式上线前应替换为真实账号体系并清理种子数据。
2. **认证强度**：当前认证为「演示 Bearer Token」（后端 `app/auth.py` 将 token 直接存于数据库，无 JWT 签名密钥、无过期刷新机制）。这适合本地/内网试用，**不满足生产安全要求**。正式接入请启用密码哈希 + JWT 签发/刷新 + 会话撤销（前端已预留 `AuthAdapter` 接口层，见 `src/services/auth/types.ts`）。
3. **CORS 白名单**：`config.py` 的 `CORS_ORIGINS` 仅含 localhost 开发地址，生产必须改为实际域名。
4. **默认密钥**：未使用外部加密密钥；若后续接入 JWT，请务必通过环境变量注入随机密钥，不要写入代码。
5. **数据范围**：管理员角色含 `VIEW_ALL_ORG` 权限，请按需收紧角色权限矩阵（前端 `src/types/index.ts` 与后端 `app/auth.py` 需保持一致）。
6. **健康检查**：`docker compose` 中后端健康检查通过 Python 探测 `/api/ready`（readiness：DB+关键表就绪才返回 200），确保 PostgreSQL 迁移完成且关键表可查询后才标记容器健康。
