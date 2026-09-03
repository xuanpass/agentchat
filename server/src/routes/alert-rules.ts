import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';
import { eventBus } from '../services/EventBus.js';
import { emitAlert } from './alerts.js';

// ── 告警规则引擎 ──

const alertRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  metric: z.enum(['token_budget', 'error_rate', 'latency', 'connection_health', 'run_failure']),
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq']),
  threshold: z.number(),
  windowSeconds: z.number().int().positive().default(300),
  channels: z.array(z.string()).default(['ui']),
  enabled: z.boolean().default(true),
  cooldownSeconds: z.number().int().nonnegative().default(3600),
});

const updateAlertRuleSchema = alertRuleSchema.partial();

export async function alertRuleRoutes(app: FastifyInstance) {

  // 创建规则
  app.post('/alert-rules', async (req, reply) => {
    const parsed = alertRuleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO alert_rules (id, name, description, metric, operator, threshold, window_seconds, channels, enabled, cooldown_seconds, trigger_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, body.name, body.description ?? null, body.metric, body.operator, body.threshold,
      body.windowSeconds, JSON.stringify(body.channels), body.enabled ? 1 : 0, body.cooldownSeconds, now, now);
    logAudit({ action: 'create', target_type: 'alert_rule', target_id: id, detail: { name: body.name, metric: body.metric } });
    eventBus.emitEvent({ type: 'connection.health', data: { alertRuleCreated: id } });
    return reply.code(201).send({ id, ...body, triggerCount: 0, createdAt: now, updatedAt: now });
  });

  // 列出规则
  app.get('/alert-rules', async (req) => {
    const { enabled, metric } = req.query as any;
    let sql = 'SELECT * FROM alert_rules WHERE 1=1';
    const params: any[] = [];
    if (enabled !== undefined) { sql += ' AND enabled = ?'; params.push(enabled === 'true' || enabled === '1' ? 1 : 0); }
    if (metric) { sql += ' AND metric = ?'; params.push(metric); }
    sql += ' ORDER BY created_at DESC';
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(r => ({ ...r, channels: JSON.parse(r.channels || '[]'), enabled: !!r.enabled }));
  });

  // 单个规则
  app.get<{ Params: { id: string } }>('/alert-rules/:id', async (req) => {
    const row = getDb().prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id) as any;
    if (!row) return { error: 'Not Found', status: 404 };
    return { ...row, channels: JSON.parse(row.channels || '[]'), enabled: !!row.enabled };
  });

  // 更新规则
  app.patch<{ Params: { id: string } }>('/alert-rules/:id', async (req, reply) => {
    const parsed = updateAlertRuleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const existing = getDb().prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });

    const fields: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
    if (body.metric !== undefined) { fields.push('metric = ?'); params.push(body.metric); }
    if (body.operator !== undefined) { fields.push('operator = ?'); params.push(body.operator); }
    if (body.threshold !== undefined) { fields.push('threshold = ?'); params.push(body.threshold); }
    if (body.windowSeconds !== undefined) { fields.push('window_seconds = ?'); params.push(body.windowSeconds); }
    if (body.channels !== undefined) { fields.push('channels = ?'); params.push(JSON.stringify(body.channels)); }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); params.push(body.enabled ? 1 : 0); }
    if (body.cooldownSeconds !== undefined) { fields.push('cooldown_seconds = ?'); params.push(body.cooldownSeconds); }
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);

    getDb().prepare(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = getDb().prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id) as any;
    return { ...updated, channels: JSON.parse(updated.channels || '[]'), enabled: !!updated.enabled };
  });

  // 删除规则
  app.delete<{ Params: { id: string } }>('/alert-rules/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    logAudit({ action: 'delete', target_type: 'alert_rule', target_id: req.params.id });
    return { ok: true };
  });

  // 手动触发规则评估
  app.post('/alert-rules/evaluate', async () => {
    const results = evaluateAllRules();
    return { evaluated: results.length, triggered: results.filter(r => r.triggered).length, results };
  });

  // 规则统计
  app.get('/alert-rules/stats', async () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM alert_rules').get() as any)?.c ?? 0;
    const enabled = (db.prepare('SELECT COUNT(*) as c FROM alert_rules WHERE enabled = 1').get() as any)?.c ?? 0;
    const totalTriggers = (db.prepare('SELECT COALESCE(SUM(trigger_count), 0) as c FROM alert_rules').get() as any)?.c ?? 0;
    const byMetric = db.prepare('SELECT metric, COUNT(*) as c FROM alert_rules GROUP BY metric').all();
    return { total, enabled, disabled: total - enabled, totalTriggers, byMetric };
  });
}

// ── 规则评估引擎 ──

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  metric: string;
  triggered: boolean;
  currentValue?: number;
  threshold?: number;
  message?: string;
}

export function evaluateAllRules(): RuleEvaluationResult[] {
  const rules = getDb().prepare('SELECT * FROM alert_rules WHERE enabled = 1').all() as any[];
  return rules.map(rule => evaluateRule(rule));
}

function evaluateRule(rule: any): RuleEvaluationResult {
  const now = Date.now();
  // 冷却期检查
  if (rule.last_triggered_at && (now - rule.last_triggered_at) < rule.cooldown_seconds * 1000) {
    return { ruleId: rule.id, ruleName: rule.name, metric: rule.metric, triggered: false };
  }

  let currentValue = 0;
  let triggered = false;
  const db = getDb();

  switch (rule.metric) {
    case 'token_budget': {
      const windowStart = now - rule.window_seconds * 1000;
      const row = db.prepare('SELECT COALESCE(SUM(cost), 0) as cost FROM token_usage WHERE created_at > ?').get(windowStart) as any;
      currentValue = row?.cost ?? 0;
      triggered = compare(currentValue, rule.operator, rule.threshold);
      break;
    }
    case 'error_rate': {
      const windowStart = now - rule.window_seconds * 1000;
      const total = (db.prepare('SELECT COUNT(*) as c FROM runs WHERE created_at > ?').get(windowStart) as any)?.c ?? 0;
      const failed = (db.prepare('SELECT COUNT(*) as c FROM runs WHERE status = ? AND created_at > ?').get('failed', windowStart) as any)?.c ?? 0;
      currentValue = total > 0 ? (failed / total) * 100 : 0;
      triggered = compare(currentValue, rule.operator, rule.threshold);
      break;
    }
    case 'latency': {
      const windowStart = now - rule.window_seconds * 1000;
      const row = db.prepare('SELECT COALESCE(AVG(duration_ms), 0) as avg FROM workflow_runs WHERE created_at > ?').get(windowStart) as any;
      currentValue = row?.avg ?? 0;
      triggered = compare(currentValue, rule.operator, rule.threshold);
      break;
    }
    case 'connection_health': {
      const total = (db.prepare('SELECT COUNT(*) as c FROM connections').get() as any)?.c ?? 0;
      const errors = (db.prepare('SELECT COUNT(*) as c FROM connections WHERE status = ?').get('error') as any)?.c ?? 0;
      currentValue = total > 0 ? (errors / total) * 100 : 0;
      triggered = compare(currentValue, rule.operator, rule.threshold);
      break;
    }
    case 'run_failure': {
      const windowStart = now - rule.window_seconds * 1000;
      const failed = (db.prepare('SELECT COUNT(*) as c FROM runs WHERE status = ? AND created_at > ?').get('failed', windowStart) as any)?.c ?? 0;
      currentValue = failed;
      triggered = compare(currentValue, rule.operator, rule.threshold);
      break;
    }
  }

  if (triggered) {
    // 更新触发记录
    getDb().prepare('UPDATE alert_rules SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ?').run(now, rule.id);
    // 创建告警
    emitAlert({
      type: 'rule_triggered',
      severity: 'warning',
      message: `告警规则 "${rule.name}" 触发: ${rule.metric} = ${currentValue.toFixed(2)} ${rule.operator} ${rule.threshold}`,
      sourceType: 'alert_rule',
      sourceId: rule.id,
    });
    // SSE 广播
    eventBus.emitEvent({ type: 'connection.health', data: { alertRuleTriggered: rule.id, ruleName: rule.name, metric: rule.metric, value: currentValue } });
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    metric: rule.metric,
    triggered,
    currentValue,
    threshold: rule.threshold,
    message: triggered ? `${rule.metric} = ${currentValue.toFixed(2)} (阈值 ${rule.operator} ${rule.threshold})` : undefined,
  };
}

function compare(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}
