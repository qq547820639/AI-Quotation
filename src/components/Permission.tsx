/**
 * 按钮级权限组件（W4）
 * - <Permission perm="INQUIRY_CREATE">{children}</Permission>
 * - 无权限时不渲染（或渲染 fallback）
 */
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import type { Permission } from '@/types';

interface Props {
  perm: Permission | Permission[];
  fallback?: ReactNode;
  children: ReactNode;
}

export default function Permission({ perm, fallback = null, children }: Props) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const ok = Array.isArray(perm) ? perm.some((p) => hasPermission(p)) : hasPermission(perm);
  return <>{ok ? children : fallback}</>;
}
