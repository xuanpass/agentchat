import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-runs-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-runs-tests';

// 用临时 DB 避免污染正式数据
const { getDb } = await import('../../src/db/index.js');
const { runRoutes } = await import('../../src/routes/runs.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  // 初始化 DB (migrate)
  getDb();
  app = Fastify();
  await app.register(runRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  // 清空 runs 表
  getDb().prepare('DELETE FROM runs').run();
});

describe('Run Routes', () => {
  it('should create a run with default values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'serial', context: 'test' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('queued');
    expect(body.strategy).toBe('serial');
    expect(body.context).toBe('test');
    expect(body.traceId).toMatch(/^t-/);
    expect(body.events).toEqual([]);
  });

  it('should create a run with team binding', async () => {
    // 先创建团队以满足 FK 约束
    getDb().prepare('INSERT INTO teams (id, name, description, members, version, created_at, updated_at) VALUES (?,?,?,?,1,?,?)')
      .run('team-123', 'Test Team', 'test', '[]', Date.now(), Date.now());
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { teamId: 'team-123', strategy: 'parallel', sessionIds: ['s1', 's2'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.teamId).toBe('team-123');
    expect(body.sessionIds).toEqual(['s1', 's2']);
  });

  it('should reject invalid strategy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should list runs with status filter', async () => {
    // 创建两个 run
    await app.inject({ method: 'POST', url: '/api/runs', payload: { strategy: 'serial' } });
    await app.inject({ method: 'POST', url: '/api/runs', payload: { strategy: 'fanout' } });

    const all = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(all.json()).toHaveLength(2);

    const queued = await app.inject({ method: 'GET', url: '/api/runs?status=queued' });
    expect(queued.json()).toHaveLength(2);

    const done = await app.inject({ method: 'GET', url: '/api/runs?status=done' });
    expect(done.json()).toHaveLength(0);
  });

  it('should get run detail', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'serial', context: 'detail test' },
    });
    const id = created.json().id;

    const detail = await app.inject({ method: 'GET', url: `/api/runs/${id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().context).toBe('detail test');
  });

  it('should return 404 for non-existent run', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/nonexistent' });
    expect(res.json().error).toBe('不存在');
  });

  it('should append events to a run', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'serial' },
    });
    const id = created.json().id;

    const ev1 = await app.inject({
      method: 'POST',
      url: `/api/runs/${id}/events`,
      payload: { type: 'info', source: 'system', payload: { msg: 'started' } },
    });
    expect(ev1.statusCode).toBe(200);
    expect(ev1.json().seq).toBe(1);
    expect(ev1.json().type).toBe('info');

    const ev2 = await app.inject({
      method: 'POST',
      url: `/api/runs/${id}/events`,
      payload: { type: 'dispatch', source: 'agent-1', payload: { msg: 'dispatched' } },
    });
    expect(ev2.json().seq).toBe(2);
  });

  it('should update run status', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'serial' },
    });
    const id = created.json().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/runs/${id}`,
      payload: { status: 'running' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe('running');
  });

  it('should delete a run', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { strategy: 'serial' },
    });
    const id = created.json().id;

    const del = await app.inject({ method: 'DELETE', url: `/api/runs/${id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const after = await app.inject({ method: 'GET', url: `/api/runs/${id}` });
    expect(after.json().error).toBe('不存在');
  });

  it('should return runs in descending time order', async () => {
    await app.inject({ method: 'POST', url: '/api/runs', payload: { strategy: 'serial' } });
    await new Promise(r => setTimeout(r, 10));
    await app.inject({ method: 'POST', url: '/api/runs', payload: { strategy: 'fanout' } });

    const list = await app.inject({ method: 'GET', url: '/api/runs' });
    const runs = list.json();
    expect(runs).toHaveLength(2);
    // 后创建的排在前面
    expect(runs[0].createdAt).toBeGreaterThanOrEqual(runs[1].createdAt);
  });
});
