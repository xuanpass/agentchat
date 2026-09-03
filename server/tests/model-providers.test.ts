import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-mp-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret';

const { getDb } = await import('../../src/db/index.js');
const { modelProviderRoutes } = await import('../../src/routes/model-providers.js');
const Fastify = (await import('fastify')).default;

let app: any;
beforeAll(async () => { getDb(); app = Fastify(); await app.register(modelProviderRoutes, { prefix: '/api' }); });
afterAll(async () => { await app?.close(); });
beforeEach(() => { getDb().prepare('DELETE FROM model_providers').run(); getDb().prepare('DELETE FROM model_routing_rules').run(); });

describe('Model Provider Routes', () => {
  it('should create a provider', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4', 'gpt-3.5'], defaultModel: 'gpt-4', weight: 2, costPer1kInput: 0.002, costPer1kOutput: 0.008 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('OpenAI');
  });

  it('should reject invalid provider type', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'Bad', provider: 'invalid', baseUrl: 'https://x.com' } });
    expect(res.statusCode).toBe(400);
  });

  it('should list providers', async () => {
    await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'P1', provider: 'openai', baseUrl: 'https://a.com' } });
    await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'P2', provider: 'anthropic', baseUrl: 'https://b.com' } });
    const res = await app.inject({ method: 'GET', url: '/api/model-providers' });
    expect(res.json().length).toBe(2);
  });

  it('should update provider', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'Update', provider: 'openai', baseUrl: 'https://a.com' } });
    const id = c.json().id;
    const u = await app.inject({ method: 'PATCH', url: `/api/model-providers/${id}`, payload: { name: 'Updated', weight: 5 } });
    expect(u.json().name).toBe('Updated');
    expect(u.json().weight).toBe(5);
  });

  it('should delete provider', async () => {
    const c = await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'Del', provider: 'openai', baseUrl: 'https://a.com' } });
    const d = await app.inject({ method: 'DELETE', url: `/api/model-providers/${c.json().id}` });
    expect(d.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/model-providers' })).json().length).toBe(0);
  });

  it('should create routing rule', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/routing-rules', payload: { name: 'High Complexity', model: 'gpt-4', conditionType: 'complexity', conditionValue: 'high', priority: 200 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('High Complexity');
  });

  it('should route to default provider', async () => {
    await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'Default', provider: 'openai', baseUrl: 'https://a.com', models: ['gpt-4'], defaultModel: 'gpt-4' } });
    const res = await app.inject({ method: 'POST', url: '/api/model-providers/route', payload: { prompt: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBeDefined();
    expect(res.json().model).toBeDefined();
  });

  it('should get stats', async () => {
    await app.inject({ method: 'POST', url: '/api/model-providers', payload: { name: 'S1', provider: 'openai', baseUrl: 'https://a.com' } });
    const res = await app.inject({ method: 'GET', url: '/api/model-providers/stats' });
    expect(res.json().total).toBe(1);
    expect(res.json().active).toBe(1);
  });
});
