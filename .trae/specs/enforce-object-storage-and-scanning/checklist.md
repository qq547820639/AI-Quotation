# Checklist
- [x] S3Storage.probe 实现 head→create→write→read→delete 真实往返，写失败返回 False
- [x] get_storage 在 S3_REQUIRED=true 且配置缺失时抛错，禁止回退本地磁盘
- [x] ClamAV probe 使用 EICAR 标准串，仅当返回 infected 才算可用
- [x] SanitizingScanner 校验声明 MIME 与扩展名一致性（MIME 欺骗）
- [x] config_validation 校验生产强制 S3（缺失/探活失败均拒绝）与 clamav
- [x] /api/ready 覆盖 PostgreSQL/Redis/S3/MinIO/ClamAV/Celery Worker
- [x] docker-compose 含 minio、minio-init、clamav 服务
- [x] 测试（FakeS3Client、EICAR、MIME 欺骗、prod 强制）全部通过
- [x] 全量后端测试通过（380 passed, 1 skipped）