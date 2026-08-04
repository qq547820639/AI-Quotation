/**
 * CommentEditor 组件测试（Task 6）
 * 覆盖：输入防抖后自动保存、保存失败保留输入并置 error、保存成功置 saved
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import CommentEditor from '../CommentEditor';
import { SupplierLevel } from '@/types';

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

function renderWithI18n(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

function setup(overrides: Partial<Parameters<typeof CommentEditor>[0]> = {}) {
  // 若调用方传入 onSave，则使用它（否则默认成功），并作为返回值供断言
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(true);
  const onChange = vi.fn();
  const onStatusChange = vi.fn();
  const onDirtyChange = vi.fn();
  renderWithI18n(
    <CommentEditor
      supplierId="sup-1"
      supplierName="供应商A"
      level={SupplierLevel.STRATEGIC}
      value=""
      onChange={onChange}
      onSave={onSave}
      onStatusChange={onStatusChange}
      onDirtyChange={onDirtyChange}
      debounceMs={800}
      {...overrides}
    />,
  );
  return { onSave, onChange, onStatusChange, onDirtyChange };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('CommentEditor 防抖自动保存', () => {
  it('输入后延时 800ms 才调用 onSave，未到延时不触发', async () => {
    const { onSave } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '质量不错' } });

    // 还没到延时，不应保存
    expect(onSave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('sup-1', '质量不错');
  });

  it('连续输入只触发一次保存（防抖合并）', async () => {
    const { onSave } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'a' } });
    fireEvent.change(textarea, { target: { value: 'ab' } });
    fireEvent.change(textarea, { target: { value: 'abc' } });

    await vi.advanceTimersByTimeAsync(800);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('sup-1', 'abc');
  });

  it('失焦时立即 flush，无需等待延时', async () => {
    const { onSave } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '尽快发货' } });
    fireEvent.blur(textarea);

    await vi.advanceTimersByTimeAsync(0);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('sup-1', '尽快发货');
  });
});

describe('CommentEditor 保存状态', () => {
  it('保存成功置 saved，展示「已保存」', async () => {
    const { onSave } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '可接受' } });
    await vi.advanceTimersByTimeAsync(800);

    await vi.advanceTimersByTimeAsync(0);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText('已保存')).toBeInTheDocument();
  });

  it('保存失败置 error（保留输入）、展示「保存失败」并可重试', async () => {
    const { onSave } = setup({ onSave: vi.fn().mockResolvedValue(false) });
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '需复核价格' } });
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(0);

    // 失败后输入内容保留
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('需复核价格');
    expect(screen.getByText('保存失败')).toBeInTheDocument();

    // 重试按钮触发再次保存
    const retryBtn = screen.getByText('重试');
    fireEvent.click(retryBtn);
    await vi.advanceTimersByTimeAsync(0);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('sup-1', '需复核价格');
  });
});

describe('CommentEditor 保存前 trim 与旧响应保护（Task 10.1）', () => {
  it('保存前去除首尾空白，onSave 收到 trim 后的值', async () => {
    const { onSave } = setup();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '  质量不错  ' } });
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(0);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('sup-1', '质量不错');
  });

  it('保存期间用户继续输入时，旧响应不把新草稿标记为已保存', async () => {
    // 手动控制的 deferred promise，模拟在途保存
    let resolveSave!: (v: boolean) => void;
    const pendingSave = new Promise<boolean>((res) => {
      resolveSave = res;
    });
    const { onSave } = setup({ onSave: vi.fn().mockReturnValue(pendingSave) });
    const textarea = screen.getByRole('textbox');

    // 第一次输入触发保存（在途）
    fireEvent.change(textarea, { target: { value: 'abc' } });
    await vi.advanceTimersByTimeAsync(800);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('sup-1', 'abc');

    // 保存仍在途时用户继续输入新内容
    fireEvent.change(textarea, { target: { value: 'abcd' } });
    await vi.advanceTimersByTimeAsync(0);

    // 旧保存响应返回（成功），但草稿已更新，不得显示「已保存」
    resolveSave(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });
});