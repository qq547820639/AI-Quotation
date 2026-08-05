# 验收清单（供应商邀请完整闭环）

> 逐项核对代码与真实执行结果。未执行的验证不得标记为通过。

## 统一邀请 URL Builder
- [ ] 后端只通过 `config.build_invitation_url` 生成 `/supplier-portal/{urlencodedToken}` 链接
- [ ] 不再生成 `/portal?token=` 旧格式
- [ ] token 用 `quote(raw_token, safe="")` URL 安全编码
- [ ] `normalize_public_app_url` 去除末尾冗余斜杠并正确处理反向代理子路径

## PUBLIC_APP_URL 启动校验
- [ ] 生产必须 HTTPS，否则校验失败
- [ ] 生产禁止 localhost/127.0.0.1/0.0.0.0/::1
- [ ] `validate_production_config` 返回错误；`assert_production_config` 抛 RuntimeError

## 投递与重新生成
- [ ] `delivery.py` 投递用统一 URL Builder 生成 portalUrl
- [ ] `inquiries.py` 重新生成链接返回 canonical URL

## 测试
- [ ] `test_invitation_url.py` 断言 canonical 链接与 PUBLIC_APP_URL 校验
- [ ] `test_invitation_security.py` 断言重新生成返回 canonical、并发提交仅一条有效报价、过期/撤销/重发/重复提交/非法令牌

## 真实 E2E（e2e/）
- [ ] E2E 完整闭环：创建询价 → 邀请 → 读邮件提取链接 → 打开门户 → 上传附件 → 保存草稿 → 提交报价 → 采购端看到报价与提交状态
- [ ] 覆盖令牌过期/撤销/重发/重复提交/并发提交/非法令牌，均有真实断言
- [ ] 本环境无 Docker 时注明不能本地运行，但代码完整，由 CI `docker-e2e` 验证

## 全量验证
- [ ] 后端全量 `python3 -m pytest -q` 通过
- [ ] 前端 `npm run lint && npx tsc --noEmit && npx vitest run` 通过