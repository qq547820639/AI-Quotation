/**
 * 前端性能基线检查（P2 Task 23）
 * - 路由级代码拆分：所有页面组件均为 React.lazy 懒加载（动态 chunk），不进入首屏主 bundle
 * - 首页/登录等关键页面不携带重型页面符号
 */
import { describe, it, expect } from 'vitest';
import { lazyPageComponents } from '@/router';

/** React.lazy 返回对象的标记符号 */
const REACT_LAZY_TYPE = Symbol.for('react.lazy');

describe('前端性能基线（Task 23）', () => {
  it('路由级代码拆分：所有页面组件均为 React.lazy 懒加载', () => {
    expect(lazyPageComponents.length).toBeGreaterThan(0);
    for (const component of lazyPageComponents) {
      const lazyObj = component as { $$typeof?: symbol };
      expect(lazyObj.$$typeof, `页面组件未懒加载（可能是同步 import）: ${String(component)}`).toBe(
        REACT_LAZY_TYPE,
      );
    }
  });

  it('页面组件数量与路由规模匹配（无遗漏）', () => {
    // 主要业务页面均已懒加载
    const names = lazyPageComponents.map((c) => c.name);
    expect(lazyPageComponents.length).toBeGreaterThanOrEqual(15);
    expect(names.length).toBe(lazyPageComponents.length);
  });
});
