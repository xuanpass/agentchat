import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-perf-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-perf-tests';

const { getDb } = await import('../../src/db/index.js');
const { connectionRoutes } = await import('../../src/routes/connections.js');
const { runRoutes } = await import('../../src/routes/runs.js');
const { teamRoutes } = await import('../../src/routes/teams.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(connectionRoutes, { prefix: '/api' });
  await app.register(runRoutes, { prefix: '/api' });
  await app.register(teamRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

describe('Performance Benchmarks', () => {
  beforeAll(async () => {
    // 创建测试连接
    const conn = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { name: 'Perf Test', kind: 'openclaw', endpoint: { baseUrl: 'http://localhost:10089' }, auth: { type: 'none' } },
    });
    const connId = conn.json().id;

    // 批量创建 50 个运行记录
    for (let i = 0; i < 50; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { strategy: 'serial', context: `Run ${i}` },
      });
    }

    // 批量创建 50 个团队
    for (let i = 0; i < 50; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/teams',
        payload: { name: `Team ${i}`, members: [{ connectionId: connId, role: 'lead' }] },
      });
    }
  });

  it('should list 50 runs under 50ms', async () => {
    const start = performance.now();
    const res = await app.inject({ method: 'GET', url: '/api/runs' });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(50);
    console.log(`  runs list: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(50);
  });

  it('should list 50 teams under 50ms', async () => {
    const start = performance.now();
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(50);
    console.log(`  teams list: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(50);
  });

  it('should create run under 20ms', async () => {
    const start = performance.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'serial' },
    });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(201);
    console.log(`  create run: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(20);
  });

  it('should handle concurrent creates without error', async () => {
    const start = performance.now();
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { strategy: 'serial', context: `concurrent-${i}` },
      }));
    }
    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;
    const allOk = results.every(r => r.statusCode === 201);
    expect(allOk).toBe(true);
    console.log(`  20 concurrent creates: ${elapsed.toFixed(1)}ms (${(elapsed / 20).toFixed(1)}ms avg)`);
  });
});
