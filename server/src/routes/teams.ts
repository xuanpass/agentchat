import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ConnectionManager } from '../services/ConnectionManager.js';
import { ConnectionRepo } from '../db/connections.js';
import { getDriver } from '../adapters/index.js';
import { eventBus } from '../services/EventBus.js';

const createTeamSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  members: z.array(z.object({
    connectionId: z.string(),
    role: z.enum(['lead', 'worker', 'reviewer', 'observer']),
    interop: z.array(z.enum(['bff-bus', 'native-tool', 'channel-webhook'])).default(['bff-bus']),
    status: z.enum(['online', 'busy', 'offline', 'error']).default('offline'),
  })).default([]),
});

export async function teamRoutes(app: FastifyInstance) {
  app.get('/teams', async () => {
    const rows = getDb().prepare('SELECT * FROM teams ORDER BY created_at DESC').all() as any[];
    return rows.map(parseTeamRow);
  });
  app.get<{ Params: { id: string } }>('/teams/:id', async (req) => {
    const t = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    return t ? parseTeamRow(t) : { error: '不存在', status: 404 };
  });

  app.post('/teams', async (req, reply) => {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const ts = Date.now();
    const id = uuid();
    getDb().prepare(`INSERT INTO teams (id, name, description, members, version, created_at, updated_at) VALUES (?,?,?,?,1,?,?)`)
      .run(id, body.name, body.description ?? null, JSON.stringify(body.members), ts, ts);
    return reply.code(201).send({ id, ...body, version: 1, createdAt: ts, updatedAt: ts });
  });

  app.patch<{ Params: { id: string } }>('/teams/:id', async (req) => {
    const t = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    if (!t) return { error: '不存在', status: 404 };
    const body: any = req.body ?? {};
    const merged = {
      name: body.name ?? t.name,
      description: body.description ?? t.description,
      members: body.members ? JSON.stringify(body.members) : t.members,
    };
    getDb().prepare('UPDATE teams SET name=?, description=?, members=?, version=version+1, updated_at=? WHERE id=?')
      .run(merged.name, merged.description, merged.members, Date.now(), req.params.id);
    const updated = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    return parseTeamRow(updated);
  });

  app.delete<{ Params: { id: string } }>('/teams/:id', async (req) => {
    getDb().prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // 队内消息路由 — BFF 总线派发 (M13: 实时协作)
  app.post<{ Params: { id: string } }>('/teams/:id/message', async (req, reply) => {
    const { to, payload, relay } = (req.body ?? {}) as any;
    if (!to || !payload) return reply.code(400).send({ error: 'to/payload 必填' });

    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    if (!team) return reply.code(404).send({ error: '团队不存在' });

    const members = team.members ? JSON.parse(team.members) : [];
    const target = members.find((m: any) => m.connectionId === to);
    if (!target) return reply.code(404).send({ error: '目标成员不在团队中' });

    const traceId = `t-${Date.now()}-${uuid().slice(0, 8)}`;

    try {
      const conn = ConnectionRepo.get(to);
      if (!conn) return reply.code(404).send({ error: '连接不存在' });

      // 异步发送 — 不阻塞响应, 失败时通过 SSE 广播错误
      ConnectionManager.ensureConnected(to).then(() => {
        const driver = getDriver(conn.kind);
        return driver.sendMessage(conn, to, payload).then((handle: any) => {
          const response = handle?.response || '';
          eventBus.emitEvent({
            type: 'team.message',
            data: {
              teamId: req.params.id,
              teamName: team.name,
              from: to,
              role: target.role,
              payload,
              response,
              traceId,
              timestamp: Date.now(),
            },
          });
        });
      }).catch((e: any) => {
        console.warn(`[teams] 消息派发到 ${to} 失败: ${e.message}`);
        eventBus.emitEvent({
          type: 'team.message.error',
          data: {
            teamId: req.params.id,
            from: to,
            role: target.role,
            payload,
            error: e.message,
            traceId,
            timestamp: Date.now(),
          },
        });
      });

      return { ok: true, relay: relay ?? 'bff-bus', traceId, to, role: target.role };
    } catch (e: any) {
      return reply.code(500).send({ error: `消息派发失败: ${e.message}` });
    }
  });
}

function parseTeamRow(t: any) {
  return {
    id: t.id, name: t.name, description: t.description ?? null,
    members: t.members ? JSON.parse(t.members) : [],
    version: t.version, createdAt: t.created_at, updatedAt: t.updated_at,
  };
}
