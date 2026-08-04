/**
 * TableSettings 组件测试（Task 7）
 * 覆盖：设置按钮渲染、打开面板后列可见性切换、密度切换、重置默认回调
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import TableSettings from '../TableSettings';
import type { TableColumnPref, TableDensity } from '@/hooks/useTablePreferences';

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

// antd 组件在 jsdom 下需要 matchMedia / ResizeObserver
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

function renderWithI18n(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const columns: TableColumnPref[] = [
  { key: 'a', title: '编号', visible: true, order: 0 },
  { key: 'b', title: '名称', visible: true, order: 1 },
  { key: 'c', title: '状态', visible: true, order: 2 },
];

function setup(overrides: Partial<Parameters<typeof TableSettings>[0]> = {}) {
  const onToggleVisible = vi.fn();
  const onMoveOrder = vi.fn();
  const onSetFixed = vi.fn();
  const onSetDensity = vi.fn();
  const onReset = vi.fn();
  renderWithI18n(
    <TableSettings
      columns={columns}
      density="default"
      onToggleVisible={onToggleVisible}
      onMoveOrder={onMoveOrder}
      onSetFixed={onSetFixed}
      onSetDensity={onSetDensity}
      onReset={onReset}
      {...overrides}
    />,
  );
  return { onToggleVisible, onMoveOrder, onSetFixed, onSetDensity, onReset };
}

describe('TableSettings', () => {
  it('渲染列设置按钮', () => {
    setup();
    expect(screen.getByText('列设置')).toBeTruthy();
  });

  it('打开面板后展示列并支持切换可见性与重置', () => {
    const { onToggleVisible, onReset } = setup();
    fireEvent.click(screen.getByText('列设置'));
    // 面板打开后展示列标题与重置按钮
    expect(screen.getByText('编号')).toBeTruthy();
    expect(screen.getByText('名称')).toBeTruthy();
    expect(screen.getByText('状态')).toBeTruthy();

    // 切换第一列的可见性
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(onToggleVisible).toHaveBeenCalledWith('a', false);

    // 面板内重置按钮
    const resetBtn = screen.getByText('重置默认');
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalled();
  });

  it('切换密度触发回调', () => {
    const { onSetDensity } = setup({ density: 'default' });
    fireEvent.click(screen.getByText('列设置'));
    fireEvent.click(screen.getByText('紧凑'));
    const lastCall = onSetDensity.mock.calls.at(-1)?.[0] as TableDensity;
    expect(lastCall).toBe('compact');
  });
});