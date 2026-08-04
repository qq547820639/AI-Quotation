/**
 * useIsMobile / useBreakpointState 测试（Task 17）
 * - 不同视口宽度下断点判断正确
 * - isMobile = !md（<768px），isTablet = md && !lg（768~991px），isDesktop = lg（>=992px）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobile, useBreakpointState } from '../useIsMobile';

/** 模拟 antd 响应式断点：根据视口宽度解析 matchMedia 查询 */
function setViewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minMatch = query.match(/\(min-width:\s*(\d+)px\)/);
    const maxMatch = query.match(/\(max-width:\s*(\d+)px\)/);
    let matches = false;
    if (minMatch) matches = width >= Number(minMatch[1]);
    if (maxMatch) matches = width <= Number(maxMatch[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

beforeEach(() => {
  setViewport(375);
});

describe('useIsMobile', () => {
  it('375px 视口（<768px）视为移动端', () => {
    setViewport(375);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('767px 视口仍为移动端', () => {
    setViewport(767);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('768px 视口起为桌面端（非移动端）', () => {
    setViewport(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('1024px 视口为桌面端', () => {
    setViewport(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});

describe('useBreakpointState', () => {
  it('手机视口：isMobile=true, isTablet=false, isDesktop=false', () => {
    setViewport(375);
    const { result } = renderHook(() => useBreakpointState());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(false);
  });

  it('平板视口（768~991px）：isMobile=false, isTablet=true, isDesktop=false', () => {
    setViewport(800);
    const { result } = renderHook(() => useBreakpointState());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(true);
    expect(result.current.isDesktop).toBe(false);
  });

  it('桌面视口（>=992px）：isMobile=false, isTablet=false, isDesktop=true', () => {
    setViewport(1280);
    const { result } = renderHook(() => useBreakpointState());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(true);
  });
});