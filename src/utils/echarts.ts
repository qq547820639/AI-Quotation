/**
 * ECharts 按需引入
 * 仅注册项目实际使用的图表与组件，避免全量打包
 * - 图表：PieChart、LineChart、BarChart、FunnelChart（B6 新增）
 * - 组件：Title、Tooltip、Legend、Grid
 * - 渲染器：CanvasRenderer
 * 按需引入的 echarts 完全兼容 init/setOption/resize/dispose 等 API
 */
import * as echarts from 'echarts/core';
import { PieChart, LineChart, BarChart, FunnelChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  PieChart,
  LineChart,
  BarChart,
  FunnelChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CanvasRenderer,
]);

export default echarts;
export { echarts };
