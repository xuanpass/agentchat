import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── Token 用量分析 ──

const recordTokenSchema = z.object({
  sessionId: z.string().optional(),
  teamId: z.string().optional(),
  connectionId: z.string().optional(),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  model: z.string().optional(),
});

export async function tokenUsageRoutes(app: FastifyInstance) {

  // 记录 token 用量
  app.post('/token-usage', async (req, reply) => {
    const parsed = recordTokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const total = body.tokensIn + body.tokensOut;
    // 估算成本: $0.002/1K input + $0.008/1K output (GPT-4 级别)
    const cost = (body.tokensIn / 1000 * 0.002) + (body.tokensOut / 1000 * 0.008);
    getDb().prepare(`
      INSERT INTO token_usage (id, session_id, team_id, connection_id, tokens_in, tokens_out, tokens_total, cost, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.sessionId ?? null, body.teamId ?? null, body.connectionId ?? null,
      body.tokensIn, body.tokensOut, total, cost, body.model ?? null, Date.now());
    return reply.code(201).send({ id, tokensIn: body.tokensIn, tokensOut: body.tokensOut, tokensTotal: total, cost });
  });

  // 用量列表 (支持过滤/分页)
  app.get('/token-usage', async (req) => {
    const { sessionId, teamId, connectionId, limit, offset } = req.query as any;
    let sql = 'SELECT * FROM token_usage WHERE 1=1';
    const params: any[] = [];
    if (sessionId) { sql += ' AND session_id = ?'; params.push(sessionId); }
    if (teamId) { sql += ' AND team_id = ?'; params.push(teamId); }
    if (connectionId) { sql += ' AND connection_id = ?'; params.push(connectionId); }
    sql += ' ORDER BY created_at DESC';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    return getDb().prepare(sql).all(...params);
  });

  // 汇总统计
  app.get('/token-usage/summary', async (req) => {
    const { teamId, period } = req.query as any;
    let timeFilter = '';
    const params: any[] = [];
    if (period === '24h') {
      timeFilter = ' AND created_at > ?';
      params.push(Date.now() - 86400000);
    } else if (period === '7d') {
      timeFilter = ' AND created_at > ?';
      params.push(Date.now() - 604800000);
    } else if (period === '30d') {
      timeFilter = ' AND created_at > ?';
      params.push(Date.now() - 2592000000);
    }
    if (teamId) {
      timeFilter += ' AND team_id = ?';
      params.push(teamId);
    }
    const db = getDb();
    const totals = (db.prepare(`
      SELECT COALESCE(SUM(tokens_in), 0) as tokensIn,
             COALESCE(SUM(tokens_out), 0) as tokensOut,
             COALESCE(SUM(tokens_total), 0) as tokensTotal,
             COALESCE(SUM(cost), 0) as cost,
             COUNT(*) as records
      FROM token_usage WHERE 1=1 ${timeFilter}
    `).get(...params) as any);

    // 按天聚合趋势
    const daily = db.prepare(`
      SELECT date(created_at / 1000, 'unixepoch') as day,
             SUM(tokens_total) as tokens,
             SUM(cost) as cost
      FROM token_usage WHERE 1=1 ${timeFilter}
      GROUP BY day ORDER BY day ASC
    `).all(...params);

    // 按模型分布
    const byModel = db.prepare(`
      SELECT COALESCE(model, 'unknown') as model,
             SUM(tokens_total) as tokens,
             SUM(cost) as cost,
             COUNT(*) as records
      FROM token_usage WHERE 1=1 ${timeFilter}
      GROUP BY model ORDER BY tokens DESC
    `).all(...params);

    return { totals, daily, byModel };
  });

  // 按会话聚合
  app.get('/token-usage/by-session', async (req) => {
    const { limit } = req.query as any;
    const lim = Math.min(Number(limit) || 20, 100);
    return getDb().prepare(`
      SELECT session_id, SUM(tokens_total) as tokens, SUM(cost) as cost, COUNT(*) as records
      FROM token_usage WHERE session_id IS NOT NULL
      GROUP BY session_id ORDER BY tokens DESC LIMIT ?
    `).all(lim);
  });

  // 删除记录
  app.delete<{ Params: { id: string } }>('/token-usage/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM token_usage WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });
}
