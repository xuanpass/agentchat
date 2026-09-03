import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── M16: 仪表盘自定义前端 (扩展 M15 后端) ──

const widgetLayoutSchema = z.object({
  widgets: z.array(z.object({
    id: z.string(),
    type: z.enum(['stat', 'chart', 'list', 'activity', 'health', 'alerts']),
    title: z.string(),
    x: z.number().default(0),
    y: z.number().default(0),
    w: z.number().default(4),
    h: z.number().default(3),
    config: z.record(z.any()).default({}),
  })),
});

export async function dashboardCustomizeRoutes(app: FastifyInstance) {

  // 获取用户仪表盘布局
  app.get('/dashboard-customize/layout', async (req) => {
    const { userId } = req.query as any;
    const layout = getDb().prepare('SELECT * FROM dashboard_widgets WHERE user_id = ? OR user_id IS NULL ORDER BY position ASC').all(userId ?? null) as any[];
    if (layout.length === 0) {
      // 返回默认布局
      return getDefaultLayout();
    }
    return layout.map(w => ({ ...w, config: JSON.parse(w.config || '{}') }));
  });

  // 保存仪表盘布局
  app.post('/dashboard-customize/layout', async (req, reply) => {
    const parsed = widgetLayoutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const { userId } = req.query as any;
    const uid = userId ?? 'default';

    const db = getDb();
    // 删除旧布局
    db.prepare('DELETE FROM dashboard_widgets WHERE user_id = ? OR user_id IS NULL').run(uid);

    // 插入新布局
    const stmt = db.prepare(`
      INSERT INTO dashboard_widgets (id, user_id, type, title, position, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (let i = 0; i < body.widgets.length; i++) {
      const w = body.widgets[i];
      stmt.run(w.id, uid, w.type, w.title, i, JSON.stringify({ x: w.x, y: w.y, w: w.w, h: w.h, ...w.config }), now, now);
    }

    logAudit(req, 'dashboard.layout.save', 'dashboard', uid, `${body.widgets.length} widgets`);
    return { ok: true, count: body.widgets.length };
  });

  // 添加单个 Widget
  app.post('/dashboard-customize/widgets', async (req, reply) => {
    const body = req.body as any;
    if (!body.type || !body.title) return reply.code(400).send({ error: 'Missing type or title' });
    const id = uuid();
    const now = Date.now();
    const { userId } = req.query as any;
    const uid = userId ?? 'default';

    // 获取当前最大 position
    const maxPos = (getDb().prepare('SELECT MAX(position) as p FROM dashboard_widgets WHERE user_id = ? OR user_id IS NULL').get(uid) as any)?.p ?? -1;

    getDb().prepare(`
      INSERT INTO dashboard_widgets (id, user_id, type, title, position, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, uid, body.type, body.title, maxPos + 1, JSON.stringify(body.config ?? {}), now, now);

    return reply.code(201).send({ id, type: body.type, title: body.title, position: maxPos + 1, createdAt: now });
  });

  // 更新 Widget
  app.patch<{ Params: { id: string } }>('/dashboard-customize/widgets/:id', async (req, reply) => {
    const body = req.body as any;
    const existing = getDb().prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Widget not found' });

    const fields: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) { fields.push('title = ?'); params.push(body.title); }
    if (body.type !== undefined) { fields.push('type = ?'); params.push(body.type); }
    if (body.position !== undefined) { fields.push('position = ?'); params.push(body.position); }
    if (body.config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(body.config)); }
    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);
    getDb().prepare(`UPDATE dashboard_widgets SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = getDb().prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id) as any;
    return { ...updated, config: JSON.parse(updated.config || '{}') };
  });

  // 删除 Widget
  app.delete<{ Params: { id: string } }>('/dashboard-customize/widgets/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Widget not found' });
    return { ok: true };
  });

  // 重置为默认布局
  app.post('/dashboard-customize/reset', async (req, reply) => {
    const { userId } = req.query as any;
    const uid = userId ?? 'default';
    getDb().prepare('DELETE FROM dashboard_widgets WHERE user_id = ? OR user_id IS NULL').run(uid);
    logAudit(req, 'dashboard.layout.reset', 'dashboard', uid, null);
    return { ok: true, layout: getDefaultLayout() };
  });

  // 可用 Widget 类型
  app.get('/dashboard-customize/widget-types', async () => {
    return [
      { type: 'stat', name: '统计卡片', description: '显示关键指标数字', icon: '📊', defaultW: 2, defaultH: 2 },
      { type: 'chart', name: '图表', description: '折线图/柱状图/饼图', icon: '📈', defaultW: 4, defaultH: 3 },
      { type: 'list', name: '列表', description: '最新记录列表', icon: '📋', defaultW: 4, defaultH: 4 },
      { type: 'activity', name: '活动流', description: '最近操作时间线', icon: '⚡', defaultW: 3, defaultH: 4 },
      { type: 'health', name: '健康状态', description: '连接/服务健康', icon: '💚', defaultW: 3, defaultH: 3 },
      { type: 'alerts', name: '告警面板', description: '未确认告警', icon: '🔔', defaultW: 3, defaultH: 3 },
    ];
  });
}

function getDefaultLayout() {
  return [
    { id: 'w-stat-sessions', type: 'stat', title: '总会话数', position: 0, config: { metric: 'totalSessions', icon: '💬' } },
    { id: 'w-stat-runs', type: 'stat', title: '总运行数', position: 1, config: { metric: 'totalRuns', icon: '⚙️' } },
    { id: 'w-stat-tokens', type: 'stat', title: '总 Token', position: 2, config: { metric: 'totalTokens', icon: '🧮' } },
    { id: 'w-stat-alerts', type: 'stat', title: '活跃告警', position: 3, config: { metric: 'activeAlerts', icon: '🔔' } },
    { id: 'w-chart-trend', type: 'chart', title: 'Token 趋势', position: 4, config: { chartType: 'line', dataSource: 'token_usage' } },
    { id: 'w-list-recent', type: 'list', title: '最近运行', position: 5, config: { dataSource: 'runs', limit: 10 } },
    { id: 'w-health', type: 'health', title: '系统健康', position: 6, config: {} },
    { id: 'w-alerts', type: 'alerts', title: '未确认告警', position: 7, config: { limit: 5 } },
  ];
}
