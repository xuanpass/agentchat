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

const broadcastSchema = z.object({
  message: z.string().min(1),
  excludeRoles: z.array(z.enum(['lead', 'worker', 'reviewer', 'observer'])).optional(),
});

const orchestrateStepSchema = z.object({
  connectionId: z.string(),
  role: z.enum(['worker', 'reviewer']),
  promptTemplate: z.string().default('{{previous}}'),
});

const orchestrateSchema = z.object({
  prompt: z.string().min(1),
  steps: z.array(orchestrateStepSchema).min(1),
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

  // ── 团队协作: 广播 / 编排 / 历史记录 ──

  /** POST /api/teams/:id/broadcast — 团队广播，所有非 observer 成员异步响应 */
  app.post<{ Params: { id: string } }>('/teams/:id/broadcast', async (req, reply) => {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { message, excludeRoles = ['observer'] } = parsed.data;

    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    if (!team) return reply.code(404).send({ error: '团队不存在' });

    const members = team.members ? JSON.parse(team.members) : [];
    const targets = members.filter((m: any) => !excludeRoles.includes(m.role));
    if (targets.length === 0) return reply.code(400).send({ error: '没有符合条件的成员' });

    const traceId = `bc-${Date.now()}-${uuid().slice(0, 8)}`;
    const ts = Date.now();

    // 记录 run
    const runId = uuid();
    getDb().prepare(`INSERT INTO runs (id, team_id, session_ids, trace_id, status, strategy, events, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', 'broadcast', ?, ?, ?)`)
      .run(runId, req.params.id, JSON.stringify([]), traceId, JSON.stringify([{ type: 'broadcast.started', timestamp: ts, message }]), ts, ts);

    // 并发发送，收集结果
    const results = await Promise.allSettled(targets.map(async (member: any) => {
      const conn = ConnectionRepo.get(member.connectionId);
      if (!conn) return { connectionId: member.connectionId, role: member.role, error: '连接不存在' };
      try {
        await ConnectionManager.ensureConnected(member.connectionId);
        const driver = getDriver(conn.kind);
        const handle = await driver.sendMessage(conn, member.connectionId, message);
        const response = handle?.response || handle?.text || '';
        return { connectionId: member.connectionId, role: member.role, response, timestamp: Date.now() };
      } catch (e: any) {
        console.warn(`[teams/broadcast] ${member.connectionId} 失败: ${e.message}`);
        return { connectionId: member.connectionId, role: member.role, error: e.message, timestamp: Date.now() };
      }
    }));

    const settled = results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...targets[i], error: r.reason?.message, timestamp: Date.now() });
    const allDone = settled.every((r: any) => !r.error);

    getDb().prepare(`UPDATE runs SET status=?, updated_at=? WHERE id=?`)
      .run(allDone ? 'completed' : 'failed', Date.now(), runId);

    eventBus.emitEvent({ type: 'team.message' as any, data: { teamId: req.params.id, traceId, results: settled } });
    return { traceId, runId, results: settled };
  });

  /** POST /api/teams/:id/orchestrate — 串行编排：lead→worker→reviewer 流水线 */
  app.post<{ Params: { id: string } }>('/teams/:id/orchestrate', async (req, reply) => {
    const parsed = orchestrateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { prompt, steps } = parsed.data;

    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    if (!team) return reply.code(404).send({ error: '团队不存在' });

    const traceId = `oc-${Date.now()}-${uuid().slice(0, 8)}`;
    const chain: any[] = [];
    let context = prompt;

    // 记录 run
    const runId = uuid();
    const runTs = Date.now();
    getDb().prepare(`INSERT INTO runs (id, team_id, session_ids, trace_id, status, strategy, context, events, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', 'orchestrate', ?, ?, ?, ?)`)
      .run(runId, req.params.id, JSON.stringify([]), traceId, JSON.stringify({ prompt, steps }), JSON.stringify([{ type: 'orchestrate.started', timestamp: runTs, prompt }]), runTs, runTs);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const conn = ConnectionRepo.get(step.connectionId);
      if (!conn) {
        chain.push({ step: i + 1, connectionId: step.connectionId, role: step.role, input: context, error: '连接不存在', timestamp: Date.now() });
        continue;
      }
      try {
        await ConnectionManager.ensureConnected(step.connectionId);
        const driver = getDriver(conn.kind);
        // 替换 promptTemplate 中的 {{previous}} 占位符
        const stepPrompt = step.promptTemplate.replace(/\{\{previous\}\}/g, context);
        const handle = await driver.sendMessage(conn, step.connectionId, stepPrompt);
        const output: string = String(handle?.response || handle?.text || '');
        chain.push({ step: i + 1, connectionId: step.connectionId, role: step.role, input: context, output, timestamp: Date.now() });
        context = output;
      } catch (e: any) {
        console.warn(`[teams/orchestrate] step ${i + 1} ${step.connectionId} 失败: ${e.message}`);
        chain.push({ step: i + 1, connectionId: step.connectionId, role: step.role, input: context, error: e.message, timestamp: Date.now() });
        break; // 失败则终止流水线
      }
    }

    const succeeded = chain.filter(c => !c.error).length;
    const allDone = succeeded === steps.length;
    getDb().prepare(`UPDATE runs SET status=?, context=?, updated_at=? WHERE id=?`)
      .run(allDone ? 'completed' : 'failed', context, Date.now(), runId);

    eventBus.emitEvent({ type: 'team.message' as any, data: { teamId: req.params.id, traceId, chain, finalContext: context } });
    return { traceId, runId, chain, finalContext: context };
  });

  /** GET /api/teams/:id/collab-history — 协作历史（复用 runs 表） */
  app.get<{ Params: { id: string } }>('/teams/:id/collab-history', async (req) => {
    const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) as any;
    if (!team) return { error: '团队不存在', status: 404 };

    const rows = getDb().prepare(
      `SELECT id, trace_id, status, strategy, context, events, created_at FROM runs
       WHERE team_id = ? AND strategy IN ('broadcast', 'orchestrate')
       ORDER BY created_at DESC LIMIT 50`
    ).all(req.params.id) as any[];

    return rows.map((r: any) => ({
      id: r.id, traceId: r.trace_id, status: r.status, type: r.strategy,
      prompt: r.context, events: r.events ? JSON.parse(r.events) : [],
      createdAt: r.created_at,
    }));
  });
}

function parseTeamRow(t: any) {
  return {
    id: t.id, name: t.name, description: t.description ?? null,
    members: t.members ? JSON.parse(t.members) : [],
    version: t.version, createdAt: t.created_at, updatedAt: t.updated_at,
  };
}
