/**
 * React Query 客户端（P1-10 Task 15：统一服务端数据缓存职责）
 * - React Query 负责服务端数据缓存 / 失效 / 新鲜度；Zustand 只承载客户端 UI 状态
 * - 独立成模块便于 store 层在服务端写操作成功后用返回对象更新缓存（setQueryData / invalidateQueries）
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000, // 30 秒内不重新请求
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** 统一查询 key 常量，避免各处散落字符串 */
export const QUERY_KEYS = {
  inquiries: ['inquiries'] as const,
  quotations: ['quotations'] as const,
  suppliers: ['suppliers'] as const,
  materials: ['materials'] as const,
  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
  auth: ['auth'] as const,
};
