import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';
import { eventBus } from '../services/EventBus.js';

// ── Agent 编排工作流 ──

const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['agent', 'condition', 'parallel', 'merge', 'input', 'output']),
  label: z.string(),
  connectionId: z.string().optional(),
  prompt: z.string().optional(),
  condition: z.string().optional(),
  config: z.record(z.any()).default({}),
});

const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  condition: z.string().optional(),
});

const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(workflowNodeSchema).default([]),
  edges: z.array(workflowEdgeSchema).default([]),
});

const updateWorkflowSchema = workflowSchema.partial().extend({
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
});

const runWorkflowSchema = z.object({
  triggeredBy: z.string().default('manual'),
  input: z.record(z.any()).optional(),
});

export async function workflowRoutes(app: FastifyInstance) {

  // 创建工作流
  app.post('/workflows', async (req, reply) => {
    const parsed = workflowSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO workflows (id, name, description, nodes, edges, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(id, body.name, body.description ?? null, JSON.stringify(body.nodes), JSON.stringify(body.edges), now, now);
    logAudit({ action: 'create', target_type: 'workflow', target_id: id, detail: { name: body.name } });
    return reply.code(201).send({ id, ...body, status: 'draft', createdAt: now, updatedAt: now });
  });

  // 列出工作流
  app.get('/workflows', async (req) => {
    const { status } = req.query as any;
    let sql = 'SELECT * FROM workflows WHERE 1=1';
    const params: any[] = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      ...r,
      nodes: JSON.parse(r.nodes || '[]'),
      edges: JSON.parse(r.edges || '[]'),
      nodeCount: JSON.parse(r.nodes || '[]').length,
    }));
  });

  // 单个工作流
  app.get<{ Params: { id: string } }>('/workflows/:id', async (req) => {
    const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as any;
    if (!row) return { error: 'Not Found', status: 404 };
    return { ...row, nodes: JSON.parse(row.nodes || '[]'), edges: JSON.parse(row.edges || '[]') };
  });

  // 更新工作流
  app.patch<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    const parsed = updateWorkflowSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const existing = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });

    const fields: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
    if (body.nodes !== undefined) { fields.push('nodes = ?'); params.push(JSON.stringify(body.nodes)); }
    if (body.edges !== undefined) { fields.push('edges = ?'); params.push(JSON.stringify(body.edges)); }
    if (body.status !== undefined) { fields.push('status = ?'); params.push(body.status); }
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);

    getDb().prepare(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as any;
    return { ...updated, nodes: JSON.parse(updated.nodes || '[]'), edges: JSON.parse(updated.edges || '[]') };
  });

  // 删除工作流
  app.delete<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM workflows WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    logAudit({ action: 'delete', target_type: 'workflow', target_id: req.params.id });
    return { ok: true };
  });

  // 运行工作流
  app.post<{ Params: { id: string } }>('/workflows/:id/run', async (req, reply) => {
    const parsed = runWorkflowSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;

    const workflow = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id) as any;
    if (!workflow) return reply.code(404).send({ error: 'Not Found' });
    if (workflow.status !== 'active') return reply.code(400).send({ error: `工作流状态为 ${workflow.status}，需 active 才能运行` });

    const nodes = JSON.parse(workflow.nodes || '[]');
    const edges = JSON.parse(workflow.edges || '[]');
    if (nodes.length === 0) return reply.code(400).send({ error: '工作流没有节点' });

    const runId = uuid();
    const now = Date.now();
    const nodesStatus: Record<string, string> = {};
    for (const node of nodes) {
      nodesStatus[node.id] = 'pending';
    }

    getDb().prepare(`
      INSERT INTO workflow_runs (id, workflow_id, status, nodes_status, nodes_result, triggered_by, created_at)
      VALUES (?, ?, 'running', ?, ?, ?, ?)
    `).run(runId, req.params.id, JSON.stringify(nodesStatus), JSON.stringify({}), body.triggeredBy, now);

    logAudit({ action: 'run', target_type: 'workflow', target_id: req.params.id, detail: { runId } });
    eventBus.emitEvent({ type: 'session.status', data: { workflowRun: runId, workflowId: req.params.id, status: 'running' } });

    // 异步执行工作流
    executeWorkflow(runId, workflow, nodes, edges, body.input ?? {});

    return reply.code(202).send({ runId, status: 'running', workflowId: req.params.id });
  });

  // 列出运行记录
  app.get('/workflow-runs', async (req) => {
    const { workflowId, status, limit, offset } = req.query as any;
    let sql = 'SELECT * FROM workflow_runs WHERE 1=1';
    const params: any[] = [];
    if (workflowId) { sql += ' AND workflow_id = ?'; params.push(workflowId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    return getDb().prepare(sql).all(...params);
  });

  // 单个运行详情
  app.get<{ Params: { id: string } }>('/workflow-runs/:id', async (req) => {
    const row = getDb().prepare('SELECT * FROM workflow_runs WHERE id = ?').get(req.params.id) as any;
    if (!row) return { error: 'Not Found', status: 404 };
    return {
      ...row,
      nodesStatus: JSON.parse(row.nodes_status || '{}'),
      nodesResult: JSON.parse(row.nodes_result || '{}'),
    };
  });

  // 取消运行
  app.post<{ Params: { id: string } }>('/workflow-runs/:id/cancel', async (req, reply) => {
    const run = getDb().prepare('SELECT * FROM workflow_runs WHERE id = ?').get(req.params.id) as any;
    if (!run) return reply.code(404).send({ error: 'Not Found' });
    if (run.status !== 'running' && run.status !== 'queued') {
      return reply.code(400).send({ error: `运行状态为 ${run.status}，无法取消` });
    }
    getDb().prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?').run('cancelled', Date.now(), req.params.id);
    return { ok: true, status: 'cancelled' };
  });

  // 工作流统计
  app.get('/workflows/stats', async () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as c FROM workflows').get() as any)?.c ?? 0;
    const active = (db.prepare('SELECT COUNT(*) as c FROM workflows WHERE status = ?').get('active') as any)?.c ?? 0;
    const totalRuns = (db.prepare('SELECT COUNT(*) as c FROM workflow_runs').get() as any)?.c ?? 0;
    const runsByStatus = db.prepare('SELECT status, COUNT(*) as c FROM workflow_runs GROUP BY status').all();
    return { total, active, archived: total - active, totalRuns, runsByStatus };
  });
}

// ── DAG 执行引擎 ──

interface WorkflowNode {
  id: string;
  type: 'agent' | 'condition' | 'parallel' | 'merge' | 'input' | 'output';
  label: string;
  connectionId?: string;
  prompt?: string;
  condition?: string;
  config: Record<string, any>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

async function executeWorkflow(
  runId: string,
  workflow: any,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  input: Record<string, any>
) {
  const db = getDb();
  const nodeMap = new Map<string, WorkflowNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // 构建邻接表
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, number>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, 0);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  // 拓扑排序找起始节点 (入度为0)
  const queue: string[] = [];
  for (const [nodeId, deg] of incoming) {
    if (deg === 0) queue.push(nodeId);
  }

  const results: Record<string, any> = {};
  const statusMap: Record<string, string> = {};
  for (const n of nodes) statusMap[n.id] = 'pending';

  let hasError = false;

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // 检查所有入边是否完成
    const allIncomingDone = (incoming.get(nodeId) ?? 0) === 0 ||
      edges.filter(e => e.target === nodeId).every(e => statusMap[e.source] === 'completed');

    if (!allIncomingDone && statusMap[nodeId] !== 'pending') continue;

    statusMap[nodeId] = 'running';
    db.prepare('UPDATE workflow_runs SET nodes_status = ? WHERE id = ?').run(JSON.stringify(statusMap), runId);
    eventBus.emitEvent({ type: 'session.status', data: { workflowRun: runId, nodeId, status: 'running' } });

    try {
      let result: any = null;

      switch (node.type) {
        case 'input':
          result = { output: input, timestamp: Date.now() };
          break;

        case 'agent':
          // 模拟 Agent 执行 (实际应调用 Gateway)
          result = await simulateAgentExecution(node, results, edges);
          break;

        case 'condition':
          result = evaluateCondition(node, results, edges);
          break;

        case 'parallel':
          result = { output: 'parallel_branch', branches: outgoing.get(nodeId)?.map(e => e.target) };
          break;

        case 'merge':
          result = { output: 'merged', mergedFrom: edges.filter(e => e.target === nodeId).map(e => e.source) };
          break;

        case 'output':
          result = { output: 'final', summary: Object.keys(results).length + ' nodes executed' };
          break;
      }

      results[nodeId] = result;
      statusMap[nodeId] = 'completed';
      db.prepare('UPDATE workflow_runs SET nodes_status = ?, nodes_result = ? WHERE id = ?')
        .run(JSON.stringify(statusMap), JSON.stringify(results), runId);
      eventBus.emitEvent({ type: 'session.status', data: { workflowRun: runId, nodeId, status: 'completed', result } });

    } catch (err: any) {
      statusMap[nodeId] = 'failed';
      results[nodeId] = { error: err.message };
      hasError = true;
      db.prepare('UPDATE workflow_runs SET nodes_status = ?, nodes_result = ? WHERE id = ?')
        .run(JSON.stringify(statusMap), JSON.stringify(results), runId);
      eventBus.emitEvent({ type: 'session.status', data: { workflowRun: runId, nodeId, status: 'failed', error: err.message } });
    }

    // 将下游节点加入队列
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetDeg = (incoming.get(edge.target) ?? 1) - 1;
      incoming.set(edge.target, targetDeg);
      if (targetDeg <= 0 && statusMap[edge.target] === 'pending') {
        queue.push(edge.target);
      }
    }
  }

  // 完成运行
  const finalStatus = hasError ? 'failed' : 'completed';
  db.prepare('UPDATE workflow_runs SET status = ?, completed_at = ? WHERE id = ?').run(finalStatus, Date.now(), runId);
  eventBus.emitEvent({ type: 'session.status', data: { workflowRun: runId, status: finalStatus } });
}

async function simulateAgentExecution(node: WorkflowNode, results: Record<string, any>, edges: WorkflowEdge[]): Promise<any> {
  // 模拟 Agent 调用延迟
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
  return {
    output: `[${node.label}] 执行完成`,
    connectionId: node.connectionId,
    prompt: node.prompt,
    timestamp: Date.now(),
  };
}

function evaluateCondition(node: WorkflowNode, results: Record<string, any>, edges: WorkflowEdge[]): any {
  // 简单条件评估: 检查上游结果
  const upstreamEdges = edges.filter(e => e.target === node.id);
  const allSuccess = upstreamEdges.every(e => results[e.source] && !results[e.source].error);
  return {
    output: allSuccess ? 'condition_true' : 'condition_false',
    condition: node.condition,
    result: allSuccess,
  };
}
