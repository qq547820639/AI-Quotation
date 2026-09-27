/**
 * R64-c：报价列表的并发响应必须有先后之见。
 * 存在理由（一手取证，不靠猜）：后端访问日志显示一个 core-flow 周期内
 * `GET /api/quotations` 被轮询约 9 次、与两次 `POST .../submit` 交错
 * （窗口内 20 submit : 96 list）。多个请求同时在飞时，响应落地顺序不保证等于发起顺序；
 * 没有序号保护，一个在提交之前发出的请求只要返回得晚，就会把已含新报价的 store 覆盖回旧快照，
 * 而 loaded=true、loadError=false 会让 R30/R33 的守卫全部放行 ⇒ 页面诚实渲染"暂无已提交报价"。
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';

const list = vi.fn();
vi.mock('@/api', () => ({
  quotationApi: {
    list: (...a: unknown[]) => list(...a),
    submit: vi.fn(),
    saveDraft: vi.fn(),
    create: vi.fn(),
  },
  inquiryApi: { list: vi.fn().mockResolvedValue([]) },
}));

import { useQuotationStore } from '@/store/useQuotationStore';

const q = (id: string, inquiryId: string) => ({ id, inquiryId }) as never;

const pristine = () => {
  const s = useQuotationStore.getState();
  return { loaded: s.loaded, loading: s.loading, loadError: s.loadError };
};
let before: ReturnType<typeof pristine>;

beforeEach(() => {
  list.mockReset();
  before = pristine();
});
afterEach(() => useQuotationStore.setState(before));

/** 两个请求同时在飞：先发起的后返回。store 必须以"后发起"的那份为准。 */
it('旧请求晚到不得覆盖新数据（R64-c 的核心）', async () => {
  let resolveA: (v: unknown) => void = () => {};
  let resolveB: (v: unknown) => void = () => {};
  list.mockImplementationOnce(() => new Promise((r) => (resolveA = r))); // 先发起，但我们会让它最后落地
  list.mockImplementationOnce(() => new Promise((r) => (resolveB = r)));

  const a = useQuotationStore.getState().loadFromApi();
  const b = useQuotationStore.getState().loadFromApi();

  resolveB([q('new', 'inq-1')]); // 新请求先返回
  await b;
  expect(useQuotationStore.getState().quotations.map((x) => x.id)).toEqual(['new']);

  resolveA([q('stale', 'inq-1')]); // 旧请求后返回
  await a;
  expect(useQuotationStore.getState().quotations.map((x) => x.id)).toEqual(['new']);
});

/** 反向对照：最新一次请求失败时仍要落 loadError，不能被"丢弃旧响应"顺手吞成静默成功 */
it('最新请求失败仍走 loadError 三态（丢弃逻辑不得变成静默吞错）', async () => {
  list.mockRejectedValueOnce(new Error('boom'));
  await useQuotationStore.getState().loadFromApi();
  const s = useQuotationStore.getState();
  expect(s.loadError).toBe(true);
  expect(s.loaded).toBe(true);
  expect(s.loading).toBe(false);
});

/** 不开火对照：单独一次请求正常返回，必须照写（防"永远丢弃"也能让上面两格绿） */
it('单发请求正常返回仍写入 store', async () => {
  list.mockResolvedValueOnce([q('solo', 'inq-1')]);
  await useQuotationStore.getState().loadFromApi();
  expect(useQuotationStore.getState().quotations.map((x) => x.id)).toEqual(['solo']);
  expect(useQuotationStore.getState().loadError).toBe(false);
});
