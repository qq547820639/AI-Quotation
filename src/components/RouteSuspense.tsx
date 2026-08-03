/**
 * 路由级 Suspense 兜底组件
 * 在懒加载页面加载完成前，展示全屏居中的 Spin
 */
import { Spin } from 'antd';

export default function RouteSuspense() {
  return (
    <div
      style={{
        width: '100%',
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Spin size="large" tip="加载中..." />
    </div>
  );
}
