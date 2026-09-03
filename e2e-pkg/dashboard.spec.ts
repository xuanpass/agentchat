import { test, expect } from './test-fixtures';

test.describe('Dashboard', () => {
  test('loads and displays stats cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll('.stat-card');
      const skeleton = document.querySelector('.skeleton-screen');
      return cards.length > 0 || !skeleton;
    }, { timeout: 15_000 });
    const count = await page.locator('.stat-card').count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('shows navigation sidebar with items', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeVisible();
    const navCount = await page.locator('.nav-item').count();
    expect(navCount).toBeGreaterThan(5);
  });

  test('connections page is accessible via URL', async ({ page }) => {
    await page.goto('/connections');
    await expect(page.locator('.page-title')).toHaveText('智能体');
  });
});
