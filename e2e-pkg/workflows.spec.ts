import { test, expect } from './test-fixtures';

test.describe('Workflows E2E', () => {
  test('page loads with title and stats', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.locator('h1').first()).toContainText('工作流');
    await expect(page.locator('.stat-card').first()).toBeVisible();
  });

  test('shows empty state or workflows grid', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page.locator('.workflows-page')).toBeVisible();
  });

  test('create workflow modal opens and closes', async ({ page }) => {
    await page.goto('/workflows');
    await page.getByRole('button', { name: '新建工作流' }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('navigate from sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('a[href="/workflows"]');
    await expect(page.locator('h1').first()).toContainText('工作流');
  });
});
