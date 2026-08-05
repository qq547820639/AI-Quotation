/**
 * 草稿与自动保存纯逻辑测试（Task 15）
 * 覆盖：状态机（保存中/已保存/失败/离线）、网络恢复、并发冲突检测、模板序列化
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildDraftMeta,
  buildTemplate,
  generateDraftClientId,
  isDraftConflict,
  isValidTemplate,
  nextSaveStatus,
  DRAFT_CONFLICT_MIN_AGE_MS,
  type DraftMeta,
} from '../draft';
import type { InquiryItem } from '@/types';

function makeItem(overrides: Partial<InquiryItem> = {}): InquiryItem {
  return {
    id: 'item-1',
    inquiryId: 'inq-1',
    name: '物料A',
    code: 'MAT001',
    category: '工业电子',
    brand: '',
    spec: '',
    techParams: '',
    unit: '个',
    quantity: 10,
    attachments: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateDraftClientId', () => {
  it('每次生成唯一标识且以 tab- 前缀开头', () => {
    const a = generateDraftClientId();
    const b = generateDraftClientId();
    expect(a).toMatch(/^tab-/);
    expect(a).not.toBe(b);
  });
});

describe('buildDraftMeta', () => {
  it('携带 clientId / editingId 与时间戳', () => {
    const meta = buildDraftMeta('tab-1', 'inq-9');
    expect(meta.clientId).toBe('tab-1');
    expect(meta.editingId).toBe('inq-9');
    expect(typeof meta.updatedAt).toBe('number');
    expect(typeof meta.savedAt).toBe('string');
  });
});

describe('nextSaveStatus（自动保存状态机）', () => {
  it('在线且持久化成功 → saved', () => {
    expect(nextSaveStatus({ online: true, persistOk: true, prev: 'saving' })).toBe('saved');
  });

  it('在线但持久化失败 → failed（自动保存失败）', () => {
    expect(nextSaveStatus({ online: true, persistOk: false, prev: 'saving' })).toBe('failed');
  });

  it('离线 → offline（网络恢复前不谎报已保存）', () => {
    expect(nextSaveStatus({ online: false, persistOk: true, prev: 'saving' })).toBe('offline');
    expect(nextSaveStatus({ online: false, persistOk: false, prev: 'saving' })).toBe('offline');
  });

  it('网络恢复后再次保存成功 → saved（网络恢复场景）', () => {
    // 离线时保存 → offline
    expect(nextSaveStatus({ online: false, persistOk: true, prev: 'saving' })).toBe('offline');
    // 网络恢复 + 持久化成功 → saved
    expect(nextSaveStatus({ online: true, persistOk: true, prev: 'offline' })).toBe('saved');
  });
});

describe('isDraftConflict（并发编辑冲突检测）', () => {
  const mine: DraftMeta = { clientId: 'tab-mine', savedAt: 'x', updatedAt: Date.now() };

  it('另一标签页在最近窗口内写入 → 冲突', () => {
    const remote = { clientId: 'tab-other', savedAt: 'x', updatedAt: Date.now() - 1000 };
    expect(isDraftConflict(remote, mine)).toBe(true);
  });

  it('自己标签页写入 → 不冲突', () => {
    const remote = { clientId: 'tab-mine', savedAt: 'x', updatedAt: Date.now() - 1000 };
    expect(isDraftConflict(remote, mine)).toBe(false);
  });

  it('过旧写入（超出窗口）→ 不冲突', () => {
    const remote = {
      clientId: 'tab-other',
      savedAt: 'x',
      updatedAt: Date.now() - DRAFT_CONFLICT_MIN_AGE_MS - 1000,
    };
    expect(isDraftConflict(remote, mine)).toBe(false);
  });

  it('缺 clientId / 缺 updatedAt → 不冲突', () => {
    expect(isDraftConflict(null, mine)).toBe(false);
    expect(isDraftConflict(undefined, mine)).toBe(false);
    expect(isDraftConflict({ savedAt: 'x' }, mine)).toBe(false);
    expect(isDraftConflict({ clientId: 'tab-other', updatedAt: NaN }, mine)).toBe(false);
  });
});

describe('buildTemplate / isValidTemplate（保存为询价模板）', () => {
  it('构建模板并清空派生 id 字段', () => {
    const template = buildTemplate(' 标准服务器采购 ', '服务器采购', [makeItem()], ['sup-1']);
    expect(template.name).toBe('标准服务器采购'); // trim 后使用
    expect(template.subject).toBe('服务器采购');
    expect(template.items[0].id).toBe('');
    expect(template.items[0].inquiryId).toBe('');
    expect(template.selectedSupplierIds).toEqual(['sup-1']);
    expect(template.createdAt).toBeTruthy();
  });

  it('空名回退为「未命名模板」', () => {
    const template = buildTemplate('   ', '主题', [makeItem()], []);
    expect(template.name).toBe('未命名模板');
  });

  it('isValidTemplate 接受合法模板、拒绝脏数据', () => {
    const valid = buildTemplate('名', '主题', [makeItem()], []);
    expect(isValidTemplate(valid)).toBe(true);
    expect(isValidTemplate({ name: 'x', items: 'not-array' })).toBe(false);
    expect(isValidTemplate(null)).toBe(false);
    expect(isValidTemplate({ name: 'x', items: [{ name: 'a', quantity: 'bad' }] })).toBe(false);
  });
});
