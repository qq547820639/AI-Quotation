/**
 * 设置的"上行 / 下行"两条同步通道（R49→R57 续）
 *
 * 这一片存在的理由：设置页过去把 systemName / currency / deadlineLeadDays 只写进 localStorage，
 * 却与真入库的两张卡共用一句"设置已保存"。现在这三项进服务端，必须两头都有常驻用例：
 *   上行 = updateSettings 发的 body 里真的带上了 store 当时的值（而不是默认值巧合）；
 *   下行 = loadFromApi 把服务端的值读进来并落回 localStorage，且币种过白名单。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('@/api/settingsApi', () => ({ settingsApi: api }));

import { useSettingsStore } from '@/store/useSettingsStore';
import { Currency } from '@/types';
import { loadJSON } from '@/utils/storage';

const REMOTE_FULL = {
  approval: { enabled: true, amountThreshold: 50000, approverId: 'u-2' },
  notification: {
    deadlineReminder: true,
    deadlineReminderHours: 24,
    quotationSubmitted: true,
    approvalResult: true,
  },
  ai: {
    provider: 'local',
    baseUrl: '',
    model: '',
    apiKey: '',
    hasApiKey: false,
    structuredOutput: true,
  },
  basic: { systemName: '服务端名称', currency: 'EUR', deadlineLeadDays: 11 },
};

const snapshot = () => {
  const s = useSettingsStore.getState();
  return {
    systemName: s.systemName,
    currency: s.currency,
    deadlineLeadDays: s.deadlineLeadDays,
    approval: s.approval,
    ai: s.ai,
  };
};

beforeEach(() => {
  api.get.mockReset();
  api.update.mockReset();
});

afterEach(() => {
  useSettingsStore.setState(snapshot());
});

describe('上行：toAppSettings 必须带上三项', () => {
  it('保存时 body.basic 用的是 store 当时的值，不是默认值', async () => {
    useSettingsStore.setState({
      systemName: '华东采购询价台',
      currency: Currency.USD,
      deadlineLeadDays: 7,
    });
    api.update.mockResolvedValue(REMOTE_FULL);
    const r = await useSettingsStore.getState().updateSettings({});
    expect(r.success).toBe(true);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update.mock.calls[0][0]).toMatchObject({
      basic: { systemName: '华东采购询价台', currency: 'USD', deadlineLeadDays: 7 },
    });
  });

  it('零读者的字段不得混进上行体（organization / validDays / todoReminder）', async () => {
    api.update.mockResolvedValue(REMOTE_FULL);
    await useSettingsStore.getState().updateSettings({});
    const body = api.update.mock.calls[0][0] as Record<string, unknown>;
    const flat = JSON.stringify(body);
    for (const forbidden of ['organization', 'validDays', 'todoReminder']) {
      expect(flat).not.toContain(`"${forbidden}"`);
    }
    // 非恒真对照：body 确实不是空的，否则上面三条"不含"是白捡的
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['approval', 'notification', 'ai', 'basic']),
    );
  });
});

describe('下行：loadFromApi 以服务端为权威', () => {
  it('服务端的三项覆盖本地，并同步落进 localStorage 镜像', async () => {
    useSettingsStore.setState({
      systemName: '本地旧名',
      currency: Currency.CNY,
      deadlineLeadDays: 1,
    });
    api.get.mockResolvedValue(REMOTE_FULL);
    await useSettingsStore.getState().loadFromApi();
    const s = useSettingsStore.getState();
    expect([s.systemName, s.currency, s.deadlineLeadDays]).toEqual([
      '服务端名称',
      Currency.EUR,
      11,
    ]);
    expect(loadJSON('settings', null)).toMatchObject({
      systemName: '服务端名称',
      deadlineLeadDays: 11,
    });
  });

  it('白名单：合法币种照收，非法币种退回默认（两档同测，防"什么都没应用"冒充"拒绝了"）', async () => {
    // 合规侧：先证明这条通道本身是通的
    api.get.mockResolvedValue({ ...REMOTE_FULL, basic: { ...REMOTE_FULL.basic, currency: 'USD' } });
    await useSettingsStore.getState().loadFromApi();
    expect(useSettingsStore.getState().currency).toBe(Currency.USD);

    // 违例侧：RUB 不在前端枚举里，不能被原样拿去渲染
    api.get.mockResolvedValue({ ...REMOTE_FULL, basic: { ...REMOTE_FULL.basic, currency: 'RUB' } });
    await useSettingsStore.getState().loadFromApi();
    expect(useSettingsStore.getState().currency).toBe(Currency.CNY);
  });

  it('降级：API 失败时保留本地值（不把 store 洗成 undefined）', async () => {
    useSettingsStore.setState({ systemName: '仅本机改过', deadlineLeadDays: 5 });
    api.get.mockRejectedValue(new Error('offline'));
    await useSettingsStore.getState().loadFromApi();
    const s = useSettingsStore.getState();
    expect(s.systemName).toBe('仅本机改过');
    expect(s.deadlineLeadDays).toBe(5);
  });
});
