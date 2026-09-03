import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── M16: 高级报告中心 ──

const createTemplateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['token_usage', 'cost_analysis', 'performance', 'trend', 'custom']),
  description: z.string().optional(),
  config: z.record(z.any()).default({}),
});

const generateReportSchema = z.object({
  templateId: z.string().optional(),
  type: z.enum(['token_usage', 'cost_analysis', 'performance', 'trend', 'custom']),
  format: z.enum(['json', 'csv', 'markdown']).default('json'),
  dateRange: z.object({
    from: z.number(),
    to: z.number(),
  }).optional(),
  filters: z.record(z.any()).default({}),
});

export async function reportRoutes(app: FastifyInstance) {

  // 创建报告模板
  app.post('/reports/templates', async (req, reply) => {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO report_templates (id, name, type, description, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.name, body.type, body.description ?? '', JSON.stringify(body.config), now, now);
    logAudit(req, 'report_template.create', 'report_template', id, body.name);
    return reply.code(201).send({ id, ...body, createdAt: now, updatedAt: now });
  });

  // 列出模板
  app.get('/reports/templates', async () => {
    const rows = getDb().prepare('SELECT * FROM report_templates ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}') }));
  });

  // 单个模板
  app.get<{ Params: { id: string } }>('/reports/templates/:id', async (req, reply) => {
    const row = getDb().prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id) as any;
    if (!row) return reply.code(404).send({ error: 'Not Found' });
    return { ...row, config: JSON.parse(row.config || '{}') };
  });

  // 更新模板
  app.patch<{ Params: { id: string } }>('/reports/templates/:id', async (req, reply) => {
    const body = req.body as any;
    const existing = getDb().prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });
    const fields: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
    if (body.config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(body.config)); }
    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);
    getDb().prepare(`UPDATE report_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = getDb().prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id) as any;
    return { ...updated, config: JSON.parse(updated.config || '{}') };
  });

  // 删除模板
  app.delete<{ Params: { id: string } }>('/reports/templates/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM report_templates WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    return { ok: true };
  });

  // 生成报告
  app.post('/reports/generate', async (req, reply) => {
    const parsed = generateReportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    const dateRange = body.dateRange ?? { from: now - 30 * 86400000, to: now };

    let data: any;
    switch (body.type) {
      case 'token_usage': data = generateTokenUsageReport(dateRange); break;
      case 'cost_analysis': data = generateCostAnalysisReport(dateRange); break;
      case 'performance': data = generatePerformanceReport(dateRange); break;
      case 'trend': data = generateTrendReport(dateRange); break;
      default: data = generateCustomReport(dateRange, body.filters);
    }

    // 保存报告记录
    getDb().prepare(`
      INSERT INTO report_templates (id, name, type, description, config, created_at, updated_at)
      VALUES (?, ?, 'custom', ?, ?, ?, ?)
    `).run(id, `报告-${new Date(now).toLocaleDateString('zh-CN')}`, `自动生成: ${body.type}`, JSON.stringify({ data, format: body.format }), now, now);

    // 格式化输出
    let content: string;
    let contentType: string;
    if (body.format === 'csv') {
      content = toCsv(data);
      contentType = 'text/csv';
    } else if (body.format === 'markdown') {
      content = toMarkdown(data, body.type);
      contentType = 'text/markdown';
    } else {
      content = JSON.stringify(data, null, 2);
      contentType = 'application/json';
    }

    logAudit(req, 'report.generate', 'report', id, body.type);
    return reply.header('Content-Type', contentType).send(content);
  });

  // 报告统计
  app.get('/reports/stats', async () => {
    const db = getDb();
    const totalReports = (db.prepare("SELECT COUNT(*) as c FROM report_templates WHERE type = 'custom'").get() as any)?.c ?? 0;
    const totalTemplates = (db.prepare('SELECT COUNT(*) as c FROM report_templates').get() as any)?.c ?? 0;
    const byType = db.prepare('SELECT type, COUNT(*) as count FROM report_templates GROUP BY type').all();
    return { totalReports, totalTemplates, byType };
  });
}

// ── 报告数据生成器 ──

function generateTokenUsageReport(dateRange: { from: number; to: number }) {
  const db = getDb();
  const summary = db.prepare(`
    SELECT COALESCE(SUM(tokens_in), 0) as totalIn, COALESCE(SUM(tokens_out), 0) as totalOut,
           COALESCE(SUM(tokens_total), 0) as total, COALESCE(SUM(cost), 0) as totalCost,
           COUNT(*) as records
    FROM token_usage WHERE created_at BETWEEN ? AND ?
  `).get(dateRange.from, dateRange.to) as any;

  const byModel = db.prepare(`
    SELECT model, SUM(tokens_total) as tokens, SUM(cost) as cost, COUNT(*) as count
    FROM token_usage WHERE created_at BETWEEN ? AND ? GROUP BY model ORDER BY tokens DESC
  `).all(dateRange.from, dateRange.to);

  const daily = db.prepare(`
    SELECT (created_at / 86400000) * 86400000 as day,
           SUM(tokens_in) as tokensIn, SUM(tokens_out) as tokensOut, SUM(cost) as cost
    FROM token_usage WHERE created_at BETWEEN ? AND ?
    GROUP BY day ORDER BY day ASC
  `).all(dateRange.from, dateRange.to);

  return { type: 'token_usage', period: dateRange, summary, byModel, daily };
}

function generateCostAnalysisReport(dateRange: { from: number; to: number }) {
  const db = getDb();
  const bySession = db.prepare(`
    SELECT session_id, SUM(cost) as cost, SUM(tokens_total) as tokens, COUNT(*) as calls
    FROM token_usage WHERE created_at BETWEEN ? AND ? AND session_id IS NOT NULL
    GROUP BY session_id ORDER BY cost DESC LIMIT 20
  `).all(dateRange.from, dateRange.to);

  const byTeam = db.prepare(`
    SELECT team_id, SUM(cost) as cost, SUM(tokens_total) as tokens
    FROM token_usage WHERE created_at BETWEEN ? AND ? AND team_id IS NOT NULL
    GROUP BY team_id ORDER BY cost DESC
  `).all(dateRange.from, dateRange.to);

  const totalCost = (db.prepare('SELECT COALESCE(SUM(cost), 0) as c FROM token_usage WHERE created_at BETWEEN ? AND ?').get(dateRange.from, dateRange.to) as any)?.c ?? 0;

  return { type: 'cost_analysis', period: dateRange, totalCost, bySession, byTeam };
}

function generatePerformanceReport(dateRange: { from: number; to: number }) {
  const db = getDb();
  const runs = db.prepare(`
    SELECT status, COUNT(*) as count, AVG(duration_ms) as avgDuration
    FROM runs WHERE created_at BETWEEN ? AND ? GROUP BY status
  `).all(dateRange.from, dateRange.to);

  const metrics = db.prepare(`
    SELECT metric_type, AVG(value) as avg, MIN(value) as min, MAX(value) as max, COUNT(*) as count
    FROM agent_metrics WHERE recorded_at BETWEEN ? AND ?
    GROUP BY metric_type
  `).all(dateRange.from, dateRange.to);

  return { type: 'performance', period: dateRange, runs, metrics };
}

function generateTrendReport(dateRange: { from: number; to: number }) {
  const db = getDb();
  const dailyTokens = db.prepare(`
    SELECT (created_at / 86400000) * 86400000 as day,
           SUM(tokens_total) as tokens, SUM(cost) as cost
    FROM token_usage WHERE created_at BETWEEN ? AND ?
    GROUP BY day ORDER BY day ASC
  `).all(dateRange.from, dateRange.to);

  const dailyRuns = db.prepare(`
    SELECT (created_at / 86400000) * 86400000 as day,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM runs WHERE created_at BETWEEN ? AND ?
    GROUP BY day ORDER BY day ASC
  `).all(dateRange.from, dateRange.to);

  return { type: 'trend', period: dateRange, dailyTokens, dailyRuns };
}

function generateCustomReport(dateRange: { from: number; to: number }, filters: any) {
  const db = getDb();
  const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE created_at BETWEEN ? AND ?').get(dateRange.from, dateRange.to) as any)?.c ?? 0;
  const totalRuns = (db.prepare('SELECT COUNT(*) as c FROM runs WHERE created_at BETWEEN ? AND ?').get(dateRange.from, dateRange.to) as any)?.c ?? 0;
  const totalAlerts = (db.prepare('SELECT COUNT(*) as c FROM alerts WHERE created_at BETWEEN ? AND ?').get(dateRange.from, dateRange.to) as any)?.c ?? 0;
  return { type: 'custom', period: dateRange, filters, totalSessions, totalRuns, totalAlerts };
}

// ── 格式化工具 ──

function toCsv(data: any): string {
  if (data.byModel && Array.isArray(data.byModel)) {
    const rows = data.byModel.map((r: any) => `${r.model},${r.tokens},${r.cost},${r.count}`);
    return 'Model,Tokens,Cost,Count\n' + rows.join('\n');
  }
  if (data.daily && Array.isArray(data.daily)) {
    const rows = data.daily.map((r: any) => `${new Date(r.day).toISOString()},${r.tokensIn ?? ''},${r.tokensOut ?? ''},${r.tokens ?? ''},${r.cost ?? ''}`);
    return 'Date,TokensIn,TokensOut,Tokens,Cost\n' + rows.join('\n');
  }
  return JSON.stringify(data);
}

function toMarkdown(data: any, type: string): string {
  let md = `# 报告: ${type}\n\n`;
  md += `生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
  if (data.summary) {
    md += `## 汇总\n\n`;
    md += `- 总输入 Token: ${data.summary.totalIn}\n`;
    md += `- 总输出 Token: ${data.summary.totalOut}\n`;
    md += `- 总 Token: ${data.summary.total}\n`;
    md += `- 总成本: $${data.summary.totalCost?.toFixed(4)}\n\n`;
  }
  if (data.byModel && Array.isArray(data.byModel)) {
    md += `## 按模型\n\n`;
    md += `| 模型 | Token | 成本 | 调用次数 |\n|------|-------|------|----------|\n`;
    for (const r of data.byModel) {
      md += `| ${r.model} | ${r.tokens} | $${r.cost?.toFixed(4)} | ${r.count} |\n`;
    }
    md += '\n';
  }
  if (data.daily && Array.isArray(data.daily)) {
    md += `## 每日趋势\n\n`;
    md += `| 日期 | Token | 成本 |\n|------|-------|------|\n`;
    for (const r of data.daily) {
      md += `| ${new Date(r.day).toLocaleDateString('zh-CN')} | ${r.tokens || (r.tokensIn + r.tokensOut)} | $${(r.cost ?? 0).toFixed(4)} |\n`;
    }
  }
  return md;
}
