# Tasks
- [x] config.py 追加 S3/ClamAV 强制与探活配置（S3_REQUIRED/CLAMAV_REQUIRED/S3_PROBE_TIMEOUT/CLAMAV_PROBE_TIMEOUT/S3_BUCKET_INIT_RETRIES/BACKOFF）
- [x] storage.py 实现真实 probe（head/create/write/read/delete 往返）+ prod 强制 S3 + 可注入 client
- [x] scanner.py 增加 EICAR probe + 声明 MIME 一致性校验 + check_scanner_available
- [x] config_validation.py prod 强制 S3 探活 / ClamAV 校验
- [x] main.py readiness 覆盖 DB/Redis/Celery/S3/ClamAV
- [x] docker-compose.yml 增加 MinIO / minio-init / ClamAV 服务
- [x] 更新 test_storage.py / test_scanner.py / test_config_validation.py（FakeS3Client、EICAR、MIME 欺骗、prod 强制）
- [x] 运行 pytest 全部通过并汇报

# Task Dependencies
- storage.py 探活依赖 config.py 的 S3_REQUIRED / 超时配置
- main.py readiness 依赖 storage.probe 与 check_scanner_available
- 测试依赖 FakeS3Client 注入能力