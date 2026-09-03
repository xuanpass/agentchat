import { test, expect } from '@playwright/test';

test.describe('Audit E2E', () => {
  test('page loads with title', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.locator('.page-title')).toHaveText('审计日志');
  });

  test('shows audit entries after actions', async ({ page }) => {
    // 先创建一个连接来产生审计记录
    await page.goto('/connections');
    await page.click('text=接入智能体');
    await page.fill('input[placeholder="如: 研发组 openclaw 主节点"]', 'Audit Test Agent');
    await page.fill('input[placeholder="ws://host:port 或 http://host:port"]', 'http://localhost:10089');
    await page.click('.modal button:has-text("创建")');
    await expect(page.locator('.conn-name:has-text("Audit Test Agent")')).toBeVisible({ timeout: 10_000 });

    // 跳转到审计页
    await page.goto('/audit');
    await expect(page.locator('.audit-entry, .audit-row, tbody tr').first()).toBeVisible({ timeout: 10_000 });
  });

  test('API: audit entries are filterable', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/audit?action=connection.create&limit=10');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
