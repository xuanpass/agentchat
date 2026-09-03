import { test, expect } from './test-fixtures';

test.describe('Connections E2E', () => {
  test('page loads with nav and title', async ({ page }) => {
    await page.goto('/connections');
    await expect(page.locator('.page-title')).toHaveText('智能体');
    const navCount = await page.locator('.nav-item').count();
    expect(navCount).toBeGreaterThan(5);
  });

  test('opens and closes wizard modal', async ({ page }) => {
    await page.goto('/connections');
    await page.click('text=接入智能体');
    await expect(page.locator('.modal')).toBeVisible();
    // 关闭 modal
    await page.click('.modal .btn:has-text("取消")');
    await expect(page.locator('.modal')).toBeHidden();
  });
});
