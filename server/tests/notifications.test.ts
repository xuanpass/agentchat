import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-notif-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-notif-tests';

const { getDb } = await import('../../src/db/index.js');
const { notificationRoutes } = await import('../../src/routes/notifications.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(notificationRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM notifications').run();
});

describe('Notification Routes', () => {
  it('should create a notification', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: '测试', body: '内容' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('测试');
  });

  it('should list notifications', async () => {
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: 'N1', body: 'B1' } });
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'warning', title: 'N2', body: 'B2' } });
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.json()).toHaveLength(2);
  });

  it('should mark as read/unread', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: '测试', body: '内容' } });
    const id = createRes.json().id;
    const readRes = await app.inject({ method: 'PATCH', url: `/api/notifications/${id}/read` });
    expect(readRes.statusCode).toBe(200);
    const unreadRes = await app.inject({ method: 'PATCH', url: `/api/notifications/${id}/unread` });
    expect(unreadRes.statusCode).toBe(200);
  });

  it('should mark all as read', async () => {
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: 'N1', body: 'B1' } });
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: 'N2', body: 'B2' } });
    const res = await app.inject({ method: 'POST', url: '/api/notifications/mark-all-read', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(2);
  });

  it('should get stats', async () => {
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: 'N1', body: 'B1' } });
    const res = await app.inject({ method: 'GET', url: '/api/notifications/stats' });
    expect(res.json().total).toBe(1);
    expect(res.json().unread).toBe(1);
  });

  it('should delete notification', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: '测试', body: '内容' } });
    const id = createRes.json().id;
    const delRes = await app.inject({ method: 'DELETE', url: `/api/notifications/${id}` });
    expect(delRes.statusCode).toBe(200);
    const listRes = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(listRes.json()).toHaveLength(0);
  });

  it('should filter by type and read status', async () => {
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'info', title: 'N1', body: 'B1' } });
    await app.inject({ method: 'POST', url: '/api/notifications', payload: { type: 'warning', title: 'N2', body: 'B2' } });
    const typeRes = await app.inject({ method: 'GET', url: '/api/notifications?type=info' });
    expect(typeRes.json()).toHaveLength(1);
    const readRes = await app.inject({ method: 'GET', url: '/api/notifications?read=0' });
    expect(readRes.json()).toHaveLength(2);
  });
});
