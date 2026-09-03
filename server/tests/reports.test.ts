import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-reports-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-reports-tests';

const { getDb } = await import('../../src/db/index.js');
const { reportRoutes } = await import('../../src/routes/reports.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(reportRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM report_templates').run();
});

describe('Report Routes', () => {
  it('should create a report template', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/reports/templates', payload: { name: '月度报告', type: 'token_usage' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('月度报告');
  });

  it('should list templates', async () => {
    await app.inject({ method: 'POST', url: '/api/reports/templates', payload: { name: 'T1', type: 'token_usage' } });
    const res = await app.inject({ method: 'GET', url: '/api/reports/templates' });
    expect(res.json()).toHaveLength(1);
  });

  it('should generate a report', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/reports/generate', payload: { type: 'token_usage', format: 'json' } });
    expect(res.statusCode).toBe(200);
  });

  it('should update a template', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/reports/templates', payload: { name: 'T1', type: 'token_usage' } });
    const id = createRes.json().id;
    const res = await app.inject({ method: 'PATCH', url: `/api/reports/templates/${id}`, payload: { name: 'Updated' } });
    expect(res.json().name).toBe('Updated');
  });

  it('should delete a template', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/reports/templates', payload: { name: 'T1', type: 'token_usage' } });
    const id = createRes.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/reports/templates/${id}` });
    expect(res.statusCode).toBe(200);
  });

  it('should get report stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('totalTemplates');
  });
});
