import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── 智能体监控 ──

const recordMetricSchema = z.object({
  connectionId: z.string().optional(),
  metricType: z.enum(['latency', 'throughput', 'error_rate', 'token_rate', 'queue_depth', 'active_tasks']),
  value: z.number(),
  labels: z.record(z.string()).optional(),
});

export async function agentMetricsRoutes(app: FastifyInstance) {

  // 记录指标
  app.post('/agent-metrics', async (req, reply) => {
    const parsed = recordMetricSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    getDb().prepare(`
      INSERT INTO agent_metrics (id, connection_id, metric_type, value, labels, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, body.connectionId ?? null, body.metricType, body.value, JSON.stringify(body.labels ?? {}), Date.now());
    return reply.code(201).send({ id, ...body, recordedAt: Date.now() });
  });

  // 批量记录指标
  app.post('/agent-metrics/batch', async (req, reply) => {
    const metrics = (req.body as any)?.metrics;
    if (!Array.isArray(metrics) || metrics.length === 0) return reply.code(400).send({ error: '无效的指标数组' });
    const now = Date.now();
    const stmt = getDb().prepare(`
      INSERT INTO agent_metrics (id, connection_id, metric_type, value, labels, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const inserted = metrics.map((m: any) => {
      const id = uuid();
      stmt.run(id, m.connectionId ?? null, m.metricType, m.value, JSON.stringify(m.labels ?? {}), now);
      return id;
    });
    return reply.code(201).send({ inserted: inserted.length, ids: inserted });
  });

  // 查询指标 (支持过滤/聚合)
  app.get('/agent-metrics', async (req) => {
    const { connectionId, metricType, start, end, limit, aggregate } = req.query as any;
    const params: any[] = [];
    let sql = 'SELECT * FROM agent_metrics WHERE 1=1';
    if (connectionId) { sql += ' AND connection_id = ?'; params.push(connectionId); }
    if (metricType) { sql += ' AND metric_type = ?'; params.push(metricType); }
    if (start) { sql += ' AND recorded_at >= ?'; params.push(Number(start)); }
    if (end) { sql += ' AND recorded_at <= ?'; params.push(Number(end)); }

    if (aggregate === '1m' || aggregate === '5m' || aggregate === '1h') {
      const interval = aggregate === '1m' ? 60000 : aggregate === '5m' ? 300000 : 3600000;
      sql = `SELECT connection_id, metric_type, (recorded_at / ${interval}) * ${interval} as bucket,
             AVG(value) as avg_value, MIN(value) as min_value, MAX(value) as max_value, COUNT(*) as count
             FROM agent_metrics WHERE 1=1`;
      if (connectionId) { sql += ' AND connection_id = ?'; }
      if (metricType) { sql += ' AND metric_type = ?'; }
      if (start) { sql += ' AND recorded_at >= ?'; }
      if (end) { sql += ' AND recorded_at <= ?'; }
      sql += ' GROUP BY connection_id, metric_type, bucket ORDER BY bucket ASC';
      const lim = Math.min(Number(limit) || 100, 500);
      sql += ' LIMIT ?';
      params.push(lim);
      return getDb().prepare(sql).all(...params);
    }

    sql += ' ORDER BY recorded_at DESC';
    const lim = Math.min(Number(limit) || 100, 500);
    const off = Number((req.query as Record<string, unknown>)['offset'] as string) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    return getDb().prepare(sql).all(...params);
  });

  // 指标汇总仪表盘
  app.get('/agent-metrics/dashboard', async () => {
    const db = getDb();
    const now = Date.now();
    const fiveMinAgo = now - 300000;
    const oneHourAgo = now - 3600000;

    // 最近 5 分钟各指标
    const recent = db.prepare(`
      SELECT metric_type, AVG(value) as avg, MAX(value) as max, MIN(value) as min, COUNT(*) as count
      FROM agent_metrics WHERE recorded_at > ?
      GROUP BY metric_type
    `).all(fiveMinAgo);

    // 最近 1 小时趋势 (按分钟)
    const hourlyTrend = db.prepare(`
      SELECT metric_type, (recorded_at / 60000) * 60000 as minute, AVG(value) as avg
      FROM agent_metrics WHERE recorded_at > ?
      GROUP BY metric_type, minute ORDER BY minute ASC
    `).all(oneHourAgo);

    // 按连接器的健康状态
    const byConnection = db.prepare(`
      SELECT connection_id,
             AVG(CASE WHEN metric_type = 'error_rate' THEN value END) as error_rate,
             AVG(CASE WHEN metric_type = 'latency' THEN value END) as avg_latency,
             AVG(CASE WHEN metric_type = 'throughput' THEN value END) as throughput,
             MAX(recorded_at) as last_seen
      FROM agent_metrics WHERE recorded_at > ?
      GROUP BY connection_id
    `).all(oneHourAgo);

    // 总览
    const overview = {
      totalMetrics: (db.prepare('SELECT COUNT(*) as c FROM agent_metrics').get() as any)?.c ?? 0,
      recent5min: (db.prepare('SELECT COUNT(*) as c FROM agent_metrics WHERE recorded_at > ?').get(fiveMinAgo) as any)?.c ?? 0,
      activeConnections: byConnection.length,
    };

    return { overview, recent, hourlyTrend, byConnection };
  });

  // 清理旧指标
  app.delete('/agent-metrics', async (req) => {
    const { olderThanDays } = req.query as any;
    const cutoff = Date.now() - (Number(olderThanDays) || 7) * 86400000;
    const result = getDb().prepare('DELETE FROM agent_metrics WHERE recorded_at < ?').run(cutoff);
    return { deleted: result.changes };
  });
}
