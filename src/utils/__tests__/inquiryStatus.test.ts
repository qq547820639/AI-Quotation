/**
 * inquiryStatus 工具测试（阶段 1.3）
 */
import { describe, it, expect } from 'vitest';
import { isEditable, isCancelable, isInProgress } from '../inquiryStatus';
import { InquiryStatus } from '@/types';

describe('isEditable', () => {
  it('DRAFT 可编辑', () => {
    expect(isEditable(InquiryStatus.DRAFT)).toBe(true);
  });
  it('PENDING_SEND 可编辑', () => {
    expect(isEditable(InquiryStatus.PENDING_SEND)).toBe(true);
  });
  it('RETURNED 可编辑（驳回后可重新编辑）', () => {
    expect(isEditable(InquiryStatus.RETURNED)).toBe(true);
  });
  it('INQUIRING 不可编辑', () => {
    expect(isEditable(InquiryStatus.INQUIRING)).toBe(false);
  });
  it('COMPLETED 不可编辑', () => {
    expect(isEditable(InquiryStatus.COMPLETED)).toBe(false);
  });
  it('CANCELLED 不可编辑', () => {
    expect(isEditable(InquiryStatus.CANCELLED)).toBe(false);
  });
});

describe('isCancelable', () => {
  it('DRAFT 不可取消', () => {
    expect(isCancelable(InquiryStatus.DRAFT)).toBe(false);
  });
  it('COMPLETED 不可取消', () => {
    expect(isCancelable(InquiryStatus.COMPLETED)).toBe(false);
  });
  it('CANCELLED 不可取消', () => {
    expect(isCancelable(InquiryStatus.CANCELLED)).toBe(false);
  });
  it('INQUIRING 可取消', () => {
    expect(isCancelable(InquiryStatus.INQUIRING)).toBe(true);
  });
  it('PENDING_CONFIRM 可取消', () => {
    expect(isCancelable(InquiryStatus.PENDING_CONFIRM)).toBe(true);
  });
  it('PENDING_APPROVAL 可取消', () => {
    expect(isCancelable(InquiryStatus.PENDING_APPROVAL)).toBe(true);
  });
});

describe('isInProgress', () => {
  it('INQUIRING 进行中', () => {
    expect(isInProgress(InquiryStatus.INQUIRING)).toBe(true);
  });
  it('PARTIAL_QUOTED 进行中', () => {
    expect(isInProgress(InquiryStatus.PARTIAL_QUOTED)).toBe(true);
  });
  it('ALL_QUOTED 进行中', () => {
    expect(isInProgress(InquiryStatus.ALL_QUOTED)).toBe(true);
  });
  it('DRAFT 不在进行中', () => {
    expect(isInProgress(InquiryStatus.DRAFT)).toBe(false);
  });
  it('COMPLETED 不在进行中', () => {
    expect(isInProgress(InquiryStatus.COMPLETED)).toBe(false);
  });
  it('PENDING_APPROVAL 不在进行中', () => {
    expect(isInProgress(InquiryStatus.PENDING_APPROVAL)).toBe(false);
  });
});
