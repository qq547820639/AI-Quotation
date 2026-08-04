/**
 * 路由级权限守卫（Task5）
 * - 接收 perm：Permission | Permission[]
 * - 当前用户无该权限时，直接导航到 /403 无权限页
 * - 用于"直接访问无权限 URL 时正确处理"（而不是看到空页面）
 */
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import type { Permission } from '@/types';

interface Props {
  perm: Permission | Permission[];
  children: ReactNode;
}

export default function RequirePermission({ perm, children }: Props) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const ok = Array.isArray(perm) ? perm.some((p) => hasPermission(p)) : hasPermission(perm);
  if (!ok) {
    return <Navigate to="/403" replace />;
  }
  return <>{children}</>;
}