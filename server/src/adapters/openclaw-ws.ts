import WebSocket from 'ws';
import crypto from 'crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

// ── OpenClaw Gateway WebSocket 驱动 ──
// 直接通过 WS (ws://127.0.0.1:10089) 连接 Gateway, 使用设备身份签名认证
// 拥有完整 operator 权限, 比 CLI 驱动更快 (无需子进程)
//
// 关键破解: 设备签名 payload 需要 v3| 前缀
//   v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
// 签名: base64url(Ed25519_sign(privateKey, utf8(payload)))
// 公钥: base64url(rawPublicKey)  (去掉 SPKI 前缀后的 32 字节)

const GATEWAY_WS_URL = process.env.AOC_GATEWAY_WS_URL ?? 'ws://127.0.0.1:10089';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const OPERATOR_SCOPES = [
  'operator.admin', 'operator.approvals', 'operator.pairing',
  'operator.read', 'operator.talk.secrets', 'operator.write',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _cachedToken: string | null = null;
let _cachedCfgTs = 0;
let _cachedDevice: { deviceId: string; publicKeyPem: string; privateKeyPem: string } | null = null;

// ── 本地 Gateway 凭据加载 ──

function lazyReadFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function getGatewayToken(): string {
  const cfgPath = path.join(os.homedir(), '.easyclaw', 'easyclaw.json');
  try {
    const stat = fs.statSync(cfgPath);
    if (stat.mtimeMs > _cachedCfgTs || _cachedToken === null) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const cfg = JSON.parse(raw);
      const t = cfg?.gateway?.auth?.token;
      if (typeof t === 'string' && t.trim()) _cachedToken = t.trim();
      _cachedCfgTs = stat.mtimeMs;
    }
  } catch {
    // fall through
  }
  return _cachedToken ?? '';
}

function getDeviceIdentity() {
  if (_cachedDevice) return _cachedDevice;
  const p = path.join(os.homedir(), '.easyclaw', 'identity', 'device.json');
  const raw = lazyReadFile(p);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d?.deviceId && d?.publicKeyPem && d?.privateKeyPem) {
      _cachedDevice = {
        deviceId: d.deviceId, publicKeyPem: d.publicKeyPem, privateKeyPem: d.privateKeyPem,
      };
      return _cachedDevice;
    }
  } catch {
    // ignore
  }
  return null;
}

// ── 签名工具 ──

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return spki.subarray(ED25519_SPKI_PREFIX.length);
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string; clientId: string; clientMode: string; role: string;
  scopes: string[]; signedAtMs: number; token: string; nonce: string;
  platform: string; deviceFamily: string;
}): string {
  return [
    'v3',
    params.deviceId, params.clientId, params.clientMode, params.role,
    params.scopes.join(','), String(params.signedAtMs), params.token,
    params.nonce, params.platform, params.deviceFamily,
  ].join('|');
}

// ── WebSocket Gateway 客户端 ──

interface PendingRequest {
  resolve: (msg: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  // 多响应模式: handler 返回 true 表示已解决, false 表示等待更多响应
  onResponse?: (msg: any) => boolean;
}

class GatewayWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private seq = 0;
  private connecting: Promise<void> | null = null;
  private connected = false;

  constructor(private url: string = GATEWAY_WS_URL) {}

  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = this._connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const connTimeout = setTimeout(() => {
        reject(new Error('WS connect timeout'));
        try { ws.close(); } catch {}
      }, 10_000);

      ws.on('open', () => {});

      ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          this._sendConnect(msg.payload?.nonce)
            .then(() => {
              clearTimeout(connTimeout);
              this.connected = true;
              resolve();
            })
            .catch(reject);
          return;
        }

        if (msg.type === 'res' && msg.id) {
          // Handle the connect handshake response specially
          if (String(msg.id) === 'connect' && (this as any).__connectHandler) {
            const h = (this as any).__connectHandler;
            (this as any).__connectHandler = null;
            h(msg);
            return;
          }
          const p = this.pending.get(String(msg.id));
          if (p) {
            // 多响应模式: 由 handler 决定是否已解决
            if (p.onResponse) {
              const resolved = p.onResponse(msg);
              if (resolved) {
                clearTimeout(p.timer);
                this.pending.delete(String(msg.id));
              }
            } else {
              clearTimeout(p.timer);
              this.pending.delete(String(msg.id));
              if (msg.ok) p.resolve(msg.payload ?? msg.result ?? {});
              else p.reject(new Error(msg.error?.message ?? `Gateway error (${msg.error?.code ?? 'UNKNOWN'})`));
            }
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connTimeout);
        if (!this.connected) reject(err);
      });

      ws.on('close', () => {
        this.connected = false;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('Gateway WS closed'));
        }
        this.pending.clear();
        this.ws = null;
      });
    });
  }

  private _sendConnect(nonce: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getGatewayToken();
      const device = getDeviceIdentity();
      if (!device) return reject(new Error('Device identity not found'));
      if (!token) return reject(new Error('Gateway token not found'));

      const signedAtMs = Date.now();
      const role = 'operator';
      const platform = 'node';
      const deviceFamily = 'node-backend';
      const scopes = OPERATOR_SCOPES;
      const clientId = 'gateway-client';
      const clientMode = 'backend';

      const payload = buildDeviceAuthPayloadV3({
        deviceId: device.deviceId, clientId, clientMode, role, scopes,
        signedAtMs, token, nonce, platform, deviceFamily,
      });
      const signature = signDevicePayload(device.privateKeyPem, payload);
      const publicKey = base64UrlEncode(derivePublicKeyRaw(device.publicKeyPem));

      const params = {
        client: { id: clientId, mode: clientMode, version: '1.0.0', platform, deviceFamily },
        minProtocol: 3,
        maxProtocol: 3,
        caps: [] as string[],
        auth: { token },
        role,
        scopes,
        device: { id: device.deviceId, publicKey, signature, signedAt: signedAtMs, nonce },
      };

      const id = 'connect';
      const reqTimeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Gateway connect timeout'));
      }, 10_000);
      const handler = (msg: any) => {
        if (msg.id === id) {
          clearTimeout(reqTimeout);
          this.pending.delete(id);
          if (msg.ok) resolve();
          else reject(new Error(msg.error?.message ?? 'Gateway connect failed'));
        }
      };
      // Register a one-shot handler; the message handler will call it
      (this as any).__connectHandler = handler;
      try {
        this.ws?.send(JSON.stringify({ type: 'req', id, method: 'connect', params }));
      } catch (e: any) {
        clearTimeout(reqTimeout);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  request<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.connected) {
      // For connect, allow before connected flag
      if (method !== 'connect') {
        return Promise.reject(new Error('Gateway WS not connected'));
      }
    }
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws?.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (e: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /**
   * agentCall — 专用两阶段响应:
   *   1) Gateway 先回 {status:'accepted', runId}
   *   2) Agent 完成后回 {status:'ok', result:{payloads}}
   * 普通 request() 会在第一阶段就 resolve, 导致丢失最终结果。
   */
  async agentCall(params: { sessionId?: string; sessionKey?: string; message: string; idempotencyKey?: string }, timeoutMs = 120_000): Promise<any> {
    if (!this.connected) throw new Error('Gateway WS not connected');
    const id = `a${++this.seq}`;
    const { sessionId, sessionKey, message, idempotencyKey } = params;

    return new Promise((resolve, reject) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.pending.delete(id);
          reject(new Error(`agentCall timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (payload: any) => { /* unused */ },
        reject: (err: Error) => { /* unused */ },
        timer,
        onResponse: (msg: any): boolean => {
          const payload = msg.payload ?? msg.result ?? {};
          // Phase 1: {status:'accepted', runId} – wait for more
          if (payload?.status === 'accepted') {
            return false;
          }
          // Phase 2: final result
          if (!resolved) {
            resolved = true;
            resolve(payload);
            return true;
          }
          return true;
        },
      });

      try {
        const reqParams: Record<string, unknown> = { message };
        if (sessionId) reqParams.sessionId = sessionId;
        if (sessionKey) reqParams.sessionKey = sessionKey;
        if (idempotencyKey) reqParams.idempotencyKey = idempotencyKey;
        this.ws?.send(JSON.stringify({ type: 'req', id, method: 'agent', params: reqParams }));
      } catch (e: any) {
        resolved = true;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  close(): void {
    try { this.ws?.close(); } catch {}
    this.connected = false;
    this.ws = null;
  }
}

// ── Driver ──

function emptyCaps() {
  return { sessions: false, teams: false, skills: false, plugins: false, mcp: false, streaming: false };
}

function toSession(s: any, connectionId?: string): AgentSession {
  return {
    id: s.sessionId ?? s.id ?? s.key ?? randomUUID(),
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

export const openclawWsDriver: AgentConnectionDriver = {
  kind: 'openclaw',

  async test(_baseUrl?: string): Promise<HealthProbe> {
    const start = Date.now();
    const client = new GatewayWsClient();
    try {
      await client.connect();
      const health = await client.request<any>('health', {});
      return {
        ok: health?.ok !== false,
        latencyMs: Date.now() - start,
        capabilities: { sessions: true, teams: true, skills: true, plugins: true, mcp: true, streaming: true },
        remoteInfo: { version: health?.version ?? 'ws' },
      };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - start, capabilities: emptyCaps(), error: e.message };
    } finally {
      client.close();
    }
  },

  async listSessions(conn: AgentConnection): Promise<AgentSession[]> {
    const client = new GatewayWsClient();
    try {
      await client.connect();
      const result = await client.request<any>('sessions.list', {});
      return (result?.sessions ?? []).map((s: any) => toSession(s, conn.id));
    } finally {
      client.close();
    }
  },

  async createSession(conn, opts?: SessionCreateOpts): Promise<AgentSession> {
    const client = new GatewayWsClient();
    try {
      await client.connect();
      const params: Record<string, unknown> = {};
      if (opts?.model) params.model = opts.model;
      if (opts?.title) params.label = opts.title;
      const result = await client.request<any>('sessions.create', params);
      return toSession({ ...result, title: opts?.title ?? '未命名会话' }, conn.id);
    } finally {
      client.close();
    }
  },

  async resumeSession(_conn, sessionKey): Promise<void> {
    const client = new GatewayWsClient();
    try {
      await client.connect();
      await client.request('sessions.resume', { key: sessionKey }, 15_000);
    } catch (e: any) {
      console.warn(`[WS] resumeSession failed: ${e.message}`);
    } finally {
      client.close();
    }
  },

  async deleteSession(_conn, sessionKey): Promise<void> {
    const client = new GatewayWsClient();
    try {
      await client.connect();
      // Gateway accepts both key and sessionId
      await client.request('sessions.delete', { key: sessionKey, sessionId: sessionKey }, 30_000);
    } catch (e: any) {
      // Don't block UI if remote delete fails — log and continue
      console.warn(`[WS] deleteSession failed for ${sessionKey}: ${e.message}`);
    } finally {
      client.close();
    }
  },

  async sendMessage(_conn, sessionId, text): Promise<StreamHandle> {
    const client = new GatewayWsClient();
    try {
      await client.connect();
      const idempotencyKey = `ik-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Use agentCall – waits for the FINAL response (with payloads)
      const result = await client.agentCall({
        sessionKey: sessionId, message: text, idempotencyKey,
      }, 120_000);

      // Extract response text from payloads
      const payloads = result?.result?.payloads ?? result?.payloads ?? [];
      const response = Array.isArray(payloads)
        ? payloads.map((p: any) => p?.text ?? '').filter(Boolean).join('\n')
        : '';
      const summary = result?.result?.meta?.finalAssistantVisibleText
        ?? result?.result?.meta?.finalAssistantRawText
        ?? result?.summary ?? '';

      return {
        sessionId,
        streamId: idempotencyKey,
        runId: result?.runId ?? idempotencyKey,
        response: response || summary,
      };
    } finally {
      client.close();
    }
  },

  async stopSession(_conn, sessionKey): Promise<void> {
    const client = new GatewayWsClient();
    try {
      await client.connect();
      await client.request('chat.abort', { sessionKey }, 15_000);
    } catch (e: any) {
      console.warn(`[WS] stopSession failed: ${e.message}`);
    } finally {
      client.close();
    }
  },

  async listCapabilities(_conn: AgentConnection): Promise<CapabilityMeta[]> {
    try {
      const cfgPath = path.join(os.homedir(), '.easyclaw', 'easyclaw.json');
      if (!fs.existsSync(cfgPath)) return [];
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const skills: string[] = cfg?.agents?.defaults?.skills ?? [];
      const plugins: string[] = Object.keys(cfg?.plugins?.entries ?? {})
        .filter((k) => cfg.plugins.entries[k]?.enabled);
      const metas: CapabilityMeta[] = [];
      for (const s of skills) metas.push({ name: s, type: 'skill', version: undefined, checksum: '', sizeBytes: 0 });
      for (const p of plugins) {
        if (p !== 'memory-core') metas.push({ name: p, type: 'plugin', version: undefined, checksum: '', sizeBytes: 0 });
      }
      return metas;
    } catch {
      return [];
    }
  },

  async pushCapability(_conn, cap: Capability): Promise<SyncResult> {
    getDb().prepare(`
      INSERT INTO capabilities (id, type, name, version, source_kind, payload, checksum, size_bytes, installed_on, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET checksum=excluded.checksum, size_bytes=excluded.size_bytes, payload=excluded.payload
    `).run(cap.id, cap.type, cap.name, cap.version ?? null, cap.sourceKind,
      JSON.stringify(cap.payload), cap.checksum, cap.sizeBytes, JSON.stringify(cap.installedOn), Date.now());
    return { ok: true, targetConnectionId: _conn.id, capabilityName: cap.name, action: 'pushed', newChecksum: cap.checksum };
  },

  async pullCapability(_conn, name): Promise<Capability> {
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
