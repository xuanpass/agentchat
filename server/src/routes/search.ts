import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/index.js';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export async function searchRoutes(app: FastifyInstance) {
  // 全局搜索
  app.get('/search', async (req) => {
    const { q, type } = req.query as any;
    const query = (q || '').trim().toLowerCase();
    if (!query) return { query: '', results: { sessions: [], messages: [], capabilities: [], connections: [], teams: [] } };

    const results: any = {};

    // 搜索会话标题
    if (!type || type === 'sessions') {
      const sessions = getDb().prepare('SELECT id, title, connection_id, status, last_active_at FROM sessions WHERE LOWER(title) LIKE ? ORDER BY last_active_at DESC LIMIT 10').all(`%${query}%`) as any[];
      results.sessions = sessions.map((s) => ({ id: s.id, title: s.title, connectionId: s.connection_id, status: s.status, lastActiveAt: s.last_active_at, type: 'session' }));
    } else {
      results.sessions = [];
    }

    // 搜索能力名称
    if (!type || type === 'capabilities') {
      const caps = getDb().prepare('SELECT id, name, type, source_kind, version FROM capabilities WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 10').all(`%${query}%`) as any[];
      results.capabilities = caps.map((c) => ({ id: c.id, name: c.name, capType: c.type, sourceKind: c.source_kind, version: c.version, type: 'capability' }));
    } else {
      results.capabilities = [];
    }

    // 搜索实例名称
    if (!type || type === 'connections') {
      const conns = getDb().prepare('SELECT id, name, kind, status FROM connections WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 10').all(`%${query}%`) as any[];
      results.connections = conns.map((c) => ({ id: c.id, name: c.name, kind: c.kind, status: c.status, type: 'connection' }));
    } else {
      results.connections = [];
    }

    // 搜索团队名称
    if (!type || type === 'teams') {
      const teams = getDb().prepare('SELECT id, name, description FROM teams WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 10').all(`%${query}%`) as any[];
      results.teams = teams.map((t) => ({ id: t.id, name: t.name, description: t.description, type: 'team' }));
    } else {
      results.teams = [];
    }

    // 搜索会话消息内容 (从 jsonl 文件读取)
    if (!type || type === 'messages') {
      results.messages = searchMessages(query);
    } else {
      results.messages = [];
    }

    return { query: q, results };
  });
}

// 搜索会话消息内容
function searchMessages(query: string): any[] {
  const sessions = getDb().prepare('SELECT id, title, remote_session_id, meta FROM sessions ORDER BY last_active_at DESC LIMIT 20').all() as any[];
  const { readFileSync, existsSync } = require('node:fs');

  const results: any[] = [];

  for (const s of sessions) {
    if (results.length >= 10) break;

    let meta: any = {};
    try { meta = s.meta ? JSON.parse(s.meta) : {}; } catch { /* ignore */ }
    let filePath = meta.sessionFile as string | undefined;
    if (!filePath) {
      const agentDir = process.env.AOC_SESSION_DIR ?? join(homedir(), '.easyclaw', 'agents', 'main', 'sessions');
      filePath = join(agentDir, `${s.remote_session_id}.jsonl`);
    }
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.type !== 'message' || !obj.message?.role) continue;

        const contentArr = Array.isArray(obj.message.content) ? obj.message.content : [];
        const text = contentArr
          .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('')
          .trim();
        if (!text.toLowerCase().includes(query)) continue;

        // 截取匹配片段
        const lowerText = text.toLowerCase();
        const idx = lowerText.indexOf(query);
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + query.length + 40);
        const snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');

        results.push({
          sessionId: s.id,
          sessionTitle: s.title,
          role: obj.message.role,
          snippet,
          timestamp: obj.timestamp ?? obj.message.timestamp ?? Date.now(),
          type: 'message',
        });

        if (results.length >= 10) break;
      }
    } catch { /* ignore */ }
  }

  return results;
}
