/**
 * 通知设置页「写入失败时开关该停在哪」的行为测试（R37 前置取证）。
 *
 * 为什么要有这个文件：登记册 R35 那一轮我写下过一条行为断言——
 * 「设置写失败时 Switch 停在用户刚拨的位置（不是弹错，是界面与后端不一致）」——
 * 但**从未实测**，只是从 antd 受控组件的推断来的。本轮把它变成可判定的断言：
 * 若失败后开关回到原位，则那条断言不成立（只是"点了没反应"），应当撤回；
 * 若停在用户拨过的位置，则断言成立，本页需要补成功/回滚语义。
 *
 * 两条极性都是必需的（缺席类断言的 locator 若根本不匹配，会以 "element(s) not found"
 * 失败而不是通过）：
 *   正向：API 成功时开关**必须**换到用户拨过的位置 ⇒ 证明这个 locator 是活的、断言不是空转；
 *   反向：API 失败时开关**应当**留在原位置 ⇒ 这才是被断言的那条"应然"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { message } from 'antd';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import NotificationPage from '../index';
import { useNotificationStore } from '@/store/useNotificationStore';
import { notificationApi } from '@/api/notificationApi';
import type { UserNotificationPreferencesSchema } from '@/types';

vi.mock('@/api/notificationApi', () => ({
  notificationApi: {
    list: vi.fn().mockResolvedValue([]),
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

const mockedApi = vi.mocked(notificationApi);

/**
 * 取设置卡片里的开关。刻意**不**按"第 N 个 = 某个 key"来绑：
 * `preferenceItems` 的渲染顺序是页面实现细节，一旦按索引绑 key，
 * 顺序变了用例会静默地测到别的 key（第一版就是这么把 `inquirySent` 误当成 `deadlineReminder`，
 * 于是"点之前应当是 true"这条前提断言直接读到 false）。
 * 下面的夹具把**四个布尔偏好全部置 true**，因此任一开关的初值都是 'true'，
 * store 侧也按"没有任何布尔位被改成 false"来判，整体与顺序无关。
 */
function firstSwitch(): HTMLElement {
  const el = document.querySelector('.ant-switch') as HTMLElement | null;
  if (!el) throw new Error('没找到 Switch：这条断言的 locator 失效了，不能用"没报错"当通过');
  return el;
}

const ALL_TRUE: UserNotificationPreferencesSchema = {
  inquirySent: true,
  quotationSubmitted: true,
  deadlineReminder: true,
  approvalResult: true,
  deadlineReminderHours: 24,
};

/** 当前所有布尔偏好位（与顺序无关） */
function boolPrefs(): boolean[] {
  const p = useNotificationStore.getState().preferences;
  return Object.values(p).filter((v): v is boolean => typeof v === 'boolean');
}

describe('通知设置页：偏好写入的结果态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // antd 的 message 挂在 document.body 的全局 portal 上，不随组件卸载消失，
    // 也不被 testing-library 的 auto-cleanup 管到 ⇒ 上一条用例留下的错误提示会冒充
    // 本条的断言（实测：不销毁时"成功路径不得有错误提示"读到 3 个残留节点）。
    message.destroy();
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
      preferences: ALL_TRUE,
    });
    i18n.language = 'zh-CN';
  });

  it('正向对照：API 成功后开关确实换到用户拨过的位置（证明 locator 是活的）', async () => {
    // 让 mock 像真服务端那样"回显收到的那份偏好"，而不是硬编一份全 false 的假响应
    mockedApi.updatePreferences.mockImplementation(async (data) => ({ ...ALL_TRUE, ...data }));
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotificationPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    const sw = firstSwitch();
    expect(sw.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(sw);
    await waitFor(() => expect(mockedApi.updatePreferences).toHaveBeenCalledTimes(1));

    // 成功路径必须落地：store 里确实有一位被关掉，且 DOM 也跟着变
    expect(boolPrefs().includes(false), '成功写入后 store 里一位都没变 ⇒ 断的是空转').toBe(true);
    await waitFor(() => expect(firstSwitch().getAttribute('aria-checked')).toBe('false'));
  });

  it('反向（应然）：API 失败后开关不得停在用户刚拨的位置，也不得让 store 承认新值', async () => {
    mockedApi.updatePreferences.mockRejectedValue(new Error('boom'));
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotificationPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    const sw = firstSwitch();
    expect(sw.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(sw);
    await waitFor(() => expect(mockedApi.updatePreferences).toHaveBeenCalledTimes(1));
    // 给异步链路（reject → store 的 catch → 可能的重渲染）一个落定机会
    await waitFor(() => {
      expect(
        boolPrefs().includes(false),
        '写入失败却有一位被记成 false ⇒ store 承认了没落地的写',
      ).toBe(false);
    });

    // 被断言的那条"应然"：界面不能宣称已经关掉
    expect(
      firstSwitch().getAttribute('aria-checked'),
      '写入失败后开关仍显示为"用户拨过的新位置" ⇒ 界面在对用户说谎（与后端不一致）',
    ).toBe('true');
  });

  it('反向的副作用：失败时既不伪造成功提示，也不静默吞掉', async () => {
    mockedApi.updatePreferences.mockRejectedValue(new Error('boom'));
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotificationPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    fireEvent.click(firstSwitch());
    await waitFor(() => expect(mockedApi.updatePreferences).toHaveBeenCalledTimes(1));
    // 这一条只钉"不得伪造成功"这一条下界。失败到底该怎么提示（toast / 回滚 / 保留拨动）
    // 属于本页的统一成功/回滚语义，是另一件事，不在本用例的断言面里。
    expect(document.querySelectorAll('.ant-message-success').length).toBe(0);
  });

  it('R43：写入失败必须可见——失败后出现指名文案的错误提示', async () => {
    mockedApi.updatePreferences.mockRejectedValue(new Error('boom'));
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotificationPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    fireEvent.click(firstSwitch());
    await waitFor(() => expect(mockedApi.updatePreferences).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(document.querySelectorAll('.ant-message-error').length).toBeGreaterThan(0),
    );
    // 文案也要指名：只断 `.ant-message-error` 存在，会被同页别的错误提示冒充（R34 同一形状）
    expect(document.querySelector('.ant-message-error')?.textContent).toContain('boom');
  });

  it('R43：异常没有原因文本时也要有可读提示，不得弹空气泡', async () => {
    mockedApi.updatePreferences.mockRejectedValue(new Error('   '));
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotificationPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    fireEvent.click(firstSwitch());
    await waitFor(() => expect(mockedApi.updatePreferences).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(document.querySelectorAll('.ant-message-error').length).toBeGreaterThan(0),
    );
    const text = document.querySelector('.ant-message-error')?.textContent ?? '';
    // 这条钉的是"提示非空"这个下界：原因空白时退回通用文案（用 `??` 会漏过 ''）。
    // 刻意不断具体是哪一句 —— 具体文案由服务端原因决定，写死会让用例替实现背书。
    expect(text.trim().length, `提示是空气泡："${text}"`).toBeGreaterThan(0);
  });

  it('R43 反向：成功路径不得留下错误提示（否则上一条可以是空转）', async () => {
    mockedApi.updatePreferences.mockImplementation(async (data) => ({ ...ALL_TRUE, ...data }));
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <NotificationPage />
        </I18nextProvider>
      </MemoryRouter>,
    );
    fireEvent.click(firstSwitch());
    await waitFor(() => expect(mockedApi.updatePreferences).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(firstSwitch().getAttribute('aria-checked')).toBe('false'));
    expect(document.querySelectorAll('.ant-message-error').length).toBe(0);
  });
});
