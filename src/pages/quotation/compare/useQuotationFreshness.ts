import { useEffect } from 'react';
import { useQuotationStore } from '@/store/useQuotationStore';

/**
 * R64：进入对比视图时先补拉一次报价。
 *
 * 本页的 data 全部来自 store，而 store 的 `loaded` 是"曾经加载成功过"的一次性旗标——
 * 应用启动拉过一次之后它永远为 true。于是供应商刚提交完、采购随即进入本页时，
 * :300 那条 R30/R33 守卫直接放行，submittedRows.length === 0 成立，
 * 页面把"本机还没同步到"说成"该询价单暂无已提交报价"（现场见登记册 R64）。
 *
 * 补拉期间 store.loading 为 true，正好由 :300 渲染 Spin，不需要再造第二个"在飞"谓词。
 * 依赖只有 inquiryId：同一条单的重渲染（评语自动保存会很频繁）不会再拉，
 * 所以不需要额外的 ref 去重——那个 ref 在此依赖数组下永远不会被走到，是死码。
 */
export function useQuotationFreshness(inquiryId: string | undefined): void {
  useEffect(() => {
    if (!inquiryId) return;
    void useQuotationStore.getState().loadFromApi();
  }, [inquiryId]);
}
