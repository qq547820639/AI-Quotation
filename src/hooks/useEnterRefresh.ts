import { useEffect, useRef } from 'react';

/**
 * R69：进入页面即补拉一次。
 *
 * 存在理由：`pages/approval/index.tsx` 既不 fetch 也没有 `useEffect`（grep 双双为 0），
 * `dataSource` 直取 store 派生值 ⇒ 表格能不能出现，取决于上一次全局 bootstrap 是否已把这条单拉进 store；
 * 在飞或尚未同步时页面就是"没有 .ant-table"（`core-flow:111` 的 webkit 红即此，与 R67 同类）。
 *
 * 语义写死：每次挂载恰好一次。刷新函数放在 ref 里、依赖数组留空，
 * 这样调用方可以传行内箭头函数而不会退化成"每次重渲染都拉一遍"。
 */
export function useEnterRefresh(refresh: () => Promise<unknown>): void {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    void ref.current();
  }, []);
}
