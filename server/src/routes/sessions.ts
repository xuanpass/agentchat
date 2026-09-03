import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { ConnectionRepo } from '../db/connections.js';
import { ConnectionManager } from '../services/ConnectionManager.js';
import { getDriver } from '../adapters/index.js';
import { eventBus } from '../services/EventBus.js';
import { logAudit } from './audit.js';

const createSessionSchema = z.object({
  connectionId: z.string().uuid(),
  title: z.string().optional(),
  projectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  instructions: z.string().optional(),
  message: z.string().optional(),   // 创建后立即发送的首条消息
});

export async function sessionRoutes(app: FastifyInstance) {
  // 列出会话(可按 connectionId/teamId 过滤, 支持分页)
  app.get('/sessions', async (req) => {
    const { connectionId, teamId, limit, offset } = req.query as any;
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const params: any[] = [];
    if (connectionId) { sql += ' AND connection_id = ?'; params.push(connectionId); }
    if (teamId) { sql += ' AND team_id = ?'; params.push(teamId); }
    sql += ' ORDER BY last_active_at DESC';
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Number(offset) || 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);
    const rows = getDb().prepare(sql).all(...params) as any[];
    return rows.map((s) => ({ ...s, meta: s.meta ? JSON.parse(s.meta) : {} }));
  });

  // 创建会话
  app.post('/sessions', async (req, reply) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = parsed.data;
    const conn = ConnectionRepo.get(body.connectionId);
    if (!conn) return reply.code(404).send({ error: '连接不存在' });

    await ConnectionManager.ensureConnected(conn.id);
    const driver = getDriver(conn.kind);
    const session = await driver.createSession(conn, {
      title: body.title, projectId: body.projectId, teamId: body.teamId, instructions: body.instructions,
    });

    // 落库
    getDb().prepare(`
      INSERT INTO sessions (id, connection_id, team_id, project_id, remote_session_id, title, created_at, last_active_at, status, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, session.connectionId, session.teamId ?? null, session.projectId ?? null,
      session.remoteSessionId, session.title, session.createdAt, session.lastActiveAt, session.status,
      JSON.stringify(session.meta));

    // 可选: 立即发首条消息
    if (body.message) await driver.sendMessage(conn, session.remoteSessionId, body.message);

    // 发送事件
    eventBus.emitEvent({ type: 'session.created', data: { id: session.id, title: session.title, connectionId: conn.id } });
    logAudit({ action: 'create', target_type: 'session', target_id: session.id, detail: { title: session.title, connection: conn.name } });

    return reply.code(201).send(session);
  });

  // 单个会话详情
  app.get<{ Params: { id: string } }>('/sessions/:id', async (req) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!s) return { error: '不存在', status: 404 };
    return { ...s, meta: s.meta ? JSON.parse(s.meta) : {} };
  });

  // 历史消息列表 (从 OpenClaw session jsonl 读取)
  app.get<{ Params: { id: string } }>('/sessions/:id/messages', async (req, reply) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!s) return reply.code(404).send({ error: '不存在' });
    const messages = readSessionMessages(s);
    return { sessionId: s.id, messages };
  });

  // 发送消息 (同步等待响应, 若驱动支持)
  app.post<{ Params: { id: string } }>('/sessions/:id/messages', async (req, reply) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!s) return reply.code(404).send({ error: '不存在' });
    const { text, stream } = (req.body ?? {}) as any;
    if (!text) return reply.code(400).send({ error: 'text 必填' });

    const conn = ConnectionRepo.get(s.connection_id);
    if (!conn) return reply.code(404).send({ error: '连接不存在' });
    await ConnectionManager.ensureConnected(conn.id);
    const driver = getDriver(conn.kind);

    if (stream) {
      // 流式模式: 启动 Agent, 立即返回 streamId, 前端通过 SSE 获取响应
      const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 异步启动 (不等待完成)
      driver.sendMessage(conn, s.remote_session_id, text).then((handle) => {
        // 响应写入 session .jsonl, SSE 端点会轮询到
      }).catch(() => { /* ignore */ });
      return reply.code(202).send({ ok: true, streamId, sessionId: s.id });
    }

    // 同步模式: 等待完整响应
    const meta = s.meta ? JSON.parse(s.meta) : {};
    const sessionKey = meta.sessionKey ?? s.remote_session_id;
    const handle = await driver.sendMessage(conn, sessionKey, text);

    // 同步响应: 直接返回全文
    if (handle.response) {
      return reply.code(200).send({
        ok: true,
        sessionId: s.id,
        response: handle.response,
        streamId: handle.streamId,
      });
    }

    // 异步(WS)驱动: 返回 streamId, 客户端通过 SSE 订阅
    return reply.code(202).send({ ok: true, streamId: handle.streamId, sessionId: s.id });
  });

  // 更新会话 (重命名)
  app.patch<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!s) return reply.code(404).send({ error: '不存在' });
    const { title } = (req.body ?? {}) as any;
    if (!title || typeof title !== 'string') return reply.code(400).send({ error: 'title 必填' });
    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, req.params.id);
    eventBus.emitEvent({ type: 'session.status', data: { id: s.id, title } });
    logAudit({ action: 'update', target_type: 'session', target_id: s.id, detail: { title } });
    return { ok: true, title };
  });

  // 删除会话
  app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!s) return reply.code(404).send({ error: '不存在' });
    const conn = ConnectionRepo.get(s.connection_id);
    if (conn) {
      await ConnectionManager.ensureConnected(conn.id);
      const driver = getDriver(conn.kind);
      if (conn.kind === 'openclaw') {
        // OpenClaw sessions.delete 需要 sessionKey (存在 meta 中)
        const sessionKey = (s.meta ? JSON.parse(s.meta) : {}).sessionKey ?? s.remote_session_id;
        await driver.deleteSession(conn, sessionKey);
      } else {
        await driver.deleteSession(conn, s.remote_session_id);
      }
    }
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    eventBus.emitEvent({ type: 'session.deleted', data: { id: s.id, title: s.title, connectionId: s.connection_id } });
    logAudit({ action: 'delete', target_type: 'session', target_id: s.id, detail: { title: s.title } });
    return { ok: true };
  });

  // 批量操作: 删除多个会话
  app.post('/sessions/batch-delete', async (req, reply) => {
    const { ids } = (req.body ?? {}) as any;
    if (!Array.isArray(ids) || ids.length === 0) return reply.code(400).send({ error: 'ids 必填 (数组)' });
    const db = getDb();
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
      if (!s) { failed++; continue; }
      const conn = ConnectionRepo.get(s.connection_id);
      if (conn) {
        try {
          await ConnectionManager.ensureConnected(conn.id);
          const driver = getDriver(conn.kind);
          const sessionKey = (s.meta ? JSON.parse(s.meta) : {}).sessionKey ?? s.remote_session_id;
          await Promise.race([
            driver.deleteSession(conn, sessionKey),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15_000)),
          ]);
        } catch (e: any) {
          console.warn(`[sessions] 批量删除 ${id} 远端失败: ${e.message} (继续删除本地)`);
        }
      }
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      deleted++;
      eventBus.emitEvent({ type: 'session.deleted', data: { id: s.id, title: s.title, connectionId: s.connection_id } });
    }
    logAudit({ action: 'batch_delete', target_type: 'session', target_id: ids.join(','), detail: { deleted, failed } });
    return { ok: true, deleted, failed };
  });

  // 批量操作: 更新会话状态 (如标记为 active/idle)
  app.post('/sessions/batch-update', async (req, reply) => {
    const { ids, status } = (req.body ?? {}) as any;
    if (!Array.isArray(ids) || ids.length === 0) return reply.code(400).send({ error: 'ids 必填' });
    if (!status || !['idle', 'running', 'done', 'error'].includes(status)) return reply.code(400).send({ error: '无效 status' });
    const db = getDb();
    const stmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
    let updated = 0;
    for (const id of ids) {
      const r = stmt.run(status, id);
      if (r.changes > 0) updated++;
    }
    return { ok: true, updated };
  });

  // 统一事件流: SSE (轮询 session .jsonl 文件 → 流式输出)
  // 支持 Last-Event-ID 断点续传: 客户端重连时带上最后收到的 streamId offset
  app.get<{ Params: { id: string } }>('/sessions/:id/stream', async (req, reply) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!s) return reply.code(404).send({ error: '不存在' });
    const { streamId } = req.query as any;

    // 支持 Last-Event-ID 断点续传
    const lastEventId = (req.headers['last-event-id'] as string) || streamId;
    let startOffset = 0;
    if (lastEventId) {
      // 从 lastEventId 恢复: lastEventId 格式为 "offset-{byteOffset}"
      const match = lastEventId.match(/^offset-(\d+)$/);
      if (match) startOffset = parseInt(match[1], 10);
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
    });
    reply.raw.write(`event: meta\ndata: ${JSON.stringify({ sessionId: s.id, status: 'connecting', lastEventId })}\n\n`);

    // 确定 session 文件路径
    let sessionFilePath: string | undefined;
    try { const meta = s.meta ? JSON.parse(s.meta) : {}; sessionFilePath = meta.sessionFile; } catch { /* ignore */ }
    if (!sessionFilePath) {
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const agentDir = process.env.AOC_SESSION_DIR ?? join(homedir(), '.easyclaw', 'agents', 'main', 'sessions');
      sessionFilePath = join(agentDir, `${s.remote_session_id}.jsonl`);
    }

    // 轮询 session 文件, 流式输出新增内容
    const { existsSync, readFileSync, statSync } = await import('node:fs');
    let lastSize = startOffset; // 从断点续传位置开始
    let lastRole = '';
    let lastSentContent = '';
    let tick = 0;
    const MAX_TICKS = 120; // 最多轮询 120 秒

    // 获取当前文件大小作为基线 (如果 startOffset 为 0)
    try {
      if (existsSync(sessionFilePath) && startOffset === 0) {
        lastSize = statSync(sessionFilePath).size;
      }
    } catch { /* ignore */ }

    const timer = setInterval(async () => {
      tick++;
      if (tick > MAX_TICKS) {
        clearInterval(timer);
        reply.raw.write(`event: done\ndata: ${JSON.stringify({ note: '超时' })}\n\n`);
        reply.raw.end();
        return;
      }

      try {
        if (!existsSync(sessionFilePath)) return;
        const stats = readFileSync(sessionFilePath, 'utf8');
        const newContent = stats.slice(lastSize);
        if (!newContent) return;
        lastSize = stats.length;

        // 解析新增行
        for (const line of newContent.split(/\r?\n/)) {
          if (!line.trim()) continue;
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.type !== 'message' || !obj.message || !obj.message.role) continue;
          const role = obj.message.role;
          const contentArr = Array.isArray(obj.message.content) ? obj.message.content : [];
          const text = contentArr
            .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text)
            .join('')
            .trim();
          if (!text) continue;

          if (role === 'assistant') {
            // 只发送新增内容 (delta)
            if (text.length > lastSentContent.length && text.startsWith(lastSentContent)) {
              const delta = text.slice(lastSentContent.length);
              const byteOffset = lastSize; // 当前文件偏移作为续传锚点
              reply.raw.write(`id: offset-${byteOffset}\nevent: text.delta\ndata: ${JSON.stringify({ content: delta, streaming: true })}\n\n`);
              lastSentContent = text;
            } else if (text !== lastSentContent) {
              // 内容不匹配 (可能是新消息), 发送完整内容
              const byteOffset = lastSize;
              reply.raw.write(`id: offset-${byteOffset}\nevent: text.delta\ndata: ${JSON.stringify({ content: text, streaming: true })}\n\n`);
              lastSentContent = text;
            }
            lastRole = role;
          }
        }
      } catch (err: any) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    }, 1000);

    // 清理
    req.raw.on('close', () => { clearInterval(timer); });
  });
}

// ── 会话历史解析 (OpenClaw session .jsonl) ──
// 文件格式: 每行一个 JSON, 其中 type='message' 的行含 role + content[]
// content 元素: { type: 'text', text } | { type: 'thinking', thinking }
function readSessionMessages(s: any): Array<{
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}> {
  // 从 meta.sessionFile 优先, 否则拼接默认路径
  let meta: any = {};
  try { meta = s.meta ? JSON.parse(s.meta) : {}; } catch { /* ignore */ }
  let filePath = meta.sessionFile as string | undefined;
  if (!filePath) {
    const agentDir = process.env.AOC_SESSION_DIR ?? join(homedir(), '.easyclaw', 'agents', 'main', 'sessions');
    filePath = join(agentDir, `${s.remote_session_id}.jsonl`);
  }
  if (!existsSync(filePath)) return [];

  const messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }> = [];
  let raw;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return []; }

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'message' || !obj.message || !obj.message.role) continue;

    const role = obj.message.role;
    if (role !== 'user' && role !== 'assistant') continue;

    // 合并 content 中所有 text 块 (跳过 thinking)
    const contentArr = Array.isArray(obj.message.content) ? obj.message.content : [];
    const text = contentArr
      .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
      .trim();
    if (!text) continue;

    // 解析时间戳 (ISO 或 epoch ms)
    const ts = parseTs(obj.timestamp ?? obj.message.timestamp);

    messages.push({
      id: obj.id ?? `m-${messages.length}`,
      role,
      content: text,
      timestamp: ts,
    });
  }
  return messages;
}

function parseTs(input: string | number | undefined): number {
  if (typeof input === 'number') return input;
  if (!input) return Date.now();
  const iso = new Date(input).getTime();
  return Number.isFinite(iso) ? iso : Date.now();
}
