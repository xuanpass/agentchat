import { test, expect } from './test-fixtures';

test.describe('Token Usage E2E', () => {
  test('page loads with title and stats', async ({ page }) => {
    await page.goto('/token-usage');
    await expect(page.locator('h1').first()).toContainText('Token');
    await expect(page.locator('.stat-card').first()).toBeVisible();
  });

  test('shows empty state or data', async ({ page }) => {
    await page.goto('/token-usage');
    await expect(page.locator('.token-usage-page')).toBeVisible();
  });

  test('navigate from sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('a[href="/token-usage"]');
    await expect(page.locator('h1').first()).toContainText('Token');
  });
});
