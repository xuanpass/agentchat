import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { logAudit } from './audit.js';

// ── M16: Agent 聊天中心 ──

const createSessionSchema = z.object({
  connectionId: z.string().optional(),
  title: z.string().min(1).default('新对话'),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  metadata: z.record(z.any()).default({}),
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
  model: z.string().optional(),
  stream: z.boolean().default(false),
  metadata: z.record(z.any()).default({}),
});

export async function agentChatRoutes(app: FastifyInstance) {

  // 创建聊天会话
  app.post('/agent-chat/sessions', async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const id = uuid();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO chat_sessions (id, connection_id, title, model, system_prompt, metadata, message_count, total_tokens_in, total_tokens_out, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 'active', ?, ?)
    `).run(id, body.connectionId ?? null, body.title, body.model ?? null, body.systemPrompt ?? null, JSON.stringify(body.metadata), now, now);
    logAudit(req, 'chat_session.create', 'chat_session', id, body.title);
    return reply.code(201).send({ id, ...body, messageCount: 0, totalTokensIn: 0, totalTokensOut: 0, status: 'active', createdAt: now, updatedAt: now });
  });

  // 列出聊天会话
  app.get('/agent-chat/sessions', async (req) => {
    const { connectionId, status, limit, offset } = req.query as any;
    const params: any[] = [];
    let sql = 'SELECT * FROM chat_sessions WHERE 1=1';
    if (connectionId) { sql += ' AND connection_id = ?'; params.push(connectionId); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    else { sql += " AND status != 'deleted'"; }
    sql += ' ORDER BY updated_at DESC';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
  });

  // 单个会话详情
  app.get<{ Params: { id: string } }>('/agent-chat/sessions/:id', async (req, reply) => {
    const row = getDb().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.id) as any;
    if (!row) return reply.code(404).send({ error: 'Not Found' });
    return { ...row, metadata: JSON.parse(row.metadata || '{}') };
  });

  // 更新会话 (重命名/归档)
  app.patch<{ Params: { id: string } }>('/agent-chat/sessions/:id', async (req, reply) => {
    const body = req.body as any;
    const existing = getDb().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not Found' });
    const fields: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) { fields.push('title = ?'); params.push(body.title); }
    if (body.status !== undefined) { fields.push('status = ?'); params.push(body.status); }
    if (body.systemPrompt !== undefined) { fields.push('system_prompt = ?'); params.push(body.systemPrompt); }
    if (body.model !== undefined) { fields.push('model = ?'); params.push(body.model); }
    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });
    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(req.params.id);
    getDb().prepare(`UPDATE chat_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const updated = getDb().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.id) as any;
    return { ...updated, metadata: JSON.parse(updated.metadata || '{}') };
  });

  // 删除会话 (软删除)
  app.delete<{ Params: { id: string } }>('/agent-chat/sessions/:id', async (req, reply) => {
    const result = getDb().prepare("UPDATE chat_sessions SET status = 'deleted', updated_at = ? WHERE id = ?").run(Date.now(), req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Not Found' });
    logAudit(req, 'chat_session.delete', 'chat_session', req.params.id, null);
    return { ok: true };
  });

  // 获取会话消息
  app.get<{ Params: { id: string } }>('/agent-chat/sessions/:id/messages', async (req, reply) => {
    const session = getDb().prepare('SELECT id FROM chat_sessions WHERE id = ? AND status != \'deleted\'').get(req.params.id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    const { limit, offset } = req.query as any;
    const lim = Math.min(Number(limit) || 100, 500);
    const off = Number(offset) || 0;
    const rows = getDb().prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(req.params.id, lim, off) as any[];
    return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));
  });

  // 发送消息 (同步响应 - 模拟 Agent 回复)
  app.post<{ Params: { id: string } }>('/agent-chat/sessions/:id/messages', async (req, reply) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const session = getDb().prepare('SELECT * FROM chat_sessions WHERE id = ? AND status = \'active\'').get(req.params.id) as any;
    if (!session) return reply.code(404).send({ error: 'Session not found or not active' });

    const now = Date.now();
    const userMsgId = uuid();
    const tokensIn = Math.ceil(body.content.length / 4);

    // 保存用户消息
    getDb().prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, tokens_in, tokens_out, model, metadata, created_at)
      VALUES (?, ?, 'user', ?, ?, 0, ?, ?, ?)
    `).run(userMsgId, req.params.id, body.content, tokensIn, body.model ?? session.model ?? null, JSON.stringify(body.metadata), now);

    // 模拟 Agent 回复 (实际项目中应调用 Gateway)
    const replyContent = generateAgentReply(body.content);
    const tokensOut = Math.ceil(replyContent.length / 4);
    const assistantMsgId = uuid();
    const replyNow = now + 100;

    getDb().prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, tokens_in, tokens_out, model, finish_reason, metadata, created_at)
      VALUES (?, ?, 'assistant', ?, 0, ?, ?, 'stop', '{}', ?)
    `).run(assistantMsgId, req.params.id, replyContent, tokensOut, body.model ?? session.model ?? null, replyNow);

    // 更新会话统计
    getDb().prepare(`
      UPDATE chat_sessions SET
        message_count = message_count + 2,
        total_tokens_in = total_tokens_in + ?,
        total_tokens_out = total_tokens_out + ?,
        updated_at = ?
      WHERE id = ?
    `).run(tokensIn, tokensOut, replyNow, req.params.id);

    return reply.code(201).send({
      userMessage: { id: userMsgId, role: 'user', content: body.content, tokensIn, createdAt: now },
      assistantMessage: { id: assistantMsgId, role: 'assistant', content: replyContent, tokensOut, finishReason: 'stop', createdAt: replyNow },
    });
  });

  // 删除消息
  app.delete<{ Params: { id: string; messageId: string } }>('/agent-chat/sessions/:id/messages/:messageId', async (req, reply) => {
    const result = getDb().prepare('DELETE FROM chat_messages WHERE id = ? AND session_id = ?').run(req.params.messageId, req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'Message not found' });
    return { ok: true };
  });

  // 聊天统计
  app.get('/agent-chat/stats', async () => {
    const db = getDb();
    const totalSessions = (db.prepare("SELECT COUNT(*) as c FROM chat_sessions WHERE status != 'deleted'").get() as any)?.c ?? 0;
    const activeSessions = (db.prepare("SELECT COUNT(*) as c FROM chat_sessions WHERE status = 'active'").get() as any)?.c ?? 0;
    const totalMessages = (db.prepare('SELECT COUNT(*) as c FROM chat_messages').get() as any)?.c ?? 0;
    const totalTokensIn = (db.prepare('SELECT COALESCE(SUM(tokens_in), 0) as c FROM chat_messages').get() as any)?.c ?? 0;
    const totalTokensOut = (db.prepare('SELECT COALESCE(SUM(tokens_out), 0) as c FROM chat_messages').get() as any)?.c ?? 0;
    const avgMessagesPerSession = totalSessions > 0 ? Math.round(totalMessages / totalSessions) : 0;

    // 最近 7 天活跃度
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const recentActivity = db.prepare(`
      SELECT (created_at / 86400000) * 86400000 as day, COUNT(*) as count
      FROM chat_messages WHERE created_at > ?
      GROUP BY day ORDER BY day ASC
    `).all(sevenDaysAgo);

    return { totalSessions, activeSessions, totalMessages, totalTokensIn, totalTokensOut, avgMessagesPerSession, recentActivity };
  });
}

// 模拟 Agent 回复生成
function generateAgentReply(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes('你好') || lower.includes('hello') || lower.includes('hi')) {
    return '你好！我是 Agent Ops Console 的智能助手。我可以帮助你管理智能体连接、监控运行状态、分析 Token 用量等。请问有什么可以帮你的？';
  }
  if (lower.includes('状态') || lower.includes('status') || lower.includes('健康')) {
    return '目前系统运行正常。所有已连接的智能体均处于活跃状态，最近一小时内无异常告警。需要我为你查看某个具体连接的详细状态吗？';
  }
  if (lower.includes('token') || lower.includes('用量') || lower.includes('成本') || lower.includes('cost')) {
    return 'Token 用量分析功能可以帮助你追踪每个会话、每个团队的 Token 消耗和成本估算。你可以在「Token 用量」页面查看详细的统计图表和趋势分析。';
  }
  if (lower.includes('告警') || lower.includes('alert') || lower.includes('错误')) {
    return '告警规则引擎支持 5 种指标类型（Token 预算、错误率、延迟、连接健康、运行失败），可以设置阈值和冷却期。当前告警中心显示所有未确认的告警事件。';
  }
  if (lower.includes('工作流') || lower.includes('workflow') || lower.includes('编排')) {
    return '编排工作流支持 6 种节点类型（输入/Agent/条件/并行/合并/输出），通过 DAG 拓扑排序执行。你可以在「编排工作流」页面创建和管理工作流。';
  }
  if (lower.includes('连接') || lower.includes('connection') || lower.includes('智能体')) {
    return '在「智能体」页面可以管理 OpenClaw、Hermes、OpenCode 等多种类型的连接。每个连接支持健康检查、能力同步和实时状态监控。';
  }
  if (lower.includes('帮助') || lower.includes('help') || lower.includes('功能')) {
    return 'Agent Ops Console 主要功能包括：\n\n1. **仪表盘** — 全局概览\n2. **智能体** — 连接管理\n3. **会话** — 会话历史\n4. **团队** — 多智能体协作\n5. **运行记录** — 任务追踪\n6. **Token 用量** — 成本分析\n7. **告警规则** — 智能告警\n8. **编排工作流** — DAG 编排\n\n需要我详细介绍某个功能吗？';
  }
  return `我理解你的问题：「${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}」。\n\n作为 Agent Ops Console 的智能助手，我可以帮你：\n- 查看系统状态和连接健康\n- 分析 Token 用量和成本\n- 管理告警规则和工作流\n- 监控智能体性能\n\n请告诉我你想了解的具体内容！`;
}
