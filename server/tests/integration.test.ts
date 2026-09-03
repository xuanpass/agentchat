import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-int-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-integration-tests';

const { getDb } = await import('../../src/db/index.js');
const { connectionRoutes } = await import('../../src/routes/connections.js');
const { teamRoutes } = await import('../../src/routes/teams.js');
const { projectRoutes } = await import('../../src/routes/projects.js');
const { runRoutes } = await import('../../src/routes/runs.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(connectionRoutes, { prefix: '/api' });
  await app.register(teamRoutes, { prefix: '/api' });
  await app.register(projectRoutes, { prefix: '/api' });
  await app.register(runRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

describe('Integration: Core Flows', () => {
  it('cascade delete: connection removes projects', async () => {
    const conn = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { name: 'Cascade Test', kind: 'openclaw', endpoint: { baseUrl: 'http://localhost:10089' }, auth: { type: 'none' } },
    });
    expect(conn.statusCode).toBe(201);
    const connId = conn.json().id;

    const p1 = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'P1', connectionId: connId, rootPath: '/tmp/p1' } });
    const p2 = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'P2', connectionId: connId, rootPath: '/tmp/p2' } });
    expect(p1.statusCode).toBe(201);
    expect(p2.statusCode).toBe(201);

    // 删除连接
    await app.inject({ method: 'DELETE', url: `/api/connections/${connId}` });

    // 项目应该被级联删除
    const check1 = await app.inject({ method: 'GET', url: `/api/projects/${p1.json().id}` });
    expect(check1.json().error).toBe('不存在');
    const check2 = await app.inject({ method: 'GET', url: `/api/projects/${p2.json().id}` });
    expect(check2.json().error).toBe('不存在');
  });

  it('run state machine: queued → running → done', async () => {
    const run = await app.inject({ method: 'POST', url: '/api/runs', payload: { strategy: 'serial' } });
    expect(run.statusCode).toBe(201);
    const runId = run.json().id;
    expect(run.json().status).toBe('queued');

    const r1 = await app.inject({ method: 'PATCH', url: `/api/runs/${runId}`, payload: { status: 'running' } });
    expect(r1.json().status).toBe('running');

    const r2 = await app.inject({ method: 'PATCH', url: `/api/runs/${runId}`, payload: { status: 'done' } });
    expect(r2.json().status).toBe('done');
  });

  it('run events: append and retrieve', async () => {
    const run = await app.inject({ method: 'POST', url: '/api/runs', payload: { strategy: 'parallel', context: 'event test' } });
    expect(run.statusCode).toBe(201);
    const runId = run.json().id;

    await app.inject({ method: 'POST', url: `/api/runs/${runId}/events`, payload: { type: 'info', source: 'test', payload: { msg: 'step 1' } } });
    await app.inject({ method: 'POST', url: `/api/runs/${runId}/events`, payload: { type: 'success', source: 'test', payload: { msg: 'step 2' } } });

    const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    expect(detail.json().events.length).toBe(2);
    expect(detail.json().events[0].seq).toBe(1);
    expect(detail.json().events[1].seq).toBe(2);
  });

  it('team message dispatch', async () => {
    const conn = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { name: 'Msg Test', kind: 'openclaw', endpoint: { baseUrl: 'http://localhost:10089' }, auth: { type: 'none' } },
    });
    expect(conn.statusCode).toBe(201);
    const connId = conn.json().id;

    const team = await app.inject({
      method: 'POST',
      url: '/api/teams',
      payload: { name: 'Msg Team', members: [{ connectionId: connId, role: 'lead' }] },
    });
    expect(team.statusCode).toBe(201);
    const teamId = team.json().id;

    const msg = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/message`,
      payload: { to: connId, relay: 'bff-bus', payload: { text: 'hello' } },
    });
    expect(msg.statusCode).toBe(200);
    expect(msg.json().traceId).toBeDefined();
  });

  it('project CRUD with connection binding', async () => {
    const conn = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { name: 'Proj Conn', kind: 'openclaw', endpoint: { baseUrl: 'http://localhost:10089' }, auth: { type: 'none' } },
    });
    expect(conn.statusCode).toBe(201);
    const connId = conn.json().id;

    // Create
    const proj = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'My Project', connectionId: connId, rootPath: '/tmp/proj', description: 'test' },
    });
    expect(proj.statusCode).toBe(201);
    const projId = proj.json().id;

    // Read
    const detail = await app.inject({ method: 'GET', url: `/api/projects/${projId}` });
    expect(detail.json().name).toBe('My Project');
    expect(detail.json().connectionId).toBe(connId);

    // Update
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projId}`,
      payload: { name: 'Updated Project', description: 'updated' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().name).toBe('Updated Project');

    // Delete
    const del = await app.inject({ method: 'DELETE', url: `/api/projects/${projId}` });
    expect(del.statusCode).toBe(200);
    const check = await app.inject({ method: 'GET', url: `/api/projects/${projId}` });
    expect(check.json().error).toBe('不存在');
  });
});
