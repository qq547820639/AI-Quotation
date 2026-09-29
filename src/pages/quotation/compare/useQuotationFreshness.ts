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
 * 依赖只有 inquiryId 与 enabled：同一条单的重渲染（评语自动保存会很频繁）不会再拉，
 * 所以不需要额外的 ref 去重——那个 ref 在此依赖数组下永远不会被走到，是死码。
 */
export function useQuotationFreshness(inquiryId: string | undefined, enabled = true): void {
  useEffect(() => {
    // R113：服务端那一支不再补拉 store 的整份报价——本页改成一发 GET /api/inquiries/{id}，
    // 新鲜度由那条查询的 staleTime:0 承担（全局默认 staleTime 是 30 s，不显式清零就会把
    // "刚提交的报价"读成"暂无已提交报价"，正是 R64 那个现场）。
    // 这里必须用显式开关早退：R67 已经把"!inquiryId 也照拉"钉成了演示分支的正确行为，
    // 只靠传 undefined 拦不住。
    if (!enabled) return;
    // R67：这里**不**再对 `!inquiryId` 早退。依赖数组已经是 [inquiryId]，
    // 一次挂载只会跑一遍、切一条单子再多跑一遍——"无 id 就拉"并不会变成轮询；
    // 而早退使"对比选择首屏"停留在"读 store 不补拉"，新建的单子可能不在卡列表里（inquiry-flow:47 的 flaky 即此）。
    void useQuotationStore.getState().loadFromApi();
  }, [inquiryId, enabled]);
}
