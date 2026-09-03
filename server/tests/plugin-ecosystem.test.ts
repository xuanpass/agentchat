import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuid } from 'uuid';

const TEST_DB = join(tmpdir(), `aoc-test-pe-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret';

const { getDb } = await import('../../src/db/index.js');
const { pluginEcosystemRoutes } = await import('../../src/routes/plugin-ecosystem.js');
const Fastify = (await import('fastify')).default;

let app: any;
function createCap(type: string, name: string) {
  const id = uuid();
  getDb().prepare('INSERT INTO capabilities (id, type, name, source_kind, payload, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, type, name, 'local', '{}', 'abc', Date.now());
  return id;
}

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(pluginEcosystemRoutes, { prefix: '/api' });
});
afterAll(async () => { await app?.close(); });
beforeEach(() => {
  getDb().prepare('DELETE FROM plugin_reviews').run();
  getDb().prepare('DELETE FROM plugin_dependencies').run();
  getDb().prepare('DELETE FROM capabilities').run();
});

describe('Plugin Ecosystem Routes', () => {
  it('should create a review', async () => {
    const capId = createCap('skill', 'Test Plugin');
    const res = await app.inject({ method: 'POST', url: '/api/plugin-reviews', payload: { capabilityId: capId, rating: 5, comment: 'Great!' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().rating).toBe(5);
  });

  it('should list reviews', async () => {
    const capId = createCap('skill', 'Test');
    await app.inject({ method: 'POST', url: '/api/plugin-reviews', payload: { capabilityId: capId, rating: 5 } });
    await app.inject({ method: 'POST', url: '/api/plugin-reviews', payload: { capabilityId: capId, rating: 3 } });
    const res = await app.inject({ method: 'GET', url: '/api/plugin-reviews?capabilityId=' + capId });
    expect(res.json().length).toBe(2);
  });

  it('should get review summary', async () => {
    const capId = createCap('skill', 'Test');
    await app.inject({ method: 'POST', url: '/api/plugin-reviews', payload: { capabilityId: capId, rating: 5 } });
    await app.inject({ method: 'POST', url: '/api/plugin-reviews', payload: { capabilityId: capId, rating: 3 } });
    const res = await app.inject({ method: 'GET', url: '/api/plugin-reviews/summary?capabilityId=' + capId });
    expect(res.json().avgRating).toBe(4);
    expect(res.json().total).toBe(2);
  });

  it('should add dependency', async () => {
    const capId1 = createCap('skill', 'Plugin A');
    const capId2 = createCap('skill', 'Plugin B');
    const res = await app.inject({ method: 'POST', url: '/api/plugin-dependencies', payload: { capabilityId: capId1, dependsOn: capId2 } });
    expect(res.statusCode).toBe(201);
  });

  it('should check dependencies', async () => {
    const capId1 = createCap('skill', 'Plugin A');
    const capId2 = createCap('skill', 'Plugin B');
    await app.inject({ method: 'POST', url: '/api/plugin-dependencies', payload: { capabilityId: capId1, dependsOn: capId2 } });
    const res = await app.inject({ method: 'GET', url: '/api/plugin-dependencies/check?capabilityId=' + capId1 });
    expect(res.json().allSatisfied).toBe(true);
    expect(res.json().dependencies.length).toBe(1);
  });

  it('should search plugins', async () => {
    createCap('skill', 'Search Me');
    const res = await app.inject({ method: 'GET', url: '/api/plugins/search?q=Search' });
    expect(res.json().length).toBeGreaterThanOrEqual(1);
  });
});
