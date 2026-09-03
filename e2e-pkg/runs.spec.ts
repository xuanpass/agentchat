import { test, expect } from './test-fixtures';

test.describe('Runs E2E', () => {
  test('page loads with title and create button', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.locator('.page-title')).toHaveText('运行记录');
    await expect(page.locator('text=新建运行')).toBeVisible();
  });

  test('opens create run modal with form', async ({ page }) => {
    await page.goto('/runs');
    await page.click('text=新建运行');
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal select').first()).toBeVisible();
  });
});
