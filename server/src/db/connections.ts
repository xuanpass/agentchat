import { getDb } from './index.js';
import type { AgentConnection, CapabilityFlags } from '../types.js';

function now() { return Date.now(); }

function rowToConnection(r: any): AgentConnection {
  return {
    id: r.id, name: r.name, kind: r.kind,
    endpoint: { baseUrl: r.endpoint_base_url, openaiPath: r.endpoint_openai_path ?? undefined },
    auth: { type: r.auth_type, encrypted: r.auth_encrypted, iv: r.auth_iv, tag: r.auth_tag },
    profile: r.profile ?? undefined, status: r.status,
    capabilities: {
      sessions: !!r.cap_sessions, teams: !!r.cap_teams, skills: !!r.cap_skills,
      plugins: !!r.cap_plugins, mcp: !!r.cap_mcp, streaming: !!r.cap_streaming,
    },
    lastSeenAt: r.last_seen_at ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  } as AgentConnection;
}

export const ConnectionRepo = {
  list(): AgentConnection[] {
    return getDb().prepare('SELECT * FROM connections ORDER BY created_at DESC').all().map(rowToConnection);
  },

  get(id: string): AgentConnection | undefined {
    const r = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id);
    return r ? rowToConnection(r) : undefined;
  },

  create(conn: Omit<AgentConnection, 'createdAt' | 'updatedAt'>): AgentConnection {
    const ts = now();
    getDb().prepare(`
      INSERT INTO connections (id, name, kind, endpoint_base_url, endpoint_openai_path,
        auth_type, auth_encrypted, auth_iv, auth_tag, profile, status,
        cap_sessions, cap_teams, cap_skills, cap_plugins, cap_mcp, cap_streaming,
        last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conn.id, conn.name, conn.kind, conn.endpoint.baseUrl, conn.endpoint.openaiPath ?? null,
      conn.auth.type, conn.auth.encrypted, conn.auth.iv, conn.auth.tag, conn.profile ?? null,
      conn.status,
      conn.capabilities.sessions ? 1 : 0, conn.capabilities.teams ? 1 : 0,
      conn.capabilities.skills ? 1 : 0, conn.capabilities.plugins ? 1 : 0,
      conn.capabilities.mcp ? 1 : 0, conn.capabilities.streaming ? 1 : 0,
      conn.lastSeenAt ?? null, ts, ts,
    );
    return this.get(conn.id)!;
  },

  update(id: string, patch: Partial<AgentConnection>): AgentConnection | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    getDb().prepare(`
      UPDATE connections SET name=?, kind=?, endpoint_base_url=?, endpoint_openai_path=?,
        auth_type=?, auth_encrypted=?, auth_iv=?, auth_tag=?, profile=?, status=?,
        cap_sessions=?, cap_teams=?, cap_skills=?, cap_plugins=?, cap_mcp=?, cap_streaming=?,
        last_seen_at=?, updated_at=?
      WHERE id=?
    `).run(
      merged.name, merged.kind, merged.endpoint.baseUrl, merged.endpoint.openaiPath ?? null,
      merged.auth.type, merged.auth.encrypted, merged.auth.iv, merged.auth.tag, merged.profile ?? null,
      merged.status,
      merged.capabilities.sessions ? 1 : 0, merged.capabilities.teams ? 1 : 0,
      merged.capabilities.skills ? 1 : 0, merged.capabilities.plugins ? 1 : 0,
      merged.capabilities.mcp ? 1 : 0, merged.capabilities.streaming ? 1 : 0,
      merged.lastSeenAt ?? null, merged.updatedAt, id,
    );
    return this.get(id);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM connections WHERE id = ?').run(id);
  },
};
