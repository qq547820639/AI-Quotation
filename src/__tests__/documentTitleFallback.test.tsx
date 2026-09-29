/**
 * 「系统名称」被清空时的标题回落（App.tsx 的 STATIC_TITLE）
 * 单独成档是因为要重新求值 App 模块：STATIC_TITLE 在模块求值时抓一次 jsdom 的 document.title，
 * 所以必须"先把标题写好 → resetModules → 再动态 import"，顺序错了抓到的就是空串。
 * 同一原因，store 也必须走 resetModules 之后的那一次 import，否则我 setState 的是旧实例。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@/router', async () => {
  const { createMemoryRouter } = await import('react-router-dom');
  return { appRouter: createMemoryRouter([{ path: '*', element: <div /> }]) };
});
vi.mock('@/utils/deadlineWatcher', () => ({ startDeadlineWatcher: vi.fn() }));

const STATIC = '静态兜底标题';

async function mountWith(systemName: string) {
  vi.resetModules();
  document.title = STATIC;
  const { useSettingsStore } = await import('@/store/useSettingsStore');
  const { default: App } = await import('@/App');
  act(() => {
    useSettingsStore.setState({ systemName });
  });
  render(<App />);
}

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('系统名称为空时的标签标题', () => {
  it('正例：名称被清空（全空格）后标题不是空串，而是 index.html 带来的那个静态标题', async () => {
    await mountWith('   ');
    expect(document.title).toBe(STATIC);
  });

  it('对照组：名称非空时写的是配置值，回落没有反过来吞掉正常值', async () => {
    await mountWith('实际名称');
    expect(document.title).toBe('实际名称');
  });
});
