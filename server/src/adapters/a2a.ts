// ── A2A (Agent2Agent) 适配器 ──
// 协议: A2A v1.0 (JSON-RPC 2.0 over HTTP), 端点由 Agent Card 自动发现
// 参考: A2A-DESIGN.md §3/§4 (实测数据见 §附录)
//
// ⚠️ 实测修正 (2026-09-04):
//   1. JSON-RPC 路径不可硬编码 — OpenClaw 挂 /a2a/v1, Hermes 挂 /, 一律取
//      Agent Card 的 supportedInterfaces[].url
//   2. Hermes 虽声明 streaming:true, 但其 SSE 只吐 TaskStatusUpdate(状态),
//      不吐文本增量。故取文本统一走同步 SendMessage, SSE 不作为文本通道
//   3. 回复文本优先取 task.artifacts[].parts[].text, 回退 task.status.message.parts[].text
//   4. TaskState 实测为 TASK_STATE_COMPLETED 形态 (带 TASK_STATE_ 前缀)

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

// ── 类型 ──

interface A2ACard {
  name?: string;
  version?: string;
  description?: string;
  url?: string;
  provider?: { organization?: string; url?: string };
  supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }>;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean; [k: string]: unknown };
  skills?: Array<{ id?: string; name?: string; description?: string; tags?: string[] }>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

interface JsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

export class A2AError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'A2AError';
    this.code = code;
    this.status = status;
  }
}

// ── 常量 ──

const CARD_TIMEOUT_MS = 6_000;
const CARD_TTL_MS = 60_000;
const DEFAULT_AGENT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function agentTimeoutMs(): number {
  const raw = Number(process.env.AOC_AGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AGENT_TIMEOUT_MS;
}

// ── Agent Card 缓存 (按连接 id + baseUrl) ──

const cardCache = new Map<string, { card: A2ACard; ts: number }>();
/** connId:contextId -> 最近一次任务的 taskId (供 stopSession 取消) */
const lastTaskId = new Map<string, string>();

function cacheKey(conn: AgentConnection): string {
  return `${conn.id}|${conn.endpoint.baseUrl}`;
}

// ── HTTP / 端点解析 ──

function authHeaders(conn: AgentConnection): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.auth.type === 'token' && conn.auth.encrypted) {
    try {
      headers['Authorization'] = `Bearer ${decryptCredential(conn.auth)}`;
    } catch { /* ignore */ }
  } else if ((conn.auth.type === 'basic' || conn.auth.type === 'password') && conn.auth.encrypted) {
    try {
      const decoded = decryptCredential(conn.auth);
      const value = conn.auth.type === 'password' ? `:${decoded}` : decoded;
      headers['Authorization'] = `Basic ${Buffer.from(value).toString('base64')}`;
    } catch { /* ignore */ }
  }
  return headers;
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/** Agent Card 固定挂在 origin 根, 与 JSON-RPC 路径无关 */
function cardUrl(baseUrl: string): string {
  const origin = new URL(baseUrl).origin;
  return `${origin}/.well-known/agent-card.json`;
}

/**
 * Agent Card 里的 URL 常是 127.0.0.1 (服务端视角)。
 * 若用户填的 baseUrl 指向非本机, 需把 card URL 的 host 换成用户填的, 否则跨机必连不上。
 * 保留 card URL 的 path (OpenClaw 的 /a2a/v1 就藏在 path 里)。
 */
function rewriteHost(target: string, baseUrl: string): string {
  try {
    const t = new URL(target);
    const b = new URL(baseUrl);
    if (!LOCAL_HOSTS.has(t.hostname)) return target;
    if (LOCAL_HOSTS.has(b.hostname)) return target;
    t.protocol = b.protocol;
    t.hostname = b.hostname;
    if (b.port) t.port = b.port;
    return t.toString();
  } catch {
    return target;
  }
}

async function fetchCard(conn: AgentConnection, opts: { force?: boolean } = {}): Promise<A2ACard> {
  const key = cacheKey(conn);
  const cached = cardCache.get(key);
  if (!opts.force && cached && Date.now() - cached.ts < CARD_TTL_MS) return cached.card;

  const url = cardUrl(conn.endpoint.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CARD_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: authHeaders(conn), signal: controller.signal });
    clearTimeout(timer);
    if (resp.status === 401 || resp.status === 403) {
      throw new A2AError('AUTH_FAILED', `A2A 端点要求认证 (HTTP ${resp.status})`, resp.status);
    }
    if (resp.status === 404) {
      throw new A2AError('NOT_FOUND', `${url} 未找到 — 请确认填写的是 A2A 服务根地址`, resp.status);
    }
    if (!resp.ok) {
      throw new A2AError('INTERNAL', `Agent Card 请求失败 (HTTP ${resp.status})`, resp.status);
    }
    const card = (await resp.json()) as A2ACard;
    cardCache.set(key, { card, ts: Date.now() });
    return card;
  } catch (e: any) {
    clearTimeout(timer);
    if (e instanceof A2AError) throw e;
    if (e?.name === 'AbortError' || /timeout/i.test(e?.message ?? '')) {
      throw new A2AError('CONN_TIMEOUT', `Agent Card 请求超时 (${CARD_TIMEOUT_MS}ms): ${url}`);
    }
    throw new A2AError('CONN_REFUSED', `无法连接 A2A 端点 ${url}: ${e?.message ?? e}`);
  }
}

/** JSON-RPC 端点: 首选 Card 声明, 回退用户填的 baseUrl */
async function jsonRpcUrl(conn: AgentConnection, card?: A2ACard): Promise<string> {
  const c = card ?? (await fetchCard(conn));
  const iface = (c.supportedInterfaces ?? []).find(
    (i) => i.url && (!i.protocolBinding || i.protocolBinding.toUpperCase() === 'JSONRPC')
  );
  const raw = iface?.url ?? c.url ?? conn.endpoint.baseUrl;
  return trimSlash(rewriteHost(raw, conn.endpoint.baseUrl));
}

async function rpc<T = any>(
  conn: AgentConnection,
  method: string,
  params: Record<string, unknown>,
  opts: { timeout?: number; card?: A2ACard } = {}
): Promise<T> {
  const url = await jsonRpcUrl(conn, opts.card);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? agentTimeoutMs());
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: authHeaders(conn),
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.status === 401 || resp.status === 403) {
      throw new A2AError('AUTH_FAILED', `${method}: 认证失败 (HTTP ${resp.status}) — 请检查 Bearer token`, resp.status);
    }
    const body = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = (body as any)?.error?.message ?? `HTTP ${resp.status}`;
      throw new A2AError(resp.status >= 500 ? 'INTERNAL' : 'CONN_REFUSED', `${method}: ${msg}`, resp.status);
    }
    const err = (body as any)?.error as JsonRpcError | undefined;
    if (err) {
      const code = err.code === -32050 || err.code === -32051 ? 'AUTH_FAILED' : 'INTERNAL';
      throw new A2AError(code, `${method}: ${err.message ?? 'JSON-RPC error'}${err.code !== undefined ? ` (code ${err.code})` : ''}`);
    }
    return (body as any)?.result as T;
  } catch (e: any) {
    clearTimeout(timer);
    if (e instanceof A2AError) throw e;
    if (e?.name === 'AbortError' || /timeout/i.test(e?.message ?? '')) {
      throw new A2AError('CONN_TIMEOUT', `${method}: 请求超时 — 远端可能仍在执行`);
    }
    throw new A2AError('CONN_REFUSED', `${method}: 无法连接 ${url}: ${e?.message ?? e}`);
  }
}

// ── 结果解析 ──

const TERMINAL_STATES = new Set([
  'completed', 'failed', 'canceled', 'cancelled', 'rejected',
  'task_state_completed', 'task_state_failed', 'task_state_canceled',
  'task_state_cancelled', 'task_state_rejected',
]);

function normalizeState(state: unknown): string {
  return String(state ?? '').toLowerCase();
}

function isTerminal(state: unknown): boolean {
  return TERMINAL_STATES.has(normalizeState(state));
}

function isFailed(state: unknown): boolean {
  const s = normalizeState(state);
  return s === 'failed' || s === 'rejected' || s === 'task_state_failed' || s === 'task_state_rejected';
}

/** 从 parts[] 提取全部文本 */
function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    if (typeof rec.text === 'string') chunks.push(rec.text);
    else if (rec.text != null) chunks.push(String(rec.text));
  }
  return chunks.join('');
}

/**
 * 提取任务回复文本 (实测优先级):
 *   task.artifacts[].parts[].text  →  task.status.message.parts[].text  →  history 末条 agent 消息
 */
function extractText(task: any): string {
  if (!task || typeof task !== 'object') return '';

  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  for (const art of artifacts) {
    const t = partsText(art?.parts);
    if (t.trim()) return t;
  }

  const statusMsg = task.status?.message;
  if (statusMsg) {
    const role = String(statusMsg.role ?? '').toLowerCase();
    if (role === 'agent' || role === 'role_agent' || role === '') {
      const t = partsText(statusMsg.parts);
      if (t.trim()) return t;
    }
  }

  const history = Array.isArray(task.history) ? task.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const role = String(m?.role ?? '').toLowerCase();
    if (role === 'user' || role === 'role_user') continue;
    const t = partsText(m?.parts);
    if (t.trim()) return t;
  }

  return '';
}

function emptyCaps() {
  return { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
}

/** 从 Card 推断底层框架 (仅用于展示, 不参与控制流) */
function inferFramework(card: A2ACard): string {
  const blob = `${card.name ?? ''} ${card.description ?? ''} ${card.provider?.organization ?? ''}`.toLowerCase();
  if (blob.includes('hermes')) return 'hermes';
  if (blob.includes('openclaw')) return 'openclaw';
  return 'a2a';
}

function simpleChecksum(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ── 会话 ──

async function createA2ASession(conn: AgentConnection, opts: SessionCreateOpts): Promise<AgentSession> {
  // A2A 无显式建会话动作: contextId 即会话标识, 首次发消息时才在远端产生 Task
  const contextId = `ctx-${crypto.randomUUID()}`;
  return {
    id: contextId,
    connectionId: conn.id,
    teamId: opts.teamId,
    projectId: opts.projectId,
    remoteSessionId: contextId,
    title: opts.title ?? 'A2A 会话',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'idle',
    meta: { contextId, profile: conn.profile, instructions: opts.instructions },
  };
}

/** ListTasks → 按 contextId 聚合为会话 */
async function listA2ASessions(conn: AgentConnection): Promise<AgentSession[]> {
  let tasks: any[];
  try {
    const result = await rpc(conn, 'ListTasks', { pageSize: 100 }, { timeout: 15_000 });
    tasks = Array.isArray(result?.tasks) ? result.tasks : Array.isArray(result) ? result : [];
  } catch {
    return []; // ListTasks 非强制实现 (A2A 标为 optional), 失败不阻断
  }

  const byCtx = new Map<string, AgentSession>();
  for (const t of tasks) {
    const ctx = String(t?.contextId ?? '');
    if (!ctx) continue;
    const text = extractText(t);
    const existing = byCtx.get(ctx);
    if (existing) {
      // 同一 contextId 多任务: 保留最新 (列表顺序即时间序, 后者更新)
      existing.lastActiveAt = Date.now();
      if (text.trim()) existing.title = text.slice(0, 40).replace(/\s+/g, ' ').trim();
      continue;
    }
    byCtx.set(ctx, {
      id: ctx,
      connectionId: conn.id,
      remoteSessionId: ctx,
      title: text.trim() ? text.slice(0, 40).replace(/\s+/g, ' ').trim() : `会话 ${ctx.slice(0, 12)}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      status: isFailed(t?.status?.state) ? 'error' : isTerminal(t?.status?.state) ? 'done' : 'running',
      meta: { contextId: ctx, taskId: t?.id, state: t?.status?.state },
    });
  }
  return [...byCtx.values()];
}

// ── 发消息 ──

function buildMessage(contextId: string, text: string) {
  return {
    kind: 'message',
    role: 'user',
    messageId: crypto.randomUUID(),
    contextId,
    parts: [{ kind: 'text', text, mediaType: 'text/plain' }],
  };
}

async function sendA2AMessage(
  conn: AgentConnection,
  contextId: string,
  text: string
): Promise<StreamHandle> {
  const card = await fetchCard(conn);
  const result = await rpc(conn, 'SendMessage', { message: buildMessage(contextId, text) }, { card });

  let task: any = result?.task ?? (result?.id ? result : null);
  const taskId: string | undefined = task?.id;
  if (taskId) lastTaskId.set(`${conn.id}:${contextId}`, taskId);

  // 非终态 → 轮询 GetTask (OpenClaw 同步返回终态, 长任务场景才走这里)
  if (taskId && !isTerminal(task?.status?.state)) {
    const deadline = Date.now() + agentTimeoutMs();
    const maxPolls = Math.ceil(agentTimeoutMs() / POLL_INTERVAL_MS);
    for (let i = 0; i < maxPolls && Date.now() < deadline; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        task = await rpc(conn, 'GetTask', { id: taskId }, { card, timeout: 15_000 });
      } catch {
        continue; // 单次轮询失败不放弃, 继续等
      }
      if (isTerminal(task?.status?.state)) break;
    }
    if (!isTerminal(task?.status?.state)) {
      throw new A2AError('CONN_TIMEOUT', `任务 ${taskId} 在 ${agentTimeoutMs() / 1000}s 内未完成 — 远端可能仍在执行`);
    }
  }

  // 终态但无文本 (Hermes 部分场景) → GetTask 再取一次 (可能带 history/artifacts)
  let response = extractText(task);
  if (!response.trim() && taskId) {
    try {
      const fetched = await rpc(conn, 'GetTask', { id: taskId }, { card, timeout: 15_000 });
      response = extractText(fetched) || response;
    } catch { /* 保持原结果 */ }
  }

  const state = task?.status?.state;
  if (isFailed(state) && !response.trim()) {
    throw new A2AError('INTERNAL', `A2A 任务失败 (state=${state})`);
  }

  return {
    sessionId: contextId,
    streamId: `a2a-${taskId ?? Date.now()}`,
    response,
    taskId,
    state,
  };
}

// ── 能力编目 (只读) ──

async function listA2ACapabilities(conn: AgentConnection): Promise<CapabilityMeta[]> {
  const card = await fetchCard(conn);
  const skills = Array.isArray(card.skills) ? card.skills : [];
  return skills.map((s) => {
    const serialized = JSON.stringify(s);
    return {
      name: s.id ?? s.name ?? 'unnamed',
      type: 'skill',
      version: card.version,
      checksum: simpleChecksum(serialized),
      sizeBytes: serialized.length,
    };
  });
}

function unsupported(conn: AgentConnection, name: string, action: string): SyncResult {
  return {
    ok: false,
    targetConnectionId: conn.id,
    capabilityName: name,
    action: 'failed',
    error: `A2A 不支持${action}: Agent Card 的 skills 是能力声明, 不是可同步的文件`,
  };
}

// ── 驱动 ──

export const a2aDriver: AgentConnectionDriver = {
  kind: 'a2a',

  async test(baseUrl: string, auth: AgentConnection['auth']): Promise<HealthProbe> {
    const start = Date.now();
    try {
      const conn: AgentConnection = {
        id: 'probe', name: 'probe', kind: 'a2a',
        endpoint: { baseUrl }, auth,
        status: 'disconnected', capabilities: emptyCaps(),
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      const card = await fetchCard(conn, { force: true });
      const skills = Array.isArray(card.skills) ? card.skills : [];
      return {
        ok: true,
        latencyMs: Date.now() - start,
        capabilities: {
          sessions: true,
          teams: false,
          skills: skills.length > 0,
          plugins: false,
          mcp: false,
          streaming: !!card.capabilities?.streaming,
        },
        remoteInfo: {
          kind: 'a2a',
          agentName: card.name,
          version: card.version,
          framework: inferFramework(card),
          protocolVersion: card.supportedInterfaces?.[0]?.protocolVersion ?? '1.0',
          jsonRpcUrl: await jsonRpcUrl(conn, card),
          skillCount: skills.length,
        },
      };
    } catch (e: any) {
      const code = e instanceof A2AError ? e.code : 'INTERNAL';
      return {
        ok: false,
        latencyMs: Date.now() - start,
        capabilities: emptyCaps(),
        error: `[${code}] ${e?.message ?? e}`,
      };
    }
  },

  listSessions: listA2ASessions,
  createSession: createA2ASession,
  resumeSession: async () => { /* A2A 无 resume: contextId 即上下文 */ },
  deleteSession: async () => { /* A2A 无按 contextId 删除任务的语义 */ },

  sendMessage: (conn, sessionId, text) => sendA2AMessage(conn, sessionId, text),

  async stopSession(conn, sessionId) {
    const taskId = lastTaskId.get(`${conn.id}:${sessionId}`);
    if (!taskId) return; // 该会话尚无任务可取消
    try {
      await rpc(conn, 'CancelTask', { id: taskId }, { timeout: 10_000 });
    } catch {
      // 远端可能已终态或不支持 CancelTask — 静默降级
    }
  },

  listCapabilities: listA2ACapabilities,
  pushCapability: (conn, cap: Capability) => Promise.resolve(unsupported(conn, cap.name, '能力推送')),
  pullCapability: (conn, name) =>
    Promise.reject(new A2AError('UNSUPPORTED', `A2A 不支持拉取能力 "${name}": skills 是声明而非文件`)),
  diffCapability: async (_conn, cap): Promise<DiffResult> => ({
    added: [], changed: [], removed: [], unchanged: [cap.name],
  }),
  deleteCapability: (conn, name) =>
    Promise.reject(new A2AError('UNSUPPORTED', `A2A 不支持删除能力 "${name}": skills 由对端 Agent Card 声明`)),
};
