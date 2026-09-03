import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-health-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-health-tests';

const { getDb } = await import('../../src/db/index.js');
const { systemHealthRoutes } = await import('../../src/routes/system-health.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(systemHealthRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

describe('System Health Routes', () => {
  it('should get overall health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system-health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('overall');
    expect(body).toHaveProperty('database');
    expect(body).toHaveProperty('connections');
    expect(body).toHaveProperty('services');
  });

  it('should get database health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system-health/database' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('status');
    expect(res.json()).toHaveProperty('queryTimeMs');
  });

  it('should get connections health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system-health/connections' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('total');
    expect(res.json()).toHaveProperty('connected');
  });

  it('should get services stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system-health/services' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('sessions');
    expect(res.json()).toHaveProperty('runs');
  });
});
