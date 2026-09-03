import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { ConnectionRepo } from '../db/connections.js';

const createProjectSchema = z.object({
  name: z.string().min(1),
  connectionId: z.string(),
  rootPath: z.string().min(1),
  description: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultAgent: z.string().optional(),
  contextHint: z.string().optional(),
});

function parseProjectRow(p: any) {
  const sessionIds: string[] = p.sessions ? JSON.parse(p.sessions) : [];
  // 丰富会话信息: 从 sessions 表查询标题和状态
  const sessionObjects = sessionIds.map((sid: string) => {
    const s = getDb().prepare('SELECT id, title, status FROM sessions WHERE id = ?').get(sid) as any;
    return s ? { id: s.id, title: s.title, status: s.status } : { id: sid, title: sid.slice(0, 12), status: 'unknown' };
  });
  return {
    id: p.id, name: p.name, connectionId: p.connection_id, rootPath: p.root_path,
    description: p.description ?? null, defaultModel: p.default_model ?? null,
    defaultAgent: p.default_agent ?? null, contextHint: p.context_hint ?? null,
    sessions: sessionObjects,
    createdAt: p.created_at, updatedAt: p.updated_at,
  };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', async (req) => {
    const { connectionId } = req.query as any;
    const rows = connectionId
      ? getDb().prepare('SELECT * FROM projects WHERE connection_id = ? ORDER BY created_at DESC').all(connectionId)
      : getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    return (rows as any[]).map(parseProjectRow);
  });

  app.get<{ Params: { id: string } }>('/projects/:id', async (req) => {
    const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as any;
    return r ? parseProjectRow(r) : { error: '不存在', status: 404 };
  });

  // 某实例下的项目列表
  app.get<{ Params: { id: string } }>('/connections/:id/projects', async (req) => {
    const rows = getDb().prepare('SELECT * FROM projects WHERE connection_id = ? ORDER BY created_at DESC').all(req.params.id);
    return (rows as any[]).map(parseProjectRow);
  });

  app.post('/projects', async (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    if (!ConnectionRepo.get(body.connectionId)) return reply.code(404).send({ error: '连接不存在' });
    const ts = Date.now();
    const id = uuid();
    getDb().prepare(`INSERT INTO projects (id, name, connection_id, root_path, description, default_model, default_agent, context_hint, sessions, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, body.name, body.connectionId, body.rootPath, body.description ?? null,
      body.defaultModel ?? null, body.defaultAgent ?? null, body.contextHint ?? null, '[]', ts, ts);
    return reply.code(201).send(parseProjectRow({
      id, name: body.name, connection_id: body.connectionId, root_path: body.rootPath,
      description: body.description, default_model: body.defaultModel, default_agent: body.defaultAgent,
      context_hint: body.contextHint, sessions: '[]', created_at: ts, updated_at: ts,
    }));
  });

  app.patch<{ Params: { id: string } }>('/projects/:id', async (req) => {
    const p = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as any;
    if (!p) return { error: '不存在', status: 404 };
    const b: any = req.body ?? {};
    const sessions = b.sessions
      ? JSON.stringify(Array.isArray(b.sessions) ? b.sessions : [])
      : p.sessions;
    const merged = {
      name: b.name ?? p.name, rootPath: b.rootPath ?? p.root_path, description: b.description ?? p.description,
      defaultModel: b.defaultModel ?? p.default_model, defaultAgent: b.defaultAgent ?? p.default_agent,
      contextHint: b.contextHint ?? p.context_hint, sessions,
    };
    getDb().prepare('UPDATE projects SET name=?, root_path=?, description=?, default_model=?, default_agent=?, context_hint=?, sessions=?, updated_at=? WHERE id=?')
      .run(merged.name, merged.rootPath, merged.description, merged.defaultModel, merged.defaultAgent, merged.contextHint, merged.sessions, Date.now(), req.params.id);
    const updated = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) as any;
    return parseProjectRow(updated);
  });

  app.delete<{ Params: { id: string } }>('/projects/:id', async (req) => {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
