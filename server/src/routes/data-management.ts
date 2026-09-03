import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── M16: 数据管理 (备份/恢复/迁移) ──

const createBackupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  includeConnections: z.boolean().default(true),
  includeSessions: z.boolean().default(true),
  includeAuditLog: z.boolean().default(false),
  includeTokenUsage: z.boolean().default(true),
});

export async function dataManagementRoutes(app: FastifyInstance) {

  // 创建备份
  app.post('/data-management/backups', async (req, reply) => {
    const parsed = createBackupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    const db = getDb();

    // 收集数据
    const backupData: any = { _meta: { id, name: body.name, description: body.description, createdAt: now, version: '1.0' } };

    if (body.includeConnections) {
      backupData.connections = db.prepare('SELECT * FROM connections').all();
    }
    if (body.includeSessions) {
      backupData.sessions = db.prepare('SELECT * FROM sessions').all();
      backupData.teams = db.prepare('SELECT * FROM teams').all();
      backupData.projects = db.prepare('SELECT * FROM projects').all();
      backupData.runs = db.prepare('SELECT * FROM runs').all();
    }
    if (body.includeAuditLog) {
      backupData.audit_log = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10000').all();
    }
    if (body.includeTokenUsage) {
      backupData.token_usage = db.prepare('SELECT * FROM token_usage').all();
      backupData.alerts = db.prepare('SELECT * FROM alerts').all();
      backupData.workflows = db.prepare('SELECT * FROM workflows').all();
    }

    const dataJson = JSON.stringify(backupData);
    const sizeBytes = Buffer.byteLength(dataJson, 'utf8');
    const checksum = simpleHash(dataJson);

    getDb().prepare(`
      INSERT INTO backup_records (id, name, description, type, status, size_bytes, checksum, data, created_at)
      VALUES (?, ?, ?, 'full', 'completed', ?, ?, ?, ?)
    `).run(id, body.name, body.description ?? '', sizeBytes, checksum, dataJson, now);

    logAudit(req, 'backup.create', 'backup', id, body.name);
    return reply.code(201).send({
      id, name: body.name, description: body.description, type: 'full',
      status: 'completed', sizeBytes, checksum, createdAt: now,
    });
  });

  // 列出备份
  app.get('/data-management/backups', async () => {
    const rows = getDb().prepare('SELECT id, name, description, type, status, size_bytes, checksum, created_at FROM backup_records ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ ...r, hasData: true }));
  });

  // 备份详情
  app.get<{ Params: { id: string } }>('/data-management/backups/:id', async (req, reply) => {
    const row = getDb().prepare('SELECT * FROM backup_records WHERE id = ?').get(req.params.id) as any;
    if (!row) return reply.code(404).send({ error: 'Not Found' });
    return row;
  });

  // 恢复备份
  app.post<{ Params: { id: string } }>('/data-management/backups/:id/restore', async (req, reply) => {
    const backup = getDb().prepare('SELECT * FROM backup_records WHERE id = ?').get(req.params.id) as any;
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });

    let data: any;
    try {
      data = JSON.parse(backup.data);
    } catch {
      return reply.code(400).send({ error: 'Invalid backup data' });
    }

    const db = getDb();
    const stats: Record<string, number> = {};

    // 恢复连接
    if (data.connections && Array.isArray(data.connections)) {
      db.prepare('DELETE FROM connections').run();
      const stmt = db.prepare('INSERT OR REPLACE INTO connections (id, name, kind, url, status, capabilities, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of data.connections) {
        stmt.run(item.id, item.name, item.kind, item.url, item.status, item.capabilities, item.last_seen_at, item.created_at);
      }
      stats.connections = data.connections.length;
    }

    // 恢复会话
    if (data.sessions && Array.isArray(data.sessions)) {
      db.prepare('DELETE FROM sessions').run();
      const stmt = db.prepare('INSERT OR REPLACE INTO sessions (id, connection_id, title, summary, message_count, status, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const item of data.sessions) {
        stmt.run(item.id, item.connection_id, item.title, item.summary, item.message_count, item.status, item.created_at, item.updated_at, item.last_active_at);
      }
      stats.sessions = data.sessions.length;
    }

    // 恢复团队
    if (data.teams && Array.isArray(data.teams)) {
      db.prepare('DELETE FROM teams').run();
      for (const item of data.teams) {
        db.prepare('INSERT OR REPLACE INTO teams (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(item.id, item.name, item.description, item.created_at);
      }
      stats.teams = data.teams.length;
    }

    // 恢复项目
    if (data.projects && Array.isArray(data.projects)) {
      db.prepare('DELETE FROM projects').run();
      for (const item of data.projects) {
        db.prepare('INSERT OR REPLACE INTO projects (id, name, description, status, created_at) VALUES (?, ?, ?, ?, ?)').run(item.id, item.name, item.description, item.status, item.created_at);
      }
      stats.projects = data.projects.length;
    }

    // 恢复运行记录
    if (data.runs && Array.isArray(data.runs)) {
      db.prepare('DELETE FROM runs').run();
      for (const item of data.runs) {
        db.prepare('INSERT OR REPLACE INTO runs (id, team_id, project_id, title, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(item.id, item.team_id, item.project_id, item.title, item.status, item.created_at);
      }
      stats.runs = data.runs.length;
    }

    // 恢复 Token 用量
    if (data.token_usage && Array.isArray(data.token_usage)) {
      db.prepare('DELETE FROM token_usage').run();
      for (const item of data.token_usage) {
        db.prepare('INSERT OR REPLACE INTO token_usage (id, session_id, team_id, connection_id, tokens_in, tokens_out, tokens_total, cost, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(item.id, item.session_id, item.team_id, item.connection_id, item.tokens_in, item.tokens_out, item.tokens_total, item.cost, item.model, item.created_at);
      }
      stats.token_usage = data.token_usage.length;
    }

    logAudit(req, 'backup.restore', 'backup', req.params.id, JSON.stringify(stats));
    return { ok: true, stats, restoredAt: Date.now() };
  });

  // 删除备份
  app.delete<{ Params: { id: string } }>('/data-management/backups/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM backup_records WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 导出数据 (轻量导出，不含 data 字段)
  app.get<{ Params: { id: string } }>('/data-management/backups/:id/export', async (req, reply) => {
    const backup = getDb().prepare('SELECT id, name, description, type, status, size_bytes, checksum, data, created_at FROM backup_records WHERE id = ?').get(req.params.id) as any;
    if (!backup) return reply.code(404).send({ error: 'Not Found' });
    return reply.header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="backup-${backup.name}.json"`)
      .send(backup.data);
  });

  // 数据统计概览
  app.get('/data-management/stats', async () => {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
    const stats: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any;
        stats[t.name] = row?.c ?? 0;
      } catch { /* skip */ }
    }
    const backups = db.prepare('SELECT id, name, size_bytes, created_at FROM backup_records ORDER BY created_at DESC').all();
    return { tables: stats, tableCount: tables.length, backups };
  });

  // 清理数据
  app.post('/data-management/cleanup', async (req) => {
    const { table, olderThanDays } = req.body as any;
    if (!table || !olderThanDays) return { error: 'Missing table or olderThanDays' };
    const cutoff = Date.now() - Number(olderThanDays) * 86400000;
    const allowedTables = ['audit_log', 'alerts', 'token_usage', 'runs', 'notifications', 'chat_messages', 'agent_metrics'];
    if (!allowedTables.includes(table)) return { error: 'Table not allowed for cleanup' };
    const tsColumn = table === 'audit_log' ? 'ts' : 'created_at';
    const result = getDb().prepare(`DELETE FROM "${table}" WHERE ${tsColumn} < ?`).run(cutoff);
    logAudit(req, 'data.cleanup', table, null, `${result.changes} rows deleted`);
    return { deleted: result.changes, table };
  });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
