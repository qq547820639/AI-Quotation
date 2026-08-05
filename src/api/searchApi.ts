/**
 * 全局搜索 API（Task 19）
 * - 跨询价 / 供应商 / 物料 / 报价的统一搜索
 * - 服务端分页：page/pageSize 由服务端裁剪，避免前端全量拉取
 * - 查询参数严格校验（keyword 长度、page>=1、pageSize 上限）由服务端完成
 */
import { client } from './client';
import type { Inquiry, Material, Quotation, Supplier } from '@/types';

/** 搜索范围：询价 / 供应商 / 物料 / 报价 */
export type GlobalSearchScope = 'inquiry' | 'supplier' | 'material' | 'quotation';

/** 全局搜索请求参数 */
export interface GlobalSearchParams {
  /** 搜索关键词（必填，服务端限制长度） */
  keyword: string;
  /** 目标范围，省略则全部 */
  scope?: GlobalSearchScope;
  /** 分页页码，默认 1 */
  page?: number;
  /** 分页大小，默认 20，上限 50 */
  pageSize?: number;
}

/** 搜索结果某一分组（服务端分页） */
export interface SearchGroup<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 全局搜索响应：四个分组的服务端分页结果 */
export interface GlobalSearchResponse {
  inquiries: SearchGroup<Inquiry>;
  suppliers: SearchGroup<Supplier>;
  materials: SearchGroup<Material>;
  quotations: SearchGroup<Quotation>;
}

/** 对单组做服务端分页（纯函数，供测试与 mock 复用） */
export function paginate<T>(list: T[], page: number, pageSize: number): SearchGroup<T> {
  const size = Math.min(Math.max(pageSize, 1), 50);
  const p = Math.max(page, 1);
  return {
    items: list.slice((p - 1) * size, p * size),
    total: list.length,
    page: p,
    pageSize: size,
  };
}

export const searchApi = {
  /** 跨实体全局搜索（服务端分页 + 参数校验） */
  global: (params: GlobalSearchParams) =>
    client.get<GlobalSearchResponse>('/search', { params }).then((r) => r.data),
};
