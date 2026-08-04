/**
 * 路由守卫（W4）
 * - 未登录跳 /login，并记录来源路径
 * - 挂载时调用 loadFromApi 刷新当前用户/权限（失败静默，保持本地降级）
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadFromApi = useAuthStore((s) => s.loadFromApi);
  const location = useLocation();

  // 首次进入时刷新会话（权限变更后 /auth/me 会返回最新用户，从而刷新 hasPermission）
  useEffect(() => {
    loadFromApi().catch(() => {
      /* API 不可用时保持本地用户 */
    });
  }, [loadFromApi]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
