/**
 * 新建询价单默认值（defaultBasicInfo）与系统设置的联动
 * - 币种默认值取「系统设置 → 默认币种」，不是写死的 CNY
 * - 设置项必须在调用时刻读取：模块加载时的快照会让设置页改过的值永远进不来回填
 */
import { describe, it, expect, afterEach } from 'vitest';
import dayjs from 'dayjs';
import { defaultBasicInfo } from '../shared';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Currency } from '@/types';

// jsdom 每个测试文件都是全新的 localStorage，故此处读到的就是 store 的 DEFAULTS
// （useSettingsStore.ts:61-81）。用例跑完按它回滚，避免污染同文件里的其他断言。
const PRISTINE = {
  currency: useSettingsStore.getState().currency,
  deadlineLeadDays: useSettingsStore.getState().deadlineLeadDays,
};

afterEach(() => {
  useSettingsStore.setState(PRISTINE);
});

describe('默认币种来自系统设置', () => {
  it('设置成 USD 后，新建询价单默认就是 USD', () => {
    useSettingsStore.setState({ currency: Currency.USD });
    expect(defaultBasicInfo().currency).toBe(Currency.USD);
  });

  it('设置成 EUR 同样透传（不是只认某一个币种）', () => {
    useSettingsStore.setState({ currency: Currency.EUR });
    expect(defaultBasicInfo().currency).toBe(Currency.EUR);
  });

  it('对照组：未配置时默认仍是 CNY', () => {
    expect(PRISTINE.currency, '夹具被污染，对照组失去意义').toBe(Currency.CNY);
    expect(defaultBasicInfo().currency).toBe(Currency.CNY);
  });

  it('每次调用都重读 store：中途改设置即改默认值', () => {
    useSettingsStore.setState({ currency: Currency.EUR });
    const first = defaultBasicInfo().currency;
    useSettingsStore.setState({ currency: Currency.USD });
    const second = defaultBasicInfo().currency;
    expect([first, second]).toEqual([Currency.EUR, Currency.USD]);
  });
});

describe('报价截止时间仍取 deadlineLeadDays', () => {
  it('设置 10 天 ⇒ 默认截止约为 10 天后', () => {
    useSettingsStore.setState({ deadlineLeadDays: 10 });
    const before = dayjs();
    const { deadline } = defaultBasicInfo();
    expect(deadline?.diff(before, 'day')).toBe(10);
  });
});
