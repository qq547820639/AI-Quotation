/**
 * 前端运行模式配置
 * - 演示/开发模式：允许"快捷登录"（选中用户即可，无需后端密码校验）
 * - 生产模式：必须通过后端密码认证（VITE_DEMO_MODE 未开启且未启用 MSW）
 *
 * 演示模式判定：显式开启 VITE_DEMO_MODE=true，或启用了 MSW（VITE_ENABLE_MSW=true，开发/测试用）。
 */
export const IS_DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_ENABLE_MSW === 'true';