import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads and displays stats cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.stat-card')).toHaveCount(4);
    await expect(page.locator('.stat-card').first()).toBeVisible();
  });

  test('shows navigation sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.nav-item')).toHaveCount.greaterThan(5);
  });

  test('navigates between pages', async ({ page }) => {
    await page.goto('/');
    await page.click('text=连接管理');
    await expect(page.locator('.page-title, h1')).toContainText('连接');
    await page.click('text=仪表盘');
    await expect(page.locator('.stat-card').first()).toBeVisible();
  });
});
