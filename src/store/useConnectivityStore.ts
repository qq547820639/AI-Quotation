/**
 * 连接状态 store（P1-10 Task 15：mock 与真实数据隔离）
 * - 客户端 UI 状态：后端是否在线、最后成功同步时间、缓存是否过期
 * - 职责：展示"离线状态 + 最后同步时间 + 缓存过期"标识，不承载服务端数据
 */
import { create } from 'zustand';

interface ConnectivityState {
  /** 后端是否可达（在线） */
  isOnline: boolean;
  /** 最后成功同步时间（ISO 字符串），null 表示从未成功同步 */
  lastSyncAt: string | null;
  /** 缓存是否因同步失败而标记为过期 */
  stale: boolean;
  /** 标记一次成功同步（恢复在线并刷新最后同步时间、清除过期标记） */
  markSynced: () => void;
  /** 标记后端不可达（离线，缓存标记过期） */
  markOffline: () => void;
  /** 仅标记缓存过期（保留在线状态，但数据可能非最新） */
  markStale: () => void;
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  isOnline: true,
  lastSyncAt: null,
  stale: false,
  markSynced: () =>
    set({
      isOnline: true,
      lastSyncAt: new Date().toISOString(),
      stale: false,
    }),
  markOffline: () =>
    set({
      isOnline: false,
      stale: true,
    }),
  markStale: () => set({ stale: true }),
}));
