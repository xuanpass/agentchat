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

// ── Hermes 适配器 ──
// 参考 ARCHITECTURE.md §1.2 / §5.1 / §5.2
// 服务入口: hermes serve (REST + WS, 默认 :9119)
// OpenAI 兼容 API: /v1/chat/completions, /v1/responses (SSE)
// 能力: ~/.hermes/config.yaml (mcp_servers) + plugins/ + skills/

const HERMES_DEFAULTS = {
  apiPort: 8642,    // OpenAI 兼容 API 端口
  servePort: 9119,  // serve 后端端口
};

function emptyCaps() {
  return { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
}

/** 从连接获取 auth header */
function authHeaders(conn: AgentConnection): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.auth.type === 'token' && conn.auth.encrypted) {
    try {
      const token = decryptCredential(conn.auth);
      headers['Authorization'] = `Bearer ${token}`;
    } catch { /* ignore */ }
  } else if (conn.auth.type === 'basic' && conn.auth.encrypted) {
    try {
      const decoded = decryptCredential(conn.auth);
      // decoded 可以是 "user:password" 或纯 token
      const b64 = Buffer.from(decoded).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    } catch { /* ignore */ }
  } else if (conn.auth.type === 'password' && conn.auth.encrypted) {
    try {
      const password = decryptCredential(conn.auth);
      const b64 = Buffer.from(`:${password}`).toString('base64');
      headers['Authorization'] = `Basic ${b64}`;
    } catch { /* ignore */ }
  }
  return headers;
}

/** 解析 baseUrl, 提取 host:port */
function parseBaseUrl(baseUrl: string): { host: string; port: number; protocol: string } {
  const url = new URL(baseUrl);
  const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
  return { host: url.hostname, port, protocol: url.protocol };
}

/** 构建 OpenAI 兼容 API URL */
function openaiApiUrl(conn: AgentConnection, path: string): string {
  const { protocol, host } = parseBaseUrl(conn.endpoint.baseUrl);
  // 如果显式配置了 openaiPath, 使用它
  if (conn.endpoint.openaiPath) {
    return `${conn.endpoint.openaiPath.replace(/\/+$/, '')}${path}`;
  }
  // 否则推断: serve 端口 + (apiPort - servePort) 偏移
  const apiPort = HERMES_DEFAULTS.apiPort;
  return `${protocol}//${host}:${apiPort}${path}`;
}

/** 构建 serve API URL */
function serveApiUrl(conn: AgentConnection, path: string): string {
  const baseUrl = conn.endpoint.baseUrl.replace(/\/+$/, '');
  return `${baseUrl}${path}`;
}

// ── HTTP 工具 ──

async function hermesFetch(
  conn: AgentConnection,
  path: string,
  options: { method?: string; body?: any; apiType?: 'openai' | 'serve'; timeout?: number } = {}
): Promise<any> {
  const { method = 'GET', body, apiType = 'openai', timeout = 30_000 } = options;
  const url = apiType === 'openai'
    ? openaiApiUrl(conn, path)
    : serveApiUrl(conn, path);

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
      throw new Error(`Hermes API ${resp.status}: ${text.slice(0, 200)}`);
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

/** 列出 Hermes 会话 (通过 OpenAI API 的会话列表或 serve API) */
async function listHermesSessions(conn: AgentConnection): Promise<AgentSession[]> {
  try {
    // 尝试 serve API 的会话列表
    const result = await hermesFetch(conn, '/api/sessions', { apiType: 'serve' });
    if (Array.isArray(result)) {
      return result.map((s: any) => toAgentSession(s, conn.id));
    }
    // 如果 serve API 不支持, 返回空数组
    return [];
  } catch {
    // serve API 不支持会话列表, 返回空
    return [];
  }
}

/** 创建 Hermes 会话 */
async function createHermesSession(conn: AgentConnection, opts: SessionCreateOpts): Promise<AgentSession> {
  // Hermes 没有独立的"创建会话"API, 会话在首次发消息时自动创建
  // 我们生成一个本地 ID, 发消息时会用到
  const sessionId = `hermes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: sessionId,
    connectionId: conn.id,
    teamId: opts.teamId,
    projectId: opts.projectId,
    remoteSessionId: sessionId,
    title: opts.title ?? 'Hermes 会话',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'idle',
    meta: { profile: conn.profile, instructions: opts.instructions },
  };
}

/** 发送消息到 Hermes (通过 OpenAI /v1/chat/completions) */
async function sendHermesMessage(
  conn: AgentConnection,
  sessionId: string,
  text: string
): Promise<StreamHandle> {
  const body: Record<string, unknown> = {
    model: 'hermes-agent',  // Hermes 的默认模型名
    messages: [{ role: 'user', content: text }],
    stream: false,  // 首版使用非流式, 同步等待完整响应
  };

  // 如果有 session_id, 传入以继续会话
  if (sessionId && !sessionId.startsWith('hermes-')) {
    body.session_id = sessionId;
  }

  const result = await hermesFetch(conn, '/v1/chat/completions', {
    method: 'POST',
    body,
    timeout: 120_000,
  });

  // 提取响应文本
  let response = '';
  try {
    response = result?.choices?.[0]?.message?.content ?? '';
  } catch { /* ignore */ }

  // 提取 sessionId (如果返回了)
  const remoteSessionId = result?.session_id ?? result?.id ?? sessionId;

  return {
    sessionId: remoteSessionId,
    streamId: `hermes-${Date.now()}`,
    response,
  };
}

// ── 能力管理 ──

/** 列出 Hermes 能力 (MCP + skills + plugins) */
async function listHermesCapabilities(conn: AgentConnection): Promise<CapabilityMeta[]> {
  const metas: CapabilityMeta[] = [];

  try {
    // 读取 Hermes 配置
    const result = await hermesFetch(conn, '/api/config', { apiType: 'serve' });

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

    // Skills
    const skills = result?.skills ?? [];
    for (const skill of skills) {
      const name = typeof skill === 'string' ? skill : skill?.name ?? skill?.id;
      if (name) {
        metas.push({
          name,
          type: 'skill',
          version: typeof skill === 'object' ? skill.version : undefined,
          checksum: simpleChecksum(JSON.stringify(skill)),
          sizeBytes: JSON.stringify(skill).length,
        });
      }
    }

    // Plugins
    const plugins = result?.plugins ?? [];
    for (const plugin of plugins) {
      const name = typeof plugin === 'string' ? plugin : plugin?.name ?? plugin?.id;
      if (name) {
        metas.push({
          name,
          type: 'plugin',
          version: typeof plugin === 'object' ? plugin.version : undefined,
          checksum: simpleChecksum(JSON.stringify(plugin)),
          sizeBytes: JSON.stringify(plugin).length,
        });
      }
    }
  } catch {
    // 如果 API 不可用, 返回空
  }

  return metas;
}

/** 推送能力到 Hermes */
async function pushHermesCapability(conn: AgentConnection, cap: Capability): Promise<SyncResult> {
  try {
    if (cap.type === 'mcp') {
      // 更新 MCP 配置
      const mcpConfig = cap.payload.kind === 'config' ? cap.payload.config : { command: cap.name };
      await hermesFetch(conn, '/api/config/mcp_servers', {
        method: 'PUT',
        body: { name: cap.name, config: mcpConfig },
        apiType: 'serve',
      });
      return { ok: true, targetConnectionId: conn.id, capabilityName: cap.name, action: 'pushed', newChecksum: cap.checksum };
    }

    if (cap.type === 'skill') {
      // 推送 skill 到 Hermes
      await hermesFetch(conn, '/api/skills', {
        method: 'POST',
        body: { name: cap.name, payload: cap.payload },
        apiType: 'serve',
      });
      return { ok: true, targetConnectionId: conn.id, capabilityName: cap.name, action: 'pushed', newChecksum: cap.checksum };
    }

    if (cap.type === 'plugin') {
      // 推送 plugin 到 Hermes
      await hermesFetch(conn, '/api/plugins', {
        method: 'POST',
        body: { name: cap.name, payload: cap.payload },
        apiType: 'serve',
      });
      return { ok: true, targetConnectionId: conn.id, capabilityName: cap.name, action: 'pushed', newChecksum: cap.checksum };
    }

    return { ok: false, targetConnectionId: conn.id, capabilityName: cap.name, action: 'failed', error: '未知能力类型' };
  } catch (e: any) {
    return { ok: false, targetConnectionId: conn.id, capabilityName: cap.name, action: 'failed', error: e.message };
  }
}

/** 从 Hermes 拉取能力 */
async function pullHermesCapability(conn: AgentConnection, name: string): Promise<Capability> {
  // 尝试从 serve API 获取
  try {
    const result = await hermesFetch(conn, `/api/config/${name}`, { apiType: 'serve' });
    return {
      id: `hermes-${name}`,
      name,
      type: name.startsWith('mcp:') ? 'mcp' : 'skill',
      sourceKind: 'hermes',
      payload: { kind: 'config', config: result },
      checksum: simpleChecksum(JSON.stringify(result)),
      sizeBytes: JSON.stringify(result).length,
      installedOn: [conn.id],
      createdAt: Date.now(),
    };
  } catch {
    // 如果 API 不可用, 返回占位
    return {
      id: `hermes-${name}`,
      name,
      type: name.startsWith('mcp:') ? 'mcp' : 'skill',
      sourceKind: 'hermes',
      payload: { kind: 'file', path: name, encoding: 'utf8', content: `# ${name}` },
      checksum: '',
      sizeBytes: 0,
      installedOn: [],
      createdAt: Date.now(),
    };
  }
}

/** 差异比对 */
async function diffHermesCapability(conn: AgentConnection, cap: Capability): Promise<DiffResult> {
  const metas = await listHermesCapabilities(conn);
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
    title: s.title ?? s.name ?? 'Hermes 会话',
    createdAt: s.created_at ?? Date.now(),
    lastActiveAt: s.last_active_at ?? s.updated_at ?? Date.now(),
    status: s.status ?? 'idle',
    meta: { profile: s.profile, model: s.model },
  };
}

function simpleChecksum(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
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

// ── 导出驱动 ──

export const hermesDriver: AgentConnectionDriver = {
  kind: 'hermes',

  async test(baseUrl: string, auth: AgentConnection['auth']): Promise<HealthProbe> {
    const start = Date.now();
    try {
      // 构建临时连接对象用于健康探测
      const conn: AgentConnection = {
        id: 'probe', name: 'probe', kind: 'hermes',
        endpoint: { baseUrl }, auth,
        status: 'disconnected', capabilities: emptyCaps(),
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      const ok = await probeHealth(baseUrl, ['/api/status', '/status', '/health']);
      return ok
        ? { ok: true, latencyMs: Date.now() - start, capabilities: { sessions: true, teams: false, skills: true, plugins: true, mcp: true, streaming: true }, remoteInfo: { kind: 'hermes' } }
        : { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: '未找到 Hermes 健康端点 (/api/status)' };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: e.message };
    }
  },

  listSessions: (conn) => withRetry(() => listHermesSessions(conn), '列出 Hermes 会话'),
  createSession: createHermesSession,
  resumeSession: async (_conn, _sessionId) => { /* Hermes 无需显式 resume */ },
  deleteSession: async (_conn, _sessionId) => { /* Hermes 无删除会话 API */ },
  sendMessage: (conn, sessionId, text) => withRetry(() => sendHermesMessage(conn, sessionId, text), '发送消息到 Hermes', { maxRetries: 1 }),
  stopSession: async (_conn, _sessionId) => { /* Hermes 无停止会话 API */ },
  listCapabilities: (conn) => withRetry(() => listHermesCapabilities(conn), '列出 Hermes 能力'),
  pushCapability: (conn, cap) => withRetry(() => pushHermesCapability(conn, cap), '推送能力到 Hermes', { maxRetries: 1 }),
  pullCapability: (conn, name) => withRetry(() => pullHermesCapability(conn, name), '从 Hermes 拉取能力'),
  diffCapability: diffHermesCapability,
  deleteCapability: async (_conn, _name) => { /* Hermes 通过配置管理删除 */ },
};

/** 依次尝试候选健康路径, 任一返回 2xx 即视为存活 */
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
