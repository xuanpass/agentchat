import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';

const createRunSchema = z.object({
  teamId: z.string().optional(),
  sessionIds: z.array(z.string()).default([]),
  strategy: z.enum(['serial', 'parallel', 'fanout']).default('serial'),
  context: z.string().optional(),
  initialMessage: z.string().optional(),
});

function parseRunRow(r: any) {
  return {
    id: r.id,
    teamId: r.team_id,
    sessionIds: r.session_ids ? JSON.parse(r.session_ids) : [],
    traceId: r.trace_id,
    status: r.status,
    strategy: r.strategy,
    context: r.context ?? null,
    events: r.events ? JSON.parse(r.events) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function runRoutes(app: FastifyInstance) {
  // 列表 — 可按 teamId / status 过滤
  app.get('/runs', async (req) => {
    const { teamId, status, limit } = req.query as any;
    let sql = 'SELECT * FROM runs WHERE 1=1';
    const params: any[] = [];
    if (teamId) { sql += ' AND team_id = ?'; params.push(teamId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(parseRunRow);
  });

  // 详情
  app.get<{ Params: { id: string } }>('/runs/:id', async (req) => {
    const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as any;
    return r ? parseRunRow(r) : { error: '不存在', status: 404 };
  });

  // 创建运行
  app.post('/runs', async (req, reply) => {
    const parsed = createRunSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const ts = Date.now();
    const id = uuid();
    const traceId = `t-${ts}-${id.slice(0, 8)}`;

    getDb().prepare(
      `INSERT INTO runs (id, team_id, session_ids, trace_id, status, strategy, context, events, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, body.teamId ?? null, JSON.stringify(body.sessionIds), traceId, 'queued',
      body.strategy, body.context ?? null, '[]', ts, ts);

    return reply.code(201).send(parseRunRow({
      id, team_id: body.teamId, session_ids: JSON.stringify(body.sessionIds),
      trace_id: traceId, status: 'queued', strategy: body.strategy,
      context: body.context, events: '[]', created_at: ts, updated_at: ts,
    }));
  });

  // 追加事件
  app.post<{ Params: { id: string } }>('/runs/:id/events', async (req, reply) => {
    const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as any;
    if (!r) return reply.code(404).send({ error: '不存在' });

    const events = r.events ? JSON.parse(r.events) : [];
    const event = {
      seq: events.length + 1,
      type: (req.body as any)?.type ?? 'info',
      source: (req.body as any)?.source ?? 'system',
      payload: (req.body as any)?.payload ?? {},
      ts: Date.now(),
    };
    events.push(event);

    getDb().prepare('UPDATE runs SET events = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(events), Date.now(), req.params.id);

    return event;
  });

  // 更新状态
  app.patch<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as any;
    if (!r) return reply.code(404).send({ error: '不存在' });
    const b: any = req.body ?? {};
    const merged = {
      status: b.status ?? r.status,
      strategy: b.strategy ?? r.strategy,
      context: b.context ?? r.context,
      sessionIds: b.sessionIds ? JSON.stringify(b.sessionIds) : r.session_ids,
    };
    getDb().prepare('UPDATE runs SET status=?, strategy=?, context=?, session_ids=?, updated_at=? WHERE id=?')
      .run(merged.status, merged.strategy, merged.context, merged.sessionIds, Date.now(), req.params.id);
    const updated = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id) as any;
    return parseRunRow(updated);
  });

  // 删除
  app.delete<{ Params: { id: string } }>('/runs/:id', async (req) => {
    getDb().prepare('DELETE FROM runs WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}
