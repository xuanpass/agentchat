import { test, expect } from './test-fixtures';

test.describe('Alert Rules E2E', () => {
  test('page loads with title and stats', async ({ page }) => {
    await page.goto('/alert-rules');
    await expect(page.locator('h1').first()).toContainText('告警规则');
    await expect(page.locator('.stat-card').first()).toBeVisible();
  });

  test('shows empty state or rules grid', async ({ page }) => {
    await page.goto('/alert-rules');
    await expect(page.locator('.alert-rules-page')).toBeVisible();
  });

  test('create rule modal opens and closes', async ({ page }) => {
    await page.goto('/alert-rules');
    await page.getByRole('button', { name: '新建规则' }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('navigate from sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('a[href="/alert-rules"]');
    await expect(page.locator('h1').first()).toContainText('告警规则');
  });
});
