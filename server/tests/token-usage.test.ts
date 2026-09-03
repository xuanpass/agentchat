import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-token-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-token-tests';

const { getDb } = await import('../../src/db/index.js');
const { tokenUsageRoutes } = await import('../../src/routes/token-usage.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(tokenUsageRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM token_usage').run();
});

describe('Token Usage Routes', () => {
  it('should record token usage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/token-usage',
      payload: { tokensIn: 1000, tokensOut: 500, model: 'gpt-4' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tokensIn).toBe(1000);
    expect(body.tokensOut).toBe(500);
    expect(body.tokensTotal).toBe(1500);
    expect(body.cost).toBeGreaterThan(0);
  });

  it('should reject invalid token data', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/token-usage',
      payload: { tokensIn: -100, tokensOut: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should list token usage', async () => {
    await app.inject({ method: 'POST', url: '/api/token-usage', payload: { tokensIn: 100, tokensOut: 50 } });
    await app.inject({ method: 'POST', url: '/api/token-usage', payload: { tokensIn: 200, tokensOut: 100 } });

    const res = await app.inject({ method: 'GET', url: '/api/token-usage' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBe(2);
  });

  it('should get summary', async () => {
    await app.inject({ method: 'POST', url: '/api/token-usage', payload: { tokensIn: 1000, tokensOut: 500 } });
    const res = await app.inject({ method: 'GET', url: '/api/token-usage/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.tokensTotal).toBe(1500);
    expect(body.totals.cost).toBeGreaterThan(0);
  });

  it('should filter by period', async () => {
    await app.inject({ method: 'POST', url: '/api/token-usage', payload: { tokensIn: 100, tokensOut: 50 } });
    const res = await app.inject({ method: 'GET', url: '/api/token-usage/summary?period=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.tokensTotal).toBe(150);
  });

  it('should delete token record', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/token-usage', payload: { tokensIn: 100, tokensOut: 50 } });
    const id = create.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/api/token-usage/${id}` });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/token-usage' });
    expect(list.json().length).toBe(0);
  });
});
