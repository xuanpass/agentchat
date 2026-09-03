import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { ConnectionManager } from '../services/ConnectionManager.js';
import os from 'node:os';

// ── 指标历史缓存 (内存环形缓冲区) ──

const METRICS_HISTORY_MAX = 60;

interface MetricsSnapshot {
  ts: number;
  connections: number;
  sessions: number;
  runs: number;
  alerts: number;
  heapUsed: number;
}

const metricsHistory: MetricsSnapshot[] = [];

let snapshotTimer: ReturnType<typeof setInterval> | null = null;

function takeSnapshot(): void {
  const db = getDb();
  const connections = ConnectionManager.all();
  const sessionRow = db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any;
  const runRow = db.prepare('SELECT COUNT(*) as c FROM runs').get() as any;
  const alertRow = db.prepare('SELECT COUNT(*) as c FROM alerts WHERE acknowledged = 0').get() as any;
  const mem = process.memoryUsage();

  metricsHistory.push({
    ts: Date.now(),
    connections: connections.filter(m => m.conn.status === 'connected').length,
    sessions: sessionRow?.c ?? 0,
    runs: runRow?.c ?? 0,
    alerts: alertRow?.c ?? 0,
    heapUsed: mem.heapUsed,
  });

  if (metricsHistory.length > METRICS_HISTORY_MAX) {
    metricsHistory.shift();
  }
}

export function startMetricsSnapshots(): void {
  if (snapshotTimer) return;
  takeSnapshot();
  snapshotTimer = setInterval(takeSnapshot, 30_000);
  snapshotTimer.unref?.();
  console.log('[metrics] 历史快照已启动 (30s 间隔)');
}

// ── 系统指标端点 ──

export async function metricsRoutes(app: FastifyInstance) {

  // 指标历史 (最近 60 个数据点, 30s 间隔)
  app.get('/metrics/history', async () => {
    return metricsHistory.slice();
  });

  // 聚合指标
  app.get('/metrics', async () => {
    const db = getDb();
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    // 连接统计
    const connections = ConnectionManager.all();
    const connByStatus: Record<string, number> = {};
    for (const m of connections) {
      connByStatus[m.conn.status] = (connByStatus[m.conn.status] ?? 0) + 1;
    }

    // 会话统计
    const sessionRow = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active FROM sessions').get() as any;

    // 运行统计
    const runRows = db.prepare('SELECT status, COUNT(*) as count FROM runs GROUP BY status').all() as any[];
    const runsByStatus: Record<string, number> = {};
    for (const r of runRows) runsByStatus[r.status] = r.count;

    // 审计日志数
    const auditRow = db.prepare('SELECT COUNT(*) as total FROM audit_log').get() as any;

    // 告警统计
    const alertRow = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN acknowledged = 0 THEN 1 ELSE 0 END) as unack FROM alerts').get() as any;

    return {
      timestamp: Date.now(),
      uptime: Math.round(uptime),
      memory: {
        rss: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
      },
      system: {
        platform: os.platform(),
        loadavg: os.loadavg(),
        freemem: os.freemem(),
        totalmem: os.totalmem(),
      },
      connections: {
        total: connections.length,
        byStatus: connByStatus,
      },
      sessions: {
        total: sessionRow?.total ?? 0,
        active: sessionRow?.active ?? 0,
      },
      runs: {
        total: runRows.reduce((s: number, r: any) => s + r.count, 0),
        byStatus: runsByStatus,
      },
      auditLog: auditRow?.total ?? 0,
      alerts: {
        total: alertRow?.total ?? 0,
        unacknowledged: alertRow?.unack ?? 0,
      },
    };
  });

  // Prometheus 格式
  app.get('/metrics/prometheus', async (_req, reply) => {
    const db = getDb();
    const connections = ConnectionManager.all();
    const metrics: string[] = [];

    const connectedCount = connections.filter(m => m.conn.status === 'connected').length;
    metrics.push('# HELP aoc_connections_total Total connections');
    metrics.push('# TYPE aoc_connections_total gauge');
    metrics.push('aoc_connections_total ' + connections.length);
    metrics.push('# HELP aoc_connections_connected Connected connections');
    metrics.push('# TYPE aoc_connections_connected gauge');
    metrics.push('aoc_connections_connected ' + connectedCount);

    const sessionRow = db.prepare('SELECT COUNT(*) as total FROM sessions').get() as any;
    metrics.push('# HELP aoc_sessions_total Total sessions');
    metrics.push('# TYPE aoc_sessions_total gauge');
    metrics.push('aoc_sessions_total ' + (sessionRow?.total ?? 0));

    const runRow = db.prepare('SELECT COUNT(*) as total FROM runs').get() as any;
    metrics.push('# HELP aoc_runs_total Total runs');
    metrics.push('# TYPE aoc_runs_total gauge');
    metrics.push('aoc_runs_total ' + (runRow?.total ?? 0));

    const mem = process.memoryUsage();
    metrics.push('#HELP aoc_memory_heap_used_bytes Heap used');
    metrics.push('# TYPE aoc_memory_heap_used_bytes gauge');
    metrics.push('aoc_memory_heap_used_bytes ' + mem.heapUsed);

    return reply.type('text/plain').send(metrics.join('\n') + '\n');
  });
}
