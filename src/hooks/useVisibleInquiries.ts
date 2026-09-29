/**
 * 当前组织可见的询价单（订阅数据本身后再过滤）。
 *
 * 页面原先写 useMemo(() => getVisibleInquiries(org), [getVisibleInquiries, org])：
 * 依赖里只有稳定的 store 方法引用，而真实后端下 store 首帧为空、数据在之后才到达，
 * 于是这个 memo 永不重算，询价列表/工作台/审批等页面在登录后恒为空表。
 */
import { useMemo } from 'react';
import { filterVisibleInquiries, useInquiryStore } from '@/store/useInquiryStore';
import { useUIStore } from '@/store/useUIStore';
import type { Inquiry } from '@/types';

export function useVisibleInquiries(): Inquiry[] {
  const inquiries = useInquiryStore((s) => s.inquiries);
  const currentOrganization = useUIStore((s) => s.currentOrganization);
  return useMemo(
    () => filterVisibleInquiries(inquiries, currentOrganization),
    [inquiries, currentOrganization],
  );
}
