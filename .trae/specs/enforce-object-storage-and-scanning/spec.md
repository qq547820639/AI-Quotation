# P0-8 对象存储与病毒扫描生产强制 Spec

## Why
生产环境此前可能静默回退到本地磁盘存储或 noop 病毒扫描，或仅凭「客户端对象创建成功」误判 S3/MinIO 可用，存在数据完整性、病毒防护与可用性盲区。

## What Changes
- 存储探活升级为真实链路验证（head bucket → 必要时创建 → 写入临时对象 → 读取校验 → 删除），禁止仅凭客户端创建成功判断可用。
- 生产强制 S3/MinIO（`S3_REQUIRED=true` 默认），配置缺失或探活失败禁止回退本地磁盘。
- 生产强制 ClamAV（`CLAMAV_REQUIRED=true` 默认），不可用/未配置时 fail-closed，禁止回退 noop/纯静态校验。
- ClamAV 探活改用 EICAR 标准测试串，证明病毒库已加载 + INSTREAM 扫描链路可用。
- Readiness 探针 `/api/ready` 覆盖 PostgreSQL + Redis + S3/MinIO + ClamAV + Celery Worker。
- 上传文件多层校验：扩展名白名单、声明 MIME 与扩展名一致性、魔数/magic bytes、双扩展名、压缩炸弹，防 MIME 欺骗与内容伪造。
- docker-compose 增加 MinIO、minio-init（桶初始化）、ClamAV 服务。

## Impact
- Affected specs: 附件安全、对象存储、可观测性
- Affected code: `backend/app/config.py`、`storage.py`、`scanner.py`、`config_validation.py`、`main.py`、`docker-compose.yml`；测试 `test_storage.py`、`test_scanner.py`、`test_config_validation.py`

## ADDED Requirements
### Requirement: S3/MinIO 真实探活
系统 SHALL 通过 head bucket →（必要时创建）→ 写入 → 读取校验 → 删除 的有限超时往返验证读写链路，任何一步失败即视为不可用（fail-closed）。

#### Scenario: 探活全链路通过
- **WHEN** bucket 存在且读写正常
- **THEN** `storage.probe()` 返回 True，且无残留临时对象

#### Scenario: 写入失败
- **WHEN** put_object 抛错
- **THEN** `storage.probe()` 返回 False

### Requirement: 生产强制 S3/MinIO
生产（`APP_ENV=prod`）默认 `S3_REQUIRED=true`；S3 配置缺失或探活失败时，`get_storage()` 抛错、配置校验拒绝启动，禁止静默回退本地磁盘。

### Requirement: 生产强制 ClamAV + EICAR 探活
生产默认 `CLAMAV_REQUIRED=true` 且 `SCANNER_PROVIDER=clamav`。ClamAV 探活仅当 EICAR 标准串被识别为 `Eicar-Test-Signature`（返回 infected）才算可用；clean/error/unavailable 一律 fail-closed。

### Requirement: Readiness 全依赖覆盖
`/api/ready` SHALL 校验 PostgreSQL（含关键表）、配置的 Redis、S3/MinIO 探活、ClamAV EICAR 探活、Celery Worker 存活；任一不就绪返回 503。

### Requirement: 文件防伪造校验
上传文件 SHALL 校验扩展名白名单、声明 MIME 与扩展名一致性、魔数（magic bytes）、双扩展名、压缩炸弹；任一失败即拒绝（infected/error）。

## MODIFIED Requirements
### Requirement: 存储工厂选择
`get_storage()` 在 S3 配置齐全时返回 S3Storage；配置缺失且 `S3_REQUIRED=true` 抛错；否则（dev/test）返回 LocalStorage。