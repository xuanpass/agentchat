import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = join(tmpdir(), `aoc-test-chat-${Date.now()}.db`);
process.env.AOC_DB_PATH = TEST_DB;
process.env.AOC_SECRET = 'test-secret-key-for-chat-tests';

const { getDb } = await import('../../src/db/index.js');
const { agentChatRoutes } = await import('../../src/routes/agent-chat.js');
const Fastify = (await import('fastify')).default;

let app: any;

beforeAll(async () => {
  getDb();
  app = Fastify();
  await app.register(agentChatRoutes, { prefix: '/api' });
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  getDb().prepare('DELETE FROM chat_messages').run();
  getDb().prepare('DELETE FROM chat_sessions').run();
});

describe('Agent Chat Routes', () => {
  it('should create a chat session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/agent-chat/sessions', payload: { title: '测试会话' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('测试会话');
    expect(body.status).toBe('active');
    expect(body.messageCount).toBe(0);
  });

  it('should list chat sessions', async () => {
    await app.inject({ method: 'POST', url: '/api/agent-chat/sessions', payload: { title: '会话1' } });
    await app.inject({ method: 'POST', url: '/api/agent-chat/sessions', payload: { title: '会话2' } });
    const res = await app.inject({ method: 'GET', url: '/api/agent-chat/sessions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('should send a message and get reply', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/agent-chat/sessions', payload: { title: '测试' } });
    const sessionId = createRes.json().id;
    const res = await app.inject({ method: 'POST', url: `/api/agent-chat/sessions/${sessionId}/messages`, payload: { content: '你好' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.userMessage.role).toBe('user');
    expect(body.assistantMessage.role).toBe('assistant');
    expect(body.assistantMessage.content.length).toBeGreaterThan(0);
  });

  it('should get session messages', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/agent-chat/sessions', payload: { title: '测试' } });
    const sessionId = createRes.json().id;
    await app.inject({ method: 'POST', url: `/api/agent-chat/sessions/${sessionId}/messages`, payload: { content: '你好' } });
    const res = await app.inject({ method: 'GET', url: `/api/agent-chat/sessions/${sessionId}/messages` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('should archive and delete sessions', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/agent-chat/sessions', payload: { title: '测试' } });
    const sessionId = createRes.json().id;
    const archiveRes = await app.inject({ method: 'PATCH', url: `/api/agent-chat/sessions/${sessionId}`, payload: { status: 'archived' } });
    expect(archiveRes.statusCode).toBe(200);
    expect(archiveRes.json().status).toBe('archived');
    const delRes = await app.inject({ method: 'DELETE', url: `/api/agent-chat/sessions/${sessionId}` });
    expect(delRes.statusCode).toBe(200);
  });

  it('should get chat stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent-chat/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('totalSessions');
    expect(body).toHaveProperty('totalMessages');
  });
});
