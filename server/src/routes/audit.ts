import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';

export interface AuditEntry {
  actor?: string;
  action: string;
  target_type?: string;
  target_id?: string;
  detail?: any;
}

/**
 * 记录一条审计日志
 *
 * 重载 1 (对象): logAudit({ actor, action, target_type, target_id, detail })
 * 重载 2 (快捷): logAudit(req, action, targetType, targetId?, detail?)
 */
export function logAudit(
  actorOrEntry: FastifyRequest | AuditEntry,
  action?: string,
  targetType?: string,
  targetId?: string | null,
  detail?: any,
): void {
  let entry: AuditEntry;
  if (action === undefined) {
    // 对象形式
    entry = actorOrEntry as AuditEntry;
  } else {
    // 快捷形式：req, action, targetType, targetId?, detail?
    const req = actorOrEntry as FastifyRequest;
    const rawActor = req.headers['x-api-key'] as string | undefined;
    entry = {
      actor: rawActor ? `key:${rawActor.slice(0, 8)}` : 'system',
      action: action!,
      target_type: targetType,
      target_id: targetId ?? undefined,
      detail,
    };
  }
  try {
    getDb().prepare(
      'INSERT INTO audit_log (actor, action, target_type, target_id, detail, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      entry.actor ?? 'system',
      entry.action,
      entry.target_type ?? null,
      entry.target_id ?? null,
      entry.detail ? JSON.stringify(entry.detail) : null,
      Date.now()
    );
  } catch (e) {
    console.error('[audit] failed to log:', e);
  }
}

/**
 * 审计中间件 — 自动记录 mutating 请求
 */
export function auditMiddleware(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutating.includes(req.method)) return done();

  const path = req.url.split('?')[0];
  const parts = path.split('/').filter(Boolean);
  // /api/connections/xxx → target_type = 'connection'
  const resource = parts[1] ?? 'unknown';
  const id = parts[2];

  // 映射路由到可读 action
  const actionMap: Record<string, Record<string, string>> = {
    POST: { connections: 'create', sessions: 'create', teams: 'create', projects: 'create', runs: 'create', capabilities: 'import', synctasks: 'sync' },
    PATCH: { connections: 'update', sessions: 'update', teams: 'update', projects: 'update', runs: 'update' },
    DELETE: { connections: 'delete', sessions: 'delete', teams: 'delete', projects: 'delete', runs: 'delete' },
  };

  const action = actionMap[req.method]?.[resource] ?? `${req.method.toLowerCase()}_${resource}`;

  logAudit({
    action,
    target_type: resource.endsWith('s') ? resource.slice(0, -1) : resource,
    target_id: id,
    detail: {
      method: req.method,
      path: req.url,
      body: req.body && typeof req.body === 'object'
        ? sanitizeBody(req.body as any)
        : undefined,
    },
  });

  done();
}

/** 脱敏：移除敏感字段 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  for (const key of ['password', 'token', 'secret', 'authEncrypted', 'auth_encrypted']) {
    if (key in sanitized) sanitized[key] = '***';
  }
  return sanitized;
}

export async function auditRoutes(app: FastifyInstance) {
  // 查询审计日志 (支持过滤和分页)
  app.get('/audit', async (req) => {
    const { action, targetType, actor, limit, offset } = req.query as any;
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

    if (action) { sql += ' AND action = ?'; params.push(action); }
    if (targetType) { sql += ' AND target_type = ?'; params.push(targetType); }
    if (actor) { sql += ' AND actor = ?'; params.push(actor); }

    sql += ' ORDER BY ts DESC';

    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);

    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(parseRow);
  });

  // 审计统计
  app.get('/audit/stats', async () => {
    const total = (getDb().prepare('SELECT COUNT(*) as c FROM audit_log').get() as any).c;
    const byAction = getDb().prepare(
      'SELECT action, COUNT(*) as count FROM audit_log GROUP BY action ORDER BY count DESC'
    ).all();
    const byTarget = getDb().prepare(
      'SELECT target_type, COUNT(*) as count FROM audit_log GROUP BY target_type ORDER BY count DESC'
    ).all();
    const recent24h = (getDb().prepare(
      'SELECT COUNT(*) as c FROM audit_log WHERE ts > ?'
    ).get(Date.now() - 86400000) as any).c;

    return { total, recent24h, byAction, byTarget };
  });

  // 单条详情
  app.get<{ Params: { id: string } }>('/audit/:id', async (req) => {
    const row = getDb().prepare('SELECT * FROM audit_log WHERE id = ?').get(req.params.id) as any;
    return row ? parseRow(row) : { error: '不存在', status: 404 };
  });
}

function parseRow(r: any) {
  return {
    id: r.id,
    actor: r.actor,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    detail: r.detail ? JSON.parse(r.detail) : null,
    ts: r.ts,
  };
}
