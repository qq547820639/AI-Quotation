/**
 * 「系统名称」设置 → 浏览器标签标题（App 的应用级副作用）
 * 被测面只有 App 自身挂的标题同步，路由树与页面数据加载都在噪音位，故一并 mock 掉。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import App from '@/App';
import { useSettingsStore } from '@/store/useSettingsStore';

vi.mock('@/router', async () => {
  const { createMemoryRouter } = await import('react-router-dom');
  // 标题是 App 自己挂的副作用，路由渲染什么与被测面无关，占位即可
  return { appRouter: createMemoryRouter([{ path: '*', element: <div /> }]) };
});
vi.mock('@/utils/deadlineWatcher', () => ({ startDeadlineWatcher: vi.fn() }));

// 同 defaultBasicInfo.test.ts：jsdom 的 localStorage 是全新的，这里读到的即 store DEFAULTS
const PRISTINE_SYSTEM_NAME = useSettingsStore.getState().systemName;

afterEach(() => {
  // 先卸载再回滚 store：否则挂在树里的 App 会在 act 之外被这次 setState 重渲染
  cleanup();
  useSettingsStore.setState({ systemName: PRISTINE_SYSTEM_NAME });
  // jsdom 起始 title 为空串，复原成空串才能看出是不是 App 写进去的
  document.title = '';
});

describe('document.title 跟随 systemName', () => {
  it('挂载时把已配置的系统名称写进标签标题', () => {
    useSettingsStore.setState({ systemName: '华东采购询价台' });
    render(<App />);
    expect(document.title).toBe('华东采购询价台');
  });

  it('systemName 变更后（不重新挂载）标题跟着改', () => {
    useSettingsStore.setState({ systemName: 'A 系统' });
    render(<App />);
    expect(document.title).toBe('A 系统');
    act(() => {
      useSettingsStore.setState({ systemName: 'B 系统' });
    });
    expect(document.title).toBe('B 系统');
  });

  it('对照组：默认设置下标题是 DEFAULTS.systemName（jsdom 里没有 index.html 可抄）', () => {
    render(<App />);
    expect(document.title).toBe('采购询价系统');
  });
});
