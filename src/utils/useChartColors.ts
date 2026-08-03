/**
 * ECharts 主题色板 hook（B4）
 * - 从 useThemeStore 读取当前主题模式
 * - 返回对应主题的 8 色色板数组（Canvas 不支持 CSS var()，需硬编码）
 * - 切换主题时组件自动重渲染
 */
import { useThemeStore } from '@/store/useThemeStore';

const LIGHT_COLORS = [
  '#165dff',
  '#00b42a',
  '#ff7d00',
  '#f53f3f',
  '#722ed1',
  '#0fc6c2',
  '#eb2f96',
  '#faad14',
];

const DARK_COLORS = [
  '#4080ff',
  '#23c343',
  '#ff9a2e',
  '#f76965',
  '#a471f5',
  '#37d4cf',
  '#f77ebe',
  '#ffc60a',
];

/** 返回当前主题的 8 色色板 */
export function useChartColors(): string[] {
  const mode = useThemeStore((s) => s.mode);
  return mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

/** 返回当前主题的坐标轴文字色 */
export function useChartTextColor(): string {
  const mode = useThemeStore((s) => s.mode);
  return mode === 'dark' ? '#a8aeb8' : '#4e5969';
}

/** 返回当前主题的坐标轴线色 */
export function useChartAxisLineColor(): string {
  const mode = useThemeStore((s) => s.mode);
  return mode === 'dark' ? '#3a3d42' : '#e5e6eb';
}
