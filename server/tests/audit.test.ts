import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-audit-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-audit-tests';

const { getDb } = await import('../../src/db/index.js');
const { auditRoutes, logAudit } = await import('../../src/routes/audit.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(auditRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM audit_log').run();
});

describe('Audit Routes', () => {
  it('should manually log and retrieve audit entry', async () => {
    logAudit({
      action: 'test_action',
      target_type: 'test',
      target_id: 'test-123',
      detail: { foo: 'bar' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    expect(res.statusCode).toBe(200);
    const entries = res.json();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('test_action');
    expect(entries[0].targetType).toBe('test');
    expect(entries[0].targetId).toBe('test-123');
    expect(entries[0].detail.foo).toBe('bar');
  });

  it('should list audit logs with action filter', async () => {
    logAudit({ action: 'create', target_type: 'team' });
    logAudit({ action: 'update', target_type: 'project' });
    logAudit({ action: 'create', target_type: 'connection' });

    const all = await app.inject({ method: 'GET', url: '/api/audit' });
    expect(all.json().length).toBe(3);

    const filtered = await app.inject({ method: 'GET', url: '/api/audit?action=create' });
    expect(filtered.json().length).toBe(2);
  });

  it('should get audit stats', async () => {
    logAudit({ action: 'create', target_type: 'team' });
    logAudit({ action: 'update', target_type: 'project' });

    const res = await app.inject({ method: 'GET', url: '/api/audit/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('recent24h');
    expect(body).toHaveProperty('byAction');
    expect(body).toHaveProperty('byTarget');
    expect(body.total).toBe(2);
  });

  it('should get single audit entry', async () => {
    logAudit({ action: 'delete', target_type: 'session', target_id: 'sess-1' });

    const all = await app.inject({ method: 'GET', url: '/api/audit?limit=1' });
    const entries = all.json();
    expect(entries.length).toBe(1);

    const detail = await app.inject({ method: 'GET', url: `/api/audit/${entries[0].id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(entries[0].id);
    expect(detail.json().action).toBe('delete');
  });

  it('should respect limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      logAudit({ action: 'create', target_type: 'item' });
    }

    const res = await app.inject({ method: 'GET', url: '/api/audit?limit=2&offset=0' });
    expect(res.json().length).toBe(2);

    const res2 = await app.inject({ method: 'GET', url: '/api/audit?limit=2&offset=2' });
    expect(res2.json().length).toBe(2);
  });

  it('should return 404 for non-existent audit entry', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit/99999' });
    expect(res.json().error).toBe('不存在');
  });

  it('should filter by target type', async () => {
    logAudit({ action: 'create', target_type: 'team' });
    logAudit({ action: 'create', target_type: 'project' });
    logAudit({ action: 'update', target_type: 'team' });

    const res = await app.inject({ method: 'GET', url: '/api/audit?targetType=team' });
    expect(res.json().length).toBe(2);
  });
});
