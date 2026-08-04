import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as axeMatchers from 'vitest-axe/matchers';
import 'vitest-axe/extend-expect';

// 注册 vitest-axe 的 toHaveNoViolations 匹配器
expect.extend(axeMatchers);

// 兜底：jsdom 环境未注入 localStorage 时（或运行在 node 环境）使用内存版 polyfill
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const polyfill: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
});
