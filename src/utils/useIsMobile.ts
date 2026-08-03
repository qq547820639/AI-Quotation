/**
 * 移动端断点判断 hook（B7）
 * - 基于 antd Grid.useBreakpoint（与 antd 组件断点一致）
 * - isMobile = !md（即 xs/sm 视为移动端，< 768px）
 * - isTablet = md && !lg（768~991px）
 * - 暴露原始 screens 供调用方做更细粒度判断
 *
 * 注意：SSR 或首屏未挂载时 useBreakpoint 返回 {}，此时各断点均为 undefined（falsy），
 *      !screens.md === true，即默认视为移动端。调用方若需避免首屏闪烁，应配合 CSS 媒体查询。
 */
import { Grid } from 'antd';

export interface BreakpointState {
  /** 是否移动端（< 768px） */
  isMobile: boolean;
  /** 是否平板（768~991px） */
  isTablet: boolean;
  /** 是否桌面端（>= 992px） */
  isDesktop: boolean;
  /** 原始断点映射 */
  screens: Record<string, boolean>;
}

export function useIsMobile(): boolean {
  const screens = Grid.useBreakpoint();
  return !screens.md;
}

export function useBreakpointState(): BreakpointState {
  const screens = Grid.useBreakpoint();
  return {
    isMobile: !screens.md,
    isTablet: Boolean(screens.md) && !screens.lg,
    isDesktop: Boolean(screens.lg),
    screens,
  };
}
