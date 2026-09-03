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
import { decryptCredential } from '../crypto.js';

// ── OpenCode 适配器 ──
// 参考 ARCHITECTURE.md §1.3 / §5.1 / §5.2
// 服务入口: opencode web (默认 :4096)
// OpenAI 兼容 API: /v1/chat/completions
// Auth: Basic (OPENCODE_SERVER_PASSWORD)
// 能力: MCP + agent/permissions (决策 2: 不支持 skills/plugins)

const OPENCODE_DEFAULTS = {
  webPort: 4096,
};

function emptyCaps() {
  return { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
}

/** 从连接获取 auth header (Basic auth) */
function authHeaders(conn: AgentConnection): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.auth.encrypted) {
    try {
      const secret = decryptCredential(conn.auth);
      // secret 可以是 "user:password" 或纯 password
      const b64 = Buffer.from(secret.includes(':') ? secret : `:${secret}`).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    } catch { /* ignore */ }
  }
  return headers;
}

/** 构建 API URL */
function apiUrl(conn: AgentConnection, path: string): string {
  if (conn.endpoint.openaiPath) {
    return `${conn.endpoint.openaiPath.replace(/\/+$/, '')}${path}`;
  }
  const baseUrl = conn.endpoint.baseUrl.replace(/\/+$/, '');
  return `${baseUrl}${path}`;
}

// ── HTTP 工具 ──

async function opencodeFetch(
  conn: AgentConnection,
  path: string,
  options: { method?: string; body?: any; timeout?: number } = {}
): Promise<any> {
  const { method = 'GET', body, timeout = 30_000 } = options;
  const url = apiUrl(conn, path);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method,
      headers: authHeaders(conn),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenCode API ${resp.status}: ${text.slice(0, 200)}`);
    }

    const contentType = resp.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return resp.json();
    }
    return resp.text();
  } catch (e: any) {
    clearTimeout(timer);
    throw e;
  }
}

// ── 会话管理 ──

/** 列出 OpenCode 会话 */
async function listOpenCodeSessions(conn: AgentConnection): Promise<AgentSession[]> {
  try {
    const result = await opencodeFetch(conn, '/sessions');
    if (Array.isArray(result)) {
      return result.map((s: any) => toAgentSession(s, conn.id));
    }
    // 尝试 OpenAI 兼容格式
    if (Array.isArray(result?.data)) {
      return result.data.map((s: any) => toAgentSession(s, conn.id));
    }
    return [];
  } catch {
    return [];
  }
}

/** 创建 OpenCode 会话 */
async function createOpenCodeSession(conn: AgentConnection, opts: SessionCreateOpts): Promise<AgentSession> {
  const sessionId = `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 尝试通过 API 创建会话
  try {
    const result = await opencodeFetch(conn, '/sessions', {
      method: 'POST',
      body: {
        title: opts.title ?? 'OpenCode 会话',
        agent: conn.profile,
        instructions: opts.instructions,
      },
    });
    if (result?.id) {
      return toAgentSession({ ...result, id: result.id }, conn.id);
    }
  } catch {
    // API 不支持, 使用本地 ID
  }

  return {
    id: sessionId,
    connectionId: conn.id,
    teamId: opts.teamId,
    projectId: opts.projectId,
    remoteSessionId: sessionId,
    title: opts.title ?? 'OpenCode 会话',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'idle',
    meta: { agent: conn.profile },
  };
}

/** 发送消息到 OpenCode (通过 OpenAI /v1/chat/completions) */
async function sendOpenCodeMessage(
  conn: AgentConnection,
  sessionId: string,
  text: string
): Promise<StreamHandle> {
  const body: Record<string, unknown> = {
    model: 'opencode',
    messages: [{ role: 'user', content: text }],
    stream: false,
  };

  // 如果有 session_id, 传入以继续
  if (sessionId && !sessionId.startsWith('oc-')) {
    body.session_id = sessionId;
  }

  const result = await opencodeFetch(conn, '/v1/chat/completions', {
    method: 'POST',
    body,
    timeout: 120_000,
  });

  let response = '';
  try {
    response = result?.choices?.[0]?.message?.content ?? '';
  } catch { /* ignore */ }

  const remoteSessionId = result?.session_id ?? result?.id ?? sessionId;

  return {
    sessionId: remoteSessionId,
    streamId: `oc-${Date.now()}`,
    response,
  };
}

// ── 能力管理 ──

/** 列出 OpenCode 能力 (仅 MCP + agent/permissions) */
async function listOpenCodeCapabilities(conn: AgentConnection): Promise<CapabilityMeta[]> {
  const metas: CapabilityMeta[] = [];

  try {
    // 尝试获取配置
    const result = await opencodeFetch(conn, '/config');

    // MCP servers
    const mcpServers = result?.mcp_servers ?? result?.mcpServers ?? {};
    for (const name of Object.keys(mcpServers)) {
      const config = mcpServers[name];
      metas.push({
        name: `mcp:${name}`,
        type: 'mcp',
        version: config?.version,
        checksum: simpleChecksum(JSON.stringify(config)),
        sizeBytes: JSON.stringify(config).length,
      });
    }

    // Agents (OpenCode 的 agent 配置)
    const agents = result?.agents ?? [];
    for (const agent of agents) {
      const name = typeof agent === 'string' ? agent : agent?.name ?? agent?.id;
      if (name) {
        metas.push({
          name: `agent:${name}`,
          type: 'mcp',  // 归类为 MCP 类能力
          version: typeof agent === 'object' ? agent.version : undefined,
          checksum: simpleChecksum(JSON.stringify(agent)),
          sizeBytes: JSON.stringify(agent).length,
        });
      }
    }
  } catch {
    // 如果 API 不可用, 返回空
  }

  return metas;
}

/** 推送能力到 OpenCode */
async function pushOpenCodeCapability(conn: AgentConnection, cap: Capability): Promise<SyncResult> {
  try {
    if (cap.type === 'mcp') {
      // 更新 MCP 配置
      const mcpConfig = cap.payload.kind === 'config' ? cap.payload.config : { command: cap.name };
      await opencodeFetch(conn, '/config/mcp_servers', {
        method: 'PUT',
        body: { name: cap.name, config: mcpConfig },
      });
      return { ok: true, targetConnectionId: conn.id, capabilityName: cap.name, action: 'pushed', newChecksum: cap.checksum };
    }

    // 不支持 skills/plugins (决策 2)
    if (cap.type === 'skill' || cap.type === 'plugin') {
      return {
        ok: false,
        targetConnectionId: conn.id,
        capabilityName: cap.name,
        action: 'failed',
        error: 'OpenCode 不支持 skills/plugins 类型的能力 (决策 2: 仅 MCP + agent/权限)',
      };
    }

    return { ok: false, targetConnectionId: conn.id, capabilityName: cap.name, action: 'failed', error: '未知能力类型' };
  } catch (e: any) {
    return { ok: false, targetConnectionId: conn.id, capabilityName: cap.name, action: 'failed', error: e.message };
  }
}

/** 从 OpenCode 拉取能力 */
async function pullOpenCodeCapability(conn: AgentConnection, name: string): Promise<Capability> {
  try {
    const result = await opencodeFetch(conn, `/config/${name}`);
    return {
      id: `oc-${name}`,
      name,
      type: name.startsWith('mcp:') ? 'mcp' : 'mcp',  // OpenCode 只有 MCP 类
      sourceKind: 'opencode',
      payload: { kind: 'config', config: result },
      checksum: simpleChecksum(JSON.stringify(result)),
      sizeBytes: JSON.stringify(result).length,
      installedOn: [conn.id],
      createdAt: Date.now(),
    };
  } catch {
    return {
      id: `oc-${name}`,
      name,
      type: 'mcp',
      sourceKind: 'opencode',
      payload: { kind: 'config', config: {} },
      checksum: '',
      sizeBytes: 0,
      installedOn: [],
      createdAt: Date.now(),
    };
  }
}

/** 差异比对 */
async function diffOpenCodeCapability(conn: AgentConnection, cap: Capability): Promise<DiffResult> {
  const metas = await listOpenCodeCapabilities(conn);
  const remote = metas.find((m) => m.name === cap.name);
  if (!remote) return { added: [cap.name], changed: [], removed: [], unchanged: [] };
  if (remote.checksum === cap.checksum) return { added: [], changed: [], removed: [], unchanged: [cap.name] };
  return { added: [], changed: [cap.name], removed: [], unchanged: [] };
}

// ── 辅助函数 ──

function toAgentSession(s: any, connectionId: string): AgentSession {
  return {
    id: s.id ?? s.session_id ?? crypto.randomUUID(),
    connectionId,
    teamId: s.team_id,
    projectId: s.project_id,
    remoteSessionId: s.id ?? s.session_id,
    title: s.title ?? s.name ?? 'OpenCode 会话',
    createdAt: s.created_at ?? Date.now(),
    lastActiveAt: s.last_active_at ?? s.updated_at ?? Date.now(),
    status: s.status ?? 'idle',
    meta: { agent: s.agent, model: s.model },
  };
}

function simpleChecksum(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ── 重试工具 ──

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  retryOn?: (error: Error) => boolean;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 500, retryOn } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const shouldRetry = retryOn ? retryOn(e) : isRetryableError(e);
      if (attempt < maxRetries && shouldRetry) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  throw new Error(`${operation} 失败: ${lastError?.message ?? '未知错误'}`);
}

function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return msg.includes('timeout') || msg.includes('econnrefused') ||
    msg.includes('reset') || msg.includes('503') || msg.includes('502') ||
    msg.includes('504') || msg.includes('abort');
}

// ── 健康探测 ──

async function probeHealth(baseUrl: string, paths: string[]): Promise<boolean> {
  for (const p of paths) {
    try {
      const url = baseUrl.replace(/\/+$/, '') + p;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4_000);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) return true;
    } catch { /* try next */ }
  }
  return false;
}

// ── 导出驱动 ──

export const opencodeDriver: AgentConnectionDriver = {
  kind: 'opencode',

  async test(baseUrl: string, auth: AgentConnection['auth']): Promise<HealthProbe> {
    const start = Date.now();
    try {
      const ok = await probeHealth(baseUrl, ['/status', '/api/status', '/health']);
      return ok
        ? { ok: true, latencyMs: Date.now() - start, capabilities: { sessions: true, teams: false, skills: false, plugins: false, mcp: true, streaming: true }, remoteInfo: { kind: 'opencode' } }
        : { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: '未找到 OpenCode 健康端点 (/status)' };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: e.message };
    }
  },

  listSessions: (conn) => withRetry(() => listOpenCodeSessions(conn), '列出 OpenCode 会话'),
  createSession: createOpenCodeSession,
  resumeSession: async (_conn, _sessionId) => { /* OpenCode 通过 session_id 自动恢复 */ },
  deleteSession: async (_conn, _sessionId) => { /* OpenCode 无显式删除会话 API */ },
  sendMessage: (conn, sessionId, text) => withRetry(() => sendOpenCodeMessage(conn, sessionId, text), '发送消息到 OpenCode', { maxRetries: 1 }),
  stopSession: async (_conn, _sessionId) => { /* OpenCode 无停止会话 API */ },
  listCapabilities: (conn) => withRetry(() => listOpenCodeCapabilities(conn), '列出 OpenCode 能力'),
  pushCapability: (conn, cap) => withRetry(() => pushOpenCodeCapability(conn, cap), '推送能力到 OpenCode', { maxRetries: 1 }),
  pullCapability: (conn, name) => withRetry(() => pullOpenCodeCapability(conn, name), '从 OpenCode 拉取能力'),
  diffCapability: diffOpenCodeCapability,
  deleteCapability: async (_conn, _name) => { /* OpenCode 通过配置管理删除 */ },
};
