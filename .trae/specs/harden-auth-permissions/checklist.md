# Checklist

- [x] 报价单 get/submit/create 跨组织访问（IDOR）返回 403，同组织放行
- [x] 无权限用户调用管理接口（AI 用量统计）返回 403，管理员返回 200
- [x] 改密后旧 access token / 旧密码失效，新密码可登录；错误当前密码与两次不一致被拒
- [x] cookie 认证的 refresh 端点校验 Origin，跨站来源 403，可信来源放行并轮换
- [x] 登录连续失败超阈值返回 429，成功/复位重置计数
- [x] 密码沿用 bcrypt 哈希，无明文存储
- [x] 约束合规：未改动 state_machine.py / scanner.py / invitations.py / delivery.py / config_validation.py / main.py / docker-compose.yml / requirements.txt / .github/workflows/ci.yml
- [x] 未删除/降低现有测试断言
- [x] `cd backend && python3 -m pytest -q` 全部通过（247 passed, 1 skipped，覆盖率 84.23% ≥ 80%）