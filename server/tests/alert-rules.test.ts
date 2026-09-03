import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-alert-rules-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-alert-rule-tests';

const { getDb } = await import('../../src/db/index.js');
const { alertRuleRoutes } = await import('../../src/routes/alert-rules.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(alertRuleRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM alert_rules').run();
});

describe('Alert Rules Routes', () => {
  it('should create a rule', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/alert-rules',
      payload: { name: 'Token Budget', metric: 'token_budget', operator: 'gt', threshold: 10 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Token Budget');
    expect(body.metric).toBe('token_budget');
    expect(body.triggerCount).toBe(0);
  });

  it('should reject invalid metric', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/alert-rules',
      payload: { name: 'Bad', metric: 'invalid_metric', operator: 'gt', threshold: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should list rules', async () => {
    await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'R1', metric: 'latency', operator: 'gt', threshold: 5000 } });
    await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'R2', metric: 'error_rate', operator: 'gt', threshold: 5 } });

    const res = await app.inject({ method: 'GET', url: '/api/alert-rules' });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(2);
  });

  it('should update a rule', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'Original', metric: 'latency', operator: 'gt', threshold: 1000 } });
    const id = create.json().id;
    const update = await app.inject({ method: 'PATCH', url: `/api/alert-rules/${id}`, payload: { name: 'Updated', threshold: 2000 } });
    expect(update.statusCode).toBe(200);
    expect(update.json().name).toBe('Updated');
    expect(update.json().threshold).toBe(2000);
  });

  it('should toggle enabled', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'Toggle', metric: 'latency', operator: 'gt', threshold: 1000 } });
    const id = create.json().id;
    expect(create.json().enabled).toBe(true);

    const disable = await app.inject({ method: 'PATCH', url: `/api/alert-rules/${id}`, payload: { enabled: false } });
    expect(disable.json().enabled).toBe(false);
  });

  it('should delete a rule', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'Delete Me', metric: 'latency', operator: 'gt', threshold: 1 } });
    const id = create.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/api/alert-rules/${id}` });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/alert-rules' });
    expect(list.json().length).toBe(0);
  });

  it('should get stats', async () => {
    await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'S1', metric: 'latency', operator: 'gt', threshold: 100 } });
    const res = await app.inject({ method: 'GET', url: '/api/alert-rules/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    expect(res.json().enabled).toBe(1);
  });

  it('should filter by enabled', async () => {
    await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'E1', metric: 'latency', operator: 'gt', threshold: 100 } });
    const create2 = await app.inject({ method: 'POST', url: '/api/alert-rules', payload: { name: 'E2', metric: 'latency', operator: 'gt', threshold: 200 } });
    await app.inject({ method: 'PATCH', url: `/api/alert-rules/${create2.json().id}`, payload: { enabled: false } });

    const enabled = await app.inject({ method: 'GET', url: '/api/alert-rules?enabled=true' });
    expect(enabled.json().length).toBe(1);
  });
});
