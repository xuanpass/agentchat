import { test, expect } from './test-fixtures';

test.describe('Audit E2E', () => {
  test('page loads with title', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.locator('.page-title')).toHaveText('审计日志');
  });

  test('page renders without crash', async ({ page }) => {
    await page.goto('/audit');
    // 验证页面渲染 — 筛选按钮存在
    await expect(page.locator('.filter-chip').first()).toBeVisible({ timeout: 10_000 });
  });
});
