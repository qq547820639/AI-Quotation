/**
 * 操作日志 store（可选）
 * 聚合所有询价单的日志，统一查询；数据源仍为 inquiry.logs
 */
import { create } from 'zustand';
import type { InquiryLog } from '@/types';
import { useInquiryStore } from './useInquiryStore';

interface LogState {
  logs: InquiryLog[];
  /** 从询价 store 刷新日志视图 */
  refreshLogs: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  logs: [],
  refreshLogs: () => {
    const inquiries = useInquiryStore.getState().inquiries;
    const logs = inquiries
      .flatMap((i) => i.logs)
      .sort((a, b) => (a.time < b.time ? 1 : -1));
    set({ logs });
  },
}));

/** 获取全部日志（按时间倒序） */
export function getAllLogs(): InquiryLog[] {
  return useInquiryStore
    .getState()
    .inquiries.flatMap((i) => i.logs)
    .sort((a, b) => (a.time < b.time ? 1 : -1));
}
