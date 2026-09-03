import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-workflows-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-workflow-tests';

const { getDb } = await import('../../src/db/index.js');
const { workflowRoutes } = await import('../../src/routes/workflows.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(workflowRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM workflow_runs').run();
  getDb().prepare('DELETE FROM workflows').run();
});

describe('Workflow Routes', () => {
  it('should create a workflow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: {
        name: 'Test Pipeline',
        description: 'A test workflow',
        nodes: [
          { id: 'n1', type: 'input', label: 'Start' },
          { id: 'n2', type: 'agent', label: 'Process' },
          { id: 'n3', type: 'output', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Test Pipeline');
    expect(body.status).toBe('draft');
    expect(body.nodes.length).toBe(3);
  });

  it('should reject empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: '', nodes: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should list workflows', async () => {
    await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'W1', nodes: [{ id: 'n1', type: 'input', label: 'I' }] } });
    await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'W2', nodes: [{ id: 'n1', type: 'input', label: 'I' }] } });

    const res = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(2);
  });

  it('should update workflow status', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Active Me', nodes: [{ id: 'n1', type: 'input', label: 'I' }] } });
    const id = create.json().id;
    const update = await app.inject({ method: 'PATCH', url: `/api/workflows/${id}`, payload: { status: 'active' } });
    expect(update.statusCode).toBe(200);
    expect(update.json().status).toBe('active');
  });

  it('should run an active workflow', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: {
      name: 'Runnable',
      nodes: [{ id: 'n1', type: 'input', label: 'I' }, { id: 'n2', type: 'output', label: 'O' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    } });
    const id = create.json().id;
    await app.inject({ method: 'PATCH', url: `/api/workflows/${id}`, payload: { status: 'active' } });

    const run = await app.inject({ method: 'POST', url: `/api/workflows/${id}/run`, payload: {} });
    expect(run.statusCode).toBe(202);
    expect(run.json().status).toBe('running');
  });

  it('should reject running a draft workflow', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: {
      name: 'Draft Only',
      nodes: [{ id: 'n1', type: 'input', label: 'I' }],
    } });
    const id = create.json().id;
    const run = await app.inject({ method: 'POST', url: `/api/workflows/${id}/run`, payload: {} });
    expect(run.statusCode).toBe(400);
  });

  it('should list workflow runs', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: {
      name: 'Multi Run',
      nodes: [{ id: 'n1', type: 'input', label: 'I' }, { id: 'n2', type: 'output', label: 'O' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    } });
    const id = create.json().id;
    await app.inject({ method: 'PATCH', url: `/api/workflows/${id}`, payload: { status: 'active' } });
    await app.inject({ method: 'POST', url: `/api/workflows/${id}/run`, payload: {} });
    await app.inject({ method: 'POST', url: `/api/workflows/${id}/run`, payload: {} });

    const runs = await app.inject({ method: 'GET', url: '/api/workflow-runs' });
    expect(runs.statusCode).toBe(200);
    expect(runs.json().length).toBe(2);
  });

  it('should get workflow stats', async () => {
    await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Stat Wf', nodes: [{ id: 'n1', type: 'input', label: 'I' }] } });
    const res = await app.inject({ method: 'GET', url: '/api/workflows/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it('should delete workflow', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Delete Me', nodes: [{ id: 'n1', type: 'input', label: 'I' }] } });
    const id = create.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/api/workflows/${id}` });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(list.json().length).toBe(0);
  });
});
