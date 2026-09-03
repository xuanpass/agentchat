import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { ConnectionRepo } from '../db/connections.js';
import { ConnectionManager } from '../services/ConnectionManager.js';
import { getDriver } from '../adapters/index.js';
import { encryptCredential } from '../crypto.js';
import type { AgentConnection } from '../types.js';

const createConnectionSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['openclaw', 'hermes', 'opencode', 'a2a']),
  endpoint: z.object({
    baseUrl: z.string().min(1),
    openaiPath: z.string().optional(),
  }),
  auth: z.object({
    type: z.enum(['token', 'basic', 'password', 'none']),
    secret: z.string().optional(),
  }),
  profile: z.string().optional(),
});

export async function connectionRoutes(app: FastifyInstance) {
  app.get('/connections', async () => {
    return ConnectionRepo.list().map(redactSecret);
  });

  app.get<{ Params: { id: string } }>('/connections/:id', async (req, reply) => {
    const c = ConnectionRepo.get(req.params.id);
    if (!c) return reply.code(404).send({ error: '不存在' });
    return redactSecret(c);
  });

  app.post('/connections', async (req, reply) => {
    const parsed = createConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();

    const encrypted = body.auth.secret
      ? encryptCredential(body.auth.secret)
      : { encrypted: '', iv: '', tag: '' };

    const caps = { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
    const conn = ConnectionRepo.create({
      id, name: body.name, kind: body.kind, endpoint: body.endpoint,
      auth: { type: body.auth.type, ...encrypted },
      profile: body.profile, status: 'disconnected', capabilities: caps, lastSeenAt: undefined,
    });

    ConnectionManager.register(conn);
    try {
      const probe = await ConnectionManager.health(id);
      const updated = ConnectionRepo.update(id, {
        status: probe.ok ? 'connected' : 'error' as any,
        capabilities: probe.capabilities,
        lastSeenAt: probe.ok ? Date.now() : undefined,
      });
      return reply.code(201).send(redactSecret(updated ?? conn));
    } catch (err: any) {
      // 健康检查失败不影响创建 — 返回 disconnected 状态
      return reply.code(201).send(redactSecret(conn));
    }
  });

  app.post<{ Params: { id: string } }>('/connections/:id/test', async (req, reply) => {
    const c = ConnectionRepo.get(req.params.id);
    if (!c) return reply.code(404).send({ error: '不存在' });
    ConnectionManager.register(c);
    try {
      const probe = await ConnectionManager.health(req.params.id);
      ConnectionRepo.update(req.params.id, { capabilities: probe.capabilities, lastSeenAt: probe.ok ? Date.now() : undefined });
      return probe;
    }
    catch (err: any) { return reply.code(502).send({ error: err.message }); }
  });

  // 手动触发所有连接健康检查
  app.post('/connections/health-all', async () => {
    await ConnectionManager.healthCheckAll();
    return { ok: true, message: '健康检查已触发' };
  });

  // 实时状态 (从 ConnectionManager 内存拿, 非 DB)
  app.get<{ Params: { id: string } }>('/connections/:id/status', async (req) => {
    const managed = ConnectionManager.getManaged(req.params.id);
    if (!managed) return { id: req.params.id, status: 'unknown', inMemory: false };
    return {
      id: req.params.id, status: managed.conn.status, inMemory: true,
      retryCount: managed.retryCount, lastError: managed.lastError ?? null,
      hasHandle: !!managed.handle, capabilities: managed.conn.capabilities,
      lastSeenAt: managed.conn.lastSeenAt,
    };
  });

  app.patch<{ Params: { id: string } }>('/connections/:id', async (req, reply) => {
    const c = ConnectionRepo.get(req.params.id);
    if (!c) return reply.code(404).send({ error: '不存在' });
    const body: any = req.body ?? {};
    if (body.auth?.secret) {
      const enc = encryptCredential(body.auth.secret);
      body.auth = { type: body.auth.type, ...enc };
    }
    const updated = ConnectionRepo.update(req.params.id, body);
    return updated ? redactSecret(updated) : reply.code(404).send({ error: '不存在' });
  });

  app.delete<{ Params: { id: string } }>('/connections/:id', async (req, reply) => {
    ConnectionManager.unregister(req.params.id);
    ConnectionRepo.delete(req.params.id);
    return { ok: true };
  });
}

function redactSecret(c: AgentConnection): any {
  return { ...c, auth: { type: c.auth.type } };
}
