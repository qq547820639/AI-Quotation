/**
 * 报价对比页「可对比询价单」选择器（无 inquiryId 时的首屏）契约测试
 * 存在理由：E2E 侧此前只断言 `.ant-table` 或 `.ant-empty`，而这个组件有报价时渲染的是
 * 卡片网格（既无表格也无空状态），后端报价状态机修好后该断言即失效。
 * 这里把两条分支（空 / 有卡片）与点击、键盘进入对比视图的契约钉住。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { Currency, InquiryStatus, type Inquiry } from '@/types';
import { inDays } from '@/test/temporalFixtures';
import CompareInquiryPicker from '../CompareInquiryPicker';

function makeInquiry(overrides: Partial<Inquiry> = {}): Inquiry {
  return {
    id: 'inq-1',
    code: 'INQ20260901001',
    subject: '服务器采购询价',
    organization: '总部采购中心',
    ownerName: '周大海',
    ownerId: 'u-1',
    currency: Currency.CNY,
    deadline: inDays(30),
    deliveryAddress: '上海',
    contact: '李四',
    paymentTerms: '款到发货',
    attachments: [],
    items: [],
    invitedSupplierIds: ['sup-1', 'sup-2'],
    quotations: [],
    logs: [],
    status: InquiryStatus.ALL_QUOTED,
    createdById: 'u-1',
    createdByName: '周大海',
    createdAt: '2026-09-01 10:00:00',
    updatedAt: '2026-09-01 10:00:00',
    selectedSupplierMap: {},
    purchaserComments: {},
    approvalNodes: [],
    ...overrides,
  };
}

function renderPicker(props: Partial<ComponentProps<typeof CompareInquiryPicker>> = {}) {
  const onOpen = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <CompareInquiryPicker
        inquiries={props.inquiries ?? []}
        getQuotationsByInquiry={props.getQuotationsByInquiry ?? (() => [])}
        onOpen={props.onOpen ?? onOpen}
      />
    </I18nextProvider>,
  );
  return { onOpen };
}

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

beforeEach(() => {
  // antd 响应式组件（Row/Col）依赖 matchMedia
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe('CompareInquiryPicker', () => {
  it('无可对比询价单时展示空状态', () => {
    renderPicker({ inquiries: [] });
    expect(screen.getByText(i18n.t('quotation.compare.noComparable'))).toBeInTheDocument();
  });

  it('有可对比询价单时按卡片列出（不渲染表格），点击进入对比视图', () => {
    const { onOpen } = renderPicker({ inquiries: [makeInquiry()] });
    expect(document.querySelector('.ant-empty')).toBeNull();
    const card = document.querySelector('.ant-card[role="button"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('服务器采购询价');
    expect(card.textContent).toContain('INQ20260901001');
    // 报价回收数 / 受邀数
    expect(card.textContent).toContain('0 / 2');
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith('inq-1');
  });

  it('卡片支持键盘 Enter 进入，且 aria-label 含询价主题', () => {
    const { onOpen } = renderPicker({ inquiries: [makeInquiry()] });
    const card = document.querySelector('.ant-card[role="button"]') as HTMLElement;
    expect(card.getAttribute('aria-label')).toContain('服务器采购询价');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('inq-1');
  });

  it('已提交报价数只统计 SUBMITTED 状态', () => {
    renderPicker({
      inquiries: [makeInquiry()],
      getQuotationsByInquiry: () => [{ status: 'SUBMITTED' }, { status: 'DRAFT' }] as never,
    });
    const card = document.querySelector('.ant-card[role="button"]') as HTMLElement;
    expect(card.textContent).toContain('1 / 2');
  });
});
