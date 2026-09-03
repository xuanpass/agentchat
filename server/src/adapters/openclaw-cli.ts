import { execSync } from 'child_process';
import type {
  AgentConnection,
  AgentConnectionDriver,
  AgentSession,
  Capability,
  CapabilityMeta,
  DiffResult,
  HealthProbe,
  SessionCreateOpts,
  StreamHandle,
  SyncResult,
} from '../types.js';
import { getDb } from '../db/index.js';

// ── OpenClaw Gateway CLI 驱动 ──
// 通过 `easyclaw gateway call` 代理所有 Gateway API 调用
// 避免了 WS 连接的设备配对和 scope 认证问题

const CLI_CMD = process.env.EASYCLAW_CMD ?? 'easyclaw';

function gwCall<T>(method: string, params?: Record<string, unknown>): T {
  const paramsStr = params ? JSON.stringify(params) : '{}';
  // Windows cmd.exe: 双引号内嵌双引号需用反斜杠转义
  const isWin = process.platform === 'win32';
  const escaped = isWin ? paramsStr.replace(/"/g, '\\"') : paramsStr;
  const q = isWin ? '"' : "'";
  const cmd = `${CLI_CMD} gateway call ${method} --params ${q}${escaped}${q} --json`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  // 跳过 CLI 前缀行 ("Gateway call: method")
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) return {} as T;
  return JSON.parse(output.slice(jsonStart)) as T;
}

// 同步等待最终响应 (仅 agent 方法): --expect-final + 长超时
function gwCallFinal<T>(method: string, params?: Record<string, unknown>): T {
  const paramsStr = params ? JSON.stringify(params) : '{}';
  const isWin = process.platform === 'win32';
  const escaped = isWin ? paramsStr.replace(/"/g, '\\"') : paramsStr;
  const q = isWin ? '"' : "'";
  const cmd = `${CLI_CMD} gateway call ${method} --params ${q}${escaped}${q} --json --expect-final --timeout ${AGENT_TIMEOUT_MS}`;
  const output = execSync(cmd, { encoding: 'utf8', timeout: AGENT_TIMEOUT_MS + 10_000, windowsHide: true });
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) return {} as T;
  return JSON.parse(output.slice(jsonStart)) as T;
}

const AGENT_TIMEOUT_MS = Number(process.env.AOC_AGENT_TIMEOUT_MS ?? 120_000);

function emptyCaps() {
  return { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
}

export const openclawDriver: AgentConnectionDriver = {
  kind: 'openclaw',

  async test(_baseUrl?: string): Promise<HealthProbe> {
    const start = Date.now();
    try {
      // 方式1: Gateway health RPC
      const result = gwCall<{ ok?: boolean; status?: string }>('health');
      if (result.ok === false) {
        return { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: 'Gateway health 返回 false' };
      }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        capabilities: { sessions: true, teams: true, skills: true, plugins: true, mcp: true, streaming: true },
        remoteInfo: { version: result.status ?? 'via-cli' },
      };
    } catch (e: any) {
      // 方式2: CLI 可用但 health RPC 不可用, 尝试 listSessions 探测
      try {
        gwCall('sessions.list');
        return {
          ok: true,
          latencyMs: Date.now() - start,
          capabilities: { sessions: true, teams: true, skills: true, plugins: true, mcp: true, streaming: true },
          remoteInfo: { version: 'via-cli (fallback)' },
        };
      } catch (e2: any) {
        return { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: e2.message };
      }
    }
  },

  async listSessions(_conn: AgentConnection): Promise<AgentSession[]> {
    const result = gwCall<{ sessions: any[] }>('sessions.list');
    return (result.sessions ?? []).map((s: any) => toSession(s, _conn.id));
  },

  async createSession(_conn, opts?: SessionCreateOpts): Promise<AgentSession> {
    const params: Record<string, unknown> = {};
    if (opts?.model) params.model = opts.model;
    if (opts?.title) params.label = opts.title;
    const result = gwCall<any>('sessions.create', params);
    return toSession({ ...result, title: opts?.title ?? '未命名会话' }, _conn.id);
  },

  async resumeSession(_conn, sessionKey): Promise<void> {
    // Gateway 没有独立 resume RPC，恢复通过 agent 方法指定 sessionKey
    gwCall('sessions.resume', { key: sessionKey });
  },

  async deleteSession(_conn, sessionKey): Promise<void> {
    gwCall('sessions.delete', { key: sessionKey });
  },

  async sendMessage(_conn, sessionId, text): Promise<StreamHandle> {
    const idempotencyKey = `ik-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 同步等待 Agent 最终响应 (需传 sessionId + --expect-final)
    const result = gwCallFinal<{
      runId?: string;
      result?: {
        payloads?: Array<{ text?: string }>;
        meta?: { finalAssistantVisibleText?: string; finalAssistantRawText?: string };
      };
    }>('agent', { sessionId, message: text, idempotencyKey });
    // 提取最终文案: result.result?.payloads[]?.text
    let response = '';
    const payloads = result?.result?.payloads;
    if (Array.isArray(payloads)) {
      response = payloads.map((p: any) => p?.text ?? '').filter(Boolean).join('\n');
    }
    const summary = result?.result?.meta?.finalAssistantVisibleText ?? result?.result?.meta?.finalAssistantRawText ?? '';
    return {
      sessionId,
      streamId: idempotencyKey,
      runId: result?.runId,
      response: response || summary,   // 完整响应文本
    };
  },

  async stopSession(_conn, sessionKey): Promise<void> {
    gwCall('chat.abort', { sessionKey });
  },

  async listCapabilities(_conn: AgentConnection): Promise<CapabilityMeta[]> {
    // Gateway 不支持 tools.list, 从本地 EasyClaw 配置读取
    try {
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const cfgPath = path.join(os.homedir(), '.easyclaw', 'easyclaw.json');
      if (!fs.existsSync(cfgPath)) return [];
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const skills: string[] = cfg?.agents?.defaults?.skills ?? [];
      const plugins: string[] = Object.keys(cfg?.plugins?.entries ?? {})
        .filter((k) => cfg.plugins.entries[k]?.enabled);
      const metas: CapabilityMeta[] = [];
      for (const s of skills) {
        metas.push({ name: s, type: 'skill', version: undefined, checksum: '', sizeBytes: 0 });
      }
      for (const p of plugins) {
        if (p !== 'memory-core') {
          metas.push({ name: p, type: 'plugin', version: undefined, checksum: '', sizeBytes: 0 });
        }
      }
      return metas;
    } catch {
      return [];
    }
  },

  async pushCapability(_conn, cap: Capability): Promise<SyncResult> {
    // Gateway 不支持 tools.upsert, 落本地 capabilities 表
    getDb().prepare(`
      INSERT INTO capabilities (id, type, name, version, source_kind, payload, checksum, size_bytes, installed_on, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum, size_bytes=excluded.size_bytes, payload=excluded.payload
    `).run(cap.id, cap.type, cap.name, cap.version ?? null, cap.sourceKind,
      JSON.stringify(cap.payload), cap.checksum, cap.sizeBytes, JSON.stringify(cap.installedOn), Date.now());
    return { ok: true, targetConnectionId: _conn.id, capabilityName: cap.name, action: 'pushed', newChecksum: cap.checksum };
  },

  async pullCapability(_conn, name): Promise<Capability> {
    // Gateway 不支持 tools.get, 从本地 capabilities 表读取
    const row = getDb().prepare('SELECT * FROM capabilities WHERE name = ?').get(name) as any;
    if (row) {
      return {
        id: row.id, name: row.name, type: row.type, version: row.version,
        sourceKind: row.source_kind, payload: JSON.parse(row.payload),
        checksum: row.checksum, sizeBytes: row.size_bytes,
        installedOn: JSON.parse(row.installed_on), createdAt: row.created_at,
      };
    }
    return {
      id: `local-${name}`, name, type: 'skill', sourceKind: _conn.kind,
      payload: { kind: 'file', path: name, encoding: 'utf8', content: `# ${name}` },
      checksum: '', sizeBytes: 0, installedOn: [], createdAt: Date.now(),
    };
  },

  async diffCapability(_conn, cap: Capability): Promise<DiffResult> {
    const metas = await this.listCapabilities(_conn);
    const remote = metas.find((m) => m.name === cap.name);
    if (!remote) return { added: [cap.name], changed: [], removed: [], unchanged: [] };
    if (remote.checksum === cap.checksum) return { added: [], changed: [], removed: [], unchanged: [cap.name] };
    return { added: [], changed: [cap.name], removed: [], unchanged: [] };
  },

  async deleteCapability(_conn, name): Promise<void> {
    getDb().prepare('DELETE FROM capabilities WHERE name = ?').run(name);
  },
};

function toSession(s: any, connectionId?: string): AgentSession {
  return {
    id: s.sessionId ?? s.id ?? s.key ?? crypto.randomUUID(),
    connectionId: connectionId ?? '',
    teamId: s.teamId,
    projectId: s.projectId,
    remoteSessionId: s.sessionId ?? s.id ?? s.key,
    title: s.displayName ?? s.label ?? s.title ?? s.name ?? '未命名会话',
    createdAt: s.createdAt ?? (s.updatedAt ? s.updatedAt - 1 : Date.now()),
    lastActiveAt: s.lastActiveAt ?? s.updatedAt ?? Date.now(),
    status: s.status ?? (s.kind === 'direct' ? 'idle' : s.status ?? 'idle'),
    meta: { ...(s.meta ?? {}), sessionKey: s.key, model: s.model, kind: s.kind },
  };
}
