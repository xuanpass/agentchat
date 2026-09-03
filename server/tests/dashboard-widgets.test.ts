import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-dw-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret';

const { getDb } = await import('../../src/db/index.js');
const { dashboardWidgetRoutes } = await import('../../src/routes/dashboard-widgets.js');
const Fastify = (await import('fastify')).default;

let app: any;
beforeAll(async () => { getDb(); app = Fastify(); await app.register(dashboardWidgetRoutes, { prefix: '/api' }); });
afterAll(async () => { await app?.close(); });
beforeEach(() => { getDb().prepare('DELETE FROM dashboard_widgets').run(); });

describe('Dashboard Widget Routes', () => {
  it('should create a widget', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'My Stat', type: 'stat', config: { metric: 'connections' } } });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('My Stat');
  });

  it('should list widgets by user', async () => {
    await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'W1', type: 'stat' } });
    await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'W2', type: 'chart' } });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard-widgets' });
    expect(res.json().length).toBe(2);
  });

  it('should update widget position', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'Move', type: 'stat' } });
    const id = c.json().id;
    const u = await app.inject({ method: 'PATCH', url: `/api/dashboard-widgets/${id}`, payload: { position: 5 } });
    expect(u.json().position).toBe(5);
  });

  it('should delete widget', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'Del', type: 'stat' } });
    const d = await app.inject({ method: 'DELETE', url: `/api/dashboard-widgets/${c.json().id}` });
    expect(d.statusCode).toBe(200);
  });

  it('should reorder widgets', async () => {
    const c1 = await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'W1', type: 'stat' } });
    const c2 = await app.inject({ method: 'POST', url: '/api/dashboard-widgets', payload: { title: 'W2', type: 'stat' } });
    const res = await app.inject({ method: 'POST', url: '/api/dashboard-widgets/reorder', payload: { widgets: [{ id: c1.json().id }, { id: c2.json().id }] } });
    expect(res.json().updated).toBe(2);
  });

  it('should get templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard-widgets/templates' });
    expect(res.json().length).toBeGreaterThan(0);
    expect(res.json()[0]).toHaveProperty('title');
    expect(res.json()[0]).toHaveProperty('type');
  });
});
