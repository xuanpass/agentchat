import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-am-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret';

const { getDb } = await import('../../src/db/index.js');
const { agentMetricsRoutes } = await import('../../src/routes/agent-metrics.js');
const Fastify = (await import('fastify')).default;

let app: any;
beforeAll(async () => { getDb(); app = Fastify(); await app.register(agentMetricsRoutes, { prefix: '/api' }); });
afterAll(async () => { await app?.close(); });
beforeEach(() => { getDb().prepare('DELETE FROM agent_metrics').run(); });

describe('Agent Metrics Routes', () => {
  it('should record a metric', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 250 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().metricType).toBe('latency');
  });

  it('should reject invalid metric type', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'invalid', value: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it('should batch record metrics', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agent-metrics/batch', payload: { metrics: [{ metricType: 'latency', value: 100 }, { metricType: 'throughput', value: 15 }] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().inserted).toBe(2);
  });

  it('should list metrics', async () => {
    await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 100 } });
    await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 200 } });
    const res = await app.inject({ method: 'GET', url: '/api/agent-metrics' });
    expect(res.json().length).toBe(2);
  });

  it('should filter by type', async () => {
    await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 100 } });
    await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'error_rate', value: 2 } });
    const res = await app.inject({ method: 'GET', url: '/api/agent-metrics?metricType=latency' });
    expect(res.json().length).toBe(1);
  });

  it('should get dashboard', async () => {
    await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 150 } });
    const res = await app.inject({ method: 'GET', url: '/api/agent-metrics/dashboard' });
    expect(res.json().overview).toBeDefined();
    expect(res.json().recent).toBeDefined();
  });

  it('should aggregate metrics', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 100 + i * 10 } });
    }
    const res = await app.inject({ method: 'GET', url: '/api/agent-metrics?aggregate=5m' });
    expect(res.json().length).toBeGreaterThan(0);
    expect(res.json()[0]).toHaveProperty('avg_value');
  });

  it('should cleanup old metrics', async () => {
    await app.inject({ method: 'POST', url: '/api/agent-metrics', payload: { metricType: 'latency', value: 100 } });
    const res = await app.inject({ method: 'DELETE', url: '/api/agent-metrics?olderThanDays=-1' });
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
  });
});
