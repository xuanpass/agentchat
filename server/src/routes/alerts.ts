import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── 告警系统 ──

const createAlertSchema = z.object({
  type: z.string(),       // 'connection_error' | 'health_check_failed' | 'rate_limit' | 'custom'
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  message: z.string(),
  sourceType: z.string().optional(),  // 'connection' | 'session' | 'system'
  sourceId: z.string().optional(),
});

const updateAlertSchema = z.object({
  acknowledged: z.boolean().optional(),
});

export async function alertRoutes(app: FastifyInstance) {

  // 创建告警
  app.post('/alerts', async (req, reply) => {
    const parsed = createAlertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    getDb().prepare(`
      INSERT INTO alerts (id, type, severity, message, source_type, source_id, acknowledged, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, body.type, body.severity, body.message, body.sourceType ?? null, body.sourceId ?? null, Date.now());
    logAudit({ action: 'create', target_type: 'alert', target_id: id, detail: { type: body.type, message: body.message } });
    return reply.code(201).send({ id, ...body, acknowledged: false, createdAt: Date.now() });
  });

  // 列出告警 (支持过滤/分页)
  app.get('/alerts', async (req) => {
    const { severity, acknowledged, limit, offset } = req.query as any;
    let sql = 'SELECT * FROM alerts WHERE 1=1';
    const params: any[] = [];
    if (severity) { sql += ' AND severity = ?'; params.push(severity); }
    if (acknowledged !== undefined) { sql += ' AND acknowledged = ?'; params.push(acknowledged === 'true' || acknowledged === '1' ? 1 : 0); }
    sql += ' ORDER BY created_at DESC';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    return getDb().prepare(sql).all(...params);
  });

  // 告警统计
  app.get('/alerts/stats', async () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM alerts').get() as any)?.c ?? 0;
    const unack = (db.prepare('SELECT COUNT(*) as c FROM alerts WHERE acknowledged = 0').get() as any)?.c ?? 0;
    const bySeverity = db.prepare('SELECT severity, COUNT(*) as c FROM alerts GROUP BY severity').all();
    const byType = db.prepare('SELECT type, COUNT(*) as c FROM alerts GROUP BY type ORDER BY c DESC LIMIT 10').all();
    return { total, unacknowledged: unack, bySeverity, byType };
  });

  // 单个告警详情
  app.get<{ Params: { id: string } }>('/alerts/:id', async (req) => {
    return getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id) ?? { error: 'Not Found', status: 404 };
  });

  // 更新告警 (确认/取消确认)
  app.patch<{ Params: { id: string } }>('/alerts/:id', async (req, reply) => {
    const parsed = updateAlertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const existing = getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });

    if (body.acknowledged !== undefined) {
      getDb().prepare('UPDATE alerts SET acknowledged = ? WHERE id = ?').run(body.acknowledged ? 1 : 0, req.params.id);
    }
    return getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  });

  // 批量确认告警
  app.post('/alerts/acknowledge-all', async (req) => {
    const { severity } = (req.body ?? {}) as any;
    let sql = 'UPDATE alerts SET acknowledged = 1 WHERE acknowledged = 0';
    const params: any[] = [];
    if (severity) { sql += ' AND severity = ?'; params.push(severity); }
    const result = getDb().prepare(sql).run(...params);
    return { updated: result.changes };
  });

  // 删除告警
  app.delete<{ Params: { id: string } }>('/alerts/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 清理已确认告警
  app.delete('/alerts', async (req) => {
    const { olderThanDays } = req.query as any;
    let sql = 'DELETE FROM alerts WHERE acknowledged = 1';
    const params: any[] = [];
    if (olderThanDays) {
      const cutoff = Date.now() - Number(olderThanDays) * 86400000;
      sql += ' AND created_at < ?';
      params.push(cutoff);
    }
    const result = getDb().prepare(sql).run(...params);
    return { deleted: result.changes };
  });
}

/** 辅助函数: 从 ConnectionManager 代码内部创建告警 */
export function emitAlert(params: {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  sourceType?: string;
  sourceId?: string;
}): void {
  const id = uuid();
  getDb().prepare(`
    INSERT INTO alerts (id, type, severity, message, source_type, source_id, acknowledged, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, params.type, params.severity, params.message, params.sourceType ?? null, params.sourceId ?? null, Date.now());
  logAudit({ action: 'create', target_type: 'alert', target_id: id, detail: { type: params.type, message: params.message } });
}
