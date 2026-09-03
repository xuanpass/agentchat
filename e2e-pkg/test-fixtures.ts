import { test as base, expect } from '@playwright/test';

// E2E 测试固定 API Key (与 playwright.config.ts 中 AOC_API_KEY 一致)
const TEST_API_KEY = 'aoc_e2e_test_key_for_playwright_1234567890';

// 扩展 test fixture: 每个 page 加载前注入 API Key
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((key) => {
      localStorage.setItem('aoc-api-key', key);
    }, TEST_API_KEY);
    await use(page);
  },
});

export { expect };
