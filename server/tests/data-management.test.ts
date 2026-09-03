import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-dm-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-dm-tests';

const { getDb } = await import('../../src/db/index.js');
const { dataManagementRoutes } = await import('../../src/routes/data-management.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(dataManagementRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM backup_records').run();
});

describe('Data Management Routes', () => {
  it('should get stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/data-management/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('tables');
    expect(res.json()).toHaveProperty('backups');
  });

  it('should create a backup', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/data-management/backups', payload: { name: '测试备份', includeConnections: true } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('测试备份');
    expect(body.status).toBe('completed');
    expect(body.sizeBytes).toBeGreaterThan(0);
  });

  it('should list backups', async () => {
    await app.inject({ method: 'POST', url: '/api/data-management/backups', payload: { name: 'B1' } });
    const res = await app.inject({ method: 'GET', url: '/api/data-management/backups' });
    expect(res.json()).toHaveLength(1);
  });

  it('should delete a backup', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/data-management/backups', payload: { name: 'B1' } });
    const id = createRes.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/data-management/backups/${id}` });
    expect(res.statusCode).toBe(200);
  });

  it('should cleanup old data', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/data-management/cleanup', payload: { table: 'audit_log', olderThanDays: 30 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('deleted');
  });
});
