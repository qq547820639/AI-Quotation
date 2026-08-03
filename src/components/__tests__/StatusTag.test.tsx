/**
 * StatusTag 组件测试（阶段 H）
 * 覆盖 InquiryStatusTag / QuotationStatusTag / SupplierLevelTag / CooperationStatusTag
 * 的文本渲染与颜色 class
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  InquiryStatusTag,
  QuotationStatusTag,
  SupplierLevelTag,
  CooperationStatusTag,
} from '../StatusTag';
import {
  CooperationStatus,
  InquiryStatus,
  QuotationStatus,
  SupplierLevel,
} from '@/types';

beforeAll(async () => {
  // 确保 i18n 完全就绪（资源内联，同步即就绪）
  await i18n.changeLanguage('zh-CN');
});

/** 包裹 I18nextProvider 渲染 */
function renderWithI18n(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('InquiryStatusTag', () => {
  it('渲染 DRAFT 状态文本「草稿」', () => {
    renderWithI18n(<InquiryStatusTag status={InquiryStatus.DRAFT} />);
    expect(screen.getByText('草稿')).toBeInTheDocument();
  });

  it('渲染 INQUIRING 状态文本「询价中」并应用 processing 颜色', () => {
    const { container } = renderWithI18n(<InquiryStatusTag status={InquiryStatus.INQUIRING} />);
    expect(screen.getByText('询价中')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-processing');
  });

  it('渲染 COMPLETED 状态文本「已完成」并应用 green 颜色', () => {
    const { container } = renderWithI18n(<InquiryStatusTag status={InquiryStatus.COMPLETED} />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-green');
  });

  it('渲染 CANCELLED 状态文本「已取消」', () => {
    renderWithI18n(<InquiryStatusTag status={InquiryStatus.CANCELLED} />);
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });
});

describe('QuotationStatusTag', () => {
  it('渲染 DRAFT「暂存」', () => {
    renderWithI18n(<QuotationStatusTag status={QuotationStatus.DRAFT} />);
    expect(screen.getByText('暂存')).toBeInTheDocument();
  });

  it('渲染 SUBMITTED「已提交」并应用 success 颜色', () => {
    const { container } = renderWithI18n(<QuotationStatusTag status={QuotationStatus.SUBMITTED} />);
    expect(screen.getByText('已提交')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-success');
  });

  it('渲染 TIMEOUT「已超时」并应用 error 颜色', () => {
    const { container } = renderWithI18n(<QuotationStatusTag status={QuotationStatus.TIMEOUT} />);
    expect(screen.getByText('已超时')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-error');
  });
});

describe('SupplierLevelTag', () => {
  it('渲染 STRATEGIC「战略」并应用 gold 颜色', () => {
    const { container } = renderWithI18n(<SupplierLevelTag level={SupplierLevel.STRATEGIC} />);
    expect(screen.getByText('战略')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-gold');
  });

  it('渲染 PREMIUM「优质」并应用 purple 颜色', () => {
    const { container } = renderWithI18n(<SupplierLevelTag level={SupplierLevel.PREMIUM} />);
    expect(screen.getByText('优质')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-purple');
  });

  it('渲染 QUALIFIED「合格」并应用 blue 颜色', () => {
    const { container } = renderWithI18n(<SupplierLevelTag level={SupplierLevel.QUALIFIED} />);
    expect(screen.getByText('合格')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-blue');
  });

  it('渲染 PENDING「待评估」', () => {
    renderWithI18n(<SupplierLevelTag level={SupplierLevel.PENDING} />);
    expect(screen.getByText('待评估')).toBeInTheDocument();
  });
});

describe('CooperationStatusTag', () => {
  it('渲染 COOPERATING「合作中」并应用 success 颜色', () => {
    const { container } = renderWithI18n(
      <CooperationStatusTag status={CooperationStatus.COOPERATING} />,
    );
    expect(screen.getByText('合作中')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-success');
  });

  it('渲染 QUALIFIED「合格」并应用 blue 颜色', () => {
    const { container } = renderWithI18n(
      <CooperationStatusTag status={CooperationStatus.QUALIFIED} />,
    );
    expect(screen.getByText('合格')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-blue');
  });

  it('渲染 DISABLED「停用」', () => {
    renderWithI18n(<CooperationStatusTag status={CooperationStatus.DISABLED} />);
    expect(screen.getByText('停用')).toBeInTheDocument();
  });

  it('渲染 BLACKLIST「黑名单」并应用 error 颜色', () => {
    const { container } = renderWithI18n(
      <CooperationStatusTag status={CooperationStatus.BLACKLIST} />,
    );
    expect(screen.getByText('黑名单')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')?.className).toContain('ant-tag-error');
  });
});
