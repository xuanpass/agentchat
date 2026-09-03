import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── 插件生态 2.0 ──

const reviewSchema = z.object({
  capabilityId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

const dependencySchema = z.object({
  capabilityId: z.string().min(1),
  dependsOn: z.string().min(1),
  versionConstraint: z.string().default('*'),
});

export async function pluginEcosystemRoutes(app: FastifyInstance) {

  // ── 插件评分/评论 ──

  // 创建评论
  app.post('/plugin-reviews', async (req, reply) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    const userId = (req.headers['x-user-id'] as string) || 'anonymous';
    getDb().prepare(`
      INSERT INTO plugin_reviews (id, capability_id, user_id, rating, comment, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.capabilityId, userId, body.rating, body.comment ?? null, now, now);
    logAudit({ action: 'create', target_type: 'plugin_review', target_id: id, detail: { capabilityId: body.capabilityId, rating: body.rating } });
    return reply.code(201).send({ id, ...body, userId, createdAt: now, updatedAt: now });
  });

  // 列出插件评论
  app.get('/plugin-reviews', async (req) => {
    const { capabilityId, limit, offset } = req.query as any;
    let sql = 'SELECT * FROM plugin_reviews WHERE 1=1';
    const params: any[] = [];
    if (capabilityId) { sql += ' AND capability_id = ?'; params.push(capabilityId); }
    sql += ' ORDER BY created_at DESC';
    const lim = Math.min(Number(limit) || 20, 100);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    return getDb().prepare(sql).all(...params);
  });

  // 插件评分汇总
  app.get('/plugin-reviews/summary', async (req) => {
    const { capabilityId } = req.query as any;
    if (!capabilityId) return { error: '需要 capabilityId', status: 400 };
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM plugin_reviews WHERE capability_id = ?').get(capabilityId) as any)?.c ?? 0;
    const avgRating = (db.prepare('SELECT COALESCE(AVG(rating), 0) as avg FROM plugin_reviews WHERE capability_id = ?').get(capabilityId) as any)?.avg ?? 0;
    const distribution = db.prepare('SELECT rating, COUNT(*) as c FROM plugin_reviews WHERE capability_id = ? GROUP BY rating ORDER BY rating DESC').all(capabilityId);
    return { capabilityId, total, avgRating: Math.round(avgRating * 10) / 10, distribution };
  });

  // 更新评论
  app.patch<{ Params: { id: string } }>('/plugin-reviews/:id', async (req, reply) => {
    const body = req.body as any;
    const existing = getDb().prepare('SELECT * FROM plugin_reviews WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });
    const fields: string[] = [];
    const params: any[] = [];
    if (body.rating !== undefined) { fields.push('rating = ?'); params.push(body.rating); }
    if (body.comment !== undefined) { fields.push('comment = ?'); params.push(body.comment); }
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);
    getDb().prepare(`UPDATE plugin_reviews SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return getDb().prepare('SELECT * FROM plugin_reviews WHERE id = ?').get(req.params.id);
  });

  // 删除评论
  app.delete<{ Params: { id: string } }>('/plugin-reviews/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM plugin_reviews WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // ── 插件依赖管理 ──

  // 添加依赖
  app.post('/plugin-dependencies', async (req, reply) => {
    const parsed = dependencySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    getDb().prepare(`
      INSERT INTO plugin_dependencies (id, capability_id, depends_on, version_constraint, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, body.capabilityId, body.dependsOn, body.versionConstraint, Date.now());
    return reply.code(201).send({ id, ...body, createdAt: Date.now() });
  });

  // 列出插件依赖
  app.get('/plugin-dependencies', async (req) => {
    const { capabilityId } = req.query as any;
    let sql = 'SELECT * FROM plugin_dependencies WHERE 1=1';
    const params: any[] = [];
    if (capabilityId) { sql += ' AND capability_id = ?'; params.push(capabilityId); }
    return getDb().prepare(sql).all(...params);
  });

  // 删除依赖
  app.delete<{ Params: { id: string } }>('/plugin-dependencies/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM plugin_dependencies WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 检查依赖完整性
  app.get('/plugin-dependencies/check', async (req) => {
    const { capabilityId } = req.query as any;
    if (!capabilityId) return { error: '需要 capabilityId', status: 400 };
    const deps = getDb().prepare('SELECT * FROM plugin_dependencies WHERE capability_id = ?').all(capabilityId) as any[];
    const allCaps = getDb().prepare('SELECT id, name, version FROM capabilities').all() as any[];
    const capMap = new Map(allCaps.map(c => [c.id, c]));

    const results = deps.map(dep => {
      const installed = capMap.get(dep.depends_on);
      return {
        dependsOn: dep.depends_on,
        required: dep.version_constraint,
        installed: installed ? { id: installed.id, name: installed.name, version: installed.version } : null,
        satisfied: !!installed,
      };
    });

    return { capabilityId, dependencies: results, allSatisfied: results.every(r => r.satisfied) };
  });

  // ── 插件市场增强 ──

  // 插件搜索 (增强版, 支持评分排序)
  app.get('/plugins/search', async (req) => {
    const { q, type, sort, limit, offset } = req.query as any;
    let sql = `
      SELECT c.*,
             COALESCE(AVG(r.rating), 0) as avg_rating,
             COUNT(r.id) as review_count
      FROM capabilities c
      LEFT JOIN plugin_reviews r ON c.id = r.capability_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (q) { sql += ' AND (c.name LIKE ? OR c.payload LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (type) { sql += ' AND c.type = ?'; params.push(type); }
    sql += ' GROUP BY c.id';
    if (sort === 'rating') sql += ' ORDER BY avg_rating DESC, review_count DESC';
    else if (sort === 'name') sql += ' ORDER BY c.name ASC';
    else sql += ' ORDER BY c.created_at DESC';
    const lim = Math.min(Number(limit) || 20, 100);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id, type: r.type, name: r.name, version: r.version,
      sourceKind: r.source_kind, sizeBytes: r.size_bytes,
      avgRating: Math.round(r.avg_rating * 10) / 10,
      reviewCount: r.review_count,
      installedOn: JSON.parse(r.installed_on || '[]'),
      createdAt: r.created_at,
    }));
  });

  // 热门插件 (按评分和评论数)
  app.get('/plugins/popular', async (req) => {
    const { limit } = req.query as any;
    const lim = Math.min(Number(limit) || 10, 50);
    return getDb().prepare(`
      SELECT c.id, c.name, c.type, c.version,
             COALESCE(AVG(r.rating), 0) as avg_rating,
             COUNT(r.id) as review_count
      FROM capabilities c
      LEFT JOIN plugin_reviews r ON c.id = r.capability_id
      GROUP BY c.id
      HAVING review_count > 0
      ORDER BY avg_rating DESC, review_count DESC
      LIMIT ?
    `).all(lim);
  });
}
