import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── 多模型路由引擎 ──

const modelProviderSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['openai', 'anthropic', 'deepseek', 'gemini', 'ollama', 'custom']),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).default([]),
  defaultModel: z.string().optional(),
  maxTokens: z.number().int().positive().default(4096),
  costPer1kInput: z.number().nonnegative().default(0),
  costPer1kOutput: z.number().nonnegative().default(0),
  weight: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
});

const updateProviderSchema = modelProviderSchema.partial();

const routingRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().min(1),
  conditionType: z.enum(['default', 'complexity', 'cost', 'latency', 'keyword']).default('default'),
  conditionValue: z.string().optional(),
  priority: z.number().int().default(100),
  enabled: z.boolean().default(true),
});

export async function modelProviderRoutes(app: FastifyInstance) {

  // ── 模型提供商 CRUD ──

  // 创建提供商
  app.post('/model-providers', async (req, reply) => {
    const parsed = modelProviderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO model_providers (id, name, provider, base_url, models, default_model, max_tokens, cost_per_1k_input, cost_per_1k_output, weight, enabled, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, body.name, body.provider, body.baseUrl, JSON.stringify(body.models), body.defaultModel ?? null,
      body.maxTokens, body.costPer1kInput, body.costPer1kOutput, body.weight, body.enabled ? 1 : 0, now, now);
    logAudit({ action: 'create', target_type: 'model_provider', target_id: id, detail: { name: body.name, provider: body.provider } });
    return reply.code(201).send({ id, ...body, status: 'active', createdAt: now, updatedAt: now });
  });

  // 列出提供商
  app.get('/model-providers', async (req) => {
    const { enabled, provider } = req.query as any;
    let sql = 'SELECT * FROM model_providers WHERE 1=1';
    const params: any[] = [];
    if (enabled !== undefined) { sql += ' AND enabled = ?'; params.push(enabled === 'true' || enabled === '1' ? 1 : 0); }
    if (provider) { sql += ' AND provider = ?'; params.push(provider); }
    sql += ' ORDER BY weight DESC, created_at DESC';
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(r => ({ ...r, models: JSON.parse(r.models || '[]'), enabled: !!r.enabled }));
  });

  // 单个提供商
  app.get<{ Params: { id: string } }>('/model-providers/:id', async (req) => {
    const row = getDb().prepare('SELECT * FROM model_providers WHERE id = ?').get(req.params.id) as any;
    if (!row) return { error: 'Not Found', status: 404 };
    return { ...row, models: JSON.parse(row.models || '[]'), enabled: !!row.enabled };
  });

  // 更新提供商
  app.patch<{ Params: { id: string } }>('/model-providers/:id', async (req, reply) => {
    const parsed = updateProviderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const existing = getDb().prepare('SELECT * FROM model_providers WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });

    const fields: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
    if (body.provider !== undefined) { fields.push('provider = ?'); params.push(body.provider); }
    if (body.baseUrl !== undefined) { fields.push('base_url = ?'); params.push(body.baseUrl); }
    if (body.models !== undefined) { fields.push('models = ?'); params.push(JSON.stringify(body.models)); }
    if (body.defaultModel !== undefined) { fields.push('default_model = ?'); params.push(body.defaultModel); }
    if (body.maxTokens !== undefined) { fields.push('max_tokens = ?'); params.push(body.maxTokens); }
    if (body.costPer1kInput !== undefined) { fields.push('cost_per_1k_input = ?'); params.push(body.costPer1kInput); }
    if (body.costPer1kOutput !== undefined) { fields.push('cost_per_1k_output = ?'); params.push(body.costPer1kOutput); }
    if (body.weight !== undefined) { fields.push('weight = ?'); params.push(body.weight); }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); params.push(body.enabled ? 1 : 0); }
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);

    getDb().prepare(`UPDATE model_providers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = getDb().prepare('SELECT * FROM model_providers WHERE id = ?').get(req.params.id) as any;
    return { ...updated, models: JSON.parse(updated.models || '[]'), enabled: !!updated.enabled };
  });

  // 删除提供商
  app.delete<{ Params: { id: string } }>('/model-providers/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM model_providers WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    logAudit({ action: 'delete', target_type: 'model_provider', target_id: req.params.id });
    return { ok: true };
  });

  // ── 路由规则 CRUD ──

  // 创建路由规则
  app.post('/routing-rules', async (req, reply) => {
    const parsed = routingRuleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO model_routing_rules (id, name, description, provider_id, model, condition_type, condition_value, priority, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name, body.description ?? null, body.providerId ?? null, body.model,
      body.conditionType, body.conditionValue ?? null, body.priority, body.enabled ? 1 : 0, now, now);
    return reply.code(201).send({ id, ...body, createdAt: now, updatedAt: now });
  });

  // 列出路由规则
  app.get('/routing-rules', async (req) => {
    const { enabled } = req.query as any;
    let sql = 'SELECT r.*, p.name as provider_name FROM model_routing_rules r LEFT JOIN model_providers p ON r.provider_id = p.id WHERE 1=1';
    const params: any[] = [];
    if (enabled !== undefined) { sql += ' AND r.enabled = ?'; params.push(enabled === 'true' || enabled === '1' ? 1 : 0); }
    sql += ' ORDER BY r.priority DESC, r.created_at DESC';
    return getDb().prepare(sql).all(...params);
  });

  // 更新路由规则
  app.patch<{ Params: { id: string } }>('/routing-rules/:id', async (req, reply) => {
    const body = req.body as any;
    const existing = getDb().prepare('SELECT * FROM model_routing_rules WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });

    const fields: string[] = [];
    const params: any[] = [];
    for (const key of ['name', 'description', 'providerId', 'model', 'conditionType', 'conditionValue']) {
      if (body[key] !== undefined) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbKey} = ?`);
        params.push(body[key]);
      }
    }
    if (body.priority !== undefined) { fields.push('priority = ?'); params.push(body.priority); }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); params.push(body.enabled ? 1 : 0); }
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);

    getDb().prepare(`UPDATE model_routing_rules SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return getDb().prepare('SELECT * FROM model_routing_rules WHERE id = ?').get(req.params.id);
  });

  // 删除路由规则
  app.delete<{ Params: { id: string } }>('/routing-rules/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM model_routing_rules WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // ── 智能路由决策 ──

  // 根据条件选择最佳模型
  app.post('/model-providers/route', async (req, reply) => {
    const { prompt, complexity, preferCost, keywords } = req.body as any;
    const rules = getDb().prepare('SELECT * FROM model_routing_rules WHERE enabled = 1 ORDER BY priority DESC').all() as any[];
    const providers = getDb().prepare('SELECT * FROM model_providers WHERE enabled = 1').all() as any[];

    if (providers.length === 0) return reply.code(404).send({ error: '没有可用的模型提供商' });

    // 匹配路由规则
    let matchedRule: any = null;
    for (const rule of rules) {
      if (rule.condition_type === 'default') { matchedRule = rule; continue; }
      if (rule.condition_type === 'complexity' && complexity === rule.condition_value) { matchedRule = rule; break; }
      if (rule.condition_type === 'keyword' && keywords && rule.condition_value) {
        const kws = rule.condition_value.split(',').map((k: string) => k.trim().toLowerCase());
        if (kws.some((k: string) => keywords.toLowerCase().includes(k))) { matchedRule = rule; break; }
      }
      if (rule.condition_type === 'cost' && preferCost === true) { matchedRule = rule; break; }
      if (rule.condition_type === 'latency' && preferCost === false) { matchedRule = rule; break; }
    }

    if (matchedRule && matchedRule.provider_id) {
      const provider = providers.find(p => p.id === matchedRule.provider_id);
      if (provider) {
        return {
          provider: { id: provider.id, name: provider.name, provider: provider.provider },
          model: matchedRule.model || provider.default_model || JSON.parse(provider.models || '[]')[0],
          rule: matchedRule.name,
          reason: `匹配路由规则: ${matchedRule.name}`,
        };
      }
    }

    // 默认: 按权重轮询
    const totalWeight = providers.reduce((sum: number, p: any) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;
    for (const provider of providers) {
      random -= provider.weight;
      if (random <= 0) {
        return {
          provider: { id: provider.id, name: provider.name, provider: provider.provider },
          model: provider.default_model || JSON.parse(provider.models || '[]')[0],
          rule: 'default',
          reason: `权重轮询 (weight=${provider.weight}/${totalWeight})`,
        };
      }
    }

    // 兜底: 第一个
    const first = providers[0];
    return {
      provider: { id: first.id, name: first.name, provider: first.provider },
      model: first.default_model || JSON.parse(first.models || '[]')[0],
      rule: 'fallback',
      reason: '兜底选择',
    };
  });

  // 提供商统计
  app.get('/model-providers/stats', async () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM model_providers').get() as any)?.c ?? 0;
    const active = (db.prepare('SELECT COUNT(*) as c FROM model_providers WHERE enabled = 1').get() as any)?.c ?? 0;
    const byProvider = db.prepare('SELECT provider, COUNT(*) as c FROM model_providers GROUP BY provider').all();
    const totalRules = (db.prepare('SELECT COUNT(*) as c FROM model_routing_rules').get() as any)?.c ?? 0;
    return { total, active, disabled: total - active, byProvider, totalRules };
  });
}
