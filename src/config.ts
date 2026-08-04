/**
 * 前端运行模式配置（P1-10 Task 15：mock 与真实数据隔离）
 * - 演示/开发模式（IS_DEMO_MODE）：允许"快捷登录"、mock 回退、快捷切换用户
 * - 生产模式（IS_PRODUCTION）：必须通过后端密码认证，禁止 mock 回退
 *
 * 演示模式判定：显式开启 VITE_DEMO_MODE=true，或启用了 MSW（VITE_ENABLE_MSW=true，开发/测试用）。
 * 生产构建默认：VITE_DEMO_MODE 与 VITE_ENABLE_MSW 均未显式开启时，IS_PRODUCTION=true，禁止 mock 回退。
 */
export const IS_DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_ENABLE_MSW === 'true';

/** 生产模式：非演示模式即视为生产（默认），禁止 mock 回退 */
export const IS_PRODUCTION = !IS_DEMO_MODE;

/** 是否允许 mock/localStorage 回退：仅演示模式允许（生产构建默认禁止） */
export const MOCK_FALLBACK_ENABLED = IS_DEMO_MODE;
