import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── 仪表盘自定义 Widget (M15/M16) ──

const widgetSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['stat', 'chart', 'list', 'activity', 'health', 'alerts', 'custom']),
  config: z.record(z.any()).default({}),
  position: z.number().int().default(0),
});

const updateWidgetSchema = widgetSchema.partial();

export async function dashboardWidgetRoutes(app: FastifyInstance) {

  // 创建 Widget
  app.post('/dashboard-widgets', async (req, reply) => {
    const parsed = widgetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    const userId = (req.headers['x-user-id'] as string) || 'default';
    getDb().prepare(`
      INSERT INTO dashboard_widgets (id, user_id, title, type, config, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, body.title, body.type, JSON.stringify(body.config), body.position, now, now);
    logAudit(req, 'dashboard_widget.create', 'dashboard_widget', id, body.title);
    return reply.code(201).send({ id, ...body, userId, createdAt: now, updatedAt: now });
  });

  // 列出 Widget (按用户)
  app.get('/dashboard-widgets', async (req) => {
    const userId = (req.headers['x-user-id'] as string) || 'default';
    const rows = getDb().prepare('SELECT * FROM dashboard_widgets WHERE user_id = ? ORDER BY position ASC').all(userId) as any[];
    return rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}') }));
  });

  // 单个 Widget
  app.get<{ Params: { id: string } }>('/dashboard-widgets/:id', async (req, reply) => {
    const row = getDb().prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id) as any;
    if (!row) return reply.code(404).send({ error: 'Not Found' });
    return { ...row, config: JSON.parse(row.config || '{}') };
  });

  // 更新 Widget
  app.patch<{ Params: { id: string } }>('/dashboard-widgets/:id', async (req, reply) => {
    const parsed = updateWidgetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const existing = getDb().prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });

    const fields: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) { fields.push('title = ?'); params.push(body.title); }
    if (body.type !== undefined) { fields.push('type = ?'); params.push(body.type); }
    if (body.config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(body.config)); }
    if (body.position !== undefined) { fields.push('position = ?'); params.push(body.position); }
    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);

    getDb().prepare(`UPDATE dashboard_widgets SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = getDb().prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id) as any;
    return { ...updated, config: JSON.parse(updated.config || '{}') };
  });

  // 删除 Widget
  app.delete<{ Params: { id: string } }>('/dashboard-widgets/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 批量更新位置 (拖拽排序)
  app.post('/dashboard-widgets/reorder', async (req, reply) => {
    const widgets = (req.body as any)?.widgets;
    if (!Array.isArray(widgets)) return reply.code(400).send({ error: '无效的 widgets 数组' });
    const stmt = getDb().prepare('UPDATE dashboard_widgets SET position = ?, updated_at = ? WHERE id = ?');
    for (let i = 0; i < widgets.length; i++) {
      stmt.run(i, Date.now(), widgets[i].id);
    }
    return { updated: widgets.length };
  });

  // 预设 Widget 模板
  app.get('/dashboard-widgets/templates', async () => {
    return [
      { title: '连接状态', type: 'stat', config: { metric: 'connections', format: 'count' } },
      { title: 'Token 趋势', type: 'chart', config: { chartType: 'line', metric: 'token_rate', period: '1h' } },
      { title: '错误率', type: 'stat', config: { metric: 'error_rate', format: 'percent', threshold: 5 } },
      { title: 'Agent 延迟', type: 'chart', config: { chartType: 'bar', metric: 'latency', period: '1h' } },
      { title: '运行记录', type: 'list', config: { source: 'runs', limit: 5 } },
      { title: '告警列表', type: 'list', config: { source: 'alerts', limit: 5, filter: 'unack' } },
      { title: '吞吐量', type: 'chart', config: { chartType: 'area', metric: 'throughput', period: '1h' } },
      { title: '队列深度', type: 'stat', config: { metric: 'queue_depth', format: 'number' } },
    ];
  });
}
