import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── M16: 通知中心 ──

const createNotificationSchema = z.object({
  type: z.enum(['alert', 'system', 'info', 'warning', 'error']).default('info'),
  title: z.string().min(1),
  body: z.string().min(1),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  link: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export async function notificationRoutes(app: FastifyInstance) {

  // 创建通知
  app.post('/notifications', async (req, reply) => {
    const parsed = createNotificationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO notifications (id, type, title, body, source_type, source_id, link, priority, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, body.type, body.title, body.body, body.sourceType ?? null, body.sourceId ?? null, body.link ?? null, body.priority, now);
    return reply.code(201).send({ id, ...body, read: false, createdAt: now });
  });

  // 列出通知 (支持过滤/分页)
  app.get('/notifications', async (req) => {
    const { type, priority, read, limit, offset, search } = req.query as any;
    const params: any[] = [];
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (priority) { sql += ' AND priority = ?'; params.push(priority); }
    if (read !== undefined) { sql += ' AND read = ?'; params.push(read === 'true' || read === '1' ? 1 : 0); }
    if (search) { sql += ' AND (title LIKE ? OR body LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY created_at DESC';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    return getDb().prepare(sql).all(...params);
  });

  // 通知统计
  app.get('/notifications/stats', async () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM notifications').get() as any)?.c ?? 0;
    const unread = (db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read = 0').get() as any)?.c ?? 0;
    const byType = db.prepare('SELECT type, COUNT(*) as count FROM notifications GROUP BY type').all();
    const byPriority = db.prepare('SELECT priority, COUNT(*) as count FROM notifications GROUP BY priority').all();
    const urgent = (db.prepare("SELECT COUNT(*) as c FROM notifications WHERE priority = 'urgent' AND read = 0").get() as any)?.c ?? 0;
    return { total, unread, urgent, byType, byPriority };
  });

  // 单个通知
  app.get<{ Params: { id: string } }>('/notifications/:id', async (req, reply) => {
    const row = getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: 'Not Found' });
    return row;
  });

  // 标记已读
  app.patch<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    const now = Date.now();
    const result = getDb().prepare('UPDATE notifications SET read = 1, read_at = ? WHERE id = ?').run(now, req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true, readAt: now };
  });

  // 标记未读
  app.patch<{ Params: { id: string } }>('/notifications/:id/unread', async (req, reply) => {
    const result = getDb().prepare('UPDATE notifications SET read = 0, read_at = NULL WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 全部已读
  app.post('/notifications/mark-all-read', async (req) => {
    const now = Date.now();
    const filter = req.body as any;
    let sql = 'UPDATE notifications SET read = 1, read_at = ? WHERE read = 0';
    const params: any[] = [now];
    if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
    if (filter?.priority) { sql += ' AND priority = ?'; params.push(filter.priority); }
    const result = getDb().prepare(sql).run(...params);
    return { updated: result.changes };
  });

  // 删除通知
  app.delete<{ Params: { id: string } }>('/notifications/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 批量删除
  app.post('/notifications/bulk-delete', async (req) => {
    const ids = (req.body as any)?.ids;
    if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
    const placeholders = ids.map(() => '?').join(',');
    const result = getDb().prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids);
    logAudit(req, 'notifications.bulk_delete', 'notifications', null, `${ids.length} items`);
    return { deleted: result.changes };
  });

  // 清理旧通知
  app.post('/notifications/cleanup', async (req) => {
    const { olderThanDays, readOnly } = req.body as any;
    const cutoff = Date.now() - (Number(olderThanDays) || 30) * 86400000;
    let sql = 'DELETE FROM notifications WHERE created_at < ?';
    const params: any[] = [cutoff];
    if (readOnly) { sql += ' AND read = 1'; }
    const result = getDb().prepare(sql).run(...params);
    return { deleted: result.changes };
  });
}
