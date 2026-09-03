import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── M16: 系统健康中心 ──

export async function systemHealthRoutes(app: FastifyInstance) {

  // 综合健康检查
  app.get('/system-health', async () => {
    const db = getDb();
    const now = Date.now();

    // 数据库健康
    const dbHealth = getDbHealth(db);

    // 连接健康
    const connections = getConnectionHealth(db, now);

    // 服务统计
    const serviceStats = getServiceStats(db);

    // 整体状态
    const overall = connections.connected === connections.total && dbHealth.status === 'healthy' ? 'healthy'
      : connections.connected === 0 && connections.total > 0 ? 'critical' : 'degraded';

    return {
      overall,
      timestamp: now,
      database: dbHealth,
      connections,
      services: serviceStats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  });

  // 数据库详细健康
  app.get('/system-health/database', async () => {
    return getDbHealth(getDb());
  });

  // 连接健康详情
  app.get('/system-health/connections', async () => {
    return getConnectionHealth(getDb(), Date.now());
  });

  // 服务统计详情
  app.get('/system-health/services', async () => {
    return getServiceStats(getDb());
  });

  // 健康检查历史 (最近 24h 的快照)
  app.get('/system-health/history', async () => {
    const oneDayAgo = Date.now() - 86400000;
    const db = getDb();
    // 从 agent_metrics 获取历史健康数据
    const history = db.prepare(`
      SELECT metric_type, (recorded_at / 300000) * 300000 as bucket,
             AVG(value) as avg_value, COUNT(*) as count
      FROM agent_metrics WHERE recorded_at > ?
      GROUP BY metric_type, bucket ORDER BY bucket ASC
    `).all(oneDayAgo);
    return history;
  });
}

function getDbHealth(db: any) {
  try {
    const start = Date.now();
    db.prepare('SELECT 1').get();
    const queryTime = Date.now() - start;

    // 表统计
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as any[];

    const tableSizes: Record<string, number> = {};
    for (const t of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any;
        tableSizes[t.name] = count?.c ?? 0;
      } catch { /* skip */ }
    }

    // 数据库文件大小 (近似)
    let dbSize = 0;
    try {
      const row = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as any;
      dbSize = row?.size ?? 0;
    } catch { /* skip */ }

    const status = queryTime < 100 ? 'healthy' : queryTime < 500 ? 'degraded' : 'critical';

    return {
      status,
      queryTimeMs: queryTime,
      tableCount: tables.length,
      tableSizes,
      dbSizeBytes: dbSize,
      tables: tables.map(t => t.name),
    };
  } catch (err: any) {
    return { status: 'critical', error: err?.message ?? 'Unknown error' };
  }
}

function getConnectionHealth(db: any, now: number) {
  const connections = db.prepare('SELECT id, name, kind, status, last_seen_at FROM connections').all() as any[];
  const fiveMinAgo = now - 300000;

  let connected = 0, disconnected = 0, error = 0;
  const details = connections.map((c: any) => {
    const isRecent = c.last_seen_at && c.last_seen_at > fiveMinAgo;
    let health: string;
    if (c.status === 'connected' && isRecent) { health = 'healthy'; connected++; }
    else if (c.status === 'error' || (c.status === 'connected' && !isRecent)) { health = 'unhealthy'; error++; }
    else { health = 'unknown'; disconnected++; }
    return { ...c, health, isRecent };
  });

  return {
    total: connections.length,
    connected,
    disconnected,
    error,
    details,
  };
}

function getServiceStats(db: any) {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const oneDayAgo = now - 86400000;

  return {
    sessions: {
      total: (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any)?.c ?? 0,
      active: (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE last_active_at > ?').get(oneHourAgo) as any)?.c ?? 0,
    },
    runs: {
      total: (db.prepare('SELECT COUNT(*) as c FROM runs').get() as any)?.c ?? 0,
      running: (db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'running'").get() as any)?.c ?? 0,
      failed24h: (db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'failed' AND created_at > ?").get(oneDayAgo) as any)?.c ?? 0,
    },
    alerts: {
      total: (db.prepare('SELECT COUNT(*) as c FROM alerts').get() as any)?.c ?? 0,
      unacked: (db.prepare('SELECT COUNT(*) as c FROM alerts WHERE acknowledged = 0').get() as any)?.c ?? 0,
    },
    audit: {
      total: (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as any)?.c ?? 0,
      recent24h: (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE ts > ?').get(oneDayAgo) as any)?.c ?? 0,
    },
    capabilities: {
      total: (db.prepare('SELECT COUNT(*) as c FROM capabilities').get() as any)?.c ?? 0,
    },
  };
}
