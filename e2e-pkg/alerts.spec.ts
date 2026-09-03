import { test, expect } from './test-fixtures';

test.describe('Alerts E2E', () => {
  test('page loads with title and stats', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.locator('h1')).toContainText('告警中心');
    await expect(page.locator('.stat-card').first()).toBeVisible();
  });

  test('shows alert table or empty state', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.locator('table, .empty')).toBeVisible();
  });

  test('filter controls are interactive', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.locator('select').first()).toBeVisible();
    await page.locator('select').first().selectOption('warning');
    await expect(page.locator('select').first()).toHaveValue('warning');
  });

  test('navigate from sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('.nav-item:has-text("告警")');
    await expect(page.locator('h1')).toContainText('告警中心');
  });
});
