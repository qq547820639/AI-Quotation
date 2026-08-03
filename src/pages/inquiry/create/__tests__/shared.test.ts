import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import {
  computeSupplierMatches,
  buildInquiryCode,
  serializeBasicInfo,
  deserializeBasicInfo,
  categoryMatch,
  normalizeCategory,
  cloneItem,
  formatBytes,
} from '../shared';
import {
  CooperationStatus,
  Currency,
  SupplierLevel,
  type Supplier,
} from '@/types';

function makeSupplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    code: 'SUP001',
    name: '供应商A',
    region: '华东',
    contact: '张三',
    phone: '13800000000',
    email: 'a@test.com',
    mainCategories: ['工业电子'],
    level: SupplierLevel.STRATEGIC,
    cooperationStatus: CooperationStatus.COOPERATING,
    qualified: true,
    historyResponseRate: 0.9,
    historyFulfillmentRate: 1,
    avgDeliveryDays: 10,
    historyCoopCount: 5,
    ...overrides,
  };
}

describe('categoryMatch', () => {
  it('品类命中返回 true', () => {
    expect(categoryMatch('工业电子', ['工业电子', '五金件'])).toBe(true);
  });
  it('别名命中返回 true', () => {
    expect(categoryMatch('工业电子', ['电子设备'])).toBe(true);
  });
  it('品类不命中返回 false', () => {
    expect(categoryMatch('五金件', ['工业电子'])).toBe(false);
  });
  it('空品类返回 false', () => {
    expect(categoryMatch('', ['工业电子'])).toBe(false);
  });
});

describe('normalizeCategory', () => {
  it('别名归一化为标准品类', () => {
    expect(normalizeCategory('电子设备')).toBe('工业电子');
    expect(normalizeCategory('包装材料')).toBe('包材');
  });
  it('已是标准品类原样返回', () => {
    expect(normalizeCategory('五金件')).toBe('五金件');
  });
  it('未知品类原样返回', () => {
    expect(normalizeCategory('未知品类')).toBe('未知品类');
  });
  it('空值返回空', () => {
    expect(normalizeCategory('')).toBe('');
  });
});

describe('computeSupplierMatches', () => {
  it('品类命中 + 合格 + 响应率 + 合作次数 综合评分', () => {
    const sup = makeSupplier({
      historyResponseRate: 0.9,
      historyCoopCount: 5,
      qualified: true,
      cooperationStatus: CooperationStatus.COOPERATING,
    });
    const matches = computeSupplierMatches([sup], ['工业电子']);
    expect(matches).toHaveLength(1);
    // 40(品类) + 20(合格) + 18(响应率0.9*20) + 5(合作次数min(5,20)) = 83
    expect(matches[0].matchScore).toBe(83);
    expect(matches[0].disabled).toBe(false);
  });

  it('按 matchScore 降序排序', () => {
    const supHigh = makeSupplier({ id: 'sup-high', historyResponseRate: 1, historyCoopCount: 20 });
    const supLow = makeSupplier({
      id: 'sup-low',
      mainCategories: ['五金件'],
      historyResponseRate: 0.1,
      historyCoopCount: 0,
    });
    const matches = computeSupplierMatches([supLow, supHigh], ['工业电子']);
    expect(matches[0].supplier.id).toBe('sup-high');
    expect(matches[1].supplier.id).toBe('sup-low');
  });

  it('DISABLED 供应商标记禁用', () => {
    const sup = makeSupplier({ cooperationStatus: CooperationStatus.DISABLED });
    const matches = computeSupplierMatches([sup], ['工业电子']);
    expect(matches[0].disabled).toBe(true);
    expect(matches[0].disabledReason).toBe('供应商已停用');
  });

  it('BLACKLIST 供应商标记禁用', () => {
    const sup = makeSupplier({ cooperationStatus: CooperationStatus.BLACKLIST });
    const matches = computeSupplierMatches([sup], ['工业电子']);
    expect(matches[0].disabled).toBe(true);
    expect(matches[0].disabledReason).toContain('黑名单');
  });

  it('评分不超过 100', () => {
    const sup = makeSupplier({
      historyResponseRate: 1,
      historyCoopCount: 100,
      qualified: true,
    });
    const matches = computeSupplierMatches([sup], ['工业电子']);
    expect(matches[0].matchScore).toBeLessThanOrEqual(100);
  });
});

describe('buildInquiryCode', () => {
  it('格式为 INQ + 8位日期 + 3位序号', () => {
    const code = buildInquiryCode();
    expect(code).toMatch(/^INQ\d{8}\d{3}$/);
    expect(code.startsWith(`INQ${dayjs().format('YYYYMMDD')}`)).toBe(true);
  });
});

describe('serializeBasicInfo / deserializeBasicInfo', () => {
  it('Dayjs 与字符串互转往返', () => {
    const form = {
      subject: '测试',
      organization: '总部',
      ownerName: '采购员',
      currency: Currency.CNY,
      deadline: dayjs('2026-08-10 18:00:00'),
      expectedDeliveryDate: dayjs('2026-08-15'),
      deliveryAddress: '上海',
      contact: '李四',
      paymentTerms: '款到发货',
      attachments: [],
    };
    const serialized = serializeBasicInfo(form);
    expect(typeof serialized.deadline).toBe('string');
    expect(serialized.deadline).toBe('2026-08-10 18:00:00');
    expect(serialized.expectedDeliveryDate).toBe('2026-08-15');

    const deserialized = deserializeBasicInfo(serialized);
    expect(dayjs.isDayjs(deserialized.deadline)).toBe(true);
    expect(dayjs.isDayjs(deserialized.expectedDeliveryDate)).toBe(true);
    expect(deserialized.subject).toBe('测试');
  });

  it('空日期序列化为 null', () => {
    const form = {
      subject: '测试',
      organization: '总部',
      ownerName: '采购员',
      currency: Currency.CNY,
      deadline: null,
      expectedDeliveryDate: null,
      deliveryAddress: '上海',
      contact: '李四',
      paymentTerms: '款到发货',
      attachments: [],
    };
    const serialized = serializeBasicInfo(form);
    expect(serialized.deadline).toBeNull();
    expect(serialized.expectedDeliveryDate).toBeNull();

    const deserialized = deserializeBasicInfo(serialized);
    expect(deserialized.deadline).toBeNull();
    expect(deserialized.expectedDeliveryDate).toBeNull();
  });
});

describe('cloneItem', () => {
  it('深拷贝并重置 id', () => {
    const item = {
      id: 'old-id',
      inquiryId: 'inq-1',
      name: '物料A',
      code: 'MAT001',
      category: '工业电子',
      brand: '',
      spec: '',
      techParams: '',
      unit: '个',
      quantity: 10,
      attachments: [{ id: 'att-1', name: 'a.pdf', url: 'x', size: 100, uploadTime: 'now' }],
    };
    const cloned = cloneItem(item, 'inq-2', 0);
    expect(cloned.id).not.toBe('old-id');
    expect(cloned.inquiryId).toBe('inq-2');
    expect(cloned.name).toBe('物料A');
    expect(cloned.attachments[0].id).toBe('att-1'); // 内部仍拷贝
    expect(cloned.attachments).not.toBe(item.attachments); // 不同引用
  });
});

describe('formatBytes', () => {
  it('0 返回 -', () => {
    expect(formatBytes(0)).toBe('-');
  });
  it('小于 1KB 返回 B', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
  it('KB 量级', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
  it('MB 量级', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
  });
});
