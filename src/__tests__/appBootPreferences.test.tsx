/**
 * R61：应用启动必须把"每用户通知偏好"从服务端取回来。
 *
 * 这条用例量的不是 loadPreferences 本身（它一直能用），而是**它有没有被接上**：
 * 过去全仓零调用点，通知偏好页显示的永远是前端 DEFAULT_PREFERENCES，
 * 服务端里存着的值没人读 ⇒ 用户刷新后看到的开关与库里存的是两回事。
 *
 * '@/api' 用 Proxy 打桩：store 的 bootstrap 会碰十几个 API 组，
 * 逐个手写 mock 会在下一个组被消费时静默失效，Proxy 让"任何组任何方法被调用"都可断言。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => [] as string[]);
const PREF_MARKER = {
  deadlineReminder: false,
  deadlineReminderHours: 6,
  quotationSubmitted: false,
  approvalResult: false,
  inquirySent: false,
};

vi.mock('@/api', () => {
  const fn = (name: string) => async () => {
    calls.push(name);
    return name.endsWith('.getPreferences') ? PREF_MARKER : [];
  };
  const group = (g: string) =>
    new Proxy({}, { get: (_t, m: string) => fn(`${g}.${m}`), set: () => true });
  return {
    __esModule: true,
    inquiryApi: group('inquiryApi'),
    supplierApi: group('supplierApi'),
    quotationApi: group('quotationApi'),
    materialApi: group('materialApi'),
    notificationApi: group('notificationApi'),
    approvalApi: group('approvalApi'),
    aiApi: group('aiApi'),
    logApi: group('logApi'),
  };
});
vi.mock('@/router', async () => {
  const { createMemoryRouter } = await import('react-router-dom');
  return { appRouter: createMemoryRouter([{ path: '*', element: <div /> }]) };
});
vi.mock('@/utils/deadlineWatcher', () => ({ startDeadlineWatcher: vi.fn() }));

import App from '@/App';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotificationStore } from '@/store/useNotificationStore';

const pristine = {
  auth: useAuthStore.getState().isAuthenticated,
  prefs: useNotificationStore.getState().preferences,
};

beforeEach(() => (calls.length = 0));

afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: pristine.auth });
  useNotificationStore.setState({ preferences: pristine.prefs });
});

describe('启动时同步每用户通知偏好', () => {
  it('已鉴权挂载 App ⇒ 调 notificationApi.getPreferences，并把服务端的值放进 store', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<App />);
    await waitFor(() => expect(calls).toContain('notificationApi.getPreferences'));
    await waitFor(() => expect(useNotificationStore.getState().preferences).toEqual(PREF_MARKER));
  });

  it('对照组：未鉴权时不发这个请求（登录页不引导业务数据，R20 的既有规矩）', async () => {
    useAuthStore.setState({ isAuthenticated: false });
    render(<App />);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).not.toContain('notificationApi.getPreferences');
  });
});
