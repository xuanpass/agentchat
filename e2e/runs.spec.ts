import { test, expect } from '@playwright/test';

test.describe('Runs E2E', () => {
  test('page loads with title and create button', async ({ page }) => {
    await page.goto('/runs');
    await expect(page.locator('.page-title')).toHaveText('运行记录');
    await expect(page.locator('text=新建运行')).toBeVisible();
  });

  test('creates a new run', async ({ page }) => {
    await page.goto('/runs');

    await page.click('text=新建运行');
    await expect(page.locator('.modal')).toBeVisible();

    // 选择策略
    await page.selectOption('.modal select', 'serial');

    // 提交
    await page.click('.modal button:has-text("创建")');

    // 验证运行卡片出现
    await expect(page.locator('.run-card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('filters runs by status', async ({ page }) => {
    await page.goto('/runs');
    
    // 等待加载
    await page.waitForTimeout(1000);

    // 点击 "进行中" 筛选
    await page.click('text=进行中');
    await page.waitForTimeout(500);

    // 验证筛选 chip 激活
    await expect(page.locator('.filter-chip.active')).toHaveText('进行中');
  });

  test('API: creates run with events', async ({ request }) => {
    // 创建运行
    const res = await request.post('http://localhost:3001/api/runs', {
      data: { strategy: 'parallel', context: 'e2e test run' },
    });
    expect(res.status()).toBe(201);
    const run = await res.json();
    expect(run.status).toBe('queued');

    // 添加事件
    await request.post(`http://localhost:3001/api/runs/${run.id}/events`, {
      data: { type: 'info', source: 'e2e', payload: { msg: 'test event' } },
    });

    // 更新状态
    const upd = await request.patch(`http://localhost:3001/api/runs/${run.id}`, {
      data: { status: 'running' },
    });
    expect((await upd.json()).status).toBe('running');

    // 验证详情
    const detail = await request.get(`http://localhost:3001/api/runs/${run.id}`);
    const detailBody = await detail.json();
    expect(detailBody.events.length).toBeGreaterThanOrEqual(1);
    expect(detailBody.context).toBe('e2e test run');
  });
});
